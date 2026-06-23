// ================================================================
//  messaging.queue.ts
//  BullMQ queue configuration, job type definitions, and all
//  enqueue helpers consumed by the rest of the platform.
//
//  Design principles:
//   - ZERO synchronous sends anywhere in the codebase.
//     Every outbound message enters this queue, no exceptions.
//   - Jobs are keyed by messageQueueId for strict deduplication.
//   - Bulk campaign sends use addBulk in 500-job chunks with
//     a 50ms stagger to respect downstream API rate limits.
//   - Per-tenant pause is implemented via a Redis flag rather than
//     pausing the shared BullMQ queue, keeping other tenants unaffected.
// ================================================================

import { Queue, QueueEvents, JobsOptions, ConnectionOptions } from 'bullmq';
import { MessageChannel, MessagingProvider } from '@prisma/client';
import { getRedisConnection } from '../config/redis';

// ================================================================
// QUEUE NAME REGISTRY
// ================================================================

export const QUEUE_NAMES = {
  OUTBOUND_MESSAGES:    'outbound-messages',
  SCHEDULED_CAMPAIGNS:  'scheduled-campaigns',
  AUTOMATION_TRIGGERS:  'automation-triggers',
  ANALYTICS_CRON:       'analytics-cron',
  OUTBOUND_WEBHOOKS:    'outbound-webhooks',
} as const;

// ================================================================
// JOB DATA TYPES
// ================================================================

/** Shape of every job pushed onto the outbound-messages queue */
export interface OutboundMessageJobData {
  messageQueueId:   string;   // FK → MessageQueue.id — always present, enables deduplication
  businessId:       string;
  customerId:       string;
  recipientPhone:   string;   // E.164 format
  channel:          MessageChannel;
  provider:         MessagingProvider;
  payload:          MessagePayload;
  isPromotional:    boolean;
  campaignId?:      string;
  automationRunId?: string;
  retryCount:       number;   // Tracked manually alongside BullMQ's built-in attemptsMade
}

// Union of all supported payload shapes
export type MessagePayload =
  | TextPayload
  | TemplatePayload
  | ImagePayload
  | VideoPayload
  | DocumentPayload
  | AudioPayload;

export interface TextPayload {
  type: 'TEXT';
  body: string;
}

export interface TemplatePayload {
  type:         'TEMPLATE';
  templateName: string;
  langCode:     string;
  components?:  TemplateComponent[];
}

export interface ImagePayload {
  type:     'IMAGE';
  mediaUrl: string;
  caption?: string;
}

export interface VideoPayload {
  type:     'VIDEO';
  mediaUrl: string;
  caption?: string;
}

export interface DocumentPayload {
  type:      'DOCUMENT';
  mediaUrl:  string;
  fileName?: string;
  caption?:  string;
}

export interface AudioPayload {
  type:     'AUDIO';
  mediaUrl: string;
}

export interface TemplateComponent {
  type:       'header' | 'body' | 'button';
  parameters: Array<{
    type:     'text' | 'image' | 'document' | 'video';
    text?:    string;
    image?:   { link: string };
    document?: { link: string; filename?: string };
  }>;
  sub_type?: 'quick_reply' | 'url';
  index?:    number;
}

/** Shape for automation trigger jobs */
export interface AutomationTriggerJobData {
  workflowId:    string;
  businessId:    string;
  customerId:    string;
  triggerType:   string;
  triggerPayload: Record<string, unknown>;
}

/** Shape for outbound webhook delivery jobs */
export interface OutboundWebhookJobData {
  deliveryId:  string;
  businessId:  string;
  webhookId:   string;
  targetUrl:   string;
  secret:      string;
  event:       string;
  payload:     Record<string, unknown>;
}

// ================================================================
// DEFAULT JOB OPTIONS
// ================================================================

const DEFAULT_MESSAGE_JOB_OPTIONS: JobsOptions = {
  attempts: 3,
  backoff: {
    type:  'exponential',
    delay: 5_000, // 5s → 25s → 125s
  },
  removeOnComplete: { age: 86_400, count: 2_000 }, // 24h or last 2000
  removeOnFail:     { age: 7 * 86_400 },            // 7 days (for debugging)
};

