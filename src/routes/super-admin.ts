// ================================================================
//  super.admin.controller.ts
//  Platform-level Super Admin API. Accessible ONLY to users with
//  Role.PLATFORM_ADMINISTRATOR — enforced by requirePlatformAdmin.
//
//  Route map (all under /api/admin):
//   GET    /metrics                       → Platform KPIs + MRR
//   GET    /tenants                       → All businesses + subscription
//   GET    /tenants/:id                   → Business detail + stats
//   POST   /tenants/:id/suspend           → Suspend tenant + pause queue
//   POST   /tenants/:id/unsuspend         → Reactivate tenant
//   DELETE /tenants/:id                   → Hard delete (irreversible)
//   POST   /impersonate/:businessId       → Issue 1h impersonation token
//   POST   /force-logout/:userId          → Revoke all user tokens
//   GET    /audit-logs                    → Global platform audit trail
//   GET    /queue-health                  → BullMQ stats across all queues
//   PUT    /feature-flags/:businessId     → Override tenant feature flags
//   POST   /announce                      → Send platform-wide announcement
//   GET    /system-health                 → Memory, uptime, DB connectivity
// ================================================================

import { Request, Response, Router }     from 'express';
import { z, ZodError }                   from 'zod';
import { }                  from '@prisma/client';
import { prisma } from '../config/prisma';
import { Role }                          from '@prisma/client';
import os                                from 'os';

import { tenantScope, requirePlatformAdmin, revokeToken } from '../middleware/tenant-scope-middleware';
import { issueImpersonationToken }       from '../services/token-service';
import { getMessageQueueHealth }         from '../services/messaging-queue';
import { syncTierToRedis, TIER_QUOTA, TIER_FEATURES } from '../services/stripe-service';
import { markBusinessSuspendedInCache, invalidateBusinessCache } from '../middleware/tenant-scope-middleware';
import { getRedisClient, redisHealth }   from '../config/redis';
import { purgeCustomerData }             from '../services/gdpr-service';


// ================================================================
// MRR TABLE (mirrors stripe.service.ts TIER_QUOTA)
// ================================================================

const TIER_MONTHLY_PRICE_GBP: Record<string, number> = {
  FREE:         0,
  STARTER:      29,
  GROWTH:       79,
  PROFESSIONAL: 149,
  ENTERPRISE:   499,
};

// ================================================================
// PLATFORM METRICS HANDLER
// ================================================================

/**
 * GET /api/admin/metrics
 * Real-time platform KPIs for the Super Admin dashboard.
 */
const metricsHandler = async (_req: Request, res: Response): Promise<void> => {
  try {
    const [
      totalBusinesses,
      activeBusinesses,
      subscriptionBreakdown,
      totalCustomers,
      totalMessages7d,
      recentSignups,
    ] = await Promise.all([
      prisma.business.count(),
      prisma.business.count({ where: { isActive: true } }),
      prisma.subscription.groupBy({
        by:    ['tier', 'status'],
        _count: { businessId: true },
      }),
      prisma.customer.count({ where: { isActive: true } }),
      prisma.messageQueue.count({
        where: { createdAt: { gte: new Date(Date.now() - 7 * 86_400_000) } },
      }),
      prisma.business.findMany({
        where:   { createdAt: { gte: new Date(Date.now() - 30 * 86_400_000) } },
        orderBy: { createdAt: 'desc' },
        take:    10,
        select:  { id: true, name: true, createdAt: true, subscription: { select: { tier: true } } },
      }),
    ]);

    // Compute MRR from active subscriptions
    const mrr = subscriptionBreakdown
      .filter(s => s.status === 'ACTIVE')
      .reduce((sum, s) => sum + (TIER_MONTHLY_PRICE_GBP[s.tier] ?? 0) * s._count.businessId, 0);

    const tierDistribution = subscriptionBreakdown.reduce<Record<string, number>>((acc, s) => {
      acc[s.tier] = (acc[s.tier] ?? 0) + s._count.businessId;
      return acc;
    }, {});

    const queueHealth = await getMessageQueueHealth();

    res.status(200).json({
      platform: {
        totalBusinesses,
        activeBusinesses,
        churnedBusinesses: totalBusinesses - activeBusinesses,
        totalCustomers,
        mrr,
        arr: mrr * 12,
      },
      subscriptions: { tierDistribution, breakdown: subscriptionBreakdown },
      messaging:     { last7Days: totalMessages7d, queue: queueHealth },
      recentSignups,
      generatedAt:   new Date().toISOString(),
    });
  } catch (err) {
    console.error('[admin] metrics error:', err);
    res.status(500).json({ error: 'METRICS_ERROR' });
  }
};

// ================================================================
// TENANT MANAGEMENT HANDLERS
// ================================================================

/** GET /api/admin/tenants */
const listTenantsHandler = async (req: Request, res: Response): Promise<void> => {
  try {
    const { search, status, tier } = req.query as Record<string, string>;

    const businesses = await prisma.business.findMany({
      where: {
        ...(search && { name: { contains: search, mode: 'insensitive' } }),
        ...(status && status === 'active'   && { isActive: true }),
        ...(status && status === 'inactive' && { isActive: false }),
        ...(tier   && { subscription: { tier: tier.toUpperCase() as any } }),
      },
      include: {
        subscription: {
          select: { tier: true, status: true, monthlyMessageQuota: true, messagesUsedThisPeriod: true },
        },
        _count: { select: { customers: true, users: true, campaigns: true } },
      },
      orderBy: { createdAt: 'desc' },
      take:    200,
    });

    res.status(200).json(businesses);
  } catch (err) {
    res.status(500).json({ error: 'LIST_TENANTS_ERROR' });
  }
};

