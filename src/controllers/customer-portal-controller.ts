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
import crypto                        from 'crypto';
import jwt, { SignOptions }          from 'jsonwebtoken';
import { prisma } from '../config/prisma';
import { tenantScope }               from '../middleware/tenant-scope-middleware';
import { getRedisClient }            from '../config/redis';
import { WahaGateway, toChatId }     from '../services/messaging-gateway';


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
  phone:             z.string().min(7).max(20),
  name:              z.string().min(1).max(100),
  ref:               z.string().min(1).max(64).optional(),
  email:             z.string().email().optional(),
  consentMarketing:  z.boolean().optional(),
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
  try {
    const { slug } = req.params;

    // Try full select first; fall back to safe columns if newer columns don't exist yet.
    let biz: any = await prisma.business.findFirst({
      where:  { slug },
      select: { id: true, name: true, slug: true, currency: true, industry: true, logoUrl: true, isActive: true, portalSettings: true, latitude: true, longitude: true, checkInRadiusMeters: true } as any,
    }).catch(() => null);

    if (biz === null) {
      // Fallback: query without newer columns in case migration not yet applied
      biz = await (prisma.business as any).findFirst({
        where:  { slug },
        select: { id: true, name: true, slug: true, currency: true, industry: true, logoUrl: true, isActive: true },
      });
    }

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
        radiusMeters:  biz.checkInRadiusMeters ?? 30,
      },
    });
  } catch (err) {
    res.status(500).json({ error: 'Portal unavailable' });
  }
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

  const biz = await (prisma.business as any).findFirst({
    where:  { slug, isActive: true },
    select: { id: true, portalSettings: true },
  });
  if (!biz) { res.status(404).json({ error: 'Business not found' }); return; }

  // Ownership: the authenticated tenant may only edit their OWN business.
  if (biz.id !== req.tenantContext?.businessId) {
    res.status(403).json({ error: 'FORBIDDEN', message: 'You can only modify your own business.' });
    return;
  }

  const current = (biz.portalSettings as Record<string, any>) ?? {};
  const merged  = { ...current, ...parse.data };

  await (prisma.business as any).update({ where: { id: biz.id }, data: { portalSettings: merged } });
  res.json({ ok: true, portalSettings: merged });
};

// Normalize a phone to E.164 — default country UK (+44).
function normalizePortalPhone(phone: string): string {
  const rawDigits = phone.trim().replace(/[^\d+]/g, '');
  if (rawDigits.startsWith('+'))       return rawDigits;
  if (rawDigits.startsWith('00'))      return '+' + rawDigits.slice(2);
  if (rawDigits.startsWith('0'))       return '+44' + rawDigits.slice(1);
  if (rawDigits.length === 10)         return '+44' + rawDigits;
  return '+' + rawDigits;
}

const OTP_TTL_SEC      = 300;  // 5 minutes
const OTP_MAX_ATTEMPTS = 5;
const otpKey  = (bizId: string, phone: string) => `portal:otp:${bizId}:${phone}`;
const otpData = (bizId: string, phone: string) => `portal:otpdata:${bizId}:${phone}`;

const VerifyOtpSchema = z.object({
  phone: z.string().min(7).max(20),
  code:  z.string().min(4).max(8),
});

/**
 * POST /api/portal/:slug/login
 * Step 1 of 2: validate input, send a 6-digit OTP over WhatsApp. Does NOT
 * issue a session — that requires the customer to prove ownership of the
 * phone number via /verify-otp. The signup payload is parked in Redis.
 */
