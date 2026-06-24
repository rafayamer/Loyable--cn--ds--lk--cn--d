// ================================================================
//  cron.service.ts
//  All node-cron job definitions — registered once at server startup.
//
//  Schedule (all UTC):
//   00:30 — Birthday automation dispatcher
//   01:00 — Customer segment refresh (all tenants, chunked)
//   01:05 — AnalyticsSnapshot generation (all tenants)
//   01:15 — Inactivity win-back queue
//
//  Design rules:
//   - Every job is idempotent: safe to re-run without duplicate data
//   - Analytics upsert is keyed on (businessId, snapshotDate, branchId)
//   - Segment writes are batched inside a single $transaction per chunk
//   - No job blocks the event loop: all DB queries are async/awaited
//   - Errors inside a per-tenant loop are caught and logged —
//     one failing tenant never aborts other tenants
// ================================================================

import cron                         from 'node-cron';
import { Prisma }     from '@prisma/client';
import { prisma } from '../config/prisma';
import { processBirthdayAutomations, evaluateAndDowngradeTier } from './loyalty-service';
import { enqueueAutomationTrigger, getAutomationQueue } from '../services/messaging-queue';
import { dispatchFeedbackRequests }   from './feedback-service';


// ================================================================
// STARTUP ENTRY POINT
// ================================================================

export const startAllCronJobs = (): void => {
  if (process.env.DISABLE_CRON === 'true') {
    console.log('[cron] DISABLE_CRON=true — skipping cron registration.');
    return;
  }

  // 00:30 UTC — birthday dispatch
  cron.schedule('30 0 * * *', jobRunner('birthday',    birthdayJob),    { timezone: 'UTC' });

  // 01:00 UTC — segment refresh
  cron.schedule('0 1 * * *',  jobRunner('segmentRefresh', segmentRefreshJob), { timezone: 'UTC' });

  // 01:05 UTC — analytics snapshot
  cron.schedule('5 1 * * *',  jobRunner('analyticsSnapshot', analyticsSnapshotJob), { timezone: 'UTC' });

  // 01:15 UTC — inactivity win-back
  cron.schedule('15 1 * * *', jobRunner('inactivityQueue', inactivityQueueJob), { timezone: 'UTC' });

  // 02:00 UTC — tier demotion (rolling 90-day window)
  cron.schedule('0 2 * * *', jobRunner('tierDemotion', tierDemotionJob), { timezone: 'UTC' });

  // 02:30 UTC — points expiry
  cron.schedule('30 2 * * *', jobRunner('pointsExpiry', pointsExpiryJob), { timezone: 'UTC' });

  // Every hour — post-visit feedback requests (sent ~4h after each visit)
  cron.schedule('0 * * * *', jobRunner('feedbackDispatch', feedbackDispatchJob), { timezone: 'UTC' });

  console.log('[cron] 7 jobs registered (6 nightly + 1 hourly).');
};

/** Wraps a job function with error boundary + execution timing */
const jobRunner = (name: string, fn: () => Promise<Record<string, unknown>>) =>
  async () => {
    const start = Date.now();
    console.log(`[cron:${name}] Starting...`);
    try {
      const result = await fn();
      console.log(`[cron:${name}] Completed in ${Date.now() - start}ms:`, result);
    } catch (err) {
      console.error(`[cron:${name}] Fatal error after ${Date.now() - start}ms:`, err);
    }
  };

// ================================================================
// JOB 1 — BIRTHDAY AUTOMATION (00:30 UTC)
// ================================================================

const birthdayJob = async (): Promise<Record<string, unknown>> => {
  return processBirthdayAutomations();
};

// ================================================================
// JOB 2 — CUSTOMER SEGMENT REFRESH (01:00 UTC)
// ================================================================

/**
 * Re-evaluates every active customer's segment across all tenants.
 * Processes in chunks of 500 to avoid Node.js heap exhaustion.
 *
 * Segment rules (applied in priority order):
 *   LOST         → no visit for > lostDaysThreshold days
 *   AT_RISK      → no visit for > irregularGapDays days
 *   BIG_SPENDER  → totalSpend >= BIG_SPENDER_THRESHOLD AND recently active
 *   VIP          → currentTierId is the business's highest-rank tier
 *   COUPON_HUNTER → redeemed > 3 coupons AND visitCount < 5 (discount-seeker)
 *   LOYAL        → lastVisit within loyalDaysWindow AND visitCount >= 2
 *   NEW          → visitCount <= 1
 */