const DEFAULT_WEBHOOK_JOB_OPTIONS: JobsOptions = {
  attempts: 5,
  backoff: { type: 'exponential', delay: 2_000 },
  removeOnComplete: { age: 3 * 86_400 },
  removeOnFail:     { age: 14 * 86_400 },
};

// ================================================================
// QUEUE SINGLETONS
// ================================================================

type QueueSingletons = {
  messages:   Queue<OutboundMessageJobData>   | null;
  automation: Queue<AutomationTriggerJobData> | null;
  webhooks:   Queue<OutboundWebhookJobData>   | null;
};

const _queues: QueueSingletons = {
  messages:   null,
  automation: null,
  webhooks:   null,
};

export const getMessageQueue = (): Queue<OutboundMessageJobData> => {
  if (!_queues.messages) {
    _queues.messages = new Queue<OutboundMessageJobData>(
      QUEUE_NAMES.OUTBOUND_MESSAGES,
      {
        connection:        getRedisConnection() as ConnectionOptions,
        defaultJobOptions: DEFAULT_MESSAGE_JOB_OPTIONS,
      }
    );
    _queues.messages.on('error', (err) =>
      console.error('[messaging.queue] Queue error:', err)
    );
  }
  return _queues.messages;
};

export const getAutomationQueue = (): Queue<AutomationTriggerJobData> => {
  if (!_queues.automation) {
    _queues.automation = new Queue<AutomationTriggerJobData>(
      QUEUE_NAMES.AUTOMATION_TRIGGERS,
      { connection: getRedisConnection() as ConnectionOptions }
    );
  }
  return _queues.automation;
};

export const getWebhookQueue = (): Queue<OutboundWebhookJobData> => {
  if (!_queues.webhooks) {
    _queues.webhooks = new Queue<OutboundWebhookJobData>(
      QUEUE_NAMES.OUTBOUND_WEBHOOKS,
      {
        connection:        getRedisConnection() as ConnectionOptions,
        defaultJobOptions: DEFAULT_WEBHOOK_JOB_OPTIONS,
      }
    );
  }
  return _queues.webhooks;
};

// ================================================================
// ENQUEUE HELPERS — Public API consumed by services
// ================================================================

/**
 * Enqueue a single message for immediate delivery.
 * A MessageQueue record MUST be created in Postgres before calling this.
 * The messageQueueId acts as the BullMQ jobId for deduplication.
 */
export const enqueueMessage = async (
  data:     OutboundMessageJobData,
  opts?:    Partial<JobsOptions>
): Promise<string> => {
  const queue = getMessageQueue();

  const job = await queue.add(
    `msg:${data.messageQueueId}`,
    data,
    {
      ...DEFAULT_MESSAGE_JOB_OPTIONS,
      ...opts,
      jobId: `msg-${data.messageQueueId}`, // Prevents duplicate processing on retry
    }
  );

  return job.id!;
};

/**
 * Enqueue a message with a calculated delay for scheduled campaigns.
 */
export const enqueueScheduledMessage = async (
  data:         OutboundMessageJobData,
  scheduledFor: Date
): Promise<string> => {
  const delayMs = Math.max(0, scheduledFor.getTime() - Date.now());
  return enqueueMessage(data, {
    delay: delayMs,
    jobId: `scheduled-${data.messageQueueId}`,
  });
};

/**
 * Enqueue a bulk campaign: one BullMQ job per recipient.
 *
 * Performance design:
 *   - Uses addBulk for single Redis round-trip per chunk
 *   - Chunks capped at 500 to stay within Redis pipe limits
 *   - 50ms stagger between chunks prevents thundering herd
 *     on the Meta / WAHA API from this worker cluster
 */
