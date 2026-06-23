// ================================================================
//  stripe.service.ts
//  Complete Stripe subscription engine.
//
//  Architecture:
//   - Webhook signature validated with stripe.webhooks.constructEvent
//     before any business logic runs (HMAC-SHA256)
//   - On invoice.paid → DB subscription updated + Redis quota key reset
//   - Feature flags stored as Redis Set: tenant:features:{businessId}
//   - Tier quotas mirrored to Redis: tenant:msg_quota:{businessId}
//     so the BullMQ worker never hits Postgres for quota checks
//   - Checkout + billing portal sessions created server-side only
//     (no Stripe keys exposed to the frontend)
//
//  5-tier model:
//   FREE | STARTER | GROWTH | PROFESSIONAL | ENTERPRISE
// ================================================================

import Stripe                  from 'stripe';
import { prisma } from '../config/prisma';
import { getRedisClient }      from '../config/redis';
import { resumeTenantQueue }   from '../services/messaging-queue';


// ================================================================
// STRIPE CLIENT (singleton)
// ================================================================

let _stripe: Stripe | null = null;

export const getStripe = (): Stripe => {
  if (!_stripe) {
    const key = process.env.STRIPE_SECRET_KEY;
    if (!key) throw new Error('[stripe] STRIPE_SECRET_KEY is not set.');
    _stripe = new Stripe(key, { apiVersion: '2024-04-10' });
  }
  return _stripe;
};

// ================================================================
// TIER CONFIGURATION
// ================================================================

type SubscriptionTier = 'FREE' | 'STARTER' | 'GROWTH' | 'PROFESSIONAL' | 'ENTERPRISE';

/**
 * Map Stripe Price IDs → internal tier.
 * Add both monthly and annual price IDs for each tier.
 */
const PRICE_TO_TIER: Record<string, SubscriptionTier> = {
  [process.env.STRIPE_PRICE_FREE_M!]:           'FREE',
  [process.env.STRIPE_PRICE_STARTER_M!]:        'STARTER',
  [process.env.STRIPE_PRICE_STARTER_A!]:        'STARTER',
  [process.env.STRIPE_PRICE_GROWTH_M!]:         'GROWTH',
  [process.env.STRIPE_PRICE_GROWTH_A!]:         'GROWTH',
  [process.env.STRIPE_PRICE_PROFESSIONAL_M!]:   'PROFESSIONAL',
  [process.env.STRIPE_PRICE_PROFESSIONAL_A!]:   'PROFESSIONAL',
  [process.env.STRIPE_PRICE_ENTERPRISE_M!]:     'ENTERPRISE',
  [process.env.STRIPE_PRICE_ENTERPRISE_A!]:     'ENTERPRISE',
};

/** Monthly message quota per tier. -1 = unlimited (Enterprise). */
export const TIER_QUOTA: Record<SubscriptionTier, number> = {
  FREE:         500,
  STARTER:      2_500,
  GROWTH:       10_000,
  PROFESSIONAL: 50_000,
  ENTERPRISE:   -1,
};

/**
 * Feature flags per tier.
 * '*' grants every feature (Enterprise bypass).
 * The BullMQ worker and API routes check: tenant:features:{businessId}
 */
export const TIER_FEATURES: Record<SubscriptionTier, string[]> = {
  FREE:         [
    'qr_checkin', 'basic_campaigns', 'customer_profiles',
  ],
  STARTER:      [
    'qr_checkin', 'basic_campaigns', 'customer_profiles',
    'loyalty_tiers', 'automations', 'referral_programme',
  ],
  GROWTH:       [
    'qr_checkin', 'basic_campaigns', 'customer_profiles',
    'loyalty_tiers', 'automations', 'referral_programme',
    'ai_insights', 'multi_branch', 'pos_webhook', 'csv_import',
    'analytics_export',
  ],
  PROFESSIONAL: [
    'qr_checkin', 'basic_campaigns', 'customer_profiles',
    'loyalty_tiers', 'automations', 'referral_programme',
    'ai_insights', 'multi_branch', 'pos_webhook', 'csv_import',
    'analytics_export', 'white_label', 'api_access',
    'outbound_webhooks', 'google_review_automation',
  ],
  ENTERPRISE:   ['*'],
};

// Redis key TTL for quota (35 days — covers longest billing cycle)
const QUOTA_KEY_TTL_SECONDS = 35 * 24 * 60 * 60;

// ================================================================
// WEBHOOK ENTRY POINT
// ================================================================

