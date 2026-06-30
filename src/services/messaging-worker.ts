// ================================================================
//  messaging.worker.ts
//  BullMQ worker: processes every outbound message job.
//
//  Pre-flight check sequence (ALL must pass before a send occurs):
//
//   [1] Tenant Queue Paused?     → DROPPED_QUOTA    (non-retryable)
//   [2] Customer exists?         → FAILED           (non-retryable)
//   [3] Customer suppressed?     → CONSENT_REVOKED  (non-retryable)
//   [4] Consent flag set?        → CONSENT_REVOKED  (non-retryable)
//   [5] Marketing paused?        → DROPPED_COOLDOWN (non-retryable)
//   [6] Within cooldown window?  → DROPPED_COOLDOWN (non-retryable)
//   [7] Quota exhausted?         → DROPPED_QUOTA    (non-retryable)
//   ✅ All passed                → Route to gateway → retry on failure
//
//  Non-retryable jobs are resolved (not failed) so BullMQ doesn't
//  fill the dead-letter queue with structurally undeliverable jobs.
// ================================================================

import { Worker, Job, UnrecoverableError } from 'bullmq';
import { MessageStatus }     from '@prisma/client';
import { prisma } from '../config/prisma';
import { useBaileys } from '../config/whatsapp-provider';
import {
  OutboundMessageJobData,
  QUEUE_NAMES,
  pauseTenantQueue,
  isTenantQueuePaused,
} from '../services/messaging-queue';
import {
  routeMessage,
  GatewayResult,
} from '../services/messaging-gateway';
import { getRedisConnection, getRedisClient as getRedisStore } from '../config/redis';
import { consumeWarmupSlot, releaseWarmupSlot } from '../services/whatsapp-reliability';
import { sendEmail }          from '../utils/email.util';
import type { ConnectionOptions } from 'bullmq';


// Concurrency: 5 simultaneous jobs per worker instance.
// Low concurrency is intentional: WhatsApp bans accounts that send messages
// in parallel bursts. All messages go through a single serial path per business.
const WORKER_CONCURRENCY = 5;

// Global rate limit: max 3 messages per second across the entire cluster.
// Per-business human-behavior delays (45-90s) are enforced inside processMessageJob.
const GLOBAL_RATE_LIMIT = { max: 3, duration: 1_000 };

// Per-business human-behavior delay tracking (Redis key: wa:last_sent:{businessId})
// Between each promotional WhatsApp message we wait 45-90 seconds + random jitter
// to mimic human sending patterns and avoid WhatsApp account bans.
const WA_MIN_DELAY_MS = 45_000;  // 45 seconds minimum
const WA_MAX_DELAY_MS = 90_000;  // 90 seconds maximum

// Quota / rate-limit / warmup tracking uses the real node-redis client
// (the BullMQ getRedisConnection() returns only { host, port } for ioredis,
// which has no get/set/incr — using it here silently broke every send).
const getRedisClient = () => getRedisStore();

const enforceWhatsAppDelay = async (businessId: string, isPromotional: boolean): Promise<void> => {
  if (!isPromotional) return; // Transactional messages (OTP, receipts) skip the delay

  const redis    = getRedisClient();
  const key      = `wa:last_sent:${businessId}`;
  const lastSent = await redis.get(key);

  if (lastSent) {
    const elapsed = Date.now() - parseInt(lastSent, 10);
    const jitter  = Math.floor(Math.random() * (WA_MAX_DELAY_MS - WA_MIN_DELAY_MS));
    const needed  = WA_MIN_DELAY_MS + jitter - elapsed;
    if (needed > 0) {
      await new Promise(r => setTimeout(r, needed));
    }
  }

  await redis.set(key, String(Date.now()), { EX: 300 }); // 5-min TTL safety net
};

// ================================================================
// MAIN JOB PROCESSOR
// ================================================================

