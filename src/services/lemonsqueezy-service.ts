// ================================================================
//  lemonsqueezy-service.ts
//  Lemon Squeezy checkout creation + webhook processing.
//
//  Security:
//   - Webhook signature verified (HMAC-SHA256, timing-safe).
//   - Tenant is linked from checkout custom metadata (business_id), which
//     the backend set when creating the checkout — never from client body.
//   - Idempotent: a duplicate webhook (same dedupe key) is ignored.
//   - Entitlements are based on variant → plan, never on discounted price.
// ================================================================

import crypto from 'crypto';
import { prisma } from '../config/prisma';
import {
  LS_PLANS, LS_PRODUCT_ID, LS_STORE_ID, LS_CHECKOUT_URL,
  variantToPlan, slugToPlan, TIER_QUOTA, lsConfigured,
  type LsPlan,
} from '../config/lemonsqueezy';

const LS_API = 'https://api.lemonsqueezy.com/v1';
const appUrl = () => process.env.APP_URL || process.env.FRONTEND_URL || 'https://app.theloyaly.com';

// ── Webhook signature ──────────────────────────────────────────────
export const verifyWebhookSignature = (rawBody: Buffer, signature: string | undefined): boolean => {
  const secret = process.env.LEMONSQUEEZY_WEBHOOK_SECRET;
  if (!secret || !signature) return false;
  const digest = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(digest, 'hex'), Buffer.from(signature, 'hex'));
  } catch { return false; }
};

// ── Checkout creation ──────────────────────────────────────────────
export interface CheckoutInput { planSlug: string; userId: string; businessId: string; email?: string; }

/**
 * Create a plan-specific Lemon Squeezy checkout URL with tenant metadata.
 * Falls back to the public checkout link (no metadata) if the API key isn't
 * configured yet — so the button still works while the store is pending.
 */