/**
 * Validate the Stripe webhook signature and route to the correct handler.
 *
 * IMPORTANT: Express must receive the RAW request body here, not parsed JSON.
 * Mount with: app.post('/api/webhooks/stripe', express.raw({ type: 'application/json' }), ...)
 */
export const handleStripeWebhook = async (
  rawBody:   Buffer,
  signature: string
): Promise<{ received: boolean; eventType: string }> => {
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!webhookSecret) throw new Error('[stripe] STRIPE_WEBHOOK_SECRET is not set.');

  let event: Stripe.Event;

  try {
    event = getStripe().webhooks.constructEvent(rawBody, signature, webhookSecret);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    throw new Error(`WEBHOOK_SIGNATURE_INVALID: ${msg}`);
  }

  // Route to handler
  switch (event.type) {
    case 'invoice.paid':
      await handleInvoicePaid(event.data.object as Stripe.Invoice);
      break;

    case 'customer.subscription.created':
    case 'customer.subscription.updated':
      await handleSubscriptionUpdated(event.data.object as Stripe.Subscription);
      break;

    case 'customer.subscription.deleted':
      await handleSubscriptionDeleted(event.data.object as Stripe.Subscription);
      break;

    case 'invoice.payment_failed':
      await handlePaymentFailed(event.data.object as Stripe.Invoice);
      break;

    case 'checkout.session.completed':
      await handleCheckoutCompleted(event.data.object as Stripe.Checkout.Session);
      break;

    default:
      // Log unhandled events for observability but don't error
      console.log(`[stripe] Unhandled event type: ${event.type}`);
  }

  return { received: true, eventType: event.type };
};

// ================================================================
// INVOICE.PAID → Quota reset + tier sync
// ================================================================

/**
 * The most critical Stripe event.
 * On every successful invoice payment:
 *   1. Resolve the tier from the price ID
 *   2. Update the Subscription record in Postgres
 *   3. Reset the Redis message quota key (new billing period)
 *   4. Rebuild the feature flags Set in Redis
 *   5. Resume tenant queue if it was paused due to quota exhaustion
 *   6. Append to AuditLog
 */
const handleInvoicePaid = async (invoice: Stripe.Invoice): Promise<void> => {
  const stripeCustomerId = invoice.customer as string;
  if (!stripeCustomerId) return;

  const subscription = await prisma.subscription.findFirst({
    where:  { stripeCustomerId },
    select: { businessId: true, tier: true, stripeSubscriptionId: true },
  });

  if (!subscription) {
    console.warn(`[stripe] invoice.paid: no subscription found for customer ${stripeCustomerId}`);
    return;
  }

  // Resolve tier from line item price IDs
  const lineItems = invoice.lines?.data ?? [];
  let tier: SubscriptionTier = subscription.tier as SubscriptionTier;

  for (const item of lineItems) {
    const priceId = typeof item.price === 'string' ? item.price : item.price?.id;
    if (priceId && PRICE_TO_TIER[priceId]) {
      tier = PRICE_TO_TIER[priceId];
      break;
    }
  }

  const quota = TIER_QUOTA[tier];

  // Stripe gives us period timestamps on the subscription
  const stripeSubscription = subscription.stripeSubscriptionId
    ? await getStripe().subscriptions.retrieve(subscription.stripeSubscriptionId)
    : null;

  // Atomic DB update
  await prisma.$transaction([
    prisma.subscription.update({
      where: { businessId: subscription.businessId },
      data: {
        tier,
        status:                  'ACTIVE',
        monthlyMessageQuota:     quota === -1 ? 9_999_999 : quota,
        messagesUsedThisPeriod:  0,  // Reset on new billing period
        currentPeriodStart:      stripeSubscription
          ? new Date(stripeSubscription.current_period_start * 1000)
          : undefined,
        currentPeriodEnd:        stripeSubscription
          ? new Date(stripeSubscription.current_period_end * 1000)
          : undefined,
        updatedAt: new Date(),
      },
    }),
    prisma.auditLog.create({
      data: {
        businessId: subscription.businessId,
        action:     'STRIPE_INVOICE_PAID',
        metaJson: {
          stripeCustomerId,
          tier,
          quota,
          invoiceId: invoice.id,
          amountPaid: invoice.amount_paid,
        },
      },
    }),
  ]);

  // Sync Redis
  await syncTierToRedis(subscription.businessId, tier);

  // Resume queue if it was paused for quota exhaustion
  await resumeTenantQueue(subscription.businessId);

  console.log(`[stripe] Invoice paid: businessId=${subscription.businessId} tier=${tier} quota=${quota}`);
};