/** GET /api/admin/tenants/:id */
const getTenantHandler = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;

    const [business, recentActivity, latestSnapshot] = await Promise.all([
      prisma.business.findUnique({
        where:   { id },
        include: {
          subscription: true,
          branches:     { select: { id: true, name: true, isActive: true } },
          users:        { select: { id: true, name: true, email: true, role: true, lastLoginAt: true } },
          _count:       { select: { customers: true, campaigns: true, messageQueue: true } },
        },
      }),
      prisma.auditLog.findMany({
        where:   { businessId: id },
        orderBy: { createdAt: 'desc' },
        take:    20,
        select:  { action: true, createdAt: true, userId: true },
      }),
      prisma.analyticsSnapshot.findFirst({
        where:   { businessId: id, branchLocationId: null },
        orderBy: { snapshotDate: 'desc' },
      }),
    ]);

    if (!business) { res.status(404).json({ error: 'TENANT_NOT_FOUND' }); return; }

    res.status(200).json({ business, recentActivity, latestSnapshot });
  } catch (err) {
    res.status(500).json({ error: 'GET_TENANT_ERROR' });
  }
};

/** POST /api/admin/tenants/:id/suspend */
const suspendTenantHandler = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id }     = req.params;
    const { reason } = req.body as { reason?: string };
    const adminId    = req.tenantContext.userId;

    await prisma.$transaction([
      prisma.business.update({
        where: { id },
        data:  { isActive: false, updatedAt: new Date() },
      }),
      prisma.auditLog.create({
        data: {
          businessId: id,
          userId:     adminId,
          action:     'ADMIN_SUSPEND_TENANT',
          metaJson:   { reason, suspendedBy: adminId, suspendedAt: new Date().toISOString() },
        },
      }),
    ]);

    // Cache the suspended state immediately so the tenantScope middleware
    // blocks requests without waiting for the DB update to propagate
    await markBusinessSuspendedInCache(id);

    res.status(200).json({ message: `Tenant ${id} suspended.`, reason });
  } catch (err) {
    res.status(500).json({ error: 'SUSPEND_ERROR' });
  }
};

/** POST /api/admin/tenants/:id/unsuspend */
const unsuspendTenantHandler = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id }   = req.params;
    const adminId  = req.tenantContext.userId;

    await prisma.$transaction([
      prisma.business.update({
        where: { id },
        data:  { isActive: true, updatedAt: new Date() },
      }),
      prisma.auditLog.create({
        data: {
          businessId: id,
          userId:     adminId,
          action:     'ADMIN_UNSUSPEND_TENANT',
          metaJson:   { unsuspendedAt: new Date().toISOString() },
        },
      }),
    ]);

    await invalidateBusinessCache(id);

    res.status(200).json({ message: `Tenant ${id} reactivated.` });
  } catch (err) {
    res.status(500).json({ error: 'UNSUSPEND_ERROR' });
  }
};

/** DELETE /api/admin/tenants/:id */
const deleteTenantHandler = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id }   = req.params;
    const { confirm } = req.body as { confirm?: string };

    if (confirm !== 'DELETE_CONFIRMED') {
      res.status(400).json({ error: 'Confirm deletion by sending { confirm: "DELETE_CONFIRMED" }' });
      return;
    }

    // Cascade delete via Prisma (schema has onDelete: Cascade on most tables)
    await prisma.business.delete({ where: { id } });
    await invalidateBusinessCache(id);

    res.status(200).json({ message: `Tenant ${id} permanently deleted.` });
  } catch (err) {
    res.status(500).json({ error: 'DELETE_TENANT_ERROR' });
  }
};

// ================================================================
// IMPERSONATION
// ================================================================

