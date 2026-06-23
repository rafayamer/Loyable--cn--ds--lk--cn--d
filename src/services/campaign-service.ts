// ================================================================
//  campaign.service.ts
//  Campaign lifecycle management and the core layout-to-payload
//  transformation pipeline.
//
//  The @dnd-kit/core canvas serialises blocks into layoutJson.
//  This service owns the ONLY path from that JSON to a real
//  WhatsApp message payload dispatched through BullMQ.
//
//  Transformation rules:
//   TEXT blocks    → concatenated body (with {name}/{business} tokens)
//   IMAGE blocks   → IMAGE payload; body becomes caption
//   VIDEO blocks   → VIDEO payload; body becomes caption
//   COUPON blocks  → coupon code + discount text appended to body
//   URL_BUTTON     → Meta interactive list-reply OR WAHA plain text "👉 label: url"
//   AI_ASSIST      → treated as TEXT (content already resolved by LLM at canvas time)
//
//  For Meta (official API): template name takes precedence.
//    If campaign.templateName is set → TEMPLATE payload.
//    Otherwise → WAHA path (freeform, no template restrictions).
//  For WAHA: always freeform text/image.
// ================================================================

import { Prisma } from '@prisma/client';
import { prisma } from '../config/prisma';
import {
  enqueueBulkCampaign,
  enqueueScheduledMessage,
  OutboundMessageJobData,
  TextPayload,
  ImagePayload,
  VideoPayload,
  TemplatePayload,
  MessagePayload,
} from '../services/messaging-queue';


// ================================================================
// LAYOUT TYPES (what @dnd-kit/core canvas serialises)
// ================================================================

export type BlockType = 'TEXT' | 'IMAGE' | 'VIDEO' | 'COUPON' | 'URL_BUTTON' | 'AI_ASSIST';

export interface LayoutBlock {
  id:            string;
  type:          BlockType;
  order:         number;
  // TEXT / AI_ASSIST
  content?:      string;
  // IMAGE / VIDEO
  mediaUrl?:     string;
  caption?:      string;
  // COUPON
  couponId?:     string;
  discountText?: string;
  couponCode?:   string;   // pre-resolved code for display
  // URL_BUTTON
  label?:        string;
  url?:          string;
}

export interface CampaignLayout {
  blocks: LayoutBlock[];
}

// ================================================================
// CREATE
// ================================================================

export interface CreateCampaignInput {
  name:            string;
  description?:    string;
  targetSegment?:  string;
  layoutJson:      CampaignLayout;
  templateName?:   string;   // If set, Meta template is used instead of freeform
  channel?:        string;
  scheduledFor?:   Date;
}

/** "ALL" / "Everyone" is not a CustomerSegment enum value — store as null (= all customers). */
const normaliseSegment = (seg: unknown): any => {
  if (!seg || seg === 'ALL' || seg === 'Everyone' || seg === 'ALL_CUSTOMERS') return null;
  return seg;
};

export const createCampaign = async (
  businessId: string,
  input:      CreateCampaignInput
) => {
  validateLayout(input.layoutJson);

  return prisma.campaign.create({
    data: {
      businessId,
      name:           input.name,
      description:    input.description,
      targetSegment:  normaliseSegment(input.targetSegment),
      layoutJson:     input.layoutJson as unknown as Prisma.InputJsonValue,
      channel:        (input.channel as any) ?? 'WHATSAPP_WAHA',
      status:         'DRAFT',
      scheduledFor:   input.scheduledFor,
    },
  });
};

// ================================================================
// UPDATE
// ================================================================

export const updateCampaign = async (
  id:         string,
  businessId: string,
  input:      Partial<CreateCampaignInput>
) => {
  const existing = await prisma.campaign.findFirst({
    where:  { id, businessId },
    select: { status: true },
  });
  if (!existing)                throw new Error('CAMPAIGN_NOT_FOUND');
  if (existing.status === 'ACTIVE') throw new Error('CAMPAIGN_ALREADY_ACTIVE');

  if (input.layoutJson) validateLayout(input.layoutJson);

  return prisma.campaign.update({
    where: { id },
    data: {
      ...(input.name            && { name:          input.name }),
      ...(input.description !== undefined && { description: input.description }),
      ...(input.targetSegment   && { targetSegment:  normaliseSegment(input.targetSegment) }),
      ...(input.layoutJson      && { layoutJson:     input.layoutJson as unknown as Prisma.InputJsonValue }),
      ...(input.channel         && { channel:        input.channel as any }),
      ...(input.scheduledFor    && { scheduledFor:   input.scheduledFor }),
      updatedAt: new Date(),
    },
  });
};