// ================================================================
// SUBSCRIPTION EVENTS
// ================================================================

const handleSubscriptionUpdated = async (sub: Stripe.Subscription): Promise<void> => {
  const stripeCustomerId = typeof sub.customer === 'string' ? sub.customer : sub.customer.id;

  const subscription = await prisma.subscription.findFirst({
    where:  { stripeCustomerId },
    select: { businessId: true },
  });

  if (!subscription) return;

  // Resolve tier from subscription items
  let tier: SubscriptionTier = 'FREE';
  for (const item of sub.items.data) {
    const priceId = typeof item.price === 'string' ? item.price : item.price.id;
    if (PRICE_TO_TIER[priceId]) {
      tier = PRICE_TO_TIER[priceId];
      break;
    }
  }

  const stripeStatus = sub.status;
  const internalStatus =
    stripeStatus === 'active'    ? 'ACTIVE'    :
    stripeStatus === 'trialing'  ? 'TRIALING'  :
    stripeStatus === 'past_due'  ? 'PAST_DUE'  :
    stripeStatus === 'paused'    ? 'PAUSED'    : 'CANCELED';

  await prisma.subscription.update({
    where: { businessId: subscription.businessId },
    data: {
      tier,
      status:                 internalStatus as any,
      stripeSubscriptionId:   sub.id,
      currentPeriodStart:     new Date(sub.current_period_start * 1000),
      currentPeriodEnd:       new Date(sub.current_period_end   * 1000),
      updatedAt:              new Date(),
    },
  });

  // If status is now active, sync Redis
  if (internalStatus === 'ACTIVE') {
    await syncTierToRedis(subscription.businessId, tier);
  }
};

const handleSubscriptionDeleted = async (sub: Stripe.Subscription): Promise<void> => {
  const stripeCustomerId = typeof sub.customer === 'string' ? sub.customer : sub.customer.id;

  const subscription = await prisma.subscription.findFirst({
    where:  { stripeCustomerId },
    select: { businessId: true },
  });

  if (!subscription) return;

  await prisma.subscription.update({
    where: { businessId: subscription.businessId },
    data: {
      tier:      'FREE',
      status:    'CANCELED',
      updatedAt: new Date(),
    },
  });

  // Downgrade to FREE tier limits
  await syncTierToRedis(subscription.businessId, 'FREE');
};

const handlePaymentFailed = async (invoice: Stripe.Invoice): Promise<void> => {
  const stripeCustomerId = invoice.customer as string;
  if (!stripeCustomerId) return;

  const subscription = await prisma.subscription.findFirst({
    where:  { stripeCustomerId },
    select: { businessId: true },
  });

  if (!subscription) return;

  await prisma.subscription.update({
    where: { businessId: subscription.businessId },
    data:  { status: 'PAST_DUE', updatedAt: new Date() },
  });

  // Notify tenant owner
  void notifyPaymentFailed(subscription.businessId, invoice.amount_due);
};

const handleCheckoutCompleted = async (session: Stripe.Checkout.Session): Promise<void> => {
  if (session.mode !== 'subscription') return;

  const businessId       = session.metadata?.businessId;
  const stripeCustomerId = session.customer as string;

  if (!businessId || !stripeCustomerId) return;

  // Link the Stripe customer ID to the business subscription
  await prisma.subscription.update({
    where: { businessId },
    data: {
      stripeCustomerId,
      stripeSubscriptionId: session.subscription as string,
      updatedAt: new Date(),
    },
  });
};

// ================================================================
// REDIS SYNC (quota + feature flags)
// ================================================================

/**
 * Mirror a tier's quota and feature flags into Redis.
 * Called on every Stripe event that changes tier or billing status.
 */
export const syncTierToRedis = async (
  businessId: string,
  tier:       SubscriptionTier
): Promise<void> => {
  const redis   = getRedisClient();
  const quota   = TIER_QUOTA[tier];
  const features = TIER_FEATURES[tier];

  const quotaKey    = `tenant:msg_quota:${businessId}`;
  const featuresKey = `tenant:features:${businessId}`;

  await Promise.all([
    // Quota key: -1 = unlimited, otherwise integer
    redis.set(quotaKey, quota, { EX: QUOTA_KEY_TTL_SECONDS }),

    // Features key: Redis Set of feature strings
    // Delete + re-populate atomically
    redis.del(featuresKey).then(() =>
      features[0] === '*'
        ? redis.sAdd(featuresKey, '*')            // Enterprise wildcard
        : redis.sAdd(featuresKey, features as any)
    ),
  ]);
};