const processMessageJob = async (
  job: Job<OutboundMessageJobData>
): Promise<void> => {
  // Handle system actions (e.g. scheduled campaign launch)
  const data = job.data as any;
  if (data._systemAction === 'LAUNCH_CAMPAIGN') {
    const { launchCampaign } = await import('./campaign-service');
    await launchCampaign(data.campaignId, data.businessId);
    return;
  }

  const {
    messageQueueId,
    businessId,
    customerId,
    recipientPhone,
    provider,
    payload,
    isPromotional,
    campaignId,
    automationRunId,
  } = job.data;

  const redis = getRedisClient();

  // ──────────────────────────────────────────────────────────────
  // PRE-FLIGHT 1: Tenant queue paused (quota exhaustion / suspension)
  // ──────────────────────────────────────────────────────────────
  const isPaused = await isTenantQueuePaused(businessId);
  if (isPaused) {
    await resolveDropped(messageQueueId, 'DROPPED_QUOTA', 'TENANT_QUEUE_PAUSED');
    return; // UnrecoverableError not needed — already resolved in DB
  }

  // ──────────────────────────────────────────────────────────────
  // PRE-FLIGHT 2: Customer record exists
  // ──────────────────────────────────────────────────────────────
  const customer = await prisma.customer.findFirst({
    where:  { id: customerId, businessId },
    select: {
      id:                       true,
      isStaff:                  true,
      marketingConsentWhatsapp: true,
      marketingConsentEmail:    true,
      marketingConsentSms:      true,
      isSuppressed:             true,
      marketingPausedUntil:     true,
    },
  });

  if (!customer) {
    await resolveDropped(messageQueueId, 'FAILED', 'CUSTOMER_NOT_FOUND_IN_TENANT');
    return;
  }

  // ──────────────────────────────────────────────────────────────
  // PRE-FLIGHT 2b: Staff member — NEVER send any automated/marketing
  // message to a customer flagged as staff/owner, at any cost.
  // ──────────────────────────────────────────────────────────────
  if ((customer as any).isStaff) {
    await resolveDropped(messageQueueId, 'FAILED', 'RECIPIENT_IS_STAFF');
    return;
  }

  // ──────────────────────────────────────────────────────────────
  // PRE-FLIGHT 3: Hard suppression (post opt-out)
  // ──────────────────────────────────────────────────────────────
  if (customer.isSuppressed) {
    await resolveDropped(messageQueueId, 'CONSENT_REVOKED', 'CUSTOMER_SUPPRESSED');
    return;
  }

  // ──────────────────────────────────────────────────────────────
  // PRE-FLIGHT 4: Channel-specific consent (promotional only)
  //   Transactional messages (isPromotional=false) bypass this check.
  //   Examples of transactional: OTP, booking confirmation, receipt.
  // ──────────────────────────────────────────────────────────────
  if (isPromotional) {
    const hasConsent = resolveConsentFlag(customer, job.data.channel);
    if (!hasConsent) {
      await resolveDropped(messageQueueId, 'CONSENT_REVOKED', 'NO_MARKETING_CONSENT');
      return;
    }
  }

  // ──────────────────────────────────────────────────────────────
  // PRE-FLIGHT 5: Marketing pause (set by negative sentiment worker)
  // ──────────────────────────────────────────────────────────────
  if (
    customer.marketingPausedUntil &&
    new Date() < new Date(customer.marketingPausedUntil)
  ) {
    await resolveDropped(
      messageQueueId,
      'DROPPED_COOLDOWN',
      `MARKETING_PAUSED_UNTIL_${customer.marketingPausedUntil.toISOString()}`
    );
    return;
  }

  // ──────────────────────────────────────────────────────────────
  // PRE-FLIGHT 6: Promotional cooldown window
  //   Checks if this customer received ANY promotional message within
  //   the tenant-configured window (default 72h).
  //   Uses a compound indexed query for < 5ms performance at scale.
  // ──────────────────────────────────────────────────────────────
  if (isPromotional) {
    const business = await prisma.business.findUnique({
      where:  { id: businessId },
      select: { messageCooldownHours: true },
    });

    const cooldownHours   = business?.messageCooldownHours ?? 72;
    const cooldownWindowStart = new Date(
      Date.now() - cooldownHours * 60 * 60 * 1_000
    );

    const recentPromo = await prisma.messageQueue.findFirst({
      where: {
        businessId,
        customerId,
        isPromotional:  true,
        status:         { in: ['SENT', 'DELIVERED', 'READ'] },
        // Check sentAt so queued-but-unsent messages don't block the cooldown window
        sentAt:         { gte: cooldownWindowStart },
        id:             { not: messageQueueId },
      },
      select: { id: true },
    });

    if (recentPromo) {
      await resolveDropped(
        messageQueueId,
        'DROPPED_COOLDOWN',
        `WITHIN_${cooldownHours}H_COOLDOWN`
      );
      return;
    }
  }

  // ──────────────────────────────────────────────────────────────
  // PRE-FLIGHT 7: Monthly message quota
  //
  //   Redis key: tenant:msg_quota:{businessId}
  //   -1 = Enterprise unlimited (skip check)
  //   0  = Exhausted → pause tenant, notify, drop
  //   N  = Decrement atomically before send
  //
  //   DECR is atomic in Redis — no race condition between concurrent workers.
  //   If the send then fails, we re-increment to avoid phantom quota loss.
  // ──────────────────────────────────────────────────────────────
  const quotaKey = `tenant:msg_quota:${businessId}`;
  const quotaRaw = await redis.get(quotaKey);
  const quota    = quotaRaw !== null ? parseInt(quotaRaw, 10) : null;

  if (quota === 0) {
    // Exhausted — pause this tenant and notify the owner
    await pauseTenantQueue(businessId);
    await resolveDropped(messageQueueId, 'DROPPED_QUOTA', 'MONTHLY_QUOTA_EXHAUSTED');
    void notifyQuotaExhausted(businessId).catch(err => console.error('[messaging.worker] Quota notification failed:', err));
    return;
  }

  // Atomic decrement (quota !== -1 = not Enterprise)
  if (quota !== null && quota !== -1) {
    await redis.decr(quotaKey);
  }

  // ──────────────────────────────────────────────────────────────
  // PRE-FLIGHT 8: Number warmup cap (WhatsApp ban protection)
  //   A freshly-connected number ramps daily volume over 30 days.
  //   Promotional only — transactional (OTP/receipts) is never capped.
  //   Consumes one slot of today's budget; released below if the send
  //   then fails so a failed attempt never burns warmup headroom.
  // ──────────────────────────────────────────────────────────────
  let warmupConsumed = false;
  if (isPromotional) {
    const warmup = await consumeWarmupSlot(businessId);
    if (!warmup.allowed) {
      // Refund the quota slot we took above — this message isn't going out today.
      if (quota !== null && quota !== -1) await redis.incr(quotaKey);
      await resolveDropped(messageQueueId, 'DROPPED_QUOTA', `WARMUP_CAP_REACHED_${warmup.cap}_PER_DAY`);
      return;
    }
    warmupConsumed = true;
  }

  // ──────────────────────────────────────────────────────────────
  // SEND — Route to Meta or WAHA gateway
  // ──────────────────────────────────────────────────────────────

  // Enforce human-like send delay for WhatsApp promotional messages.
  // This runs BEFORE the DB status update so the delay doesn't inflate "in-flight" time.
  await enforceWhatsAppDelay(businessId, isPromotional);

  // Mark as in-flight in DB before calling external API
  await prisma.messageQueue.update({
    where: { id: messageQueueId },
    data:  { status: 'PENDING', updatedAt: new Date() },
  });

  let result: GatewayResult;

  try {
    result = await routeMessage({ businessId, provider, recipientPhone, payload });
  } catch (err) {
    // Re-credit quota + warmup on hard gateway throw (network error, not API rejection)
    if (quota !== null && quota !== -1) await redis.incr(quotaKey);
    if (warmupConsumed) await releaseWarmupSlot(businessId);

    const msg = err instanceof Error ? err.message : 'GATEWAY_THROW';
    // Throw — BullMQ will retry with exponential backoff
    throw new Error(`GATEWAY_ERROR: ${msg}`);
  }

  // ──────────────────────────────────────────────────────────────
  // POST-SEND: Update DB record
  // ──────────────────────────────────────────────────────────────
  if (result.success) {
    // updateMany on subscription: silently no-ops if row doesn't exist,
    // preventing a missing subscription from rolling back the sent status.
    await prisma.$transaction([
      prisma.messageQueue.update({
        where: { id: messageQueueId },
        data: {
          status:            'SENT',
          providerMessageId: result.messageId,
          sentAt:            new Date(),
          updatedAt:         new Date(),
        },
      }),
      ...(campaignId
        ? [prisma.campaign.update({
            where: { id: campaignId },
            data:  { sentCount: { increment: 1 } },
          })]
        : []),
    ]);
    // Separate non-critical usage tracking — failure here doesn't undo the sent status
    await prisma.subscription.updateMany({
      where: { businessId },
      data:  { messagesUsedThisPeriod: { increment: 1 } },
    });

  } else {
    // Re-credit quota + warmup — API rejected the message, we didn't use the slot
    if (quota !== null && quota !== -1) await redis.incr(quotaKey);
    if (warmupConsumed) await releaseWarmupSlot(businessId);

    await prisma.messageQueue.update({
      where: { id: messageQueueId },
      data: {
        status:        'FAILED',
        failureReason: result.error ?? 'GATEWAY_API_REJECTION',
        retryCount:    { increment: 1 },
        updatedAt:     new Date(),
      },
    });

    // Throw to trigger BullMQ retry
    throw new Error(`SEND_FAILED: ${result.error}`);
  }
};