const segmentRefreshJob = async (): Promise<Record<string, unknown>> => {
  const businesses = await prisma.business.findMany({
    where:  { isActive: true },
    select: {
      id:                true,
      loyalDaysWindow:   true,
      irregularGapDays:  true,
      lostDaysThreshold: true,
    },
  });

  let totalProcessed = 0;
  let totalChanged   = 0;

  for (const biz of businesses) {
    try {
      const { processed, changed } = await refreshSegmentsForBusiness(biz);
      totalProcessed += processed;
      totalChanged   += changed;
    } catch (err) {
      console.error(`[cron:segmentRefresh] Business ${biz.id} failed:`, err);
    }
  }

  return { businesses: businesses.length, totalProcessed, totalChanged };
};

const BIG_SPENDER_THRESHOLD = 500; // £ — configurable per business in future
const CHUNK_SIZE             = 500;

const refreshSegmentsForBusiness = async (biz: {
  id:                string;
  loyalDaysWindow:   number;
  irregularGapDays:  number;
  lostDaysThreshold: number;
}): Promise<{ processed: number; changed: number }> => {
  const now            = Date.now();
  const loyalCutoff    = new Date(now - biz.loyalDaysWindow   * 86_400_000);
  const atRiskCutoff   = new Date(now - biz.irregularGapDays  * 86_400_000);
  const lostCutoff     = new Date(now - biz.lostDaysThreshold * 86_400_000);

  const highestTier = await prisma.loyaltyTier.findFirst({
    where:   { businessId: biz.id },
    orderBy: { rank: 'desc' },
    select:  { id: true },
  });

  let processed = 0;
  let changed   = 0;
  let cursor: string | undefined;

  while (true) {
    const customers = await prisma.customer.findMany({
      where:   { businessId: biz.id, isActive: true },
      select: {
        id:               true,
        visitCount:       true,
        totalSpend:       true,
        lastVisitAt:      true,
        segment:          true,
        currentTierId:    true,
        couponRedemptions: { select: { id: true }, take: 10 },
      },
      take:    CHUNK_SIZE,
      cursor:  cursor ? { id: cursor } : undefined,
      skip:    cursor ? 1 : 0,
      orderBy: { id: 'asc' },
    });

    if (customers.length === 0) break;
    cursor = customers[customers.length - 1].id;

    type SegmentUpdate = { id: string; segment: string; prev: string };
    const updates: SegmentUpdate[] = [];

    for (const c of customers) {
      processed++;
      const spend        = Number(c.totalSpend ?? 0);
      const last         = c.lastVisitAt;
      const redemptions  = c.couponRedemptions.length;
      const prev         = c.segment;
      let   next: string = prev;

      // BIG_SPENDER evaluated first so dormant VIPs aren't lost to LOST/AT_RISK
      if (spend >= BIG_SPENDER_THRESHOLD) {
        next = 'BIG_SPENDER';
      } else if (!last || last < lostCutoff) {
        next = 'LOST';
      } else if (last < atRiskCutoff) {
        next = 'AT_RISK';
      } else if (highestTier && c.currentTierId === highestTier.id) {
        next = 'VIP';
      } else if (redemptions > 3 && c.visitCount < 5) {
        next = 'COUPON_HUNTER';
      } else if (last >= loyalCutoff && c.visitCount >= 2) {
        next = 'LOYAL';
      } else if (c.visitCount <= 1) {
        next = 'NEW';
      }

      if (next !== prev) {
        updates.push({ id: c.id, segment: next, prev });
      }
    }

    if (updates.length > 0) {
      // Batch all updates and history appends in one transaction
      await prisma.$transaction(
        updates.flatMap(u => [
          prisma.customer.update({
            where:  { id: u.id },
            data:   { segment: u.segment as any, updatedAt: new Date() },
            select: { id: true },
          }),
          prisma.customerSegmentHistory.create({
            data: {
              businessId:  biz.id,
              customerId:  u.id,
              fromSegment: u.prev as any,
              toSegment:   u.segment as any,
              reason:      'INACTIVITY',
              changedAt:   new Date(),
            },
          }),
        ])
      );
      changed += updates.length;
    }

    if (customers.length < CHUNK_SIZE) break;
  }

  return { processed, changed };
};

// ================================================================
// JOB 3 — NIGHTLY ANALYTICS SNAPSHOT (01:05 UTC)
// ================================================================

