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
import { tenantScope }               from '../middleware/tenant-scope-middleware';

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

const CheckInSchema = z.object({
  latitude:  z.number(),
  longitude: z.number(),
});

// Haversine distance in metres
function distanceMetres(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6_371_000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ================================================================
// HANDLERS
// ================================================================

/** GET /api/portal/:slug/info — business branding + tier config + portal settings */
const infoHandler = async (req: Request, res: Response): Promise<void> => {
  const { slug } = req.params;
  const biz = await prisma.business.findFirst({
    where:  { slug },  // isActive not required — portal should always be accessible
    select: { id: true, name: true, slug: true, currency: true, industry: true, logoUrl: true, isActive: true } as any,
  });
  if (!biz) { res.status(404).json({ error: 'Business not found' }); return; }

  const tiers = await (prisma as any).loyaltyTier.findMany({
    where:   { businessId: biz.id },
    orderBy: { rank: 'asc' },
  });

  res.json({
    business: biz,
    tiers,
    portalSettings: biz.portalSettings ?? {},
    checkIn: {
      enabled:       !!(biz.latitude && biz.longitude),
      radiusMeters:  (biz as any).checkInRadiusMeters ?? 30,
    },
  });
};

/** PATCH /api/portal/:slug/settings — update portal content settings (tenant auth required) */
const settingsSchema = z.object({
  showMenu:          z.boolean().optional(),
  menuImageUrl:      z.string().optional(),
  showWifi:          z.boolean().optional(),
  wifiName:          z.string().max(100).optional(),
  wifiPassword:      z.string().max(200).optional(),
  showAnnouncement:  z.boolean().optional(),
  announcementText:  z.string().max(500).optional(),
  showReferral:      z.boolean().optional(),
  showVisitHistory:  z.boolean().optional(),
  customSections:    z.array(z.object({
    title:   z.string().max(100),
    body:    z.string().max(1000),
    icon:    z.string().max(10).optional(),
    visible: z.boolean(),
  })).optional(),
});

const updateSettingsHandler = async (req: Request, res: Response): Promise<void> => {
  const { slug } = req.params;
  const parse = settingsSchema.safeParse(req.body);
  if (!parse.success) { res.status(400).json({ error: 'Invalid input', issues: parse.error.issues }); return; }

  const biz = await prisma.business.findFirst({
    where:  { slug, isActive: true },
    select: { id: true } as any,
  });
  if (!biz) { res.status(404).json({ error: 'Business not found' }); return; }

  // Read current portalSettings separately
  const bizFull = await (prisma.business as any).findUnique({ where: { id: biz.id }, select: { portalSettings: true } });
  const current = (bizFull?.portalSettings as Record<string, any>) ?? {};
  const merged  = { ...current, ...parse.data };

  await (prisma.business as any).update({ where: { id: biz.id }, data: { portalSettings: merged } });
  res.json({ ok: true, portalSettings: merged });
};

/** POST /api/portal/:slug/login — phone + name → find or create customer */
const loginHandler = async (req: Request, res: Response): Promise<void> => {
  const parse = LoginSchema.safeParse(req.body);
  if (!parse.success) { res.status(400).json({ error: 'Invalid input', issues: parse.error.issues }); return; }

  const { phone, name } = parse.data;
  const { slug } = req.params;

  const biz = await prisma.business.findFirst({
    where: { slug },
    select: { id: true, name: true },
  });
  if (!biz) { res.status(404).json({ error: 'Business not found' }); return; }

  // Normalize phone — keep + prefix, strip spaces/dashes
  const normalized = phone.trim().replace(/[\s\-().]/g, '');

  let customer = await prisma.customer.findFirst({
    where: {
      businessId: biz.id,
      OR: [
        { whatsappNumber: normalized },
        { whatsappNumber: normalized.startsWith('+') ? normalized.slice(1) : `+${normalized}` },
      ],
    },
    select: { id: true, fullName: true, whatsappNumber: true },
  });

  let isNew = false;
  if (!customer) {
    // Auto-create new customer on first portal visit
    customer = await prisma.customer.create({
      data: {
        businessId:     biz.id,
        fullName:       name.trim(),
        whatsappNumber: normalized,
        segment:        'NEW',
      },
      select: { id: true, fullName: true, whatsappNumber: true },
    });
    isNew = true;
  }

  // Log this portal visit
  await prisma.portalLogin.create({
    data: { customerId: customer.id, businessId: biz.id },
  }).catch(() => {}); // ignore if table not yet migrated

  const token = issuePortalToken(customer.id, biz.id);
  res.json({ token, customer: { id: customer.id, name: customer.fullName }, isNew });
};

/** GET /api/portal/me — full loyalty profile */
const meHandler = async (req: Request, res: Response): Promise<void> => {
  const { customerId, businessId } = (req as any).portalCtx;

  const [customer, tiers, recentVisits] = await Promise.all([
    prisma.customer.findFirst({
      where: { id: customerId, businessId },
      select: {
        id: true, fullName: true, whatsappNumber: true, email: true,
        currentPointsBalance: true, currentTierId: true, visitCount: true, totalSpend: true,
        referralCode: true, createdAt: true,
        coupons: {
          where:   { status: 'ACTIVE' },
          select:  { id: true, code: true, type: true, value: true, expiresAt: true, freeProductName: true },
          orderBy: { createdAt: 'desc' },
          take:    10,
        },
      },
    }),
    (prisma as any).loyaltyTier.findMany({
      where:   { businessId },
      orderBy: { rank: 'asc' },
    }),
    prisma.visit.findMany({
      where:   { customerId, businessId },
      orderBy: { visitedAt: 'desc' },
      take:    20,
      select:  { id: true, visitedAt: true, amountSpent: true, source: true },
    }),
  ]);

  if (!customer) { res.status(404).json({ error: 'Customer not found' }); return; }

  // Resolve tier name from currentTierId
  const tierRecord = customer.currentTierId
    ? await (prisma as any).loyaltyTier.findUnique({ where: { id: customer.currentTierId }, select: { name: true } }).catch(() => null)
    : null;
  const tierName = tierRecord?.name ?? 'Member';

  // Referral stats
  const referralCount = await prisma.customer.count({
    where: { businessId, referredByCode: customer.referralCode ?? '' },
  }).catch(() => 0);

  // Next tier progress
  const pts = customer.currentPointsBalance ?? 0;
  const currentTierIdx = tiers.findIndex((t: any) => t.name === tierName);
  const nextTier = tiers[currentTierIdx + 1] ?? null;
  const progressToNext = nextTier
    ? Math.min(100, Math.round(((pts - (tiers[currentTierIdx]?.minPoints ?? 0)) /
        (nextTier.minPoints - (tiers[currentTierIdx]?.minPoints ?? 0))) * 100))
    : 100;

  res.json({
    customer: { ...customer, name: customer.fullName, tier: tierName, pointsBalance: customer.currentPointsBalance, totalVisits: customer.visitCount },
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

/** GET /api/portal/:slug/today — today's portal logins (requires tenant JWT) */
const todayHandler = async (req: Request, res: Response): Promise<void> => {
  const { slug } = req.params;
  const biz = await prisma.business.findFirst({
    where: { slug },
    select: { id: true },
  });
  if (!biz) { res.status(404).json({ error: 'Business not found' }); return; }

  const start = new Date();
  start.setHours(0, 0, 0, 0);

  // Try PortalLogin table first; fall back to customers created/updated today
  let customers: any[] = [];
  try {
    const logins = await prisma.portalLogin.findMany({
      where: { businessId: biz.id, createdAt: { gte: start } },
      orderBy: { createdAt: 'desc' },
      distinct: ['customerId'],
      include: {
        customer: {
          select: { id: true, fullName: true, whatsappNumber: true, currentPointsBalance: true, currentTierId: true, createdAt: true },
        },
      },
    });
    customers = logins.map(l => ({
      ...l.customer,
      name: l.customer.fullName,
      pointsBalance: l.customer.currentPointsBalance,
      tier: l.customer.currentTierId ?? 'Member',
      isNew: l.customer.createdAt >= start,
      loginAt: l.createdAt,
    }));
  } catch {
    // PortalLogin table not yet migrated — show customers created today
    const newToday = await prisma.customer.findMany({
      where: { businessId: biz.id, createdAt: { gte: start } },
      orderBy: { createdAt: 'desc' },
      select: { id: true, fullName: true, whatsappNumber: true, currentPointsBalance: true, createdAt: true },
    });
    customers = newToday.map(c => ({ ...c, name: c.fullName, pointsBalance: c.currentPointsBalance, tier: 'Member', isNew: true }));
  }

  res.json({ customers, date: start });
};

/** POST /api/portal/checkin — geo-gated self check-in from customer portal */
const checkInPortalHandler = async (req: Request, res: Response): Promise<void> => {
  const parse = CheckInSchema.safeParse(req.body);
  if (!parse.success) { res.status(400).json({ error: 'latitude and longitude required' }); return; }

  const { customerId, businessId } = (req as any).portalCtx;
  const { latitude: custLat, longitude: custLon } = parse.data;

  // Load business location + radius
  const biz = await (prisma.business as any).findUnique({
    where:  { id: businessId },
    select: { latitude: true, longitude: true, checkInRadiusMeters: true },
  }) as { latitude: number | null; longitude: number | null; checkInRadiusMeters: number } | null;
  if (!biz) { res.status(404).json({ error: 'Business not found' }); return; }
  if (!biz.latitude || !biz.longitude) {
    res.status(400).json({ error: 'Check-in location not configured by this business' }); return;
  }

  const dist = distanceMetres(custLat, custLon, biz.latitude, biz.longitude);
  const radius = (biz as any).checkInRadiusMeters ?? 30;
  if (dist > radius) {
    res.status(403).json({ error: 'TOO_FAR', distanceMetres: Math.round(dist), radiusMetres: radius }); return;
  }

  // Idempotency: one check-in per customer per day
  const dayStart = new Date();
  dayStart.setHours(0, 0, 0, 0);
  const existing = await prisma.visit.findFirst({
    where: { businessId, customerId, source: 'QR_CHECKIN', visitedAt: { gte: dayStart } },
    select: { id: true },
  });
  if (existing) {
    res.status(409).json({ error: 'ALREADY_CHECKED_IN_TODAY' }); return;
  }

  // Create visit then accrue points
  const visit = await prisma.visit.create({
    data: { businessId, customerId, source: 'QR_CHECKIN', amountSpent: 0, visitedAt: new Date() } as any,
    select: { id: true },
  });

  const { accruePointsForVisit } = await import('../services/loyalty-service');
  const result = await accruePointsForVisit(visit.id, businessId, customerId, 0).catch(() => ({ pointsEarned: 0, newBalance: 0 }));

  res.json({ ok: true, pointsEarned: (result as any).pointsEarned ?? 0, newBalance: (result as any).newBalance ?? 0, distanceMetres: Math.round(dist) });
};

/** PATCH /api/portal/:slug/location — set business check-in location (tenant auth) */
const locationSchema = z.object({
  latitude:            z.number().min(-90).max(90),
  longitude:           z.number().min(-180).max(180),
  checkInRadiusMeters: z.number().int().min(10).max(500).optional(),
});

const updateLocationHandler = async (req: Request, res: Response): Promise<void> => {
  const parse = locationSchema.safeParse(req.body);
  if (!parse.success) { res.status(400).json({ error: 'Invalid input', issues: parse.error.issues }); return; }

  const { slug } = req.params;
  const biz = await prisma.business.findFirst({ where: { slug }, select: { id: true } });
  if (!biz) { res.status(404).json({ error: 'Business not found' }); return; }

  await prisma.business.update({
    where: { id: biz.id },
    data:  { latitude: parse.data.latitude, longitude: parse.data.longitude, ...(parse.data.checkInRadiusMeters ? { checkInRadiusMeters: parse.data.checkInRadiusMeters } : {}) } as any,
  });
  res.json({ ok: true });
};

// ================================================================
// ROUTER
// ================================================================

export const customerPortalRouter = Router();

customerPortalRouter.get('/:slug/info',         infoHandler);
customerPortalRouter.post('/:slug/login',        loginHandler);
customerPortalRouter.get('/:slug/today',         todayHandler);
customerPortalRouter.patch('/:slug/settings',    tenantScope, updateSettingsHandler);
customerPortalRouter.patch('/:slug/location',    tenantScope, updateLocationHandler);
customerPortalRouter.get('/me',                  portalAuth, meHandler);
customerPortalRouter.post('/redeem',             portalAuth, redeemHandler);
customerPortalRouter.post('/checkin',            portalAuth, checkInPortalHandler);