export const enqueueBulkCampaign = async (
  jobs: OutboundMessageJobData[]
): Promise<void> => {
  const queue     = getMessageQueue();
  const CHUNK     = 500;
  const STAGGER_MS = 50;

  for (let i = 0; i < jobs.length; i += CHUNK) {
    const chunk = jobs.slice(i, i + CHUNK);

    await queue.addBulk(
      chunk.map((data, idx) => ({
        name: `msg:${data.messageQueueId}`,
        data,
        opts: {
          ...DEFAULT_MESSAGE_JOB_OPTIONS,
          jobId:  `msg-${data.messageQueueId}`,
          // Stagger within chunk: 10ms per job
          delay: Math.floor(i / CHUNK) * STAGGER_MS + idx * 10,
        },
      }))
    );

    // Small yield between chunks to avoid blocking the event loop
    if (i + CHUNK < jobs.length) {
      await new Promise(r => setTimeout(r, 20));
    }
  }
};

/**
 * Enqueue an automation workflow trigger.
 */
export const enqueueAutomationTrigger = async (
  data: AutomationTriggerJobData
): Promise<string> => {
  const queue = getAutomationQueue();
  const job   = await queue.add(
    `automation:${data.workflowId}:${data.customerId}`,
    data,
    {
      attempts:         3,
      backoff:          { type: 'fixed', delay: 3_000 },
      removeOnComplete: { age: 86_400 },
      removeOnFail:     { age: 7 * 86_400 },
      // Deduplicate: same workflow + customer within 1 minute = same job
      jobId: `automation-${data.workflowId}-${data.customerId}-${Math.floor(Date.now() / 60_000)}`,
    }
  );
  return job.id!;
};

/**
 * Enqueue an outbound webhook delivery (Zapier / Xero / QuickBooks).
 */
export const enqueueOutboundWebhook = async (
  data: OutboundWebhookJobData
): Promise<void> => {
  const queue = getWebhookQueue();
  await queue.add(
    `webhook:${data.deliveryId}`,
    data,
    {
      ...DEFAULT_WEBHOOK_JOB_OPTIONS,
      jobId: `webhook-${data.deliveryId}`,
    }
  );
};

// ================================================================
// TENANT QUEUE CONTROLS
// ================================================================

/**
 * Soft-pause a tenant's message processing.
 * Sets a Redis flag the worker checks before processing each job.
 * Other tenants are completely unaffected — no shared queue state change.
 *
 * Called when:
 *   - Monthly message quota is exhausted
 *   - Tenant subscription is past-due or canceled
 *   - Platform Admin manually suspends the account
 */
export const pauseTenantQueue = async (businessId: string): Promise<void> => {
  const redis = getRedisConnection() as any;
  await redis.set(
    `tenant:queue_paused:${businessId}`,
    '1',
    { EX: 60 * 60 * 24 } // Auto-expires in 24h as safety net
  );
};

/**
 * Resume a paused tenant (called after Stripe payment succeeds
 * or admin manually lifts the pause).
 */
export const resumeTenantQueue = async (businessId: string): Promise<void> => {
  const redis = getRedisConnection() as any;
  await redis.del(`tenant:queue_paused:${businessId}`);
};

/**
 * Check if a tenant's queue is currently paused.
 */
export const isTenantQueuePaused = async (businessId: string): Promise<boolean> => {
  const redis = getRedisConnection() as any;
  const val   = await redis.get(`tenant:queue_paused:${businessId}`);
  return val === '1';
};

// ================================================================
// QUEUE HEALTH / MONITORING (consumed by Super Admin dashboard)
// ================================================================

export interface QueueHealth {
  waiting:   number;
  active:    number;
  completed: number;
  failed:    number;
  delayed:   number;
  paused:    number;
}

export const getMessageQueueHealth = async (): Promise<QueueHealth> => {
  const queue = getMessageQueue();
  const [waiting, active, completed, failed, delayed, paused] = await Promise.all([
    queue.getWaitingCount(),
    queue.getActiveCount(),
    queue.getCompletedCount(),
    queue.getFailedCount(),
    queue.getDelayedCount(),
    queue.getJobCountByTypes('paused').catch(() => 0),
  ]);
  return { waiting, active, completed, failed, delayed, paused };
};

export const closeAllQueues = async (): Promise<void> => {
  await Promise.all([
    _queues.messages?.close(),
    _queues.automation?.close(),
    _queues.webhooks?.close(),
  ]);
};