// ================================================================
// AUTOMATION TRIGGER PROCESSOR
// ================================================================

export const processAutomationJob = async (
  job: Job<{ workflowId: string; businessId: string; customerId: string; triggerType: string; triggerPayload: Record<string, unknown> }>
): Promise<void> => {
  const { workflowId, businessId, customerId } = job.data;

  const workflow = await prisma.automationWorkflow.findFirst({
    where:  { id: workflowId, businessId, status: 'ACTIVE' },
    select: { id: true, compiledJson: true, name: true },
  });

  if (!workflow?.compiledJson) {
    throw new UnrecoverableError('WORKFLOW_NOT_FOUND_OR_NOT_COMPILED');
  }

  const run = await prisma.automationRun.create({
    data: {
      businessId,
      workflowId,
      customerId,
      bullmqJobId: job.id,
      status:      'RUNNING',
    },
  });

  try {
    // Compiled JSON structure:
    // { trigger: {...}, actions: [{ type, templateName, delayMinutes, ... }] }
    const compiled = workflow.compiledJson as {
      actions: Array<{
        type:           string;
        templateName?:  string;
        delayMinutes?:  number;
        points?:        number;
        segmentChange?: string;
      }>;
    };

    for (const action of compiled.actions) {
      switch (action.type) {
        case 'SEND_WHATSAPP': {
          // Create a MessageQueue record, then enqueue
          await dispatchAutomationMessage(
            businessId,
            customerId,
            workflowId,
            run.id,
            action.templateName!,
            action.delayMinutes ?? 0
          );
          break;
        }
        case 'AWARD_POINTS': {
          if (action.points) {
            await awardAutomationPoints(businessId, customerId, action.points, workflowId);
          }
          break;
        }
        case 'CHANGE_SEGMENT': {
          if (action.segmentChange) {
            await prisma.customer.update({
              where:  { id: customerId },
              data:   { segment: action.segmentChange as any },
              select: { id: true },
            });
          }
          break;
        }
      }
    }

    await prisma.$transaction([
      prisma.automationRun.update({
        where: { id: run.id },
        data:  { status: 'COMPLETED' },
      }),
      prisma.automationWorkflow.update({
        where: { id: workflowId },
        data:  { runCount: { increment: 1 }, lastRunAt: new Date() },
      }),
    ]);

  } catch (err) {
    await prisma.automationRun.update({
      where: { id: run.id },
      data: {
        status:       'FAILED',
        errorMessage: err instanceof Error ? err.message : 'UNKNOWN',
      },
    });
    throw err;
  }
};

