// ================================================================
//  feedback-service.ts
//  Post-visit NPS collection via WhatsApp.
//
//  Flow:
//   1. Nightly (or triggered): find visits from ~4h ago with no
//      feedback request sent yet
//   2. Send "Rate your experience: ⭐ 1–5" message to customer
//   3. Inbound reply (digit 1–5) parsed in messaging-gateway webhook
//   4. FeedbackResponse row created; score <= 2 → SENTIMENT_NEGATIVE
//      automation trigger fired
// ================================================================

import { prisma } from '../config/prisma';
import { enqueueAutomationTrigger, enqueueMessage, TextPayload } from './messaging-queue';


const FEEDBACK_WINDOW_MS  = 4 * 3_600_000;   // Send 4h after visit
const LOOKBACK_WINDOW_MS  = 2 * 3_600_000;   // Process visits 4–6h old
const NEGATIVE_SCORE_MAX  = 2;               // Scores ≤ 2 trigger SENTIMENT_NEGATIVE

// ── Send rating requests ──────────────────────────────────────────

export const dispatchFeedbackRequests = async (): Promise<{ sent: number; skipped: number }> => {
  const now      = Date.now();
  const from     = new Date(now - FEEDBACK_WINDOW_MS - LOOKBACK_WINDOW_MS);
  const to       = new Date(now - FEEDBACK_WINDOW_MS);

  const businesses = await prisma.business.findMany({
    where:  { isActive: true },
    select: { id: true },
  });

  let sent    = 0;
  let skipped = 0;

  for (const biz of businesses) {
    const visits = await prisma.visit.findMany({
      where: {
        businessId: biz.id,
        visitedAt:  { gte: from, lte: to },
        source:     { in: ['POS_WEBHOOK', 'QR_CHECKIN'] },
      },
      select: { id: true, customerId: true, visitedAt: true },
    });

    // Batch-check for existing feedback to avoid duplicates
    const existingVisitIds = new Set(
      (await prisma.feedbackResponse.findMany({
        where: { businessId: biz.id, visitId: { in: visits.map(v => v.id) } },
        select: { visitId: true },
      })).map(f => f.visitId)
    );

    for (const visit of visits) {
      if (existingVisitIds.has(visit.id)) { skipped++; continue; }

      const customer = await prisma.customer.findFirst({
        where:  { id: visit.customerId, isSuppressed: false, marketingConsentWhatsapp: true },
        select: { id: true, fullName: true, whatsappNumber: true },
      });
      if (!customer?.whatsappNumber) { skipped++; continue; }

      const body = `Hi ${customer.fullName?.split(' ')[0] ?? 'there'} 👋\n\nHow was your visit today?\n\nReply with a number:\n⭐ 1 – Poor\n⭐⭐ 2 – Fair\n⭐⭐⭐ 3 – Good\n⭐⭐⭐⭐ 4 – Great\n⭐⭐⭐⭐⭐ 5 – Excellent`;
      const payload: TextPayload = { type: 'TEXT', body };

      try {
        // Create the MessageQueue record first (enqueueMessage requires it)
        const record = await prisma.messageQueue.create({
          data: {
            businessId:    biz.id,
            customerId:    customer.id,
            channel:       'WHATSAPP_WAHA',
            provider:      'WAHA',
            status:        'PENDING',
            payloadJson:   payload as any,
            isPromotional: false, // Transactional — bypasses cooldown in worker
            scheduledFor:  new Date(),
          },
        });
        await enqueueMessage({
          messageQueueId: record.id,
          businessId:     biz.id,
          customerId:     customer.id,
          recipientPhone: customer.whatsappNumber,
          channel:        'WHATSAPP_WAHA',
          provider:       'WAHA',
          payload,
          isPromotional:  false,
          retryCount:     0,
        });

        // Mark as requested by creating a placeholder row (score=0)
        await prisma.feedbackResponse.create({
          data: {
            businessId: biz.id,
            customerId: customer.id,
            visitId:    visit.id,
            score:      0, // pending — will be updated when reply arrives
            channel:    'WHATSAPP',
            sentAt:     new Date(),
          } as any,
        });
        sent++;
      } catch {
        skipped++;
      }
    }
  }

  return { sent, skipped };
};

// ── Process incoming rating reply ──────────────────────────────────

/**
 * Called by the inbound webhook handler when a customer replies with
 * a digit 1–5. Finds the most recent pending FeedbackResponse for this
 * customer, updates it, and fires SENTIMENT_NEGATIVE for low scores.
 */
export const processFeedbackReply = async (
  businessId: string,
  customerId: string,
  messageText: string
): Promise<boolean> => {
  const score = parseInt(messageText.trim(), 10);
  if (isNaN(score) || score < 1 || score > 5) return false;

  // Find the most recent pending (score=0) feedback request
  const pending = await prisma.feedbackResponse.findFirst({
    where:   { businessId, customerId, score: 0 },
    orderBy: { sentAt: 'desc' },
  } as any);

  if (!pending) return false;

  await prisma.feedbackResponse.update({
    where: { id: pending.id },
    data:  { score, createdAt: new Date() } as any,
  });

  if (score <= NEGATIVE_SCORE_MAX) {
    const wf = await prisma.automationWorkflow.findFirst({
      where:  { businessId, triggerType: 'SENTIMENT_NEGATIVE', status: 'ACTIVE' },
      select: { id: true },
    });
    if (wf) {
      enqueueAutomationTrigger({
        workflowId:     wf.id,
        businessId,
        customerId,
        triggerType:    'SENTIMENT_NEGATIVE',
        triggerPayload: { score, visitId: pending.visitId },
      }).catch(() => {});
    }
  }

  return true;
};