const loginHandler = async (req: Request, res: Response): Promise<void> => {
  const parse = LoginSchema.safeParse(req.body);
  if (!parse.success) { res.status(400).json({ error: 'Invalid input', issues: parse.error.issues }); return; }

  const { phone, name, ref, email, consentMarketing } = parse.data;
  const { slug } = req.params;

  const biz = await prisma.business.findFirst({
    where:  { slug },
    select: { id: true, name: true, wahaBaseUrl: true, wahaSessionId: true, wahaApiKey: true },
  });
  if (!biz) { res.status(404).json({ error: 'Business not found' }); return; }

  const normalized = normalizePortalPhone(phone);
  const redis = getRedisClient();

  // Generate + store the OTP and the pending signup payload.
  const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
  await redis.set(otpKey(biz.id, normalized), code, { EX: OTP_TTL_SEC });
  await redis.set(
    otpData(biz.id, normalized),
    JSON.stringify({ name: name.trim(), ref: ref ?? null, email: email ?? null, consentMarketing: !!consentMarketing }),
    { EX: OTP_TTL_SEC }
  );
  await redis.del(`portal:otpattempts:${biz.id}:${normalized}`);

  // Deliver the code over WhatsApp.
  const baseUrl   = biz.wahaBaseUrl   ?? process.env.WAHA_BASE_URL   ?? 'http://localhost:3001';
  const sessionId = biz.wahaSessionId ?? process.env.WAHA_SESSION_ID ?? 'default';
  const apiKey    = biz.wahaApiKey    ?? process.env.WAHA_API_KEY    ?? '';
  const sent = await WahaGateway.sendText(
    toChatId(normalized),
    `Your ${biz.name} verification code is ${code}. It expires in 5 minutes.`,
    baseUrl, sessionId, apiKey
  ).catch(() => ({ success: false }));

  // In dev (or if WhatsApp isn't connected) we surface the code so testing
  // isn't blocked. Never do this in production.
  const devEcho = process.env.NODE_ENV !== 'production' ? { devCode: code } : {};
  if (!sent.success && process.env.NODE_ENV === 'production') {
    res.status(502).json({ error: 'Could not send verification code. Please try again.' });
    return;
  }

  res.json({ otpRequired: true, phone: normalized.replace(/.(?=.{4})/g, '*'), ...devEcho });
};

/**
 * POST /api/portal/:slug/verify-otp
 * Step 2 of 2: verify the code, find-or-create the customer, run referral /
 * email-bonus side effects, then issue the portal session token.
 */