// ================================================================
// OUTBOUND WEBHOOK PROCESSOR (Zapier / Xero / QuickBooks)
// ================================================================

import crypto from 'crypto';
import axios  from 'axios';

export const processOutboundWebhookJob = async (
  job: Job<{ deliveryId: string; businessId: string; webhookId: string; targetUrl: string; secret: string; event: string; payload: Record<string, unknown> }>
): Promise<void> => {
  const { deliveryId, targetUrl, secret, event, payload } = job.data;

  const body      = JSON.stringify({ event, data: payload, timestamp: Date.now() });
  const signature = crypto
    .createHmac('sha256', secret)
    .update(body)
    .digest('hex');

  try {
    const response = await axios.post(targetUrl, body, {
      headers: {
        'Content-Type':           'application/json',
        'X-Webhook-Signature':    `sha256=${signature}`,
        'X-Webhook-Event':        event,
        'X-Cube-Retain-Delivery': deliveryId,
      },
      timeout: 10_000,
    });

    await prisma.outboundWebhookDelivery.update({
      where: { id: deliveryId },
      data: {
        httpStatus:   response.status,
        responseBody: String(response.data).substring(0, 500),
        succeededAt:  new Date(),
      },
    });

  } catch (err) {
    const httpStatus = axios.isAxiosError(err) ? err.response?.status : undefined;

    await prisma.outboundWebhookDelivery.update({
      where: { id: deliveryId },
      data: {
        httpStatus:   httpStatus,
        failedAt:     new Date(),
        attemptCount: { increment: 1 },
      },
    });

    throw new Error(`WEBHOOK_DELIVERY_FAILED: ${httpStatus ?? 'NO_RESPONSE'}`);
  }
};

