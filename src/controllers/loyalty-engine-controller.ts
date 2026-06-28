// ================================================================
//  loyalty-engine-controller.ts
//  HTTP layer for the Loyalty Engine extensions, mounted at
//  /api/loyalty-engine. All routes behind tenantScope; businessId is
//  always sourced from req.tenantContext.
//
//  Rewards   GET/POST/PATCH/DELETE /rewards · POST /rewards/:id/redeem
//  Gift cards GET/POST /gift-cards · POST /gift-cards/redeem · GET /gift-cards/:code
//  Challenges GET/POST/PATCH/DELETE /challenges · GET /challenges/badges
//  QR        POST /qr/generate · POST /qr/verify
// ================================================================

import { Request, Response, Router } from 'express';
import { z, ZodError } from 'zod';
import { Role } from '@prisma/client';
import { prisma } from '../config/prisma';
import { tenantScope, requireRoles } from '../middleware/tenant-scope-middleware';
import {
  redeemReward, issueGiftCard, redeemGiftCard,
  evaluateChallenges, signQrPayload, verifyQrPayload,
  type RewardRedeemError, type GiftRedeemError,
} from '../services/loyalty-engine-service';

const STAFF = [Role.TENANT_OWNER, Role.BRANCH_MANAGER, Role.MARKETING_STAFF] as const;
const OWNER = [Role.TENANT_OWNER, Role.BRANCH_MANAGER] as const;
const REDEEMERS = [Role.TENANT_OWNER, Role.BRANCH_MANAGER, Role.CASHIER, Role.CUSTOMER] as const;

const handle = (err: unknown, res: Response): void => {
  if (err instanceof ZodError) { res.status(400).json({ error: 'VALIDATION_ERROR', fields: err.errors }); return; }
  console.error('[loyalty-engine]', err);
  res.status(500).json({ error: 'INTERNAL_ERROR' });
};

const ERR_STATUS: Record<RewardRedeemError | GiftRedeemError, number> = {
  REWARD_NOT_FOUND: 404, REWARD_INACTIVE: 409, OUT_OF_STOCK: 409, TIER_TOO_LOW: 403,
  PER_CUSTOMER_LIMIT: 409, INSUFFICIENT_POINTS_BALANCE: 402,
  GIFT_CARD_NOT_FOUND: 404, GIFT_CARD_INACTIVE: 409, GIFT_CARD_EXPIRED: 410, GIFT_CARD_EMPTY: 409,
};

export const loyaltyEngineRouter = Router();
loyaltyEngineRouter.use(tenantScope as any);

// ================================================================
//  REWARDS ENGINE
// ================================================================

const RewardSchema = z.object({
  name: z.string().min(1).max(80),
  description: z.string().max(300).optional(),
  type: z.enum(['FREE_ITEM', 'DISCOUNT', 'VOUCHER', 'CASHBACK', 'EXPERIENCE']),
  imageUrl: z.string().url().optional().or(z.literal('')),
  pointsCost: z.number().int().min(0),
  value: z.number().min(0).optional(),
  freeItemName: z.string().max(80).optional(),
  minTierRank: z.number().int().min(0).nullable().optional(),
  stock: z.number().int().min(0).nullable().optional(),
  perCustomerLimit: z.number().int().min(1).nullable().optional(),
  isActive: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
});

loyaltyEngineRouter.get('/rewards', requireRoles(...REDEEMERS) as any, async (req: Request, res: Response) => {
  try {
    const { businessId } = req.tenantContext;
    const rewards = await prisma.rewardTemplate.findMany({
      where: { businessId, ...(req.query.activeOnly === 'true' ? { isActive: true } : {}) },
      orderBy: [{ sortOrder: 'asc' }, { pointsCost: 'asc' }],
    });
    res.status(200).json({ rewards });
  } catch (err) { handle(err, res); }
});

loyaltyEngineRouter.post('/rewards', requireRoles(...OWNER) as any, async (req: Request, res: Response) => {
  try {
    const { businessId } = req.tenantContext;
    const b = RewardSchema.parse(req.body);
    const reward = await prisma.rewardTemplate.create({ data: { businessId, ...b, imageUrl: b.imageUrl || null } });
    res.status(201).json(reward);
  } catch (err) { handle(err, res); }
});

loyaltyEngineRouter.patch('/rewards/:id', requireRoles(...OWNER) as any, async (req: Request, res: Response) => {
  try {
    const { businessId } = req.tenantContext;
    const b = RewardSchema.partial().parse(req.body);
    const result = await prisma.rewardTemplate.updateMany({ where: { id: req.params.id, businessId }, data: { ...b, ...(b.imageUrl !== undefined ? { imageUrl: b.imageUrl || null } : {}) } });
    if (result.count === 0) { res.status(404).json({ error: 'REWARD_NOT_FOUND' }); return; }
    res.status(200).json({ ok: true });
  } catch (err) { handle(err, res); }
});

