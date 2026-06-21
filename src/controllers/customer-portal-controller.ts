// ================================================================
//  customer-portal-controller.ts
//  Public-facing customer loyalty portal — no tenant JWT required.
//  Customers authenticate with phone + name → receive a short-lived
//  portal token (signed JWT) that grants read access to their profile.
//
//  Route map (all public, mounted at /api/portal):
//   GET  /api/portal/:slug/info       → business info + tier config
//   POST /api/portal/:slug/login      → phone + name → portal JWT
//   GET  /api/portal/me               → full profile (portal JWT)
//   POST /api/portal/redeem           → redeem coupon (portal JWT)
// ================================================================

import { Request, Response, Router } from 'express';
import { z }                         from 'zod';
import jwt, { SignOptions }          from 'jsonwebtoken';
import { PrismaClient }              from '@prisma/client';

const prisma = new PrismaClient();

// ── Portal JWT helpers ────────────────────────────────────────────
const PORTAL_SECRET = () => {
  const s = process.env.JWT_SECRET;
  if (!s) throw new Error('JWT_SECRET not set');
  return s;
};

const PORTAL_EXPIRY = '7d';

function issuePortalToken(customerId: string, businessId: string): string {
  return jwt.sign(
    { customerId, businessId, scope: 'CUSTOMER_PORTAL' },
    PORTAL_SECRET(),
    { expiresIn: PORTAL_EXPIRY, algorithm: 'HS256' } as SignOptions
  );
}

function verifyPortalToken(token: string): { customerId: string; businessId: string } {
  const payload = jwt.verify(token, PORTAL_SECRET()) as any;
  if (payload.scope !== 'CUSTOMER_PORTAL') throw new Error('Invalid scope');
  return { customerId: payload.customerId, businessId: payload.businessId };
}

// ── Auth middleware for portal routes ─────────────────────────────
function portalAuth(req: Request, res: Response, next: any) {
  const auth = req.headers.authorization;
  if (!auth?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Missing portal token' });
    return;
  }
  try {
    const ctx = verifyPortalToken(auth.slice(7));
    (req as any).portalCtx = ctx;
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired portal token' });
  }
}

// ── Validation schemas ────────────────────────────────────────────
const LoginSchema = z.object({
  phone: z.string().min(7).max(20),
  name:  z.string().min(1).max(100),
});

const RedeemSchema = z.object({
  couponCode: z.string().min(1),
});

// ================================================================
// HANDLERS
// ================================================================

/** GET /api/portal/:slug/info — business branding + tier config */
const infoHandler = async (req: Request, res: Response): Promise<void> => {
  const { slug } = req.params;
  const biz = await prisma.business.findFirst({
    where:  { slug, isActive: true },
    select: { id: true, name: true, slug: true, currency: true, industry: true, logoUrl: true },
  });
  if (!biz) { res.status(404).json({ error: 'Business not found' }); return; }

  const tiers = await prisma.tierConfig.findMany({
    where:   { businessId: biz.id },
    orderBy: { minPoints: 'asc' },
    select:  { name: true, minPoints: true, maxPoints: true, color: true, discountPct: true, perks: true },
  });

  res.json({ business: biz, tiers });
};

/** POST /api/portal/:slug/login — phone + name verification */
const loginHandler = async (req: Request, res: Response): Promise<void> => {
  const parse = LoginSchema.safeParse(req.body);
  if (!parse.success) { res.status(400).json({ error: 'Invalid input', issues: parse.error.issues }); return; }

  const { phone, name } = parse.data;
  const { slug } = req.params;

  const biz = await prisma.business.findFirst({
    where: { slug, isActive: true },
    select: { id: true, name: true },
  });
  if (!biz) { res.status(404).json({ error: 'Business not found' }); return; }

  // Normalize phone — strip non-digits for fuzzy match
  const digits = phone.replace(/\D/g, '');

  const customer = await prisma.customer.findFirst({
    where: {
      businessId: biz.id,
      OR: [
        { whatsappNumber: { contains: digits } },
        { whatsappNumber: digits },
        { whatsappNumber: `+${digits}` },
      ],
    },
    select: { id: true, name: true, whatsappNumber: true },
  });

  if (!customer) {
    res.status(404).json({ error: 'No loyalty account found for this phone number. Ask the business to add you.' });
    return;
  }

  // Loose name match — first word or substring
  const storedFirst = customer.name?.split(' ')[0]?.toLowerCase() ?? '';
  const inputFirst  = name.trim().split(' ')[0].toLowerCase();
  if (storedFirst && inputFirst && storedFirst !== inputFirst) {
    res.status(401).json({ error: 'Name does not match our records. Please check your name.' });
    return;
  }

  const token = issuePortalToken(customer.id, biz.id);
  res.json({ token, customer: { id: customer.id, name: customer.name } });
};

