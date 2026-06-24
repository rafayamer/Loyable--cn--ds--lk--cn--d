// ================================================================
//  webhook.pos.ts
//  Agnostic POS webhook controller.
//
//  Supported providers: Square · Toast · Clover · Custom
//
//  Each provider sends a different payload shape. This controller
//  normalises every payload into one internal shape:
//    NormalisedTransaction { phone?, email?, amountGBP, transactionId, timestamp }
//
//  Then runs idempotent check-in logic:
//    1. Validate API key → resolve businessId (never trust URL param alone)
//    2. Deduplicate via transactionId + businessId in PosWebhookLog
//    3. Upsert Customer (phone OR email match)
//    4. Create Visit record
//    5. Accrue points + evaluate tier upgrade
//    6. Enqueue any eligible automation triggers (VISIT_MILESTONE etc.)
//
//  Authentication: POS systems send `X-Api-Key: {key}` header.
//  The business owner generates this key in Settings → Integrations.
//
//  Security: respond 200 immediately on receipt (async processing).
//  POS systems retry on non-2xx — early 200 prevents duplicate webhooks.
// ================================================================

import { Request, Response, Router } from 'express';
import crypto                         from 'crypto';
import { }               from '@prisma/client';
import { prisma } from '../config/prisma';
import { accruePointsForVisit, evaluateCustomerSegment } from '../services/loyalty-service';
import { enqueueAutomationTrigger }   from '../services/messaging-queue';


// ================================================================
// NORMALISED TRANSACTION SHAPE
// ================================================================

interface NormalisedTransaction {
  transactionId:  string;
  phone?:         string;   // Raw — normalised to E.164 later
  email?:         string;
  amountPence:    number;   // Always in smallest currency unit (pence/cents)
  currency:       string;
  branchRef?:     string;   // Provider's location/branch identifier
  customerRef?:   string;   // Provider's customer ID (for future sync)
  timestamp:      Date;
  rawPayload:     unknown;
}

// ================================================================
// PROVIDER NORMALIZERS
// ================================================================

/**
 * Square webhook payload normaliser.
 * Handles: payment.created, payment.completed
 * Docs: https://developer.squareup.com/reference/square/webhooks/payment.completed
 */
const normaliseSquare = (body: Record<string, unknown>): NormalisedTransaction | null => {
  const payment = (body.data as any)?.object?.payment;
  if (!payment) return null;

  const amount = payment.amount_money?.amount as number | undefined;
  if (!amount || amount <= 0) return null;

  return {
    transactionId: payment.id as string,
    phone:         payment.buyer_phone_number as string | undefined,
    email:         payment.buyer_email_address as string | undefined,
    amountPence:   amount,
    currency:      (payment.amount_money?.currency as string) ?? 'GBP',
    branchRef:     payment.location_id as string | undefined,
    customerRef:   payment.customer_id as string | undefined,
    timestamp:     payment.created_at ? new Date(payment.created_at as string) : new Date(),
    rawPayload:    body,
  };
};

/**
 * Toast webhook payload normaliser.
 * Handles: PAYMENT_COMPLETED, ORDER_COMPLETED
 * Docs: https://doc.toasttab.com/doc/devguide/apiWebhooks.html
 */
const normaliseToast = (body: Record<string, unknown>): NormalisedTransaction | null => {
  const order = body.order as Record<string, unknown> | undefined;
  if (!order) return null;

  const amount = (order.totalAmount as number | undefined) ?? 0;

  const customer = order.customer as Record<string, unknown> | undefined;

  return {
    transactionId: (order.guid ?? order.id ?? crypto.randomUUID()) as string,
    phone:         customer?.phone as string | undefined,
    email:         customer?.email as string | undefined,
    amountPence:   Math.round(amount * 100),
    currency:      'GBP',
    branchRef:     order.restaurantGuid as string | undefined,
    customerRef:   customer?.guid as string | undefined,
    timestamp:     order.createdDate
      ? new Date(order.createdDate as string)
      : new Date(),
    rawPayload:    body,
  };
};

/**
 * Clover webhook payload normaliser.
 * Handles: payment events
 * Docs: https://docs.clover.com/docs/webhook-structure
 */