loyaltyEngineRouter.delete('/rewards/:id', requireRoles(...OWNER) as any, async (req: Request, res: Response) => {
  try {
    const { businessId } = req.tenantContext;
    await prisma.rewardTemplate.deleteMany({ where: { id: req.params.id, businessId } });
    res.status(204).end();
  } catch (err) { handle(err, res); }
});

// Redeem a reward. Customer redeems for themselves; staff redeems on a
// customer's behalf via ?customerId=.
loyaltyEngineRouter.post('/rewards/:id/redeem', requireRoles(...REDEEMERS) as any, async (req: Request, res: Response) => {
  try {
    const { businessId, userId, role } = req.tenantContext;
    const customerId = role === Role.CUSTOMER ? userId : (req.query.customerId as string | undefined) ?? (req.body?.customerId as string | undefined);
    if (!customerId) { res.status(400).json({ error: 'CUSTOMER_ID_REQUIRED' }); return; }

    const outcome = await redeemReward(businessId, customerId, req.params.id);
    if (!outcome.ok) { res.status(ERR_STATUS[outcome.error] ?? 400).json({ error: outcome.error }); return; }
    res.status(200).json(outcome.result);
  } catch (err) { handle(err, res); }
});

loyaltyEngineRouter.get('/rewards/redemptions', requireRoles(...STAFF) as any, async (req: Request, res: Response) => {
  try {
    const { businessId } = req.tenantContext;
    const redemptions = await prisma.rewardRedemption.findMany({
      where: { businessId, ...(req.query.status ? { status: req.query.status as any } : {}) },
      orderBy: { redeemedAt: 'desc' },
      take: 100,
      include: { reward: { select: { name: true, type: true } } },
    });
    res.status(200).json({ redemptions });
  } catch (err) { handle(err, res); }
});

// Mark a PENDING reward (free item / experience) as fulfilled at the counter
loyaltyEngineRouter.post('/rewards/redemptions/:id/fulfill', requireRoles(...REDEEMERS) as any, async (req: Request, res: Response) => {
  try {
    const { businessId, userId } = req.tenantContext;
    const result = await prisma.rewardRedemption.updateMany({ where: { id: req.params.id, businessId, status: 'PENDING' }, data: { status: 'FULFILLED', fulfilledAt: new Date(), fulfilledByUserId: userId } });
    if (result.count === 0) { res.status(404).json({ error: 'REDEMPTION_NOT_FOUND' }); return; }
    res.status(200).json({ ok: true });
  } catch (err) { handle(err, res); }
});

// ================================================================
//  GIFT CARDS
// ================================================================

const GiftIssueSchema = z.object({
  initialBalance: z.number().positive().max(100_000),
  purchaserName: z.string().max(80).optional(),
  recipientName: z.string().max(80).optional(),
  recipientPhone: z.string().max(30).optional(),
  message: z.string().max(300).optional(),
  expiresAt: z.string().datetime().optional(),
});

loyaltyEngineRouter.get('/gift-cards', requireRoles(...STAFF) as any, async (req: Request, res: Response) => {
  try {
    const { businessId } = req.tenantContext;
    const [cards, agg] = await Promise.all([
      prisma.giftCard.findMany({ where: { businessId }, orderBy: { createdAt: 'desc' }, take: 100 }),
      prisma.giftCard.aggregate({ where: { businessId, status: 'ACTIVE' }, _sum: { currentBalance: true }, _count: { id: true } }),
    ]);
    res.status(200).json({ cards, outstandingBalance: Number(agg._sum.currentBalance ?? 0), activeCount: agg._count.id });
  } catch (err) { handle(err, res); }
});

loyaltyEngineRouter.post('/gift-cards', requireRoles(...OWNER) as any, async (req: Request, res: Response) => {
  try {
    const { businessId } = req.tenantContext;
    const b = GiftIssueSchema.parse(req.body);
    const card = await issueGiftCard(businessId, { ...b, expiresAt: b.expiresAt ? new Date(b.expiresAt) : null });
    res.status(201).json(card);
  } catch (err) { handle(err, res); }
});