// ================================================================
// WORKER INITIALIZATION — Call once at app startup
// ================================================================

export const startAllWorkers = (): {
  messageWorker:   Worker;
  automationWorker: Worker;
  webhookWorker:   Worker;
} => {
  const conn = getRedisConnection() as ConnectionOptions;

  // Idle-polling tuning to minimise Redis commands (important on metered Redis
  // like Upstash). drainDelay = how long the blocking pop waits when there are
  // no jobs (seconds) — real jobs are still picked up instantly when enqueued,
  // this only stretches the IDLE re-poll interval. stalledInterval is the
  // periodic stalled-job check (ms). Both default low (5s / 30s); raising them
  // cuts idle command volume several-fold with no effect on job latency.
  const IDLE = {
    drainDelay:      Number(process.env.WORKER_DRAIN_DELAY_SECONDS || 30),
    stalledInterval: Number(process.env.WORKER_STALLED_INTERVAL_MS || 60_000),
  };

  // ── Message Worker ──────────────────────────────────────────
  const messageWorker = new Worker<OutboundMessageJobData>(
    QUEUE_NAMES.OUTBOUND_MESSAGES,
    processMessageJob,
    {
      connection:  conn,
      concurrency: WORKER_CONCURRENCY,
      limiter:     GLOBAL_RATE_LIMIT,
      ...IDLE,
    }
  );

  // ── Automation Worker ───────────────────────────────────────
  const automationWorker = new Worker(
    QUEUE_NAMES.AUTOMATION_TRIGGERS,
    processAutomationJob,
    { connection: conn, concurrency: 10, ...IDLE }
  );

  // ── Outbound Webhook Worker ─────────────────────────────────
  const webhookWorker = new Worker(
    QUEUE_NAMES.OUTBOUND_WEBHOOKS,
    processOutboundWebhookJob,
    { connection: conn, concurrency: 15, ...IDLE }
  );

  // ── Shared event handlers ───────────────────────────────────
  for (const [name, worker] of [
    ['message',   messageWorker],
    ['automation', automationWorker],
    ['webhook',   webhookWorker],
  ] as const) {
    worker.on('failed', (job, err) => {
      const attempts = job?.attemptsMade ?? 0;
      const maxAttempts = job?.opts?.attempts ?? 3;
      console.error(
        `[${name}.worker] Job ${job?.id} failed (${attempts}/${maxAttempts}): ${err.message}`
      );
    });

    worker.on('stalled', (jobId) => {
      console.warn(`[${name}.worker] Job ${jobId} stalled — worker may have crashed`);
    });

    worker.on('error', (err) => {
      console.error(`[${name}.worker] Worker-level error:`, err);
    });
  }

  console.log('[workers] All BullMQ workers started.');
  return { messageWorker, automationWorker, webhookWorker };
};

// ================================================================
// INTERNAL HELPERS
// ================================================================

/** Marks a job as non-retryable by resolving it with a terminal status in DB */
const resolveDropped = async (
  messageQueueId: string,
  status:         MessageStatus,
  reason:         string
): Promise<void> => {
  await prisma.messageQueue.update({
    where: { id: messageQueueId },
    data: {
      status,
      failureReason: reason,
      updatedAt:     new Date(),
    },
  });
  // We intentionally do NOT throw here — BullMQ marks the job as completed,
  // not failed, since the drop was intentional and should not be retried.
};

