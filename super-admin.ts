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
import { PrismaClient }                  from '@prisma/client';
import { Role }                          from '@prisma/client';
import os                                from 'os';

import { tenantScope, requirePlatformAdmin, revokeToken } from '../middleware/tenantScope';
import { issueImpersonationToken }       from '../services/token.service';
import { getMessageQueueHealth }         from '../queues/messaging.queue';
import { syncTierToRedis, TIER_QUOTA, TIER_FEATURES } from '../services/stripe.service';
import { markBusinessSuspendedInCache, invalidateBusinessCache } from '../middleware/tenantScope';
import { getRedisClient }                from '../config/redis';
import { purgeCustomerData }             from '../services/gdpr.service';

const prisma = new PrismaClient();

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
      await redis.sAdd(featuresKey, ...features);
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

    // Redis ping
    const redisStart = Date.now();
    await getRedisClient().ping();
    const redisLatencyMs = Date.now() - redisStart;

    const queueHealth = await getMessageQueueHealth();

    const mem  = process.memoryUsage();
    const load = os.loadavg();

    res.status(200).json({
      status:    'healthy',
      uptime:    process.uptime(),
      timestamp: new Date().toISOString(),
      database:  { status: 'connected', latencyMs: dbLatencyMs },
      redis:     { status: 'connected', latencyMs: redisLatencyMs },
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
// MOUNT IN app.ts:
//   app.use('/api/admin', adminRouter);
// ================================================================