const verifyOtpHandler = async (req: Request, res: Response): Promise<void> => {
  const parse = VerifyOtpSchema.safeParse(req.body);
  if (!parse.success) { res.status(400).json({ error: 'Invalid input' }); return; }
  const { slug } = req.params;
  const normalized = normalizePortalPhone(parse.data.phone);

  const biz = await prisma.business.findFirst({
    where:  { slug },
    select: { id: true, name: true, portalSettings: true },
  });
  if (!biz) { res.status(404).json({ error: 'Business not found' }); return; }

  const redis = getRedisClient();
  const attemptsK = `portal:otpattempts:${biz.id}:${normalized}`;
  const attempts  = Number(await redis.get(attemptsK) ?? 0);
  if (attempts >= OTP_MAX_ATTEMPTS) {
    res.status(429).json({ error: 'Too many attempts. Request a new code.' });
    return;
  }

  const stored = await redis.get(otpKey(biz.id, normalized));
  if (!stored || stored !== parse.data.code) {
    await redis.set(attemptsK, String(attempts + 1), { EX: OTP_TTL_SEC });
    res.status(401).json({ error: 'Invalid or expired code' });
    return;
  }

  // Code is valid — consume it and the parked payload.
  const payloadRaw = await redis.get(otpData(biz.id, normalized));
  const payload = payloadRaw ? JSON.parse(payloadRaw) : {};
  await redis.del(otpKey(biz.id, normalized));
  await redis.del(otpData(biz.id, normalized));
  await redis.del(attemptsK);

  const ps = (biz.portalSettings as Record<string, any>) ?? {};
  const emailBonusPoints = Number(ps.emailBonusPoints ?? 0);
  const name = (payload.name as string) ?? 'Member';
  const ref = payload.ref as string | null;
  const email = payload.email as string | null;
  const consentMarketing = !!payload.consentMarketing;

  const searchVariants = [...new Set([normalized, parse.data.phone.trim().replace(/[\s\-().]/g, '')])];
  let customer = await prisma.customer.findFirst({
    where:  { businessId: biz.id, OR: searchVariants.map(v => ({ whatsappNumber: v })) },
    select: { id: true, fullName: true, whatsappNumber: true },
  });

  let isNew = false;
  if (!customer) {
    customer = await prisma.customer.create({
      data: { businessId: biz.id, fullName: name, whatsappNumber: normalized, segment: 'NEW' },
      select: { id: true, fullName: true, whatsappNumber: true },
    });
    isNew = true;
  }

  let referralApplied = false;
  if (isNew && ref) {
    try {
      const { processReferralConversion } = await import('../services/loyalty-service');
      const r = await processReferralConversion(customer.id, ref.trim(), biz.id);
      referralApplied = r.success;
    } catch { /* non-fatal */ }
  }

  let emailBonusAwarded = 0;
  if (email) {
    const existing = await prisma.customer.findUnique({ where: { id: customer.id }, select: { email: true, currentPointsBalance: true } });
    const isFirstEmail = !existing?.email;
    // select id only — never RETURNING * (avoids referencing columns the DB
    // may not have migrated yet, e.g. isStaff).
    await prisma.customer.update({ where: { id: customer.id }, data: { email, ...(consentMarketing ? { marketingConsentWhatsapp: true } : {}) }, select: { id: true } });
    if (isFirstEmail && emailBonusPoints > 0) {
      const curBal = existing?.currentPointsBalance ?? 0;
      await prisma.rewardPointsLedger.create({
        data: { customerId: customer.id, businessId: biz.id, type: 'CREDIT', points: emailBonusPoints, balanceAfter: curBal + emailBonusPoints, reason: 'MANUAL_ADJUSTMENT', referenceType: 'EMAIL_BONUS' },
      });
      await prisma.customer.update({ where: { id: customer.id }, data: { currentPointsBalance: { increment: emailBonusPoints } }, select: { id: true } });
      emailBonusAwarded = emailBonusPoints;
    }
  } else if (consentMarketing) {
    await prisma.customer.update({ where: { id: customer.id }, data: { marketingConsentWhatsapp: true }, select: { id: true } });
  }

  await prisma.portalLogin.create({ data: { customerId: customer.id, businessId: biz.id } }).catch(() => {});

  const token = issuePortalToken(customer.id, biz.id);
  res.json({ token, customer: { id: customer.id, name: customer.fullName }, isNew, referralApplied, emailBonusAwarded });
};