/** GET /api/portal/me — full loyalty profile */
const meHandler = async (req: Request, res: Response): Promise<void> => {
  const { customerId, businessId } = (req as any).portalCtx;

  const [customer, tiers, recentVisits] = await Promise.all([
    prisma.customer.findFirst({
      where: { id: customerId, businessId },
      select: {
        id: true, name: true, whatsappNumber: true, email: true,
        pointsBalance: true, tier: true, totalVisits: true, totalSpend: true,
        referralCode: true, createdAt: true,
        coupons: {
          where:   { status: 'ACTIVE' },
          select:  { id: true, code: true, type: true, value: true, expiresAt: true, freeProductName: true },
          orderBy: { createdAt: 'desc' },
          take:    10,
        },
      },
    }),
    prisma.tierConfig.findMany({
      where:   { businessId },
      orderBy: { minPoints: 'asc' },
      select:  { name: true, minPoints: true, maxPoints: true, color: true, discountPct: true, perks: true },
    }),
    prisma.visit.findMany({
      where:   { customerId, businessId },
      orderBy: { visitedAt: 'desc' },
      take:    20,
      select:  { id: true, visitedAt: true, spend: true, pointsEarned: true, checkInMethod: true },
    }),
  ]);

  if (!customer) { res.status(404).json({ error: 'Customer not found' }); return; }

  // Referral stats
  const referralCount = await prisma.customer.count({
    where: { businessId, referredByCode: customer.referralCode ?? '' },
  }).catch(() => 0);

  // Next tier progress
  const currentTierIdx = tiers.findIndex(t => t.name === customer.tier);
  const nextTier = tiers[currentTierIdx + 1] ?? null;
  const progressToNext = nextTier
    ? Math.min(100, Math.round(((customer.pointsBalance - (tiers[currentTierIdx]?.minPoints ?? 0)) /
        (nextTier.minPoints - (tiers[currentTierIdx]?.minPoints ?? 0))) * 100))
    : 100;

  res.json({
    customer,
    tiers,
    visits:       recentVisits,
    referralCount,
    nextTier,
    progressToNext,
  });
};

/** POST /api/portal/redeem — redeem a coupon by code */
const redeemHandler = async (req: Request, res: Response): Promise<void> => {
  const parse = RedeemSchema.safeParse(req.body);
  if (!parse.success) { res.status(400).json({ error: 'Invalid input' }); return; }

  const { customerId, businessId } = (req as any).portalCtx;
  const { couponCode } = parse.data;

  const coupon = await prisma.coupon.findFirst({
    where: { code: couponCode, customerId, businessId, status: 'ACTIVE' },
  });

  if (!coupon) { res.status(404).json({ error: 'Coupon not found or already used' }); return; }
  if (coupon.expiresAt && coupon.expiresAt < new Date()) {
    res.status(400).json({ error: 'Coupon has expired' });
    return;
  }

  await prisma.coupon.update({
    where: { id: coupon.id },
    data:  { status: 'USED', redemptionCount: { increment: 1 } },
  });

  res.json({ ok: true, coupon: { id: coupon.id, code: coupon.code, value: coupon.value } });
};

// ================================================================
// ROUTER
// ================================================================

export const customerPortalRouter = Router();

customerPortalRouter.get('/:slug/info',  infoHandler);
customerPortalRouter.post('/:slug/login', loginHandler);
customerPortalRouter.get('/me',          portalAuth, meHandler);
customerPortalRouter.post('/redeem',     portalAuth, redeemHandler);