// ================================================================
// READ
// ================================================================

export const listCampaigns = async (businessId: string) =>
  prisma.campaign.findMany({
    where:   { businessId },
    orderBy: { createdAt: 'desc' },
  });

export const getCampaignById = async (id: string, businessId: string) => {
  const campaign = await prisma.campaign.findFirst({ where: { id, businessId } });
  if (!campaign) throw new Error('CAMPAIGN_NOT_FOUND');
  return campaign;
};

export const getCampaignStats = async (id: string, businessId: string) => {
  const [campaign, msgStats, attribution] = await Promise.all([
    prisma.campaign.findFirst({ where: { id, businessId } }),
    prisma.messageQueue.groupBy({
      by:    ['status'],
      where: { campaignId: id, businessId },
      _count: { id: true },
    }),
    prisma.visit.aggregate({
      where:  { attributedCampaignId: id, businessId } as any,
      _sum:   { amountSpent: true },
      _count: { id: true },
    }).catch(() => ({ _sum: { amountSpent: null }, _count: { id: 0 } })),
  ]);

  if (!campaign) throw new Error('CAMPAIGN_NOT_FOUND');

  const stats = Object.fromEntries(msgStats.map(s => [s.status, s._count.id]));
  const total  = Object.values(stats).reduce((sum, n) => sum + n, 0);

  return {
    campaign,
    stats,
    total,
    deliveryRate:      total > 0 ? ((stats['DELIVERED'] ?? 0) + (stats['READ'] ?? 0)) / total * 100 : 0,
    readRate:          total > 0 ? (stats['READ'] ?? 0) / total * 100 : 0,
    dropRate:          total > 0 ? ((stats['DROPPED_COOLDOWN'] ?? 0) + (stats['CONSENT_REVOKED'] ?? 0)) / total * 100 : 0,
    attributedRevenue: Number(attribution._sum.amountSpent ?? 0),
    attributedVisits:  attribution._count.id,
  };
};

// ================================================================
// LAUNCH (immediate) / SCHEDULE (delayed)
// ================================================================

/**
 * Dispatch a campaign to all eligible customers in the target segment.
 *
 * Flow:
 *   1. Guard: prevent double-launch
 *   2. Resolve segment → customers (with consent + suppression filter)
 *   3. Check Redis quota headroom (fail fast before creating DB records)
 *   4. For each customer: build personalised MessagePayload from layoutJson
 *   5. Create MessageQueue records in DB (chunked $transaction)
 *   6. Call enqueueBulkCampaign → BullMQ handles rate limiting + pre-flights
 *   7. Update campaign status → ACTIVE
 */