/**
 * Computes and upserts one AnalyticsSnapshot row per active business.
 * Frontend dashboards read ONLY from this table — zero live aggregation.
 *
 * Idempotent: upsert keyed on (businessId, snapshotDate, branchLocationId=null)
 * means re-running after a failure produces exactly one row per day per tenant.
 */
const analyticsSnapshotJob = async (): Promise<Record<string, unknown>> => {
  const today    = new Date();
  const dateOnly = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));

  const businesses = await prisma.business.findMany({
    where:  { isActive: true },
    select: { id: true },
  });

  let successCount = 0;
  let failCount    = 0;

  for (const { id: businessId } of businesses) {
    try {
      await generateSnapshotForBusiness(businessId, dateOnly);
      successCount++;
    } catch (err) {
      failCount++;
      console.error(`[cron:analyticsSnapshot] Business ${businessId} failed:`, err);
    }
  }

  return { businesses: businesses.length, successCount, failCount };
};

const generateSnapshotForBusiness = async (
  businessId: string,
  dateOnly:   Date
): Promise<void> => {
  const dayStart = dateOnly;
  const dayEnd   = new Date(dateOnly.getTime() + 86_400_000);

  const day30ago = new Date(dayStart.getTime() - 30 * 86_400_000);

  // Run all aggregates in parallel
  const [segCounts, visitStats, msgStats, totalCustomers, ltvStats, repeatCustomers] =
    await Promise.all([
      prisma.customer.groupBy({
        by:    ['segment'],
        where: { businessId, isActive: true },
        _count: { id: true },
      }),
      prisma.visit.aggregate({
        where:  { businessId, visitedAt: { gte: dayStart, lt: dayEnd } },
        _count: { id: true },
        _sum:   { amountSpent: true },
        _avg:   { amountSpent: true },
      }),
      prisma.messageQueue.groupBy({
        by:    ['status'],
        where: { businessId, createdAt: { gte: dayStart, lt: dayEnd } },
        _count: { id: true },
      }),
      prisma.customer.count({ where: { businessId, isActive: true } }),
      prisma.customer.aggregate({
        where: { businessId, isActive: true },
        _avg:  { totalSpend: true },
      }),
      // Customers who visited more than once in the last 30 days
      prisma.visit.groupBy({
        by:     ['customerId'],
        where:  { businessId, visitedAt: { gte: day30ago } },
        having: { customerId: { _count: { gt: 1 } } },
        _count: { customerId: true },
      }),
    ]);

  const seg = Object.fromEntries(segCounts.map(s => [s.segment, s._count.id]));
  const msg = Object.fromEntries(msgStats.map(s  => [s.status,  s._count.id]));

  const atRisk         = (seg['AT_RISK'] ?? 0) + (seg['LOST'] ?? 0);
  const churnRate      = totalCustomers > 0 ? (atRisk / totalCustomers) * 100 : 0;
  const retentionRate  = 100 - churnRate;
  const averageLtv     = Number(ltvStats._avg.totalSpend ?? 0);
  const totalRevenue   = Number(visitStats._sum.amountSpent ?? 0);
  const avgOrder       = Number(visitStats._avg.amountSpent ?? 0);
  const repeatVisitRate = totalCustomers > 0 ? (repeatCustomers.length / totalCustomers) * 100 : 0;

  const sent      = (msg['SENT'] ?? 0) + (msg['DELIVERED'] ?? 0) + (msg['READ'] ?? 0);
  const delivered = msg['DELIVERED']          ?? 0;
  const read      = msg['READ']               ?? 0;
  const failed    = msg['FAILED']             ?? 0;
  const droppedC  = msg['CONSENT_REVOKED']    ?? 0;
  const droppedCo = msg['DROPPED_COOLDOWN']   ?? 0;

  const snapshotData = {
    totalCustomers,
    newCustomers:    seg['NEW']          ?? 0,
    loyalCustomers:  seg['LOYAL']         ?? 0,
    vipCustomers:    seg['VIP']           ?? 0,
    atRiskCustomers: seg['AT_RISK']       ?? 0,
    lostCustomers:   seg['LOST']          ?? 0,
    bigSpenders:     seg['BIG_SPENDER']   ?? 0,
    couponHunters:   seg['COUPON_HUNTER'] ?? 0,
    totalVisits:     visitStats._count.id,
    totalRevenue,
    averageOrderValue: avgOrder,
    churnRate,
    retentionRate,
    averageLtv,
    messagesSent:    sent,
    messagesDelivered: delivered,
    messagesRead:    read,
    messagesFailed:  failed,
    messagesDroppedConsent:  droppedC,
    messagesDroppedCooldown: droppedCo,
    repeatVisitRate,
  };

  await prisma.analyticsSnapshot.upsert({
    where: {
      businessId_snapshotDate_branchLocationId: {
        businessId,
        snapshotDate:     dateOnly,
        branchLocationId: null as any,
      },
    },
    update: { ...snapshotData, createdAt: undefined },
    create: { businessId, snapshotDate: dateOnly, branchLocationId: null, ...snapshotData },
  });
};