/** GET /api/portal/me — full loyalty profile */
const meHandler = async (req: Request, res: Response): Promise<void> => {
  const { customerId, businessId } = (req as any).portalCtx;

  // Self-heal: credit points for any visits that never accrued (e.g. recorded
  // before the points config columns existed), then re-evaluate tier.
  try {
    const { backfillVisitPoints } = await import('../services/loyalty-service');
    await backfillVisitPoints(customerId, businessId);
  } catch { /* non-fatal — show whatever balance exists */ }

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
      select:  { id: true, visitedAt: true, amountSpent: true, source: true, pointsEarned: true },
    }),
  ]);

  if (!customer) { res.status(404).json({ error: 'Customer not found' }); return; }

  // tiers are ordered by rank asc (lowest → highest)
  const visitCount = customer.visitCount ?? 0;
  const totalSpend = Number(customer.totalSpend ?? 0);

  // Does the customer qualify for a tier? (visits OR spend threshold met)
  const qualifies = (t: any) =>
    (t.minVisitCount == null || visitCount >= t.minVisitCount) &&
    (t.minTotalSpend == null || totalSpend >= Number(t.minTotalSpend));

  // Resolve current tier: prefer stored currentTierId, else highest qualifying tier
  let currentTier: any =
    (customer.currentTierId && tiers.find((t: any) => t.id === customer.currentTierId)) || null;
  if (!currentTier) {
    const qualifying = tiers.filter(qualifies);
    currentTier = qualifying.length ? qualifying[qualifying.length - 1] : null;
  }
  const tierName = currentTier?.name ?? (tiers[0]?.name ?? 'Member');

  // Next tier = the first tier ranked above the current one that isn't yet reached
  const currentRank = currentTier?.rank ?? 0;
  const nextTierRaw = tiers.find((t: any) => t.rank > currentRank && !qualifies(t)) ?? null;

  // Progress toward the next tier, measured on whichever metric it gates on
  let progressToNext = 100;
  let needLabel = '';
  if (nextTierRaw) {
    if (nextTierRaw.minVisitCount != null) {
      const baseV = currentTier?.minVisitCount ?? 0;
      const span  = Math.max(1, nextTierRaw.minVisitCount - baseV);
      progressToNext = Math.max(0, Math.min(100, Math.round(((visitCount - baseV) / span) * 100)));
      const remaining = Math.max(0, nextTierRaw.minVisitCount - visitCount);
      needLabel = `${remaining} more visit${remaining === 1 ? '' : 's'}`;
    } else if (nextTierRaw.minTotalSpend != null) {
      const target = Number(nextTierRaw.minTotalSpend);
      const baseS  = Number(currentTier?.minTotalSpend ?? 0);
      const span   = Math.max(1, target - baseS);
      progressToNext = Math.max(0, Math.min(100, Math.round(((totalSpend - baseS) / span) * 100)));
      const remaining = Math.max(0, target - totalSpend);
      needLabel = `${fmtSpendGap(remaining, customer)} to go`;
    }
  }

  // Normalize next tier for the frontend (avoids non-existent minPoints field)
  const nextTier = nextTierRaw
    ? { name: nextTierRaw.name, needLabel, minVisitCount: nextTierRaw.minVisitCount, minTotalSpend: nextTierRaw.minTotalSpend }
    : null;

  // Perks for the current tier (from benefitsJson)
  const perks = ((currentTier?.benefitsJson as any[]) ?? []).map((b: any) =>
    b?.description ?? b?.productName ?? (b?.type === 'PERCENTAGE_DISCOUNT' ? `${b.value}% member discount` : b?.type)
  ).filter(Boolean);

  // Referral stats
  const referralCount = await prisma.customer.count({
    where: { businessId, referredByCode: customer.referralCode ?? '' },
  }).catch(() => 0);

  res.json({
    customer: { ...customer, name: customer.fullName, tier: tierName, pointsBalance: customer.currentPointsBalance, totalVisits: customer.visitCount },
    tiers,
    perks,
    visits:       recentVisits,
    referralCount,
    nextTier,
    progressToNext,
  });
};

// Format remaining spend gap using the business currency where possible
function fmtSpendGap(amount: number, _customer: any): string {
  return `£${Math.ceil(amount)}`;
}

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

  // Ownership: this exposes customer PII (names + phone numbers) so it is
  // restricted to the business's own authenticated staff.
  if (biz.id !== req.tenantContext?.businessId) {
    res.status(403).json({ error: 'FORBIDDEN' });
    return;
  }

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

  // Ownership: the authenticated tenant may only edit their OWN business.
  if (biz.id !== req.tenantContext?.businessId) {
    res.status(403).json({ error: 'FORBIDDEN', message: 'You can only modify your own business.' });
    return;
  }

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

customerPortalRouter.get('/:slug/info',          infoHandler);
customerPortalRouter.post('/:slug/login',        loginHandler);
customerPortalRouter.post('/:slug/verify-otp',   verifyOtpHandler);
customerPortalRouter.get('/:slug/today',         tenantScope, todayHandler);
customerPortalRouter.patch('/:slug/settings',    tenantScope, updateSettingsHandler);
customerPortalRouter.patch('/:slug/location',    tenantScope, updateLocationHandler);
customerPortalRouter.get('/me',                  portalAuth, meHandler);
customerPortalRouter.post('/redeem',             portalAuth, redeemHandler);
customerPortalRouter.post('/checkin',            portalAuth, checkInPortalHandler);