export const launchCampaign = async (
  id:         string,
  businessId: string
): Promise<{ queued: number; skipped: number }> => {
  const campaign = await prisma.campaign.findFirst({
    where:  { id, businessId },
    select: { status: true, targetSegment: true, layoutJson: true, channel: true },
  });

  if (!campaign)                          throw new Error('CAMPAIGN_NOT_FOUND');
  if (campaign.status === 'ACTIVE')       throw new Error('CAMPAIGN_ALREADY_LAUNCHED');
  if (campaign.status === 'COMPLETED')    throw new Error('CAMPAIGN_ALREADY_COMPLETED');
  if (!campaign.layoutJson)               throw new Error('CAMPAIGN_HAS_NO_LAYOUT');

  const business = await prisma.business.findUnique({
    where:  { id: businessId },
    select: { messagingProvider: true, name: true, wahaBaseUrl: true, wahaSessionId: true },
  });

  // Resolve segment recipients
  const customers = await resolveSegmentCustomers(
    businessId,
    campaign.targetSegment as string | null
  );

  if (customers.length === 0) {
    return { queued: 0, skipped: 0 };
  }

  // Quota headroom check
  await assertQuotaHeadroom(businessId, customers.length);

  const layout   = campaign.layoutJson as unknown as CampaignLayout;
  // Auto-detect: if WAHA credentials are configured, prefer WAHA regardless of stored provider field
  const hasWaha  = !!(business?.wahaBaseUrl && business?.wahaSessionId);
  const provider = hasWaha ? 'WAHA' : (business?.messagingProvider ?? 'WAHA');
  const channel  = (campaign.channel && campaign.channel !== 'WHATSAPP_META'
    ? campaign.channel
    : (provider === 'WAHA' ? 'WHATSAPP_WAHA' : 'WHATSAPP_META')) as Prisma.MessageQueueCreateManyInput['channel'];

  const jobs:    OutboundMessageJobData[] = [];
  const records: Prisma.MessageQueueCreateManyInput[] = [];
  let   skipped  = 0;

  for (const customer of customers) {
    if (!customer.whatsappNumber) { skipped++; continue; }

    const payload = buildMessagePayloadFromLayout(layout, customer, business?.name ?? '', provider);

    records.push({
      businessId,
      customerId:    customer.id,
      campaignId:    id,
      channel,
      provider,
      status:        'PENDING',
      payloadJson:   payload as unknown as Prisma.InputJsonValue,
      isPromotional: true,
      scheduledFor:  new Date(),
    });
  }

  if (records.length === 0) {
    return { queued: 0, skipped };
  }

  // Build a phone lookup for the job-building step
  const phoneByCustomerId = new Map(customers.map(c => [c.id, c.whatsappNumber]));

  // Bulk insert MessageQueue records in chunks.
  // Capture createdAt timestamp before each chunk so we can reliably fetch
  // back only the rows we just inserted (avoids fragile skip-based pagination).
  const CHUNK = 500;
  const insertedIds: string[] = [];

  for (let i = 0; i < records.length; i += CHUNK) {
    const slice = records.slice(i, i + CHUNK);
    const beforeInsert = new Date(Date.now() - 1_000); // 1s buffer for clock skew
    await prisma.messageQueue.createMany({ data: slice });

    // Fetch only the rows created in this chunk window
    const created = await prisma.messageQueue.findMany({
      where: {
        campaignId: id,
        businessId,
        status:     'PENDING',
        createdAt:  { gte: beforeInsert },
        customerId: { in: slice.map(r => r.customerId as string) },
      },
      select: { id: true, customerId: true, payloadJson: true },
    });

    for (const r of created) {
      const phone = phoneByCustomerId.get(r.customerId);
      if (!phone) continue;

      jobs.push({
        messageQueueId: r.id,
        businessId,
        customerId:     r.customerId,
        recipientPhone: phone,
        channel:        channel as any,
        provider:       provider as any,
        payload:        r.payloadJson as unknown as MessagePayload,
        isPromotional:  true,
        campaignId:     id,
        retryCount:     0,
      });
    }
  }

  // Bulk enqueue to BullMQ
  await enqueueBulkCampaign(jobs);

  // Mark campaign ACTIVE
  await prisma.campaign.update({
    where: { id },
    data:  { status: 'ACTIVE', sentCount: jobs.length, updatedAt: new Date() },
  });

  return { queued: jobs.length, skipped };
};

/**
 * Schedule a campaign for future dispatch.
 * Creates a single BullMQ delayed job that calls launchCampaign at the target time.
 */
export const scheduleCampaign = async (
  id:           string,
  businessId:   string,
  scheduledFor: Date
): Promise<void> => {
  if (scheduledFor <= new Date()) throw new Error('SCHEDULED_TIME_MUST_BE_FUTURE');

  const campaign = await prisma.campaign.findFirst({
    where:  { id, businessId },
    select: { status: true },
  });

  if (!campaign)                    throw new Error('CAMPAIGN_NOT_FOUND');
  if (campaign.status === 'ACTIVE') throw new Error('CAMPAIGN_ALREADY_ACTIVE');

  await prisma.campaign.update({
    where: { id },
    data:  { status: 'SCHEDULED', scheduledFor, updatedAt: new Date() },
  });

  // Enqueue a single "campaign launcher" job — the worker calls launchCampaign
  const { enqueueMessage } = await import('../services/messaging-queue');

  // We reuse the message queue with a special system payload type
  const delayMs = scheduledFor.getTime() - Date.now();

  await enqueueScheduledCampaignLaunch(id, businessId, delayMs);
};

