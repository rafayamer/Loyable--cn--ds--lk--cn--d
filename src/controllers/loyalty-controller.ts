// ================================================================
//  loyalty.controller.ts
//  Express HTTP handlers + router for all loyalty endpoints.
//
//  Route map:
//   GET  /api/loyalty/:customerId/profile    → getProfileHandler
//   POST /api/loyalty/:customerId/redeem     → redeemCouponHandler
//   GET  /api/loyalty/tiers                  → getTiersHandler
//   PUT  /api/loyalty/tiers                  → updateTiersHandler
//   POST /api/loyalty/referral/apply         → applyReferralHandler
//   GET  /api/loyalty/:customerId/referrals  → getReferralStatsHandler
//   POST /api/loyalty/checkin                → checkInHandler (POS/QR)
//   GET  /api/loyalty/analytics/snapshot     → getSnapshotHandler
//
//  All routes protected by tenantScope middleware.
//  businessId is always sourced from req.tenantContext — never req.body.
// ================================================================

import { Request, Response, Router } from 'express';
import { z, ZodError }               from 'zod';
import { Role }                      from '@prisma/client';
import { prisma } from '../config/prisma';
import { }              from '@prisma/client';

import {
  getCustomerLoyaltyProfile,
  redeemCoupon,
  getTierConfiguration,
  upsertTierConfiguration,
  processReferralConversion,
  accruePointsForVisit,
  evaluateCustomerSegment,
} from '../services/loyalty-service';

import {
  tenantScope,
  requireRoles,
  getBranchScopedWhere,
} from '../middleware/tenant-scope-middleware';


// ================================================================
// ZOD SCHEMAS
// ================================================================

const RedeemCouponSchema = z.object({
  couponCode:   z.string().min(1).max(100),
  cashierPin:   z.string().length(4).regex(/^\d{4}$/, 'PIN must be exactly 4 digits'),
  wasOffline:   z.boolean().optional().default(false),
});

const UpdateTiersSchema = z.array(
  z.object({
    rank:          z.number().int().min(1).max(10),
    name:          z.string().min(1).max(50),
    minVisitCount: z.number().int().min(0).optional(),
    minTotalSpend: z.number().min(0).optional(),
    color:         z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
    benefitsJson:  z.array(z.object({
      type:          z.enum(['PERCENTAGE_DISCOUNT', 'FREE_PRODUCT', 'PRIORITY_SERVICE']),
      value:         z.number().optional(),
      description:   z.string().optional(),
    })).optional(),
  })
);

const ApplyReferralSchema = z.object({
  referralCode:  z.string().min(5).max(50),
});

const CheckInSchema = z.object({
  amountSpent:      z.number().min(0),
  branchLocationId: z.string().cuid().optional(),
  source:           z.enum(['QR_CHECKIN', 'POS_WEBHOOK', 'MANUAL']).default('QR_CHECKIN'),
  notes:            z.string().max(500).optional(),
});

// ================================================================
// VALIDATION MIDDLEWARE
// ================================================================

const validate = (schema: z.ZodSchema) =>
  (req: Request, res: Response, next: ReturnType<typeof require>) => {
    try {
      req.body = schema.parse(req.body);
      next();
    } catch (err) {
      if (err instanceof ZodError) {
        res.status(400).json({
          error:  'VALIDATION_ERROR',
          fields: err.errors.map(e => ({ path: e.path.join('.'), message: e.message })),
        });
      } else {
        next(err);
      }
    }
  };

// ================================================================
// ERROR MAP
// ================================================================

const ERROR_STATUS: Record<string, number> = {
  CUSTOMER_NOT_FOUND:             404,
  COUPON_NOT_FOUND:               404,
  COUPON_USED:                    409,
  COUPON_EXPIRED:                 410,
  INVALID_CASHIER_PIN:            401,
  INSUFFICIENT_POINTS_BALANCE:    402,
  INVALID_REFERRAL_CODE:          404,
  REFERRAL_ALREADY_PROCESSED:     409,
  TRANSACTION_FAILED:             500,
};

const handleError = (err: unknown, res: Response): void => {
  const msg    = err instanceof Error ? err.message : 'UNKNOWN_ERROR';
  const status = ERROR_STATUS[msg] ?? 500;
  if (status === 500) console.error('[loyalty.controller]', err);
  res.status(status).json({ error: status === 500 ? 'INTERNAL_ERROR' : msg });
};

// ================================================================
// HANDLERS
// ================================================================