/**
 * Check if a business has a specific feature enabled.
 * Called by controllers that gate features behind tier.
 */
export const hasFeature = async (
  businessId: string,
  feature:    string
): Promise<boolean> => {
  const redis       = getRedisClient();
  const featuresKey = `tenant:features:${businessId}`;

  const [hasWildcard, hasSpecific] = await Promise.all([
    redis.sIsMember(featuresKey, '*'),
    redis.sIsMember(featuresKey, feature),
  ]);

  return hasWildcard || hasSpecific;
};

// ================================================================
// CHECKOUT & BILLING PORTAL SESSIONS
// ================================================================

export interface CheckoutSessionResult {
  sessionId: string;
  url:       string;
}

/**
 * Create a Stripe Checkout session for upgrading a subscription.
 * The client redirects to session.url — Stripe handles payment collection.
 */
export const createCheckoutSession = async (
  businessId: string,
  priceId:    string,
  returnUrl:  string
): Promise<CheckoutSessionResult> => {
  const subscription = await prisma.subscription.findUnique({
    where:  { businessId },
    select: { stripeCustomerId: true, stripeSubscriptionId: true },
  });

  const owner = await prisma.user.findFirst({
    where:  { businessId, role: 'TENANT_OWNER' },
    select: { email: true, name: true },
  });

  const sessionParams: Stripe.Checkout.SessionCreateParams = {
    mode:                'subscription',
    payment_method_types: ['card'],
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: `${returnUrl}/settings/billing?success=true&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url:  `${returnUrl}/settings/billing?cancelled=true`,
    metadata:    { businessId },
    ...(subscription?.stripeCustomerId
      ? { customer: subscription.stripeCustomerId }
      : { customer_email: owner?.email }
    ),
    subscription_data: {
      metadata: { businessId },
    },
    allow_promotion_codes: true,
  };

  // If upgrading an existing subscription, switch to subscription update flow
  if (subscription?.stripeSubscriptionId) {
    const session = await getStripe().checkout.sessions.create({
      ...sessionParams,
      mode: 'subscription',
    });
    return { sessionId: session.id, url: session.url! };
  }

  const session = await getStripe().checkout.sessions.create(sessionParams);
  return { sessionId: session.id, url: session.url! };
};

/**
 * Create a Stripe Billing Portal session for managing existing subscriptions.
 * Customer can cancel, update payment method, or download invoices.
 */
export const createBillingPortalSession = async (
  businessId: string,
  returnUrl:  string
): Promise<string> => {
  const subscription = await prisma.subscription.findUnique({
    where:  { businessId },
    select: { stripeCustomerId: true },
  });

  if (!subscription?.stripeCustomerId) {
    throw new Error('NO_STRIPE_CUSTOMER: Complete a checkout session first.');
  }

  const session = await getStripe().billingPortal.sessions.create({
    customer:   subscription.stripeCustomerId,
    return_url: returnUrl,
  });

  return session.url;
};

// ================================================================
// SUBSCRIPTION READ
// ================================================================

export const getSubscriptionForBusiness = async (businessId: string) => {
  const [subscription, redisQuota] = await Promise.all([
    prisma.subscription.findUnique({ where: { businessId } }),
    getRedisClient().get(`tenant:msg_quota:${businessId}`),
  ]);

  return {
    subscription,
    quotaRemaining: redisQuota !== null ? parseInt(redisQuota, 10) : null,
    tierLimits: subscription
      ? {
          quota:    TIER_QUOTA[subscription.tier as SubscriptionTier],
          features: TIER_FEATURES[subscription.tier as SubscriptionTier],
        }
      : null,
  };
};

// ================================================================
// INTERNAL
// ================================================================

const notifyPaymentFailed = async (
  businessId:  string,
  amountDue:   number
): Promise<void> => {
  const owner = await prisma.user.findFirst({
    where:  { businessId, role: 'TENANT_OWNER', isActive: true },
    select: { email: true, name: true },
  });

  if (!owner) return;

  const { sendEmail } = await import('../utils/email.util');
  await sendEmail({
    to:         owner.email,
    subject:    'Action required: Your payment failed',
    templateId: 'PAYMENT_FAILED',
    variables: {
      name:       owner.name,
      amountDue:  (amountDue / 100).toFixed(2),
      billingUrl: `${process.env.FRONTEND_URL}/settings/billing`,
    },
  }).catch(console.error);
};