loyaltyEngineRouter.get('/gift-cards/:code', requireRoles(...REDEEMERS) as any, async (req: Request, res: Response) => {
  try {
    const { businessId } = req.tenantContext;
    const card = await prisma.giftCard.findFirst({ where: { businessId, code: req.params.code.trim().toUpperCase() }, select: { code: true, currentBalance: true, initialBalance: true, status: true, expiresAt: true } });
    if (!card) { res.status(404).json({ error: 'GIFT_CARD_NOT_FOUND' }); return; }
    res.status(200).json({ ...card, currentBalance: Number(card.currentBalance), initialBalance: Number(card.initialBalance) });
  } catch (err) { handle(err, res); }
});

const GiftRedeemSchema = z.object({ code: z.string().min(3), customerId: z.string().optional() });

loyaltyEngineRouter.post('/gift-cards/redeem', requireRoles(...REDEEMERS) as any, async (req: Request, res: Response) => {
  try {
    const { businessId, userId, role } = req.tenantContext;
    const b = GiftRedeemSchema.parse(req.body);
    const customerId = role === Role.CUSTOMER ? userId : b.customerId;
    if (!customerId) { res.status(400).json({ error: 'CUSTOMER_ID_REQUIRED' }); return; }
    const outcome = await redeemGiftCard(businessId, b.code, customerId);
    if (!outcome.ok) { res.status(ERR_STATUS[outcome.error] ?? 400).json({ error: outcome.error }); return; }
    res.status(200).json(outcome);
  } catch (err) { handle(err, res); }
});

// ================================================================
//  GAMIFICATION — challenges & badges
// ================================================================

const ChallengeSchema = z.object({
  name: z.string().min(1).max(80),
  description: z.string().max(300).optional(),
  type: z.enum(['VISIT_COUNT', 'SPEND_TOTAL', 'VISIT_STREAK', 'REFERRAL_COUNT', 'PRODUCT_TRY']),
  goal: z.number().int().positive(),
  rewardPoints: z.number().int().min(0).optional(),
  badgeName: z.string().max(40).optional(),
  badgeIcon: z.string().max(8).optional(),
  startsAt: z.string().datetime().optional(),
  endsAt: z.string().datetime().optional(),
  isActive: z.boolean().optional(),
});

loyaltyEngineRouter.get('/challenges', requireRoles(...REDEEMERS) as any, async (req: Request, res: Response) => {
  try {
    const { businessId, userId, role } = req.tenantContext;
    const customerId = role === Role.CUSTOMER ? userId : (req.query.customerId as string | undefined);
    const challenges = await prisma.challenge.findMany({ where: { businessId }, orderBy: { createdAt: 'desc' } });

    // If a customer is in scope, attach their progress to each challenge
    if (customerId) {
      const progress = await prisma.challengeProgress.findMany({ where: { businessId, customerId } });
      const map = new Map(progress.map((p) => [p.challengeId, p]));
      res.status(200).json({
        challenges: challenges.map((c) => {
          const p = map.get(c.id);
          return { ...c, progress: p?.progress ?? 0, completed: p?.completed ?? false, pct: Math.min(100, Math.round(((p?.progress ?? 0) / c.goal) * 100)) };
        }),
      });
      return;
    }

    // Owner view: include participation/completion counts
    const counts = await prisma.challengeProgress.groupBy({ by: ['challengeId', 'completed'], where: { businessId }, _count: { id: true } });
    res.status(200).json({
      challenges: challenges.map((c) => ({
        ...c,
        participants: counts.filter((x) => x.challengeId === c.id).reduce((s, x) => s + x._count.id, 0),
        completions: counts.filter((x) => x.challengeId === c.id && x.completed).reduce((s, x) => s + x._count.id, 0),
      })),
    });
  } catch (err) { handle(err, res); }
});

loyaltyEngineRouter.post('/challenges', requireRoles(...OWNER) as any, async (req: Request, res: Response) => {
  try {
    const { businessId } = req.tenantContext;
    const b = ChallengeSchema.parse(req.body);
    const challenge = await prisma.challenge.create({ data: { businessId, ...b, startsAt: b.startsAt ? new Date(b.startsAt) : null, endsAt: b.endsAt ? new Date(b.endsAt) : null } });
    res.status(201).json(challenge);
  } catch (err) { handle(err, res); }
});

loyaltyEngineRouter.patch('/challenges/:id', requireRoles(...OWNER) as any, async (req: Request, res: Response) => {
  try {
    const { businessId } = req.tenantContext;
    const b = ChallengeSchema.partial().parse(req.body);
    const data: any = { ...b };
    if (b.startsAt !== undefined) data.startsAt = b.startsAt ? new Date(b.startsAt) : null;
    if (b.endsAt !== undefined) data.endsAt = b.endsAt ? new Date(b.endsAt) : null;
    const result = await prisma.challenge.updateMany({ where: { id: req.params.id, businessId }, data });
    if (result.count === 0) { res.status(404).json({ error: 'CHALLENGE_NOT_FOUND' }); return; }
    res.status(200).json({ ok: true });
  } catch (err) { handle(err, res); }
});