/**
 * GET /api/loyalty/:customerId/profile
 * Returns tier status, points balance, ledger, and referral code.
 * Available to: TENANT_OWNER, BRANCH_MANAGER, MARKETING_STAFF, CASHIER
 */
const getProfileHandler = async (req: Request, res: Response): Promise<void> => {
  try {
    const { customerId } = req.params;
    const { businessId } = req.tenantContext;

    const profile = await getCustomerLoyaltyProfile(customerId, businessId);

    if (!profile.customer) {
      res.status(404).json({ error: 'CUSTOMER_NOT_FOUND' });
      return;
    }

    res.status(200).json(profile);
  } catch (err) { handleError(err, res); }
};

/**
 * POST /api/loyalty/:customerId/redeem
 * Atomic coupon redemption with row-level lock + PIN verification.
 * Available to: CASHIER, BRANCH_MANAGER, TENANT_OWNER
 *
 * Body: { couponCode, cashierPin, wasOffline? }
 */
const redeemCouponHandler = async (req: Request, res: Response): Promise<void> => {
  try {
    const { customerId }                = req.params;
    const { couponCode, cashierPin, wasOffline } = req.body as z.infer<typeof RedeemCouponSchema>;
    const { businessId, userId, branchLocationId } = req.tenantContext;

    if (!branchLocationId) {
      res.status(400).json({ error: 'BRANCH_LOCATION_REQUIRED_FOR_CASHIER' });
      return;
    }

    const result = await redeemCoupon(
      couponCode,
      cashierPin,
      userId,
      branchLocationId,
      businessId,
      wasOffline
    );

    if (!result.success) {
      const status = ERROR_STATUS[result.error!] ?? 400;
      res.status(status).json({ error: result.error });
      return;
    }

    res.status(200).json({
      success:      true,
      discountText: result.discountText,
      couponId:     result.couponId,
    });
  } catch (err) { handleError(err, res); }
};

/**
 * GET /api/loyalty/tiers
 * Returns the business's loyalty tier configuration.
 */
const getTiersHandler = async (req: Request, res: Response): Promise<void> => {
  try {
    const tiers = await getTierConfiguration(req.tenantContext.businessId);
    res.status(200).json(tiers);
  } catch (err) { handleError(err, res); }
};

/**
 * PUT /api/loyalty/tiers
 * Upsert the loyalty tier configuration (from the visual slider UI).
 * Available to: TENANT_OWNER only
 *
 * Body: Array of tier objects with rank, name, thresholds, benefits
 */
const updateTiersHandler = async (req: Request, res: Response): Promise<void> => {
  try {
    const tiers = req.body as z.infer<typeof UpdateTiersSchema>;
    const tiers_updated = await upsertTierConfiguration(
      req.tenantContext.businessId,
      tiers
    );
    res.status(200).json(tiers_updated);
  } catch (err) { handleError(err, res); }
};

/**
 * POST /api/loyalty/referral/apply
 * Apply a referral code for the authenticated customer.
 * The atomic $transaction creates the discount coupon + credits
 * the referrer's points in a single DB operation.
 *
 * Body: { referralCode }
 */
const applyReferralHandler = async (req: Request, res: Response): Promise<void> => {
  try {
    const { referralCode }  = req.body as z.infer<typeof ApplyReferralSchema>;
    const { businessId, userId } = req.tenantContext;

    const result = await processReferralConversion(userId, referralCode, businessId);

    if (!result.success) {
      const status = ERROR_STATUS[result.error!] ?? 400;
      res.status(status).json({ error: result.error });
      return;
    }

    res.status(200).json({
      success:          true,
      discountCouponId: result.discountCouponId,
      message:          `Referral applied! You have a ${10}% discount coupon ready.`,
    });
  } catch (err) { handleError(err, res); }
};

/**
 * GET /api/loyalty/:customerId/referrals
 * Return referral code, conversion count, and points earned from referrals.
 */
const getReferralStatsHandler = async (req: Request, res: Response): Promise<void> => {
  try {
    const { customerId } = req.params;
    const { businessId } = req.tenantContext;

    const [customer, ledgerStats, referrals] = await Promise.all([
      prisma.customer.findFirst({
        where:  { id: customerId, businessId },
        select: { referralCode: true },
      }),
      prisma.rewardPointsLedger.aggregate({
        where:  { customerId, businessId, reason: 'REFERRAL_CREDIT' },
        _sum:   { points: true },
        _count: { id: true },
      }),
      prisma.customer.findMany({
        where: {
          businessId,
          referredByCode: (await prisma.customer.findFirst({
            where:  { id: customerId, businessId },
            select: { referralCode: true },
          }))?.referralCode ?? '__none__',
        },
        select: { id: true, fullName: true, createdAt: true },
        take:   50,
      }),
    ]);

    res.status(200).json({
      referralCode:    customer?.referralCode,
      conversions:     ledgerStats._count.id,
      totalPointsEarned: ledgerStats._sum.points ?? 0,
      referredCustomers: referrals.map(r => ({
        id:       r.id,
        name:     r.fullName,
        joinedAt: r.createdAt,
      })),
    });
  } catch (err) { handleError(err, res); }
};