const normaliseClover = (body: Record<string, unknown>): NormalisedTransaction | null => {
  const data = body.data as Record<string, unknown> | undefined;
  const obj  = data?.object as Record<string, unknown> | undefined;
  const pay  = (obj?.payment ?? obj) as Record<string, unknown> | undefined;

  if (!pay) return null;

  const amount = pay.amount as number | undefined;
  if (!amount || amount <= 0) return null;

  const customer = pay.customer as Record<string, unknown> | undefined;
  const order    = pay.order    as Record<string, unknown> | undefined;

  return {
    transactionId: (pay.id ?? crypto.randomUUID()) as string,
    phone:         customer?.phoneNumber as string | undefined,
    email:         customer?.email       as string | undefined,
    amountPence:   amount,
    currency:      'GBP',
    branchRef:     (body.merchantId ?? body.mid) as string | undefined,
    customerRef:   (customer?.id ?? pay.clientCreatedTime) as string | undefined,
    timestamp:     pay.createdTime
      ? new Date(pay.createdTime as number * 1000)
      : new Date(),
    rawPayload:    body,
  };
};

/**
 * Custom/Generic normaliser for any POS that sends a standardised payload.
 * The business configures their POS to send this schema directly.
 *
 * Expected fields:
 *  { transactionId, phone?, email?, amountPence, currency?, branchRef?, timestamp? }
 */
const normaliseCustom = (body: Record<string, unknown>): NormalisedTransaction | null => {
  if (!body.transactionId) return null;
  if (!body.amountPence && !body.amount) return null;

  return {
    transactionId: body.transactionId as string,
    phone:         body.phone       as string | undefined,
    email:         body.email       as string | undefined,
    amountPence:   (body.amountPence ?? Math.round((body.amount as number) * 100)) as number,
    currency:      (body.currency   as string) ?? 'GBP',
    branchRef:     body.branchRef   as string | undefined,
    customerRef:   body.customerId  as string | undefined,
    timestamp:     body.timestamp
      ? new Date(body.timestamp as string)
      : new Date(),
    rawPayload:    body,
  };
};

const NORMALIZERS: Record<string, (b: Record<string, unknown>) => NormalisedTransaction | null> = {
  square: normaliseSquare,
  toast:  normaliseToast,
  clover: normaliseClover,
  custom: normaliseCustom,
};

// ================================================================
// API KEY RESOLVER
// ================================================================

/**
 * Resolve businessId from the X-Api-Key header.
 * The key is stored as SHA-256 hash in ApiKey table.
 */
const resolveBusinessFromApiKey = async (
  rawKey: string
): Promise<string | null> => {
  if (!rawKey) return null;

  const keyHash = crypto
    .createHash('sha256')
    .update(rawKey.trim())
    .digest('hex');

  const apiKey = await prisma.apiKey.findUnique({
    where:  { keyHash },
    select: { businessId: true, isActive: true, expiresAt: true },
  });

  if (!apiKey?.isActive) return null;
  if (apiKey.expiresAt && apiKey.expiresAt < new Date()) return null;

  // Update lastUsedAt (fire-and-forget)
  prisma.apiKey
    .update({ where: { keyHash }, data: { lastUsedAt: new Date() } })
    .catch(console.error);

  return apiKey.businessId;
};

// ================================================================
// MAIN PROCESSING PIPELINE
// ================================================================