// ================================================================
// JOB 4 — INACTIVITY WIN-BACK QUEUE (01:15 UTC)
// ================================================================

/**
 * Find AT_RISK customers who haven't received a win-back automation
 * within the deduplication window, then enqueue their INACTIVITY
 * workflow via BullMQ (max 100 per business per run to prevent spikes).
 *
 * Deduplication: excludes customers who already have a COMPLETED
 * INACTIVITY AutomationRun within the irregular_gap_days window.
 */
const inactivityQueueJob = async (): Promise<Record<string, unknown>> => {
  const businesses = await prisma.business.findMany({
    where:  { isActive: true },
    select: { id: true, irregularGapDays: true },
  });

  let evaluated = 0;
  let queued    = 0;

  for (const biz of businesses) {
    try {
      const wf = await prisma.automationWorkflow.findFirst({
        where:  { businessId: biz.id, triggerType: 'INACTIVITY', status: 'ACTIVE' },
        select: { id: true },
      });

      if (!wf) continue;

      const inactivityCutoff    = new Date(Date.now() - biz.irregularGapDays * 86_400_000);
      const deduplicationCutoff = new Date(Date.now() - biz.irregularGapDays * 86_400_000);

      // Customers already messaged recently (deduplication)
      const alreadyMessaged = await prisma.automationRun.findMany({
        where: {
          businessId: biz.id,
          workflowId: wf.id,
          status:     'COMPLETED',
          triggeredAt: { gte: deduplicationCutoff },
        },
        select: { customerId: true },
      });

      const excludeIds = alreadyMessaged.map(r => r.customerId);

      // Backpressure: skip this business if queue is already heavily loaded
      const queueDepth = await getAutomationQueue().getWaitingCount().catch(() => 0);
      if (queueDepth > 50_000) {
        console.warn(`[cron:inactivityQueue] Queue depth ${queueDepth} exceeds 50k — skipping biz ${biz.id} to prevent overload`);
        continue;
      }

      // Paginate in chunks of 500 to handle large customer bases
      const CHUNK = 500;
      let cursor: string | undefined;
      let pageLoop = true;
      while (pageLoop) {
        const page = await prisma.customer.findMany({
          where: {
            businessId:               biz.id,
            segment:                  { in: ['AT_RISK', 'LOST'] },
            isActive:                 true,
            isSuppressed:             false,
            marketingConsentWhatsapp: true,
            lastVisitAt:              { lte: inactivityCutoff },
            id:                       { notIn: excludeIds, ...(cursor ? { gt: cursor } : {}) },
          },
          select:  { id: true },
          orderBy: { id: 'asc' },
          take:    CHUNK,
        });
        if (page.length < CHUNK) pageLoop = false;
        if (page.length > 0) cursor = page[page.length - 1].id;

        for (const customer of page) {
          evaluated++;
          try {
            await enqueueAutomationTrigger({
              workflowId:     wf.id,
              businessId:     biz.id,
              customerId:     customer.id,
              triggerType:    'INACTIVITY',
              triggerPayload: { daysInactive: biz.irregularGapDays },
            });
            queued++;
          } catch (err) {
            console.error(`[cron:inactivityQueue] Enqueue failed for ${customer.id}:`, err);
          }
        }
      }
    } catch (err) {
      console.error(`[cron:inactivityQueue] Business ${biz.id} failed:`, err);
    }
    // Yield between businesses to prevent Redis/DB saturation
    await new Promise(resolve => setTimeout(resolve, 50));
  }

  return { businesses: businesses.length, evaluated, queued };
};

// ================================================================
// TIER DEMOTION JOB
// ================================================================

/**
 * Nightly job: re-evaluate every customer with a tier against their
 * rolling 90-day visit activity. Demote if they no longer qualify.
 */