/** Resolve the correct consent flag for the outbound channel */
const resolveConsentFlag = (
  customer: {
    marketingConsentWhatsapp: boolean;
    marketingConsentEmail:    boolean;
    marketingConsentSms:      boolean;
  },
  channel: string
): boolean => {
  switch (channel) {
    case 'WHATSAPP_META':
    case 'WHATSAPP_WAHA':
      return customer.marketingConsentWhatsapp;
    case 'EMAIL':
      return customer.marketingConsentEmail;
    case 'SMS':
      return customer.marketingConsentSms;
    default:
      return false;
  }
};

/** Send upgrade notification email to Tenant Owner on quota exhaustion */
const notifyQuotaExhausted = async (businessId: string): Promise<void> => {
  try {
    const owner = await prisma.user.findFirst({
      where:  { businessId, role: 'TENANT_OWNER', isActive: true },
      select: { email: true, name: true },
    });
    if (!owner) return;

    await sendEmail({
      to:         owner.email,
      subject:    'Your monthly message quota has been reached',
      templateId: 'QUOTA_EXHAUSTED',
      variables: {
        name:       owner.name,
        upgradeUrl: `${process.env.FRONTEND_URL}/settings/billing`,
      },
    });
  } catch (err) {
    console.error('[messaging.worker] Quota notification failed:', err);
  }
};

/** Create a MessageQueue record + enqueue for an automation action */
const dispatchAutomationMessage = async (
  businessId:     string,
  customerId:     string,
  workflowId:     string,
  automationRunId: string,
  templateName:   string,
  delayMinutes:   number
): Promise<void> => {
  const customer = await prisma.customer.findUnique({
    where:  { id: customerId },
    select: { whatsappNumber: true },
  });

  if (!customer?.whatsappNumber) return;

  const business = await prisma.business.findUnique({
    where:  { id: businessId },
    select: { messagingProvider: true, wahaBaseUrl: true, wahaSessionId: true },
  });

  // Mirror provider logic from campaign-service
  const globalBaileys = useBaileys();
  const hasWaha    = !globalBaileys && !!(business?.wahaBaseUrl && business?.wahaSessionId);
  const provider   = (hasWaha ? 'WAHA' : (business?.messagingProvider ?? 'WAHA')) as any;
  const scheduledFor = new Date(Date.now() + delayMinutes * 60 * 1_000);

  const record = await prisma.messageQueue.create({
    data: {
      businessId,
      customerId,
      automationRunId,
      channel:       provider === 'WAHA' ? 'WHATSAPP_WAHA' : 'WHATSAPP_META',
      provider,
      status:        'PENDING',
      templateName,
      payloadJson: {
        type:         'TEMPLATE',
        templateName,
        langCode:     'en_US',
      },
      isPromotional: true,
      scheduledFor,
    },
  });

  const { enqueueScheduledMessage } = await import('../services/messaging-queue');
  await enqueueScheduledMessage(
    {
      messageQueueId:   record.id,
      businessId,
      customerId,
      recipientPhone:   customer.whatsappNumber,
      channel:          record.channel as any,
      provider:         record.provider as any,
      payload:          record.payloadJson as any,
      isPromotional:    true,
      automationRunId,
      retryCount:       0,
    },
    scheduledFor
  );
};

/** Append points to the immutable RewardPointsLedger from an automation */
const awardAutomationPoints = async (
  businessId:  string,
  customerId:  string,
  points:      number,
  referenceId: string
): Promise<void> => {
  const customer = await prisma.customer.findUnique({
    where:  { id: customerId },
    select: { currentPointsBalance: true },
  });

  if (!customer) return;

  const newBalance = customer.currentPointsBalance + points;

  await prisma.$transaction([
    prisma.rewardPointsLedger.create({
      data: {
        businessId,
        customerId,
        type:          'CREDIT',
        points,
        balanceAfter:  newBalance,
        reason:        'AUTOMATION_REWARD',
        referenceId,
        referenceType: 'AUTOMATION',
      },
    }),
    prisma.customer.update({
      where:  { id: customerId },
      data:   { currentPointsBalance: newBalance },
      select: { id: true },
    }),
  ]);
};

// ================================================================
// GRACEFUL SHUTDOWN
// ================================================================

export const gracefulShutdown = async (
  workers: ReturnType<typeof startAllWorkers>
): Promise<void> => {
  console.log('[workers] Graceful shutdown initiated...');
  await Promise.all([
    workers.messageWorker.close(),
    workers.automationWorker.close(),
    workers.webhookWorker.close(),
  ]);
  console.log('[workers] All workers shut down cleanly.');
};