const processTransaction = async (
  businessId:   string,
  provider:     string,
  transaction:  NormalisedTransaction
): Promise<void> => {
  const { transactionId, phone, email, amountPence, branchRef, timestamp, rawPayload } = transaction;

  // ── 1. Idempotency check ────────────────────────────────────
  const existingLog = await prisma.posWebhookLog.findUnique({
    where: { transactionId_businessId: { transactionId, businessId } },
    select: { id: true, status: true },
  });

  if (existingLog) {
    // Already processed — update to DUPLICATE and exit
    await prisma.posWebhookLog.update({
      where: { id: existingLog.id },
      data:  { status: 'DUPLICATE' },
    });
    return;
  }

  // Create log entry immediately (before processing)
  const log = await prisma.posWebhookLog.create({
    data: {
      businessId,
      provider:         provider.toUpperCase() as any,
      transactionId,
      rawPayload:       rawPayload as any,
      normalizedPhone:  phone ? normaliseE164(phone) : null,
      normalizedEmail:  email?.toLowerCase().trim() ?? null,
      amountCents:      amountPence,
      status:           'PENDING',
    },
  });

  // ── 2. Resolve branch location ────────────────────────────────
  let branchLocationId: string | null = null;
  if (branchRef) {
    const branch = await prisma.branchLocation.findFirst({
      where:  { businessId, isActive: true },
      select: { id: true },
      // In production: match by branchRef stored on BranchLocation.externalRef
      // For now: use the first active branch as fallback
    });
    branchLocationId = branch?.id ?? null;
  }

  // ── 3. Upsert customer ────────────────────────────────────────
  const normPhone = phone ? normaliseE164(phone)          : null;
  const normEmail = email ? email.toLowerCase().trim()    : null;

  if (!normPhone && !normEmail) {
    await prisma.posWebhookLog.update({
      where: { id: log.id },
      data:  { status: 'MISSING_CUSTOMER_IDENTITY' },
    });
    return;
  }

  // Find existing customer
  const existingCustomer = await prisma.customer.findFirst({
    where: {
      businessId,
      OR: [
        ...(normPhone ? [{ whatsappNumber: normPhone }] : []),
        ...(normEmail ? [{ email: normEmail }]           : []),
      ],
    },
    select: { id: true, fullName: true, visitCount: true },
  });

  let customerId: string;
  let isNewCustomer = false;

  if (existingCustomer) {
    customerId = existingCustomer.id;
    // Update any missing contact info
    await prisma.customer.update({
      where:  { id: customerId },
      data:   {
        ...(normPhone && !existingCustomer ? { whatsappNumber: normPhone } : {}),
        ...(normEmail && !existingCustomer ? { email:          normEmail } : {}),
        totalSpend: { increment: amountPence / 100 },
        updatedAt:  new Date(),
      },
      select: { id: true },
    });
  } else {
    // Create new customer from POS data
    const newCustomer = await prisma.customer.create({
      data: {
        businessId,
        fullName:                 extractNameFromEmail(normEmail) ?? 'POS Customer',
        whatsappNumber:           normPhone,
        email:                    normEmail,
        segment:                  'NEW',
        visitCount:               0,
        totalSpend:               amountPence / 100,
        marketingConsentWhatsapp: false, // Explicit consent required separately
        marketingConsentEmail:    false,
        firstVisitAt:             timestamp,
        lastVisitAt:              timestamp,
      },
    });
    customerId    = newCustomer.id;
    isNewCustomer = true;
  }

  // ── 4. Create visit (idempotent — transactionId as unique key) ─
  // Revenue attribution: find most recent campaign/automation message sent within 48h
  const ATTRIBUTION_WINDOW_MS = 48 * 3_600_000;
  const attributionSince = new Date(timestamp.getTime() - ATTRIBUTION_WINDOW_MS);
  const recentMsg = await prisma.messageQueue.findFirst({
    where: { customerId, businessId, status: { in: ['SENT', 'DELIVERED', 'READ'] }, createdAt: { gte: attributionSince } },
    orderBy: { createdAt: 'desc' },
    select:  { campaignId: true, automationRunId: true },
  }).catch(() => null);

  const visit = await prisma.visit.create({
    data: {
      businessId,
      customerId,
      branchLocationId,
      transactionId,
      amountSpent:             amountPence / 100,
      source:                  'POS_WEBHOOK',
      visitedAt:               timestamp,
      attributedCampaignId:   recentMsg?.campaignId      ?? null,
      attributedAutomationId: recentMsg?.automationRunId ?? null,
    } as any,
  });

  // Increment customer counters
  await prisma.customer.update({
    where:  { id: customerId },
    data:   {
      visitCount:  { increment: 1 },
      lastVisitAt: timestamp,
      ...(isNewCustomer ? { firstVisitAt: timestamp } : {}),
    },
    select: { id: true },
  });

  // ── 5. Accrue points + tier evaluation ───────────────────────
  await accruePointsForVisit(visit.id, businessId, customerId, amountPence / 100);

  // Inline segment re-evaluation so customer shows correct label immediately
  evaluateCustomerSegment(customerId, businessId).catch(() => {});

  // ── 6. Milestone automation check ───────────────────────────
  const updatedCustomer = await prisma.customer.findUnique({
    where:  { id: customerId },
    select: { visitCount: true },
  });

  const MILESTONES = [5, 10, 25, 50, 100];
  if (updatedCustomer && MILESTONES.includes(updatedCustomer.visitCount)) {
    const wf = await prisma.automationWorkflow.findFirst({
      where:  { businessId, triggerType: 'VISIT_MILESTONE', status: 'ACTIVE' },
      select: { id: true },
    });
    if (wf) {
      await enqueueAutomationTrigger({
        workflowId:     wf.id,
        businessId,
        customerId,
        triggerType:    'VISIT_MILESTONE',
        triggerPayload: { visitCount: updatedCustomer.visitCount },
      });
    }
  }

  // ── 7. Update log to PROCESSED ───────────────────────────────
  await prisma.posWebhookLog.update({
    where: { id: log.id },
    data: {
      status:          'PROCESSED',
      visitId:         visit.id,
      createdCustomer: isNewCustomer,
      processedAt:     new Date(),
    },
  });
};