export const pauseCampaign = async (id: string, businessId: string): Promise<void> => {
  await prisma.campaign.update({
    where: { id },
    data:  { status: 'PAUSED', updatedAt: new Date() },
  });
};

// ================================================================
// CORE: LAYOUT → MESSAGE PAYLOAD BUILDER
// ================================================================

/**
 * Transform a @dnd-kit/core CampaignLayout into a MessagePayload
 * consumable by the Meta/WAHA gateway.
 *
 * This is the single source of truth for how a visual campaign
 * canvas becomes an actual WhatsApp message.
 */
export const buildMessagePayloadFromLayout = (
  layout:       CampaignLayout,
  customer:     { fullName: string; whatsappNumber?: string | null },
  businessName: string,
  provider:     string = 'META'
): MessagePayload => {
  const sorted = [...layout.blocks].sort((a, b) => a.order - b.order);

  const textBlocks   = sorted.filter(b => b.type === 'TEXT' || b.type === 'AI_ASSIST');
  const imageBlocks  = sorted.filter(b => b.type === 'IMAGE');
  const videoBlocks  = sorted.filter(b => b.type === 'VIDEO');
  const couponBlocks = sorted.filter(b => b.type === 'COUPON');
  const buttonBlocks = sorted.filter(b => b.type === 'URL_BUTTON');

  // Personalise text content
  const firstName = customer.fullName.split(' ')[0];
  const personalise = (text: string) =>
    text
      .replace(/\{name\}/gi,       firstName)
      .replace(/\{fullname\}/gi,   customer.fullName)
      .replace(/\{business\}/gi,   businessName)
      .replace(/\{businessname\}/gi, businessName);

  // Build body text
  const bodyParts: string[] = [];

  for (const b of textBlocks) {
    if (b.content) bodyParts.push(personalise(b.content));
  }

  // Coupon blocks inject discount info + code
  for (const b of couponBlocks) {
    const lines: string[] = [];
    if (b.discountText) lines.push(`🎟️ *${b.discountText}*`);
    if (b.couponCode)   lines.push(`Code: \`${b.couponCode}\``);
    if (lines.length)   bodyParts.push(lines.join('\n'));
  }

  // URL buttons — for WAHA or when Meta interactive is unavailable:
  // append as plain text links
  if (provider === 'WAHA') {
    for (const b of buttonBlocks) {
      if (b.label && b.url) bodyParts.push(`👉 *${b.label}*: ${b.url}`);
    }
  }

  const body = bodyParts.join('\n\n').trim() || businessName;

  // ── Choose payload shape ────────────────────────────────────
  // Priority: VIDEO > IMAGE > TEXT
  // Buttons are appended to caption for media payloads.

  if (videoBlocks.length > 0) {
    return {
      type:     'VIDEO',
      mediaUrl: videoBlocks[0].mediaUrl!,
      caption:  body || videoBlocks[0].caption,
    } satisfies VideoPayload;
  }

  if (imageBlocks.length > 0) {
    return {
      type:     'IMAGE',
      mediaUrl: imageBlocks[0].mediaUrl!,
      caption:  body || imageBlocks[0].caption,
    } satisfies ImagePayload;
  }

  return { type: 'TEXT', body } satisfies TextPayload;
};

// ================================================================
// LAYOUT VALIDATION
// ================================================================

