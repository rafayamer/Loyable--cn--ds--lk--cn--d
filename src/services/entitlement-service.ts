// ================================================================
//  entitlement-service.ts
//  Centralized plan/feature/usage enforcement. Frontend blur is not
//  security — these server-side checks are. Reads the tenant's
//  Subscription (verified from server-side tenant context), applies the
//  14-day Growth trial, and exposes guards for routes.
//
//  Helpers: getTenantEntitlements, requireFeature, requirePlan,
//           requireUsageLimit, assertSubscriptionActive.
// ================================================================

import { Request, Response, NextFunction } from 'express';
import { prisma } from '../config/prisma';
import {
  PLANS, TIER_RANK, TRIAL_DAYS, TRIAL_TIER, featureMinTier,
  type Tier, type FeatureKey, type PlanLimits,
} from '../config/plans';

export interface TrialState { active: boolean; expired: boolean; daysRemaining: number; endsAt: Date | null; }
export interface UsageState { customers: number; branches: number; staff: number; messagesUsed: number; }
export interface Entitlements {
  businessId: string;
  tier: Tier;            // billed tier on record
  effectiveTier: Tier;   // tier whose entitlements apply right now (trial-aware)
  planName: string;
  status: string;        // subscription status
  active: boolean;       // subscription usable (active or in trial)
  trial: TrialState;
  limits: PlanLimits;
  features: FeatureKey[];
  usage: UsageState;
}

const isUnlimited = (n: number) => n < 0;

/** Resolve a tenant's effective entitlements, applying the 14-day Growth trial. */
export const getTenantEntitlements = async (businessId: string): Promise<Entitlements> => {
  const sub = await prisma.subscription.findUnique({
    where: { businessId },
    select: { tier: true, status: true, createdAt: true, currentPeriodEnd: true, messagesUsedThisPeriod: true },
  });

  const billedTier = (sub?.tier ?? 'FREE') as Tier;
  const status = sub?.status ?? 'TRIALING';

  // Trial: a FREE/TRIALING subscription gets Growth entitlements for 14 days.
  let effectiveTier: Tier = billedTier;
  let trial: TrialState = { active: false, expired: false, daysRemaining: 0, endsAt: null };
  if (status === 'TRIALING' && billedTier === 'FREE' && sub?.createdAt) {
    const endsAt = new Date(sub.createdAt.getTime() + TRIAL_DAYS * 86_400_000);
    const msLeft = endsAt.getTime() - Date.now();
    if (msLeft > 0) {
      effectiveTier = TRIAL_TIER;
      trial = { active: true, expired: false, daysRemaining: Math.ceil(msLeft / 86_400_000), endsAt };
    } else {
      effectiveTier = 'FREE';
      trial = { active: false, expired: true, daysRemaining: 0, endsAt };
    }
  }

  // A canceled/past-due paid plan falls back to Free entitlements (data preserved).
  const active = status === 'ACTIVE' || trial.active;
  if (!active && billedTier !== 'FREE') effectiveTier = 'FREE';

  const plan = PLANS[effectiveTier];

  const [customers, branches, staff] = await Promise.all([
    prisma.customer.count({ where: { businessId, isActive: true } }),
    prisma.branchLocation.count({ where: { businessId } }).catch(() => 0),
    prisma.user.count({ where: { businessId, isActive: true, role: { not: 'CUSTOMER' } } }),
  ]);

  return {
    businessId,
    tier: billedTier,
    effectiveTier,
    planName: plan.name,
    status,
    active,
    trial,
    limits: plan.limits,
    features: plan.features,
    usage: { customers, branches, staff, messagesUsed: sub?.messagesUsedThisPeriod ?? 0 },
  };
};

export const hasFeature = (ent: Entitlements, feature: FeatureKey): boolean => ent.features.includes(feature);

/** True if usage is at/over the plan limit for a resource (unlimited never blocks). */
export const isAtLimit = (ent: Entitlements, resource: keyof PlanLimits): boolean => {
  const limit = ent.limits[resource];
  if (isUnlimited(limit)) return false;
  const used =
    resource === 'customers' ? ent.usage.customers :
    resource === 'branches'  ? ent.usage.branches :
    resource === 'staff'     ? ent.usage.staff :
    ent.usage.messagesUsed;
  return used >= limit;
};

// ── Express guards ─────────────────────────────────────────────────
// A blocked guard returns 402 with a structured payload so the frontend
// can render the exact "Available on <Plan>" locked overlay.

const lockedPayload = (requiredTier: Tier, reason: string) => ({
  error: 'UPGRADE_REQUIRED',
  requiredPlan: PLANS[requiredTier].name,
  requiredTier,
  reason,
});

export const requireFeature = (feature: FeatureKey) =>
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const ent = await getTenantEntitlements(req.tenantContext.businessId);
      if (hasFeature(ent, feature)) { next(); return; }
      const need = featureMinTier(feature);
      res.status(402).json(lockedPayload(need, `${feature} is available on ${PLANS[need].name}.`));
    } catch { res.status(500).json({ error: 'ENTITLEMENT_CHECK_FAILED' }); }
  };

export const requirePlan = (minTier: Tier) =>
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const ent = await getTenantEntitlements(req.tenantContext.businessId);
      if (TIER_RANK[ent.effectiveTier] >= TIER_RANK[minTier]) { next(); return; }
      res.status(402).json(lockedPayload(minTier, `This needs the ${PLANS[minTier].name} plan.`));
    } catch { res.status(500).json({ error: 'ENTITLEMENT_CHECK_FAILED' }); }
  };

export const requireUsageLimit = (resource: keyof PlanLimits) =>
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const ent = await getTenantEntitlements(req.tenantContext.businessId);
      if (!isAtLimit(ent, resource)) { next(); return; }
      // Pick the next tier up that raises this limit, for the upgrade prompt.
      const order: Tier[] = ['FREE', 'STARTER', 'GROWTH', 'PROFESSIONAL'];
      const cur = ent.limits[resource];
      const better = order.find(t => { const l = PLANS[t].limits[resource]; return l < 0 || l > cur; }) ?? 'PROFESSIONAL';
      res.status(402).json({ ...lockedPayload(better, `You've reached your ${resource} limit (${ent.limits[resource]}).`), resource, limit: ent.limits[resource] });
    } catch { res.status(500).json({ error: 'ENTITLEMENT_CHECK_FAILED' }); }
  };

export const assertSubscriptionActive = () =>
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const ent = await getTenantEntitlements(req.tenantContext.businessId);
      if (ent.active) { next(); return; }
      res.status(402).json({ error: 'SUBSCRIPTION_INACTIVE', reason: 'Your Growth trial has ended. Your data is safe, but this needs an active plan.' });
    } catch { res.status(500).json({ error: 'ENTITLEMENT_CHECK_FAILED' }); }
  };