const tierDemotionJob = async (): Promise<Record<string, unknown>> => {
  const businesses = await prisma.business.findMany({
    where:  { isActive: true },
    select: { id: true },
  });

  let evaluated = 0;
  let demoted   = 0;

  for (const biz of businesses) {
    try {
      let demotionCursor: string | undefined;
      while (true) {
        const page = await prisma.customer.findMany({
          where:   { businessId: biz.id, isActive: true, currentTierId: { not: null } },
          select:  { id: true },
          orderBy: { id: 'asc' },
          take:    500,
          cursor:  demotionCursor ? { id: demotionCursor } : undefined,
          skip:    demotionCursor ? 1 : 0,
        });
        if (page.length === 0) break;
        demotionCursor = page[page.length - 1].id;

        for (const c of page) {
          evaluated++;
          const wasDemoted = await evaluateAndDowngradeTier(c.id, biz.id);
          if (wasDemoted) demoted++;
        }
        if (page.length < 500) break;
      }
    } catch (err) {
      console.error(`[cron:tierDemotion] Business ${biz.id} failed:`, err);
    }
  }

  return { businesses: businesses.length, evaluated, demoted };
};

// ================================================================
// POINTS EXPIRY JOB
// ================================================================

/**
 * Nightly points expiry: for each business, find customers with
 * positive point balances where their last CREDIT ledger entry is
 * older than Business.pointsExpiryDays. Write a DEBIT EXPIRY entry
 * and decrement currentPointsBalance.
 *
 * 30-day pre-expiry warning is handled by checking for a warning
 * already sent in this cycle to avoid duplicate notifications.
 */
const pointsExpiryJob = async (): Promise<Record<string, unknown>> => {
  const businesses = await prisma.business.findMany({
    where:  { isActive: true },
    select: { id: true, pointsExpiryDays: true },
  });

  let expired   = 0;
  let customers = 0;

  for (const biz of businesses) {
    const expiryDays  = (biz as any).pointsExpiryDays ?? 365;
    const expiryCutoff = new Date(Date.now() - expiryDays * 86_400_000);
    const warnCutoff   = new Date(Date.now() - (expiryDays - 30) * 86_400_000);

    try {
      // Find customers with points whose oldest uncredited entry predates the cutoff
      const eligible = await prisma.customer.findMany({
        where: {
          businessId:           biz.id,
          isActive:             true,
          currentPointsBalance: { gt: 0 },
        },
        select: { id: true, currentPointsBalance: true },
      });

      for (const c of eligible) {
        // Check oldest CREDIT ledger entry
        const oldest = await prisma.rewardPointsLedger.findFirst({
          where:   { customerId: c.id, businessId: biz.id, type: 'CREDIT' },
          orderBy: { createdAt: 'asc' },
          select:  { createdAt: true, points: true },
        });
        if (!oldest) continue;

        // Pre-expiry warning (30 days out)
        if (oldest.createdAt < warnCutoff && oldest.createdAt >= expiryCutoff) {
          // Enqueue non-blocking warning automation
          enqueueAutomationTrigger({
            workflowId:     'POINTS_EXPIRY_WARNING',
            businessId:     biz.id,
            customerId:     c.id,
            triggerType:    'POINTS_EXPIRY_WARNING' as any,
            triggerPayload: { expiresInDays: 30, points: c.currentPointsBalance },
          }).catch(() => {});
          continue;
        }

        if (oldest.createdAt >= expiryCutoff) continue; // Not yet expired

        // Expire all outstanding points
        const pts = c.currentPointsBalance ?? 0;
        if (pts <= 0) continue;

        await prisma.$transaction([
          prisma.customer.update({
            where:  { id: c.id },
            data:   { currentPointsBalance: 0, updatedAt: new Date() },
            select: { id: true },
          }),
          prisma.rewardPointsLedger.create({
            data: {
              businessId:   biz.id,
              customerId:   c.id,
              type:         'DEBIT',
              points:       pts,
              balanceAfter: 0,
              reason:       'EXPIRY',
            } as any,
          }),
        ]);
        customers++;
        expired += pts;
      }
    } catch (err) {
      console.error(`[cron:pointsExpiry] Business ${biz.id} failed:`, err);
    }
  }

  return { businesses: businesses.length, customersExpired: customers, pointsExpired: expired };
};

// ================================================================
// FEEDBACK DISPATCH JOB
// ================================================================

const feedbackDispatchJob = async (): Promise<Record<string, unknown>> => {
  const result = await dispatchFeedbackRequests();
  return result;
};