const validateLayout = (layout: CampaignLayout): void => {
  if (!layout?.blocks || !Array.isArray(layout.blocks)) {
    throw new Error('INVALID_LAYOUT: blocks array is required');
  }
  if (layout.blocks.length === 0) {
    throw new Error('INVALID_LAYOUT: campaign must have at least one block');
  }
  if (layout.blocks.length > 20) {
    throw new Error('INVALID_LAYOUT: maximum 20 blocks per campaign');
  }

  const validTypes = new Set<BlockType>([
    'TEXT', 'IMAGE', 'VIDEO', 'COUPON', 'URL_BUTTON', 'AI_ASSIST',
  ]);

  for (const block of layout.blocks) {
    if (!block.id)   throw new Error(`INVALID_LAYOUT: block missing id`);
    if (!block.type) throw new Error(`INVALID_LAYOUT: block ${block.id} missing type`);
    if (!validTypes.has(block.type)) {
      throw new Error(`INVALID_LAYOUT: unknown block type "${block.type}"`);
    }
    if ((block.type === 'IMAGE' || block.type === 'VIDEO') && !block.mediaUrl) {
      throw new Error(`INVALID_LAYOUT: ${block.type} block ${block.id} requires mediaUrl`);
    }
    if (block.type === 'URL_BUTTON' && (!block.label || !block.url)) {
      throw new Error(`INVALID_LAYOUT: URL_BUTTON block ${block.id} requires label and url`);
    }
  }
};

// ================================================================
// SEGMENT CUSTOMER RESOLVER
// ================================================================

/** Fetch customers in the target segment with consent filter pre-applied */
const resolveSegmentCustomers = async (
  businessId: string,
  segment:    string | null
): Promise<Array<{ id: string; whatsappNumber: string | null; fullName: string }>> => {
  return prisma.customer.findMany({
    where: {
      businessId,
      isActive:                 true,
      isStaff:                  false,   // Staff/owner never receive campaigns
      isSuppressed:             false,
      marketingConsentWhatsapp: true,
      OR: [
        { marketingPausedUntil: null },
        { marketingPausedUntil: { lt: new Date() } },
      ],
      ...(segment && segment !== 'ALL' && { segment: segment as any }),
    },
    select: { id: true, whatsappNumber: true, fullName: true },
    take:   10_000,
  }).then(rows => {
    if (rows.length === 10_000) {
      console.warn(`[campaign.service] resolveSegmentCustomers: hit 10k cap for business ${businessId} segment=${segment ?? 'ALL'} — some customers will be skipped`);
    }
    return rows;
  });
};

// ================================================================
// QUOTA HEADROOM CHECK
// ================================================================

const assertQuotaHeadroom = async (
  businessId: string,
  needed:     number
): Promise<void> => {
  const { getRedisClient } = await import('../config/redis');
  const redis  = getRedisClient();
  const quotaStr = await redis.get(`tenant:msg_quota:${businessId}`);

  if (quotaStr === null) return; // No quota key = uncapped (legacy / first run)

  const quota = parseInt(quotaStr, 10);
  if (quota === -1) return;  // Enterprise = unlimited

  if (quota < needed) {
    throw new Error(
      `INSUFFICIENT_QUOTA: campaign needs ${needed} messages but only ${quota} remain this month.`
    );
  }
};

// ================================================================
// SCHEDULED CAMPAIGN LAUNCHER (BullMQ delayed job)
// ================================================================

const enqueueScheduledCampaignLaunch = async (
  campaignId:  string,
  businessId:  string,
  delayMs:     number
): Promise<void> => {
  const { getMessageQueue } = await import('../services/messaging-queue');
  const queue = getMessageQueue();

  await queue.add(
    `campaign-launch:${campaignId}`,
    {
      // Special system job — worker detects _systemAction and calls launchCampaign
      _systemAction: 'LAUNCH_CAMPAIGN',
      campaignId,
      businessId,
      // Required fields to satisfy OutboundMessageJobData type at queue level
      messageQueueId: `sys-${campaignId}`,
      customerId:     'system',
      recipientPhone: 'system',
      channel:        'WHATSAPP_META',
      provider:       'META',
      payload:        { type: 'TEXT', body: '' },
      isPromotional:  true,
      retryCount:     0,
    } as any,
    {
      delay:  delayMs,
      jobId:  `launch-${campaignId}`,
      attempts: 3,
      backoff: { type: 'exponential', delay: 60_000 },
    }
  );
};