// ================================================================
// HTTP HANDLER
// ================================================================

const posWebhookHandler = async (req: Request, res: Response): Promise<void> => {
  // Respond 200 immediately — POS systems retry on slow responses
  res.status(200).json({ received: true });

  const provider = req.params.provider?.toLowerCase() ?? 'custom';
  const rawKey   = (req.headers['x-api-key'] ?? req.query.apiKey) as string | undefined;

  if (!rawKey) {
    console.warn('[pos.webhook] Missing X-Api-Key header');
    return;
  }

  try {
    const businessId = await resolveBusinessFromApiKey(rawKey);
    if (!businessId) {
      console.warn('[pos.webhook] Invalid or expired API key');
      return;
    }

    const normaliser = NORMALIZERS[provider] ?? NORMALIZERS.custom;
    const transaction = normaliser(req.body as Record<string, unknown>);

    if (!transaction) {
      console.warn(`[pos.webhook] Could not normalise payload for provider "${provider}"`);
      return;
    }

    await processTransaction(businessId, provider, transaction);

  } catch (err) {
    console.error('[pos.webhook] Processing error:', err);
  }
};

// ================================================================
// ROUTER
// ================================================================

export const posWebhookRouter = Router();

// /api/webhooks/pos/:provider  (square | toast | clover | custom)
posWebhookRouter.post('/:provider', posWebhookHandler);

// Generic endpoint (provider detected from payload shape)
posWebhookRouter.post('/', posWebhookHandler);

// GET webhook config (business owner sees their webhook URL + API key prefix)
posWebhookRouter.get('/config', async (req, res) => {
  const rawKey   = req.headers['x-api-key'] as string | undefined;
  const businessId = rawKey ? await resolveBusinessFromApiKey(rawKey) : null;
  if (!businessId) { res.status(401).json({ error: 'INVALID_API_KEY' }); return; }

  res.json({
    webhookUrls: {
      square: `${process.env.API_BASE_URL}/api/webhooks/pos/square`,
      toast:  `${process.env.API_BASE_URL}/api/webhooks/pos/toast`,
      clover: `${process.env.API_BASE_URL}/api/webhooks/pos/clover`,
      custom: `${process.env.API_BASE_URL}/api/webhooks/pos/custom`,
    },
    instructions: {
      authentication: 'Include X-Api-Key header with your POS API key in every request.',
      idempotency:    'Each transactionId is processed exactly once. Duplicate payloads are safely ignored.',
    },
  });
});

// ================================================================
// UTILITIES
// ================================================================

/** Normalise a phone number to E.164 format. Handles common formats. */
const normaliseE164 = (raw: string): string | null => {
  if (!raw) return null;
  const digits = raw.replace(/[^\d+]/g, '');
  if (digits.startsWith('+')) return digits;
  if (digits.startsWith('00')) return '+' + digits.slice(2);
  if (digits.startsWith('0'))  return '+44' + digits.slice(1); // UK default
  if (digits.length === 10)    return '+44' + digits;          // UK 10-digit
  if (digits.length === 11)    return '+' + digits;
  return null;
};

/** Best-effort name from email (customer@business.com → Customer) */
const extractNameFromEmail = (email: string | null): string | null => {
  if (!email) return null;
  const local = email.split('@')[0].replace(/[._\-+]/g, ' ').trim();
  return local.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ') || null;
};
