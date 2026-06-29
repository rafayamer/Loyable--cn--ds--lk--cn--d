// ================================================================
//  entitlements-controller.ts
//  - Public:  GET /api/plans          → four-plan pricing + plugin status
//  - Tenant:  GET /api/entitlements   → this tenant's plan, limits, usage,
//                                        features, trial state (drives locked UI)
// ================================================================

import { Request, Response, Router } from 'express';
import { tenantScope } from '../middleware/tenant-scope-middleware';
import { getTenantEntitlements } from '../services/entitlement-service';
import { publicPlans, PLUGIN_STATUS } from '../config/plans';

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