/** POST /api/admin/impersonate/:businessId */
const impersonateHandler = async (req: Request, res: Response): Promise<void> => {
  try {
    const { businessId } = req.params;
    const adminId        = req.tenantContext.userId;

    const token = await issueImpersonationToken(adminId, businessId);

    // The AuditLog is written inside tenantScope.ts on each request
    // made with this token. We also log the issuance here.
    await prisma.auditLog.create({
      data: {
        businessId,
        userId:   adminId,
        action:   'ADMIN_IMPERSONATE_ISSUED',
        metaJson: { issuedAt: new Date().toISOString(), expiresIn: '1h' },
      },
    });

    res.status(200).json({
      impersonationToken: token,
      expiresIn:          '1 hour',
      warning:            'All actions taken with this token are fully audited.',
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'IMPERSONATION_ERROR';
    res.status(msg === 'TENANT_OWNER_NOT_FOUND' ? 404 : 500).json({ error: msg });
  }
};

// ================================================================
// FORCE LOGOUT
// ================================================================

/** POST /api/admin/force-logout/:userId */
const forceLogoutHandler = async (req: Request, res: Response): Promise<void> => {
  try {
    const { userId } = req.params;
    const adminId    = req.tenantContext.userId;

    const user = await prisma.user.findUnique({
      where:  { id: userId },
      select: { id: true, businessId: true, refreshTokenHash: true },
    });

    if (!user) { res.status(404).json({ error: 'USER_NOT_FOUND' }); return; }

    // Clear refresh token hash — forces re-login on next token rotation
    await prisma.user.update({
      where: { id: userId },
      data:  { refreshTokenHash: null },
    });

    await prisma.auditLog.create({
      data: {
        businessId: user.businessId,
        userId:     adminId,
        action:     'ADMIN_FORCE_LOGOUT',
        entityType: 'User',
        entityId:   userId,
        metaJson:   { forcedAt: new Date().toISOString() },
      },
    });

    res.status(200).json({ message: `User ${userId} forced out. Their next refresh will fail.` });
  } catch (err) {
    res.status(500).json({ error: 'FORCE_LOGOUT_ERROR' });
  }
};

// ================================================================
// AUDIT LOGS (global)
// ================================================================

/** GET /api/admin/audit-logs */
const auditLogsHandler = async (req: Request, res: Response): Promise<void> => {
  try {
    const { businessId, action, limit = '100' } =
      req.query as Record<string, string>;

    const logs = await prisma.auditLog.findMany({
      where: {
        ...(businessId && { businessId }),
        ...(action     && { action: { contains: action, mode: 'insensitive' } }),
      },
      orderBy: { createdAt: 'desc' },
      take:    Math.min(parseInt(limit), 500),
      include: { user: { select: { name: true, email: true, role: true } } },
    });

    res.status(200).json(logs);
  } catch (err) {
    res.status(500).json({ error: 'AUDIT_LOG_ERROR' });
  }
};

// ================================================================
// FEATURE FLAG OVERRIDE
// ================================================================

const FeatureFlagsSchema = z.object({
  features: z.array(z.string()),
});

/** PUT /api/admin/feature-flags/:businessId */
const featureFlagsHandler = async (req: Request, res: Response): Promise<void> => {
  try {
    const { businessId } = req.params;
    const { features }   = req.body as z.infer<typeof FeatureFlagsSchema>;
    const adminId        = req.tenantContext.userId;

    const redis       = getRedisClient();
    const featuresKey = `tenant:features:${businessId}`;

    await redis.del(featuresKey);
    if (features.length > 0) {
      await redis.sAdd(featuresKey, features as any);
    }

    await prisma.auditLog.create({
      data: {
        businessId,
        userId:   adminId,
        action:   'ADMIN_OVERRIDE_FEATURES',
        metaJson: { features, overriddenAt: new Date().toISOString() },
      },
    });

    res.status(200).json({ businessId, features, message: 'Feature flags updated in Redis.' });
  } catch (err) {
    res.status(500).json({ error: 'FEATURE_FLAG_ERROR' });
  }
};

// ================================================================
// PLATFORM ANNOUNCEMENT
// ================================================================

const AnnounceSchema = z.object({
  subject: z.string().min(1).max(200),
  body:    z.string().min(1).max(2000),
  tier:    z.enum(['ALL', 'FREE', 'STARTER', 'GROWTH', 'PROFESSIONAL', 'ENTERPRISE']).optional().default('ALL'),
});

/** POST /api/admin/announce */
const announceHandler = async (req: Request, res: Response): Promise<void> => {
  try {
    const { subject, body, tier } = req.body as z.infer<typeof AnnounceSchema>;
    const adminId = req.tenantContext.userId;

    const owners = await prisma.user.findMany({
      where: {
        role:     'TENANT_OWNER',
        isActive: true,
        ...(tier !== 'ALL' && {
          business: { subscription: { tier: tier as any } },
        }),
      },
      select: { email: true, name: true },
    });

    // Fire-and-forget email to all owners
    const { sendEmail } = await import('../utils/email.util');

    let sent = 0;
    for (const owner of owners) {
      try {
        await sendEmail({
          to:         owner.email,
          subject,
          templateId: 'PLATFORM_ANNOUNCEMENT',
          variables:  { name: owner.name, body, subject },
        });
        sent++;
      } catch { /* continue */ }
    }

    await prisma.auditLog.create({
      data: {
        businessId: 'PLATFORM',
        userId:     adminId,
        action:     'ADMIN_ANNOUNCEMENT',
        metaJson:   { subject, tier, recipientCount: owners.length, sent },
      },
    });

    res.status(200).json({
      message:    `Announcement sent to ${sent}/${owners.length} tenant owners.`,
      tier,
      sent,
      total:      owners.length,
    });
  } catch (err) {
    res.status(500).json({ error: 'ANNOUNCE_ERROR' });
  }
};

// ================================================================
// SYSTEM HEALTH
// ================================================================

/** GET /api/admin/system-health */
const systemHealthHandler = async (req: Request, res: Response): Promise<void> => {
  const start = Date.now();

  try {
    // DB ping
    await prisma.$queryRaw`SELECT 1`;
    const dbLatencyMs = Date.now() - start;

    // Redis health — never throws; distinguishes an over-limit cap from a
    // healthy connection so the admin UI can flag it clearly.
    const rh = await redisHealth();

    // Queue health needs Redis; guard it so a Redis cap doesn't 503 the whole
    // health endpoint.
    let queueHealth: unknown = null;
    try { queueHealth = await getMessageQueueHealth(); } catch { queueHealth = { status: 'unavailable' }; }

    const mem  = process.memoryUsage();
    const load = os.loadavg();

    res.status(200).json({
      status:    rh.ok ? 'healthy' : 'degraded',
      uptime:    process.uptime(),
      timestamp: new Date().toISOString(),
      database:  { status: 'connected', latencyMs: dbLatencyMs },
      redis:     { status: rh.ok ? 'connected' : (rh.error === 'OVER_LIMIT' ? 'over_limit' : 'down'), latencyMs: rh.latencyMs, error: rh.error },
      queue:     queueHealth,
      process: {
        nodeVersion:  process.version,
        memoryMB: {
          heapUsed:  Math.round(mem.heapUsed  / 1_048_576),
          heapTotal: Math.round(mem.heapTotal / 1_048_576),
          rss:       Math.round(mem.rss       / 1_048_576),
        },
        cpuLoad1m:  load[0].toFixed(2),
        cpuLoad5m:  load[1].toFixed(2),
        cpuLoad15m: load[2].toFixed(2),
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'HEALTH_CHECK_FAILED';
    res.status(503).json({ status: 'degraded', error: msg });
  }
};

// ================================================================
// GDPR ADMIN PURGE (Super Admin can purge on behalf of any tenant)
// ================================================================

const adminPurgeHandler = async (req: Request, res: Response): Promise<void> => {
  try {
    const { customerId, businessId } = req.params;
    const adminId = req.tenantContext.userId;

    const result = await purgeCustomerData(customerId, businessId, adminId);
    res.status(200).json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'PURGE_ERROR';
    res.status(msg === 'CUSTOMER_NOT_FOUND' ? 404 : 500).json({ error: msg });
  }
};

// ================================================================
// VALIDATION HELPER
// ================================================================

const validate = (schema: z.ZodSchema) =>
  (req: Request, res: Response, next: ReturnType<typeof require>): void => {
    try { req.body = schema.parse(req.body); next(); }
    catch (err) {
      if (err instanceof ZodError) {
        res.status(400).json({ error: 'VALIDATION_ERROR', fields: err.errors });
      } else next(err);
    }
  };

// ================================================================
// ROUTER
// ================================================================

export const adminRouter = Router();

// All admin routes require: valid JWT + PLATFORM_ADMINISTRATOR role
adminRouter.use(tenantScope as any, requirePlatformAdmin as any);

adminRouter.get('/metrics',             metricsHandler);
adminRouter.get('/tenants',             listTenantsHandler);
adminRouter.get('/tenants/:id',         getTenantHandler);
adminRouter.post('/tenants/:id/suspend',   suspendTenantHandler);
adminRouter.post('/tenants/:id/unsuspend', unsuspendTenantHandler);
adminRouter.delete('/tenants/:id',      deleteTenantHandler);
adminRouter.post('/impersonate/:businessId', impersonateHandler);
adminRouter.post('/force-logout/:userId',    forceLogoutHandler);
adminRouter.get('/audit-logs',              auditLogsHandler);
adminRouter.get('/queue-health',            async (_req, res) => {
  res.json(await getMessageQueueHealth());
});
adminRouter.put('/feature-flags/:businessId',
  validate(FeatureFlagsSchema) as any,
  featureFlagsHandler
);
adminRouter.post('/announce',
  validate(AnnounceSchema) as any,
  announceHandler
);
adminRouter.get('/system-health', systemHealthHandler);
adminRouter.delete(
  '/gdpr/purge/:businessId/:customerId',
  adminPurgeHandler
);

// ================================================================
// PRICING CUSTOMIZATION
// ================================================================

const PricingUpdateSchema = z.object({
  tier:                z.enum(['FREE', 'STARTER', 'GROWTH', 'PROFESSIONAL', 'ENTERPRISE']),
  monthlyPriceGBP:     z.number().min(0).optional(),
  annualPriceGBP:      z.number().min(0).optional(),
  monthlyMessageQuota: z.number().min(-1).optional(),
  features:            z.array(z.string()).optional(),
  displayName:         z.string().min(1).max(50).optional(),
  description:         z.string().max(200).optional(),
  isPublic:            z.boolean().optional(),
});

const PLATFORM_PRICING_KEY = 'platform:pricing';
const PLATFORM_SETTINGS_KEY = 'platform:settings';
const PLATFORM_EMAIL_CONFIG_KEY = 'platform:email:config';
const PLATFORM_EMAIL_TEMPLATES_KEY = 'platform:email:templates';

const defaultPricing = {
  FREE:         { monthlyPriceGBP: 0,   annualPriceGBP: 0,    monthlyMessageQuota: 500,    displayName: 'Free',         description: 'Get started at no cost',              isPublic: true,  features: ['qr_checkin','basic_campaigns','customer_profiles'] },
  STARTER:      { monthlyPriceGBP: 29,  annualPriceGBP: 278,  monthlyMessageQuota: 2500,   displayName: 'Starter',      description: 'For growing local businesses',         isPublic: true,  features: ['qr_checkin','basic_campaigns','customer_profiles','loyalty_tiers','automations_basic','csv_import'] },
  GROWTH:       { monthlyPriceGBP: 79,  annualPriceGBP: 758,  monthlyMessageQuota: 10000,  displayName: 'Growth',       description: 'Scale your retention engine',          isPublic: true,  features: ['qr_checkin','basic_campaigns','customer_profiles','loyalty_tiers','automations_basic','csv_import','advanced_automations','ai_insights','campaign_scheduling','referral_programme'] },
  PROFESSIONAL: { monthlyPriceGBP: 149, annualPriceGBP: 1430, monthlyMessageQuota: 50000,  displayName: 'Professional', description: 'Full power for ambitious teams',       isPublic: true,  features: ['qr_checkin','basic_campaigns','customer_profiles','loyalty_tiers','automations_basic','csv_import','advanced_automations','ai_insights','campaign_scheduling','referral_programme','ab_testing','webhooks','white_label','priority_support','gdpr_tools'] },
  ENTERPRISE:   { monthlyPriceGBP: 499, annualPriceGBP: 4790, monthlyMessageQuota: -1,     displayName: 'Enterprise',   description: 'Unlimited everything. Dedicated CSM.', isPublic: true,  features: ['*'] },
};

/** GET /api/admin/pricing */
const getPricingHandler = async (_req: Request, res: Response): Promise<void> => {
  try {
    const redis = getRedisClient();
    const raw   = await redis.get(PLATFORM_PRICING_KEY);
    const pricing = raw ? JSON.parse(raw) : defaultPricing;
    res.status(200).json({ pricing, source: raw ? 'redis' : 'default' });
  } catch (err) {
    res.status(500).json({ error: 'GET_PRICING_ERROR' });
  }
};

/** PUT /api/admin/pricing */
const updatePricingHandler = async (req: Request, res: Response): Promise<void> => {
  try {
    const update  = PricingUpdateSchema.parse(req.body);
    const adminId = req.tenantContext.userId;
    const redis   = getRedisClient();

    const raw     = await redis.get(PLATFORM_PRICING_KEY);
    const current = raw ? JSON.parse(raw) : { ...defaultPricing };

    current[update.tier] = { ...current[update.tier], ...update };
    delete (current[update.tier] as any).tier;

    await redis.set(PLATFORM_PRICING_KEY, JSON.stringify(current));

    // Sync quota to Redis for all active tenants on this tier
    const businesses = await prisma.subscription.findMany({
      where: { tier: update.tier as any, status: 'ACTIVE' },
      select: { businessId: true },
    });

    if (update.monthlyMessageQuota !== undefined) {
      await Promise.all(
        businesses.map(b =>
          redis.set(
            `tenant:msg_quota:${b.businessId}`,
            update.monthlyMessageQuota === -1 ? '999999999' : String(update.monthlyMessageQuota)
          )
        )
      );
    }

    await prisma.auditLog.create({
      data: {
        businessId: 'PLATFORM',
        userId:     adminId,
        action:     'ADMIN_UPDATE_PRICING',
        metaJson:   { tier: update.tier, changes: update },
      },
    });

    res.status(200).json({ message: `Pricing updated for ${update.tier}`, tier: current[update.tier] });
  } catch (err) {
    if (err instanceof ZodError) { res.status(400).json({ error: 'VALIDATION_ERROR', fields: err.errors }); return; }
    res.status(500).json({ error: 'UPDATE_PRICING_ERROR' });
  }
};

// ================================================================
// PLATFORM SETTINGS
// ================================================================

const PlatformSettingsSchema = z.object({
  platformName:           z.string().min(1).max(100).optional(),
  platformUrl:            z.string().url().optional(),
  supportEmail:           z.string().email().optional(),
  maintenanceMode:        z.boolean().optional(),
  maintenanceBannerText:  z.string().max(300).optional(),
  allowNewRegistrations:  z.boolean().optional(),
  defaultTrial:           z.object({ enabled: z.boolean(), days: z.number().min(0).max(90) }).optional(),
  globalCooldownHours:    z.number().min(1).max(168).optional(),
  maxTenantsPerPlan:      z.record(z.string(), z.number()).optional(),
  defaultPointsPerPound:  z.number().min(0).max(100).optional(),
  defaultExpiryDays:      z.number().min(0).optional(),
  logoUrl:                z.string().url().optional(),
  faviconUrl:             z.string().url().optional(),
  primaryColor:           z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  accentColor:            z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
});

const defaultPlatformSettings = {
  platformName:          'The Loyaly',
  platformUrl:           'https://theloyaly.com',
  supportEmail:          'support@theloyaly.com',
  maintenanceMode:       false,
  maintenanceBannerText: '',
  allowNewRegistrations: true,
  defaultTrial:          { enabled: true, days: 14 },
  globalCooldownHours:   72,
  maxTenantsPerPlan:     {},
  defaultPointsPerPound: 1,
  defaultExpiryDays:     365,
  logoUrl:               '',
  faviconUrl:            '',
  primaryColor:          '#6366f1',
  accentColor:           '#8b5cf6',
};

/** GET /api/admin/platform-settings */
const getPlatformSettingsHandler = async (_req: Request, res: Response): Promise<void> => {
  try {
    const redis = getRedisClient();
    const raw   = await redis.get(PLATFORM_SETTINGS_KEY);
    res.status(200).json(raw ? JSON.parse(raw) : defaultPlatformSettings);
  } catch (err) {
    res.status(500).json({ error: 'GET_SETTINGS_ERROR' });
  }
};

/** PUT /api/admin/platform-settings */
const updatePlatformSettingsHandler = async (req: Request, res: Response): Promise<void> => {
  try {
    const updates  = PlatformSettingsSchema.parse(req.body);
    const adminId  = req.tenantContext.userId;
    const redis    = getRedisClient();

    const raw     = await redis.get(PLATFORM_SETTINGS_KEY);
    const current = raw ? JSON.parse(raw) : { ...defaultPlatformSettings };
    const merged  = { ...current, ...updates };

    await redis.set(PLATFORM_SETTINGS_KEY, JSON.stringify(merged));

    await prisma.auditLog.create({
      data: {
        businessId: 'PLATFORM',
        userId:     adminId,
        action:     'ADMIN_UPDATE_PLATFORM_SETTINGS',
        metaJson:   { changes: updates },
      },
    });

    res.status(200).json({ message: 'Platform settings updated.', settings: merged });
  } catch (err) {
    if (err instanceof ZodError) { res.status(400).json({ error: 'VALIDATION_ERROR', fields: err.errors }); return; }
    res.status(500).json({ error: 'UPDATE_SETTINGS_ERROR' });
  }
};

// ================================================================
// EMAIL CONFIGURATION
// ================================================================

const EmailConfigSchema = z.object({
  provider:        z.enum(['SENDGRID', 'RESEND', 'NODEMAILER', 'POSTMARK', 'DISABLED']),
  fromEmail:       z.string().email(),
  fromName:        z.string().min(1).max(100),
  replyTo:         z.string().email().optional(),
  apiKey:          z.string().optional(),
  smtpHost:        z.string().optional(),
  smtpPort:        z.number().min(1).max(65535).optional(),
  smtpUser:        z.string().optional(),
  smtpPass:        z.string().optional(),
  smtpSecure:      z.boolean().optional(),
  enableTracking:  z.boolean().optional(),
  unsubscribeUrl:  z.string().url().optional(),
});

/** GET /api/admin/email-config */
const getEmailConfigHandler = async (_req: Request, res: Response): Promise<void> => {
  try {
    const redis = getRedisClient();
    const raw   = await redis.get(PLATFORM_EMAIL_CONFIG_KEY);
    if (!raw) { res.status(200).json({ configured: false }); return; }

    const config = JSON.parse(raw);
    // Mask sensitive values
    if (config.apiKey)   config.apiKey   = '***' + config.apiKey.slice(-4);
    if (config.smtpPass) config.smtpPass = '••••••••';
    res.status(200).json({ configured: true, config });
  } catch (err) {
    res.status(500).json({ error: 'GET_EMAIL_CONFIG_ERROR' });
  }
};

/** PUT /api/admin/email-config */
const updateEmailConfigHandler = async (req: Request, res: Response): Promise<void> => {
  try {
    const config  = EmailConfigSchema.parse(req.body);
    const adminId = req.tenantContext.userId;
    const redis   = getRedisClient();

    await redis.set(PLATFORM_EMAIL_CONFIG_KEY, JSON.stringify(config));

    await prisma.auditLog.create({
      data: {
        businessId: 'PLATFORM',
        userId:     adminId,
        action:     'ADMIN_UPDATE_EMAIL_CONFIG',
        metaJson:   { provider: config.provider, fromEmail: config.fromEmail },
      },
    });

    res.status(200).json({ message: 'Email configuration saved.', provider: config.provider });
  } catch (err) {
    if (err instanceof ZodError) { res.status(400).json({ error: 'VALIDATION_ERROR', fields: err.errors }); return; }
    res.status(500).json({ error: 'UPDATE_EMAIL_CONFIG_ERROR' });
  }
};

/** POST /api/admin/email-config/test */
const testEmailConfigHandler = async (req: Request, res: Response): Promise<void> => {
  try {
    const { to } = req.body as { to: string };
    if (!to) { res.status(400).json({ error: 'Provide { to: "email@example.com" }' }); return; }

    const { sendEmail } = await import('../utils/email.util');
    await sendEmail({
      to,
      subject:    'The Loyaly Admin — Test Email',
      templateId: 'PLATFORM_ANNOUNCEMENT',
      variables:  {
        name:    'Admin',
        subject: 'Email configuration test',
        body:    'This is a test email from the The Loyaly platform admin. Your email provider is configured correctly.',
      },
    });

    await prisma.auditLog.create({
      data: {
        businessId: 'PLATFORM',
        userId:     req.tenantContext.userId,
        action:     'ADMIN_TEST_EMAIL_SENT',
        metaJson:   { to },
      },
    });

    res.status(200).json({ message: `Test email dispatched to ${to}.` });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'TEST_EMAIL_FAILED';
    res.status(500).json({ error: msg });
  }
};

// ================================================================
// EMAIL TEMPLATES
// ================================================================

const EmailTemplateSchema = z.object({
  templateId: z.enum([
    'PASSWORD_RESET', 'STAFF_INVITE', 'QUOTA_EXHAUSTED',
    'QUOTA_WARNING', 'PAYMENT_FAILED', 'PLATFORM_ANNOUNCEMENT',
    'WELCOME', 'TIER_UPGRADE_NOTICE', 'SUSPENSION_NOTICE',
  ]),
  subject:     z.string().min(1).max(200),
  htmlBody:    z.string().min(1),
  textBody:    z.string().optional(),
  variables:   z.array(z.string()).optional(),
  isActive:    z.boolean().optional(),
});

const builtinTemplates: Record<string, { subject: string; htmlBody: string; textBody: string; variables: string[]; isActive: boolean }> = {
  PASSWORD_RESET: {
    subject:   'Reset your The Loyaly password',
    htmlBody:  `<div style="font-family:sans-serif;max-width:600px;margin:auto"><h2 style="color:#6366f1">Reset your password</h2><p>Hi {{name}},</p><p>Click the link below to reset your password. This link expires in {{expiryMinutes}} minutes.</p><a href="{{resetUrl}}" style="background:#6366f1;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;display:inline-block">Reset Password</a><p style="color:#888;font-size:12px;margin-top:24px">If you didn't request this, you can safely ignore this email.</p></div>`,
    textBody:  `Hi {{name}}, reset your password at: {{resetUrl}} (expires in {{expiryMinutes}} minutes)`,
    variables: ['name', 'resetUrl', 'expiryMinutes'],
    isActive:  true,
  },
  STAFF_INVITE: {
    subject:   `You've been invited to {{businessName}} on The Loyaly`,
    htmlBody:  `<div style="font-family:sans-serif;max-width:600px;margin:auto"><h2 style="color:#6366f1">You're invited!</h2><p>Hi {{name}},</p><p>You've been added as <strong>{{role}}</strong> at <strong>{{businessName}}</strong>.</p><a href="{{acceptUrl}}" style="background:#6366f1;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;display:inline-block">Accept Invitation</a><p style="color:#888;font-size:12px;margin-top:24px">This invitation expires in {{expiryHours}} hours.</p></div>`,
    textBody:  `You've been invited to {{businessName}} as {{role}}. Accept at: {{acceptUrl}}`,
    variables: ['name', 'businessName', 'role', 'acceptUrl', 'expiryHours'],
    isActive:  true,
  },
  QUOTA_WARNING: {
    subject:   `Action needed: You've used {{percentUsed}}% of your message quota`,
    htmlBody:  `<div style="font-family:sans-serif;max-width:600px;margin:auto"><h2 style="color:#f59e0b">⚠️ Quota Warning</h2><p>Hi {{name}},</p><p>You've used <strong>{{percentUsed}}%</strong> of your monthly message quota ({{used}} / {{total}} messages).</p><p>Upgrade now to keep your campaigns running without interruption.</p><a href="{{upgradeUrl}}" style="background:#6366f1;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;display:inline-block">Upgrade Plan</a></div>`,
    textBody:  `Hi {{name}}, you've used {{percentUsed}}% of your quota ({{used}}/{{total}}). Upgrade at: {{upgradeUrl}}`,
    variables: ['name', 'percentUsed', 'used', 'total', 'upgradeUrl'],
    isActive:  true,
  },
  QUOTA_EXHAUSTED: {
    subject:   'Your message quota has been reached',
    htmlBody:  `<div style="font-family:sans-serif;max-width:600px;margin:auto"><h2 style="color:#ef4444">📭 Quota Exhausted</h2><p>Hi {{name}},</p><p>Your plan's monthly message quota of <strong>{{total}}</strong> messages has been reached. New messages are paused until you upgrade or your quota resets.</p><a href="{{upgradeUrl}}" style="background:#6366f1;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;display:inline-block">Upgrade Now</a></div>`,
    textBody:  `Hi {{name}}, your message quota is exhausted. Upgrade at: {{upgradeUrl}}`,
    variables: ['name', 'total', 'upgradeUrl'],
    isActive:  true,
  },
  PAYMENT_FAILED: {
    subject:   'Payment failed — action required',
    htmlBody:  `<div style="font-family:sans-serif;max-width:600px;margin:auto"><h2 style="color:#ef4444">💳 Payment Failed</h2><p>Hi {{name}},</p><p>Your payment of <strong>£{{amountDue}}</strong> failed. Please update your payment method to keep your account active.</p><a href="{{billingUrl}}" style="background:#ef4444;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;display:inline-block">Update Payment Method</a></div>`,
    textBody:  `Hi {{name}}, your payment of £{{amountDue}} failed. Update at: {{billingUrl}}`,
    variables: ['name', 'amountDue', 'billingUrl'],
    isActive:  true,
  },
  PLATFORM_ANNOUNCEMENT: {
    subject:   '{{subject}}',
    htmlBody:  `<div style="font-family:sans-serif;max-width:600px;margin:auto"><h2 style="color:#6366f1">{{subject}}</h2><p>Hi {{name}},</p><div>{{body}}</div><p style="color:#888;font-size:12px;margin-top:24px">The Loyaly Platform Team</p></div>`,
    textBody:  `Hi {{name}}, {{body}}`,
    variables: ['name', 'subject', 'body'],
    isActive:  true,
  },
  WELCOME: {
    subject:   'Welcome to The Loyaly, {{businessName}}! 🎉',
    htmlBody:  `<div style="font-family:sans-serif;max-width:600px;margin:auto"><h2 style="color:#6366f1">Welcome aboard! 🎉</h2><p>Hi {{name}},</p><p>Your The Loyaly workspace for <strong>{{businessName}}</strong> is ready. Start building loyalty programmes and automated campaigns in minutes.</p><a href="{{dashboardUrl}}" style="background:#6366f1;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;display:inline-block">Go to Dashboard</a></div>`,
    textBody:  `Welcome {{name}}! Your workspace for {{businessName}} is ready. Go to: {{dashboardUrl}}`,
    variables: ['name', 'businessName', 'dashboardUrl'],
    isActive:  true,
  },
  TIER_UPGRADE_NOTICE: {
    subject:   'Your plan has been upgraded to {{newTier}}',
    htmlBody:  `<div style="font-family:sans-serif;max-width:600px;margin:auto"><h2 style="color:#10b981">🚀 Plan Upgraded!</h2><p>Hi {{name}},</p><p>Your plan has been upgraded from <strong>{{oldTier}}</strong> to <strong>{{newTier}}</strong>. You now have access to <strong>{{newQuota}}</strong> messages per month and new features.</p><a href="{{dashboardUrl}}" style="background:#10b981;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;display:inline-block">Explore New Features</a></div>`,
    textBody:  `Hi {{name}}, your plan was upgraded from {{oldTier}} to {{newTier}}. Visit: {{dashboardUrl}}`,
    variables: ['name', 'oldTier', 'newTier', 'newQuota', 'dashboardUrl'],
    isActive:  true,
  },
  SUSPENSION_NOTICE: {
    subject:   'Your The Loyaly account has been suspended',
    htmlBody:  `<div style="font-family:sans-serif;max-width:600px;margin:auto"><h2 style="color:#ef4444">Account Suspended</h2><p>Hi {{name}},</p><p>Your The Loyaly account for <strong>{{businessName}}</strong> has been suspended. Reason: <em>{{reason}}</em></p><p>Please contact <a href="mailto:{{supportEmail}}">{{supportEmail}}</a> to resolve this.</p></div>`,
    textBody:  `Hi {{name}}, your account {{businessName}} has been suspended. Reason: {{reason}}. Contact: {{supportEmail}}`,
    variables: ['name', 'businessName', 'reason', 'supportEmail'],
    isActive:  true,
  },
};

/** GET /api/admin/email-templates */
const getEmailTemplatesHandler = async (_req: Request, res: Response): Promise<void> => {
  try {
    const redis = getRedisClient();
    const raw   = await redis.get(PLATFORM_EMAIL_TEMPLATES_KEY);
    const overrides = raw ? JSON.parse(raw) : {};
    const merged = Object.fromEntries(
      Object.entries(builtinTemplates).map(([id, tpl]) => [
        id, { ...tpl, ...(overrides[id] ?? {}), templateId: id },
      ])
    );
    res.status(200).json({ templates: merged, count: Object.keys(merged).length });
  } catch (err) {
    res.status(500).json({ error: 'GET_TEMPLATES_ERROR' });
  }
};

/** PUT /api/admin/email-templates */
const updateEmailTemplateHandler = async (req: Request, res: Response): Promise<void> => {
  try {
    const update  = EmailTemplateSchema.parse(req.body);
    const adminId = req.tenantContext.userId;
    const redis   = getRedisClient();

    const raw     = await redis.get(PLATFORM_EMAIL_TEMPLATES_KEY);
    const current = raw ? JSON.parse(raw) : {};
    const { templateId, ...rest } = update;
    current[templateId] = { ...current[templateId], ...rest };

    await redis.set(PLATFORM_EMAIL_TEMPLATES_KEY, JSON.stringify(current));

    await prisma.auditLog.create({
      data: {
        businessId: 'PLATFORM',
        userId:     adminId,
        action:     'ADMIN_UPDATE_EMAIL_TEMPLATE',
        metaJson:   { templateId, changes: rest },
      },
    });

    res.status(200).json({ message: `Template ${templateId} updated.`, template: current[templateId] });
  } catch (err) {
    if (err instanceof ZodError) { res.status(400).json({ error: 'VALIDATION_ERROR', fields: err.errors }); return; }
    res.status(500).json({ error: 'UPDATE_TEMPLATE_ERROR' });
  }
};

/** POST /api/admin/email-templates/preview */
const previewEmailTemplateHandler = async (req: Request, res: Response): Promise<void> => {
  try {
    const { templateId, variables } = req.body as { templateId: string; variables: Record<string, string> };

    const redis    = getRedisClient();
    const raw      = await redis.get(PLATFORM_EMAIL_TEMPLATES_KEY);
    const overrides = raw ? JSON.parse(raw) : {};

    const base = builtinTemplates[templateId];
    if (!base) { res.status(404).json({ error: 'TEMPLATE_NOT_FOUND' }); return; }

    const template = { ...base, ...(overrides[templateId] ?? {}) };

    let html = template.htmlBody;
    let text = template.textBody ?? '';
    let subj = template.subject;

    for (const [k, v] of Object.entries(variables ?? {})) {
      const re = new RegExp(`{{${k}}}`, 'g');
      html = html.replace(re, v);
      text = text.replace(re, v);
      subj = subj.replace(re, v);
    }

    res.status(200).json({ subject: subj, htmlBody: html, textBody: text });
  } catch (err) {
    res.status(500).json({ error: 'PREVIEW_TEMPLATE_ERROR' });
  }
};

/** POST /api/admin/email-templates/reset/:templateId */
const resetEmailTemplateHandler = async (req: Request, res: Response): Promise<void> => {
  try {
    const { templateId } = req.params;
    if (!builtinTemplates[templateId]) { res.status(404).json({ error: 'TEMPLATE_NOT_FOUND' }); return; }

    const redis   = getRedisClient();
    const raw     = await redis.get(PLATFORM_EMAIL_TEMPLATES_KEY);
    const current = raw ? JSON.parse(raw) : {};
    delete current[templateId];
    await redis.set(PLATFORM_EMAIL_TEMPLATES_KEY, JSON.stringify(current));

    await prisma.auditLog.create({
      data: {
        businessId: 'PLATFORM',
        userId:     req.tenantContext.userId,
        action:     'ADMIN_RESET_EMAIL_TEMPLATE',
        metaJson:   { templateId },
      },
    });

    res.status(200).json({ message: `Template ${templateId} reset to default.`, template: builtinTemplates[templateId] });
  } catch (err) {
    res.status(500).json({ error: 'RESET_TEMPLATE_ERROR' });
  }
};

// ================================================================
// REGISTER NEW ROUTES
// ================================================================

adminRouter.get('/pricing',                  getPricingHandler);
adminRouter.put('/pricing',                  updatePricingHandler);
adminRouter.get('/platform-settings',        getPlatformSettingsHandler);
adminRouter.put('/platform-settings',        updatePlatformSettingsHandler);
adminRouter.get('/email-config',             getEmailConfigHandler);
adminRouter.put('/email-config',             updateEmailConfigHandler);
adminRouter.post('/email-config/test',       testEmailConfigHandler);
adminRouter.get('/email-templates',          getEmailTemplatesHandler);
adminRouter.put('/email-templates',          updateEmailTemplateHandler);
adminRouter.post('/email-templates/preview', previewEmailTemplateHandler);
adminRouter.post('/email-templates/reset/:templateId', resetEmailTemplateHandler);

// ================================================================
// MOUNT IN app.ts:
//   app.use('/api/admin', adminRouter);
// ================================================================