export const createCheckout = async (input: CheckoutInput): Promise<{ url: string; metadataAttached: boolean }> => {
  const plan = slugToPlan(input.planSlug);
  if (!plan) throw new Error('INVALID_PLAN');

  const returnUrl = `${appUrl()}/billing/success`;
  if (!lsConfigured() || !LS_STORE_ID) {
    // Store/API not active yet → public link, no metadata. Webhook will still
    // map by variant; account linking then relies on email + manual review.
    return { url: LS_CHECKOUT_URL, metadataAttached: false };
  }

  const body = {
    data: {
      type: 'checkouts',
      attributes: {
        checkout_data: {
          email: input.email,
          custom: {
            user_id: input.userId,
            business_id: input.businessId,
            plan_slug: plan.slug,
            source: 'app',
          },
        },
        product_options: { redirect_url: returnUrl },
      },
      relationships: {
        store:   { data: { type: 'stores',   id: String(LS_STORE_ID) } },
        variant: { data: { type: 'variants', id: String(plan.variantId) } },
      },
    },
  };

  const res = await fetch(`${LS_API}/checkouts`, {
    method: 'POST',
    headers: {
      Accept: 'application/vnd.api+json',
      'Content-Type': 'application/vnd.api+json',
      Authorization: `Bearer ${process.env.LEMONSQUEEZY_API_KEY}`,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`LS_CHECKOUT_FAILED ${res.status}: ${txt.slice(0, 300)}`);
  }
  const json = await res.json() as any;
  const url = json?.data?.attributes?.url;
  if (!url) throw new Error('LS_CHECKOUT_NO_URL');
  return { url, metadataAttached: true };
};

// ── Status mapping ─────────────────────────────────────────────────
// LS subscription status → internal SubscriptionStatus enum.
const mapStatus = (lsStatus: string): { internal: string; active: boolean } => {
  switch (lsStatus) {
    case 'active':
    case 'on_trial':      return { internal: 'ACTIVE', active: true };
    case 'paused':        return { internal: 'PAUSED', active: false };
    case 'past_due':      return { internal: 'PAST_DUE', active: true }; // grace: keep access
    case 'unpaid':        return { internal: 'PAST_DUE', active: false };
    case 'cancelled':     return { internal: 'CANCELED', active: true }; // keep until ends_at
    case 'expired':       return { internal: 'CANCELED', active: false };
    default:              return { internal: 'ACTIVE', active: true };
  }
};

const applyPlan = async (
  businessId: string,
  plan: LsPlan | null,
  attrs: any,
  eventName: string,
  downgradeToFree = false,
): Promise<void> => {
  const tier = downgradeToFree ? 'FREE' : (plan?.tier ?? 'FREE');
  const lsStatus = String(attrs?.status ?? 'active');
  const { internal } = mapStatus(lsStatus);
  const status = downgradeToFree ? 'CANCELED' : internal;
  const quota = TIER_QUOTA[tier as keyof typeof TIER_QUOTA] ?? 100;

  const data: any = {
    tier, status, planSlug: downgradeToFree ? 'free' : plan?.slug ?? null,
    monthlyMessageQuota: quota,
    lsProductId: attrs?.product_id != null ? String(attrs.product_id) : LS_PRODUCT_ID,
    lsVariantId: attrs?.variant_id != null ? String(attrs.variant_id) : plan?.variantId ?? null,
    lsCustomerId: attrs?.customer_id != null ? String(attrs.customer_id) : undefined,
    lsOrderId: attrs?.order_id != null ? String(attrs.order_id) : undefined,
    renewsAt: attrs?.renews_at ? new Date(attrs.renews_at) : null,
    endsAt: attrs?.ends_at ? new Date(attrs.ends_at) : null,
    trialEndsAt: attrs?.trial_ends_at ? new Date(attrs.trial_ends_at) : null,
    cancelledAt: lsStatus === 'cancelled' ? new Date() : null,
    currentPeriodEnd: attrs?.renews_at ? new Date(attrs.renews_at) : (attrs?.ends_at ? new Date(attrs.ends_at) : null),
    lastSyncedAt: new Date(),
  };
  Object.keys(data).forEach(k => data[k] === undefined && delete data[k]);

  await prisma.subscription.upsert({
    where: { businessId },
    update: data,
    create: { businessId, ...data, messagesUsedThisPeriod: 0, currentPeriodStart: new Date() },
  });
  await prisma.auditLog.create({
    data: { businessId, action: 'BILLING_WEBHOOK', metaJson: { event: eventName, tier, status, lsStatus } },
  }).catch(() => {});
};

// ── Webhook processing (idempotent) ────────────────────────────────
export interface WebhookResult { ok: boolean; handled: string; duplicate?: boolean; }

export const processWebhook = async (rawBody: Buffer, signature: string | undefined): Promise<WebhookResult> => {
  if (!verifyWebhookSignature(rawBody, signature)) throw new Error('INVALID_SIGNATURE');

  const payload = JSON.parse(rawBody.toString('utf8'));
  const eventName: string = payload?.meta?.event_name ?? 'unknown';
  const custom = payload?.meta?.custom_data ?? {};
  const resource = payload?.data ?? {};
  const attrs = resource?.attributes ?? {};

  // Idempotency: ignore a duplicate delivery for the same logical change.
  const dedupeKey = crypto.createHash('sha256')
    .update(`${eventName}|${resource?.id ?? ''}|${attrs?.status ?? ''}|${attrs?.updated_at ?? ''}`)
    .digest('hex');
  try {
    await prisma.processedWebhook.create({ data: { provider: 'LEMONSQUEEZY', dedupeKey, eventName } });
  } catch {
    return { ok: true, handled: eventName, duplicate: true }; // unique constraint → already processed
  }

  // Resolve the tenant: prefer secure checkout metadata; never trust anything else.
  const businessId: string | undefined = custom?.business_id;
  if (!businessId && !eventName.startsWith('order')) {
    await prisma.auditLog.create({ data: { businessId: 'UNKNOWN', action: 'BILLING_WEBHOOK_NO_TENANT', metaJson: { event: eventName } } }).catch(() => {});
    return { ok: true, handled: `${eventName}:no-tenant` };
  }
  // Confirm the business exists (don't activate a non-existent / wrong tenant).
  if (businessId) {
    const exists = await prisma.business.findUnique({ where: { id: businessId }, select: { id: true } });
    if (!exists) return { ok: true, handled: `${eventName}:tenant-not-found` };
  }

  const plan = variantToPlan(attrs?.variant_id) ?? slugToPlan(custom?.plan_slug);

  switch (eventName) {
    case 'subscription_created':
    case 'subscription_updated':
    case 'subscription_resumed':
    case 'subscription_unpaused':
    case 'subscription_payment_success':
      if (businessId) await applyPlan(businessId, plan, attrs, eventName);
      break;
    case 'subscription_cancelled':
      // Keep paid access until period end (status cancelled, ends_at in future).
      if (businessId) await applyPlan(businessId, plan, attrs, eventName);
      break;
    case 'subscription_expired':
    case 'subscription_paused':
      // Expired → downgrade to Free. Paused → lock but keep data.
      if (businessId) await applyPlan(businessId, plan, attrs, eventName, eventName === 'subscription_expired');
      break;
    case 'subscription_payment_failed':
      if (businessId) await prisma.subscription.update({ where: { businessId }, data: { status: 'PAST_DUE', lastSyncedAt: new Date() } }).catch(() => {});
      break;
    case 'order_created':
    case 'order_refunded':
    case 'subscription_payment_refunded':
      // No refunds policy: just log; do not change entitlements on order events.
      await prisma.auditLog.create({ data: { businessId: businessId ?? 'UNKNOWN', action: 'BILLING_ORDER_EVENT', metaJson: { event: eventName } } }).catch(() => {});
      break;
    default:
      // Unknown event — log safely, never crash.
      await prisma.auditLog.create({ data: { businessId: businessId ?? 'UNKNOWN', action: 'BILLING_WEBHOOK_UNKNOWN', metaJson: { event: eventName } } }).catch(() => {});
  }

  if (businessId) {
    await prisma.subscription.update({ where: { businessId }, data: { lastWebhookEventId: String(resource?.id ?? dedupeKey.slice(0, 16)) } }).catch(() => {});
  }
  return { ok: true, handled: eventName };
};