loyaltyEngineRouter.delete('/challenges/:id', requireRoles(...OWNER) as any, async (req: Request, res: Response) => {
  try {
    const { businessId } = req.tenantContext;
    await prisma.challenge.deleteMany({ where: { id: req.params.id, businessId } });
    res.status(204).end();
  } catch (err) { handle(err, res); }
});

// Manually re-evaluate a customer's challenge progress (also runs on check-in)
loyaltyEngineRouter.post('/challenges/evaluate', requireRoles(...REDEEMERS) as any, async (req: Request, res: Response) => {
  try {
    const { businessId, userId, role } = req.tenantContext;
    const customerId = role === Role.CUSTOMER ? userId : (req.body?.customerId as string | undefined);
    if (!customerId) { res.status(400).json({ error: 'CUSTOMER_ID_REQUIRED' }); return; }
    const result = await evaluateChallenges(customerId, businessId);
    res.status(200).json(result);
  } catch (err) { handle(err, res); }
});

loyaltyEngineRouter.get('/badges', requireRoles(...REDEEMERS) as any, async (req: Request, res: Response) => {
  try {
    const { businessId, userId, role } = req.tenantContext;
    const customerId = role === Role.CUSTOMER ? userId : (req.query.customerId as string | undefined);
    if (!customerId) { res.status(400).json({ error: 'CUSTOMER_ID_REQUIRED' }); return; }
    const badges = await prisma.customerBadge.findMany({ where: { businessId, customerId }, orderBy: { earnedAt: 'desc' } });
    res.status(200).json({ badges });
  } catch (err) { handle(err, res); }
});

// ================================================================
//  SIGNED QR — branch / table / event scoped check-in tokens
// ================================================================

const QrGenSchema = z.object({
  scope: z.enum(['BRANCH', 'TABLE', 'EVENT', 'DYNAMIC']),
  branchLocationId: z.string().optional(),
  tableId: z.string().optional(),
  eventId: z.string().optional(),
  ttlSeconds: z.number().int().min(10).max(86_400).optional(),
  geo: z.object({ lat: z.number(), lng: z.number(), radiusM: z.number().positive() }).optional(),
});

loyaltyEngineRouter.post('/qr/generate', requireRoles(...STAFF) as any, async (req: Request, res: Response) => {
  try {
    const { businessId } = req.tenantContext;
    const b = QrGenSchema.parse(req.body);
    // DYNAMIC and EVENT QRs expire; static BRANCH/TABLE QRs can be printed once.
    const exp = b.ttlSeconds ? Date.now() + b.ttlSeconds * 1000 : (b.scope === 'DYNAMIC' ? Date.now() + 60_000 : undefined);
    const token = signQrPayload({ businessId, scope: b.scope, branchLocationId: b.branchLocationId, tableId: b.tableId, eventId: b.eventId, geo: b.geo, exp });
    const base = process.env.API_BASE_URL?.replace(/\/$/, '') || '';
    res.status(200).json({ token, exp: exp ?? null, checkinUrl: `${base}/checkin?t=${encodeURIComponent(token)}` });
  } catch (err) { handle(err, res); }
});

const QrVerifySchema = z.object({
  token: z.string(),
  geo: z.object({ lat: z.number(), lng: z.number() }).optional(),
});

loyaltyEngineRouter.post('/qr/verify', requireRoles(...REDEEMERS) as any, async (req: Request, res: Response) => {
  try {
    const { businessId } = req.tenantContext;
    const b = QrVerifySchema.parse(req.body);
    const scope = verifyQrPayload(b.token);
    if (!scope) { res.status(400).json({ valid: false, error: 'INVALID_OR_EXPIRED_QR' }); return; }
    if (scope.businessId !== businessId) { res.status(403).json({ valid: false, error: 'QR_BUSINESS_MISMATCH' }); return; }

    // Geolocation fraud check (only when the QR carries a geofence)
    if (scope.geo) {
      if (!b.geo) { res.status(400).json({ valid: false, error: 'LOCATION_REQUIRED' }); return; }
      const { distanceMeters } = await import('../services/loyalty-engine-service');
      const dist = distanceMeters(scope.geo, b.geo);
      if (dist > scope.geo.radiusM) { res.status(403).json({ valid: false, error: 'OUTSIDE_GEOFENCE', distanceM: Math.round(dist) }); return; }
    }
    res.status(200).json({ valid: true, scope });
  } catch (err) { handle(err, res); }
});