/**
 * POST /api/loyalty/checkin
 * Register a customer visit + accrue points atomically.
 * Used by QR check-in, manual staff entry, and tablet kiosk.
 * POS webhooks use the dedicated webhook.pos.ts controller instead.
 *
 * Body: { amountSpent, branchLocationId?, source?, notes? }
 * Customer ID comes from the JWT (customer-facing portal) or query param (staff).
 */
const checkInHandler = async (req: Request, res: Response): Promise<void> => {
  try {
    const { amountSpent, branchLocationId: bodyBranch, source, notes } =
      req.body as z.infer<typeof CheckInSchema>;
    const { businessId, userId, branchLocationId: tokenBranch, role } = req.tenantContext;

    // Staff check-in: customerId comes from query param
    // Customer portal: customerId is the authenticated user
    const customerId =
      role === Role.CUSTOMER
        ? userId
        : (req.query.customerId as string | undefined);

    if (!customerId) {
      res.status(400).json({ error: 'CUSTOMER_ID_REQUIRED' });
      return;
    }

    const effectiveBranch = bodyBranch ?? tokenBranch ?? undefined;

    // Idempotency: prevent same customer checking in twice today
    const today     = new Date();
    const dayStart  = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    const existing  = await prisma.visit.findFirst({
      where: {
        businessId,
        customerId,
        source:    source ?? 'QR_CHECKIN',
        visitedAt: { gte: dayStart },
      },
      select: { id: true },
    });

    if (existing) {
      res.status(409).json({ error: 'ALREADY_CHECKED_IN_TODAY', visitId: existing.id });
      return;
    }

    // Revenue attribution: most recent campaign/automation message within 48h
    const ATTR_WINDOW = new Date(Date.now() - 48 * 3_600_000);
    const recentMsg = await prisma.messageQueue.findFirst({
      where: { customerId, businessId, status: { in: ['SENT', 'DELIVERED', 'READ'] }, createdAt: { gte: ATTR_WINDOW } },
      orderBy: { createdAt: 'desc' },
      select:  { campaignId: true, automationRunId: true },
    }).catch(() => null);

    // Create visit
    const visit = await prisma.$transaction(async (tx) => {
      const v = await tx.visit.create({
        data: {
          businessId,
          customerId,
          branchLocationId:       effectiveBranch,
          amountSpent,
          source:                 source ?? 'QR_CHECKIN',
          notes,
          visitedAt:              new Date(),
          attributedCampaignId:   recentMsg?.campaignId      ?? null,
          attributedAutomationId: recentMsg?.automationRunId ?? null,
        } as any,
      });

      // Increment customer counters
      await tx.customer.update({
        where:  { id: customerId },
        data:   {
          visitCount: { increment: 1 },
          totalSpend: { increment: amountSpent },
          lastVisitAt:  new Date(),
          firstVisitAt: undefined,
          updatedAt:    new Date(),
        },
        select: { id: true },
      });

      // Ensure firstVisitAt is set only if null
      await tx.customer.updateMany({
        where:  { id: customerId, firstVisitAt: null },
        data:   { firstVisitAt: new Date() },
      });

      return v;
    });

    // Accrue points + tier evaluation (outside main transaction for isolation)
    const { pointsEarned, newBalance, tierUpgraded } = await accruePointsForVisit(
      visit.id,
      businessId,
      customerId,
      amountSpent
    );

    // Inline segment re-evaluation so customer label is correct immediately
    evaluateCustomerSegment(customerId, businessId).catch(() => {});

    // Re-evaluate gamification challenges (visit-count, streak, spend, …) so
    // any newly-completed challenge grants its points + badge right away.
    import('../services/loyalty-engine-service')
      .then(({ evaluateChallenges }) => evaluateChallenges(customerId, businessId))
      .catch(() => {});

    // Check visit milestone automation (e.g. 10th visit)
    const updatedCustomer = await prisma.customer.findUnique({
      where:  { id: customerId },
      select: { visitCount: true },
    });

    if (updatedCustomer) {
      void checkVisitMilestone(businessId, customerId, updatedCustomer.visitCount);
    }

    res.status(201).json({
      visitId:      visit.id,
      pointsEarned,
      newBalance,
      tierUpgraded,
    });
  } catch (err) { handleError(err, res); }
};

