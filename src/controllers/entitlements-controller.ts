// ================================================================
//  entitlements-controller.ts
//  - Public:  GET /api/plans          → four-plan pricing + plugin status
//  - Tenant:  GET /api/entitlements   → this tenant's plan, limits, usage,
//                                        features, trial state (drives locked UI)
// ================================================================

import { Request, Response, Router } from 'express';
import { Role } from '@prisma/client';
import { prisma } from '../config/prisma';
import { tenantScope, requireRoles } from '../middleware/tenant-scope-middleware';
import { getTenantEntitlements } from '../services/entitlement-service';
import { publicPlans, PLUGIN_STATUS, PLANS } from '../config/plans';
import { resolvePromoCode } from '../config/promo-codes';

// Public pricing — no auth. Only live, plan-included features are returned.
export const plansPublicRouter = Router();
plansPublicRouter.get('/', (_req: Request, res: Response): void => {
  res.json({
    plans: publicPlans().map(p => ({
      tier: p.tier, slug: p.slug, name: p.name, priceMonthlyGBP: p.priceMonthlyGBP,
      recommended: !!p.recommended, tagline: p.tagline, limits: p.limits, highlights: p.highlights,
    })),
    plugins: PLUGIN_STATUS,
  });
});

// Tenant entitlements — drives in-app locked/blur states + billing screen.
export const entitlementsRouter = Router();
entitlementsRouter.use(tenantScope as any);
entitlementsRouter.get('/', async (req: Request, res: Response): Promise<void> => {
  try {
    const ent = await getTenantEntitlements(req.tenantContext.businessId);
    res.json(ent);
  } catch (err) {
    console.error('[entitlements]', (err as Error).message);
    res.status(500).json({ error: 'ENTITLEMENT_ERROR' });
  }
});

// POST /api/entitlements/redeem  { code }  — owner-only test promo codes that
// switch the tenant's tier so plan functionality can be exercised. Audit-logged.
const TIER_QUOTA: Record<string, number> = { FREE: 100, STARTER: 3000, GROWTH: 24000, PROFESSIONAL: 100000, ENTERPRISE: 9_999_999 };
entitlementsRouter.post('/redeem', requireRoles(Role.TENANT_OWNER) as any, async (req: Request, res: Response): Promise<void> => {
  try {
    const { businessId, userId } = req.tenantContext;
    const tier = resolvePromoCode(String(req.body?.code ?? ''));
    if (!tier) { res.status(400).json({ error: 'INVALID_CODE' }); return; }
    const quota = TIER_QUOTA[tier] ?? 100;
    await prisma.subscription.upsert({
      where:  { businessId },
      update: { tier: tier as any, status: 'ACTIVE', monthlyMessageQuota: quota, messagesUsedThisPeriod: 0, currentPeriodStart: new Date(), currentPeriodEnd: new Date(Date.now() + 30 * 86_400_000) },
      create: { businessId, tier: tier as any, status: 'ACTIVE', monthlyMessageQuota: quota, messagesUsedThisPeriod: 0, currentPeriodStart: new Date(), currentPeriodEnd: new Date(Date.now() + 30 * 86_400_000) },
    });
    await prisma.auditLog.create({ data: { businessId, userId, action: 'PROMO_CODE_REDEEMED', metaJson: { tier } } }).catch(() => {});
    const ent = await getTenantEntitlements(businessId);
    res.json({ ok: true, tier, planName: PLANS[tier].name, entitlements: ent });
  } catch (err) {
    console.error('[entitlements:redeem]', (err as Error).message);
    res.status(500).json({ error: 'REDEEM_FAILED' });
  }
});