/**
 * GET /api/loyalty/analytics/snapshot
 * Returns the latest AnalyticsSnapshot for the authenticated tenant.
 * Frontend dashboards consume ONLY this endpoint — no live aggregation.
 */
const getSnapshotHandler = async (req: Request, res: Response): Promise<void> => {
  try {
    const { businessId } = req.tenantContext;
    const days           = Math.min(Number(req.query.days ?? 30), 365);

    const cutoff = new Date(Date.now() - days * 86_400_000);

    const snapshots = await prisma.analyticsSnapshot.findMany({
      where: {
        businessId,
        branchLocationId: null,
        snapshotDate:     { gte: cutoff },
      },
      orderBy: { snapshotDate: 'asc' },
    });

    // If no stored snapshots, compute a live snapshot so the dashboard
    // shows real data immediately (instead of dashes on a fresh account).
    if (snapshots.length === 0) {
      const liveSnap = await computeLiveSnapshot(businessId);
      return void res.status(200).json([liveSnap]);
    }

    res.status(200).json(snapshots);
  } catch (err) { handleError(err, res); }
};

/** Computes a live analytics snapshot without writing to DB. */
const computeLiveSnapshot = async (businessId: string): Promise<Record<string, unknown>> => {
  const now      = new Date();
  const day30ago = new Date(now.getTime() - 30 * 86_400_000);

  const [segCounts, visitStats, msgStats, totalCustomers, ltvStats, repeatCustomers] =
    await Promise.all([
      prisma.customer.groupBy({
        by:    ['segment'],
        where: { businessId, isActive: true },
        _count: { id: true },
      }),
      prisma.visit.aggregate({
        where:  { businessId, visitedAt: { gte: day30ago } },
        _count: { id: true },
        _sum:   { amountSpent: true },
        _avg:   { amountSpent: true },
      }),
      prisma.messageQueue.groupBy({
        by:    ['status'],
        where: { businessId, createdAt: { gte: day30ago } },
        _count: { id: true },
      }),
      prisma.customer.count({ where: { businessId, isActive: true } }),
      prisma.customer.aggregate({
        where: { businessId, isActive: true },
        _avg:  { totalSpend: true },
      }),
      // Repeat customers = visited more than once in last 30 days
      prisma.visit.groupBy({
        by:    ['customerId'],
        where: { businessId, visitedAt: { gte: day30ago } },
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
  const repeatVisitRate = totalCustomers > 0 ? (repeatCustomers.length / totalCustomers) * 100 : 0;

  const sent      = (msg['SENT'] ?? 0) + (msg['DELIVERED'] ?? 0) + (msg['READ'] ?? 0);

  return {
    businessId,
    snapshotDate:     now,
    branchLocationId: null,
    totalCustomers,
    newCustomers:     seg['NEW']          ?? 0,
    loyalCustomers:   seg['LOYAL']        ?? 0,
    vipCustomers:     seg['VIP']          ?? 0,
    atRiskCustomers:  seg['AT_RISK']      ?? 0,
    lostCustomers:    seg['LOST']         ?? 0,
    bigSpenders:      seg['BIG_SPENDER']  ?? 0,
    couponHunters:    seg['COUPON_HUNTER'] ?? 0,
    totalVisits:      visitStats._count.id,
    totalRevenue:     Number(visitStats._sum.amountSpent ?? 0),
    averageOrderValue: Number(visitStats._avg.amountSpent ?? 0),
    churnRate,
    retentionRate,
    averageLtv,
    repeatVisitRate,
    messagesSent:     sent,
    messagesDelivered: msg['DELIVERED'] ?? 0,
    messagesRead:     msg['READ']       ?? 0,
    messagesFailed:   msg['FAILED']     ?? 0,
    messagesDroppedConsent:  msg['CONSENT_REVOKED']  ?? 0,
    messagesDroppedCooldown: msg['DROPPED_COOLDOWN'] ?? 0,
  };
};

// ================================================================
// VISIT MILESTONE HELPER (fire-and-forget)
// ================================================================

const VISIT_MILESTONES = [5, 10, 25, 50, 100];

const checkVisitMilestone = async (
  businessId:  string,
  customerId:  string,
  visitCount:  number
): Promise<void> => {
  if (!VISIT_MILESTONES.includes(visitCount)) return;

  const wf = await prisma.automationWorkflow.findFirst({
    where: { businessId, triggerType: 'VISIT_MILESTONE', status: 'ACTIVE' },
    select: { id: true },
  });

  if (!wf) return;

  // Enqueue via BullMQ (messaging-queue owns the AutomationRun lifecycle)
  const { enqueueAutomationTrigger } = await import('../services/messaging-queue');
  await enqueueAutomationTrigger({
    workflowId:     wf.id,
    businessId,
    customerId,
    triggerType:    'VISIT_MILESTONE',
    triggerPayload: { visitCount },
  }).catch(console.error);
};

// ================================================================
// CUSTOMERS LIST HANDLER
// ================================================================

// Root-level churn risk (0-100) from recency, visit frequency and segment.
// Mirrors the client heuristic so dashboard "at-risk" reflects real data.
const computeChurnRisk = (c: any): number => {
  const now       = Date.now();
  const lastVisit = c.lastVisitAt ? new Date(c.lastVisitAt).getTime() : null;
  const daysSince = lastVisit ? Math.floor((now - lastVisit) / 86_400_000) : 999;
  const visits    = c.visitCount ?? 0;
  const recency   = Math.min(60, (daysSince / 90) * 60);
  const freq      = Math.max(0, 30 - Math.min(30, visits * 3));
  const segBonus  = c.segment === 'LOST' ? 15 : c.segment === 'AT_RISK' ? 10 : c.segment === 'NEW' ? 5 : 0;
  return Math.max(0, Math.min(100, Math.round(recency + freq + segBonus)));
};

const listCustomersHandler = async (req: Request, res: Response): Promise<void> => {
  try {
    const { businessId } = req.tenantContext;
    const q       = (req.query.q as string) ?? '';
    const segment = (req.query.segment as string) ?? '';
    const page    = Math.max(1, Number(req.query.page ?? 1));
    const limit   = Math.min(100, Number(req.query.limit ?? 50));
    const skip    = (page - 1) * limit;

    const where: any = {
      businessId,
      isActive: true,
      ...(q && {
        OR: [
          { fullName:       { contains: q, mode: 'insensitive' } },
          { whatsappNumber: { contains: q } },
          { email:          { contains: q, mode: 'insensitive' } },
        ],
      }),
      ...(segment && { segment }),
    };

    const [customers, total] = await Promise.all([
      prisma.customer.findMany({
        where,
        orderBy: { lastVisitAt: 'desc' },
        skip,
        take: limit,
        select: {
          id: true, fullName: true, whatsappNumber: true, email: true,
          segment: true, visitCount: true, totalSpend: true,
          currentPointsBalance: true, currentTierId: true,
          lastVisitAt: true, createdAt: true, referralCode: true,
          isStaff: true, marketingConsentWhatsapp: true, isSuppressed: true,
        },
      }),
      prisma.customer.count({ where }),
    ]);

    const mapped = customers.map((c: any) => ({
      ...c,
      phone: c.whatsappNumber,
      pointsBalance: c.currentPointsBalance,
      churnRisk: computeChurnRisk(c),
    }));
    res.status(200).json({ customers: mapped, total, page, pages: Math.ceil(total / limit) });
  } catch (err) { handleError(err, res); }
};

// ================================================================
// DASHBOARD KPI HANDLER
// ================================================================

const getDashboardHandler = async (req: Request, res: Response): Promise<void> => {
  try {
    const { businessId } = req.tenantContext;
    const now   = new Date();
    const d7    = new Date(now.getTime() - 7 * 86_400_000);
    const d30   = new Date(now.getTime() - 30 * 86_400_000);
    const d60   = new Date(now.getTime() - 60 * 86_400_000);

    const [
      totalCustomers, activeCustomers, newThisMonth,
      revenueResult, prevRevenueResult,
      msgThisMonth, recentSnapshots, segmentCounts,
      subscription,
    ] = await Promise.all([
      prisma.customer.count({ where: { businessId } }),
      prisma.customer.count({ where: { businessId, lastVisitAt: { gte: d30 } } }),
      prisma.customer.count({ where: { businessId, createdAt: { gte: d30 } } }),
      prisma.visit.aggregate({ where: { businessId, visitedAt: { gte: d30 } }, _sum: { amountSpent: true }, _count: true }),
      prisma.visit.aggregate({ where: { businessId, visitedAt: { gte: d60, lt: d30 } }, _sum: { amountSpent: true }, _count: true }),
      prisma.messageQueue.count({ where: { businessId, createdAt: { gte: d30 } } }),
      prisma.analyticsSnapshot.findMany({
        where: { businessId, branchLocationId: null, snapshotDate: { gte: d7 } },
        orderBy: { snapshotDate: 'asc' },
      }),
      prisma.customer.groupBy({
        by: ['segment'], where: { businessId }, _count: { id: true },
      }),
      prisma.subscription.findUnique({ where: { businessId }, select: { monthlyMessageQuota: true, messagesUsedThisPeriod: true } }),
    ]);

    const revenue     = Number(revenueResult._sum?.amountSpent ?? 0);
    const prevRevenue = Number(prevRevenueResult._sum?.amountSpent ?? 0);
    const revChange   = prevRevenue ? ((revenue - prevRevenue) / prevRevenue) * 100 : 0;

    // Build visitTrend from snapshots if available, otherwise aggregate raw visits by day
    let visitTrend: { day: string; visits: number; revenue: number }[];
    if (recentSnapshots.length > 0) {
      visitTrend = recentSnapshots.map(s => ({
        day:     s.snapshotDate.toISOString().slice(0, 10),
        visits:  s.totalVisits,
        revenue: Number(s.totalRevenue ?? 0),
      }));
    } else {
      // Fall back: group visits by day for last 30 days
      const rawVisits = await prisma.visit.findMany({
        where:  { businessId, visitedAt: { gte: d30 } },
        select: { visitedAt: true, amountSpent: true },
        orderBy: { visitedAt: 'asc' },
      });
      const byDay = new Map<string, { visits: number; revenue: number }>();
      for (const v of rawVisits) {
        const day = v.visitedAt.toISOString().slice(0, 10);
        const cur = byDay.get(day) ?? { visits: 0, revenue: 0 };
        byDay.set(day, { visits: cur.visits + 1, revenue: cur.revenue + Number(v.amountSpent ?? 0) });
      }
      visitTrend = Array.from(byDay.entries()).map(([day, d]) => ({ day, ...d }));
    }

    res.status(200).json({
      kpis: {
        totalCustomers,
        activeCustomers,
        newThisMonth,
        revenue,
        revenuePrevMonth: prevRevenue,
        revenueChange: Math.round(revChange * 10) / 10,
        visits: revenueResult._count,
        messagesThisMonth: msgThisMonth,
        quotaUsed: subscription?.messagesUsedThisPeriod ?? 0,
        quotaTotal: subscription?.monthlyMessageQuota ?? 0,
      },
      visitTrend,
      segments: segmentCounts.map(s => ({ name: s.segment, value: s._count.id })),
    });
  } catch (err) { handleError(err, res); }
};

// ================================================================
// MESSAGE QUEUE HANDLER
// ================================================================

const listMessagesHandler = async (req: Request, res: Response): Promise<void> => {
  try {
    const { businessId } = req.tenantContext;
    const status  = (req.query.status as string) ?? '';
    const limit   = Math.min(100, Number(req.query.limit ?? 50));
    const page    = Math.max(1, Number(req.query.page ?? 1));

    const where: any = {
      businessId,
      ...(status && { status }),
    };

    const [messages, total] = await Promise.all([
      prisma.messageQueue.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        include: {
          customer: { select: { fullName: true, whatsappNumber: true, segment: true } },
        },
      }),
      prisma.messageQueue.count({ where }),
    ]);

    const mappedMsgs = messages.map((m: any) => ({
      ...m,
      customer: m.customer ? { ...m.customer, phone: m.customer.whatsappNumber } : null,
    }));
    res.status(200).json({ messages: mappedMsgs, total, page });
  } catch (err) { handleError(err, res); }
};

// ================================================================
// ROUTER ASSEMBLY
// ================================================================

// ================================================================
// CREATE CUSTOMER HANDLER
// ================================================================

const CreateCustomerSchema = z.object({
  fullName:           z.string().min(1).max(200),
  whatsappNumber:     z.string().min(5).max(30),
  email:              z.string().email().optional(),
  segment:            z.string().optional(),
  initialPoints:      z.number().int().min(0).optional(),
  sendWelcomeMessage: z.boolean().optional(),
  welcomeMessage:     z.string().max(1000).optional(),
});

const createCustomerHandler = async (req: Request, res: Response): Promise<void> => {
  try {
    const { businessId } = req.tenantContext;
    const body = CreateCustomerSchema.parse(req.body);

    // Normalise phone
    let phone = body.whatsappNumber.replace(/\s+/g, '');
    if (!phone.startsWith('+')) phone = '+' + phone;

    const existing = await prisma.customer.findFirst({ where: { businessId, whatsappNumber: phone } });
    if (existing) {
      res.status(409).json({ error: 'CUSTOMER_EXISTS', message: 'A customer with this phone number already exists.' });
      return;
    }

    const referralCode = Math.random().toString(36).slice(2, 8).toUpperCase();
    const customer = await prisma.customer.create({
      data: {
        businessId,
        fullName:   body.fullName,
        whatsappNumber: phone,
        email:      body.email,
        segment:    (body.segment as any) ?? 'NEW',
        referralCode,
        marketingConsentWhatsapp: true,
      },
    });

    // Award initial points if requested
    if (body.initialPoints && body.initialPoints > 0) {
      await prisma.rewardPointsLedger.create({
        data: {
          customerId:   customer.id,
          businessId,
          type:         'CREDIT',
          points:       body.initialPoints,
          balanceAfter: body.initialPoints,
          reason:       'MANUAL_ADJUSTMENT',
          referenceType: 'INITIAL_REGISTRATION',
        },
      });
      await prisma.customer.update({
        where:  { id: customer.id },
        data:   { currentPointsBalance: { increment: body.initialPoints } },
        select: { id: true },
      });
    }

    // Queue welcome message if requested
    if (body.sendWelcomeMessage && body.welcomeMessage) {
      const business = await prisma.business.findUnique({ where: { id: businessId }, select: { name: true } });
      const msgText = body.welcomeMessage
        .replace('{{name}}', body.fullName.split(' ')[0])
        .replace('{{points}}', String(body.initialPoints ?? 0))
        .replace('{{business_name}}', business?.name ?? '');
      const mqRecord = await prisma.messageQueue.create({
        data: {
          businessId,
          customerId:    customer.id,
          channel:       'WHATSAPP_WAHA',
          provider:      'WAHA',
          status:        'PENDING',
          isPromotional: false,
          payloadJson:   { type: 'TEXT', body: msgText } as any,
        },
      });
      const { enqueueMessage } = await import('../services/messaging-queue');
      await enqueueMessage({
        messageQueueId: mqRecord.id,
        businessId,
        customerId:     customer.id,
        recipientPhone: phone,
        channel:        'WHATSAPP_WAHA',
        provider:       'WAHA',
        payload:        { type: 'TEXT', body: msgText },
        isPromotional:  false,
        retryCount:     0,
      });
    }

    res.status(201).json({ customer: { id: customer.id, fullName: customer.fullName, whatsappNumber: phone } });
  } catch (err) { handleError(err, res); }
};

// ================================================================
// UPDATE CUSTOMER (staff flag, consent, name) — PATCH
// ================================================================
const UpdateCustomerSchema = z.object({
  isStaff:                  z.boolean().optional(),
  marketingConsentWhatsapp: z.boolean().optional(),
  fullName:                 z.string().min(1).max(200).optional(),
  email:                    z.string().email().optional(),
  segment:                  z.string().optional(),
});

const updateCustomerHandler = async (req: Request, res: Response): Promise<void> => {
  try {
    const { businessId } = req.tenantContext;
    const { customerId } = req.params;
    const body = UpdateCustomerSchema.parse(req.body);

    const existing = await prisma.customer.findFirst({ where: { id: customerId, businessId }, select: { id: true } });
    if (!existing) { res.status(404).json({ error: 'CUSTOMER_NOT_FOUND' }); return; }

    const data: any = {};
    if (body.isStaff !== undefined)                  data.isStaff = body.isStaff;
    if (body.marketingConsentWhatsapp !== undefined) data.marketingConsentWhatsapp = body.marketingConsentWhatsapp;
    if (body.fullName !== undefined)                 data.fullName = body.fullName;
    if (body.email !== undefined)                    data.email = body.email;
    if (body.segment !== undefined)                  data.segment = body.segment as any;

    const updated = await prisma.customer.update({ where: { id: customerId }, data, select: { id: true, isStaff: true } });
    res.status(200).json({ customer: updated });
  } catch (err) { handleError(err, res); }
};

// ================================================================
// DELETE CUSTOMER — soft delete (isActive=false) then hard delete
// ================================================================
const deleteCustomerHandler = async (req: Request, res: Response): Promise<void> => {
  try {
    const { businessId } = req.tenantContext;
    const { customerId } = req.params;

    const existing = await prisma.customer.findFirst({ where: { id: customerId, businessId }, select: { id: true } });
    if (!existing) { res.status(404).json({ error: 'CUSTOMER_NOT_FOUND' }); return; }

    // Cascade removes visits, ledgers, messageQueue, etc. via schema onDelete.
    await prisma.customer.delete({ where: { id: customerId } });
    res.status(200).json({ ok: true, deleted: customerId });
  } catch (err) { handleError(err, res); }
};

export const loyaltyRouter = Router();

// All loyalty routes require a valid tenant JWT
loyaltyRouter.use(tenantScope as any);

// Read-only: cashier and above
loyaltyRouter.get(
  '/:customerId/profile',
  requireRoles(Role.TENANT_OWNER, Role.BRANCH_MANAGER, Role.MARKETING_STAFF, Role.CASHIER) as any,
  getProfileHandler
);

loyaltyRouter.get(
  '/:customerId/referrals',
  requireRoles(Role.TENANT_OWNER, Role.BRANCH_MANAGER, Role.MARKETING_STAFF) as any,
  getReferralStatsHandler
);

loyaltyRouter.get(
  '/analytics/snapshot',
  requireRoles(Role.TENANT_OWNER, Role.BRANCH_MANAGER, Role.MARKETING_STAFF) as any,
  getSnapshotHandler
);

loyaltyRouter.get(
  '/tiers',
  requireRoles(Role.TENANT_OWNER, Role.BRANCH_MANAGER, Role.MARKETING_STAFF, Role.CASHIER) as any,
  getTiersHandler
);

// Mutating: Owner only
loyaltyRouter.put(
  '/tiers',
  requireRoles(Role.TENANT_OWNER) as any,
  validate(UpdateTiersSchema) as any,
  updateTiersHandler
);

// Cashier operations
loyaltyRouter.post(
  '/:customerId/redeem',
  requireRoles(Role.TENANT_OWNER, Role.BRANCH_MANAGER, Role.CASHIER) as any,
  validate(RedeemCouponSchema) as any,
  redeemCouponHandler
);

// Check-in: staff or authenticated customer
loyaltyRouter.post(
  '/checkin',
  requireRoles(
    Role.TENANT_OWNER, Role.BRANCH_MANAGER, Role.CASHIER, Role.MARKETING_STAFF, Role.CUSTOMER
  ) as any,
  validate(CheckInSchema) as any,
  checkInHandler
);

// Referral: customer portal
loyaltyRouter.post(
  '/referral/apply',
  validate(ApplyReferralSchema) as any,
  applyReferralHandler
);

// Dashboard KPIs
loyaltyRouter.get(
  '/dashboard',
  requireRoles(Role.TENANT_OWNER, Role.BRANCH_MANAGER, Role.MARKETING_STAFF) as any,
  getDashboardHandler
);

// Customer list
loyaltyRouter.get(
  '/customers',
  requireRoles(Role.TENANT_OWNER, Role.BRANCH_MANAGER, Role.MARKETING_STAFF, Role.CASHIER) as any,
  listCustomersHandler
);

// Create customer manually
loyaltyRouter.post(
  '/customers',
  requireRoles(Role.TENANT_OWNER, Role.BRANCH_MANAGER, Role.CASHIER) as any,
  createCustomerHandler
);

// Update customer (mark staff, toggle consent, edit details)
loyaltyRouter.patch(
  '/customers/:customerId',
  requireRoles(Role.TENANT_OWNER, Role.BRANCH_MANAGER) as any,
  updateCustomerHandler
);

// Delete customer
loyaltyRouter.delete(
  '/customers/:customerId',
  requireRoles(Role.TENANT_OWNER, Role.BRANCH_MANAGER) as any,
  deleteCustomerHandler
);

// GDPR purge — delete all PII for a customer by phone number
loyaltyRouter.post(
  '/customers/purge',
  requireRoles(Role.TENANT_OWNER) as any,
  async (req: any, res: any) => {
    const { businessId } = req.tenantContext;
    const { phone } = req.body as { phone?: string };
    if (!phone?.trim()) { res.status(400).json({ error: 'Phone number required' }); return; }
    const customer = await prisma.customer.findFirst({
      where: { businessId, whatsappNumber: phone.trim() },
      select: { id: true },
    });
    if (!customer) { res.status(404).json({ error: 'No customer found with that phone number' }); return; }
    await prisma.customer.delete({ where: { id: customer.id } });
    res.json({ ok: true });
  }
);

// Message queue
loyaltyRouter.get(
  '/messages',
  requireRoles(Role.TENANT_OWNER, Role.BRANCH_MANAGER, Role.MARKETING_STAFF) as any,
  listMessagesHandler
);

// ================================================================
// MOUNT IN app.ts:
//   import { loyaltyRouter } from './controllers/loyalty.controller';
//   app.use('/api/loyalty', loyaltyRouter);
// ================================================================
