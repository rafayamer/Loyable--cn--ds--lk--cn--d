// ================================================================
//  plans.ts
//  Single source of truth for The Loyaly's four-plan structure:
//    Free · Starter £39 · Growth £99 (recommended) · Pro £199
//
//  The Prisma SubscriptionTier enum keeps its existing values; the
//  public "Pro" plan is backed by the PROFESSIONAL tier and ENTERPRISE
//  is treated as internal/hidden (never shown on public pricing).
//  Limits and features here are enforced by entitlement-service.ts.
// ================================================================

export type Tier = 'FREE' | 'STARTER' | 'GROWTH' | 'PROFESSIONAL' | 'ENTERPRISE';

// Feature keys checked by requireFeature(). Keep in sync with the UI gates.
export type FeatureKey =
  | 'qr_checkin' | 'basic_campaigns' | 'customer_profiles'
  | 'loyalty_wallet' | 'store_credit' | 'segments' | 'automations'
  | 'campaign_builder' | 'referrals'
  | 'ai_advisor' | 'ai_reports' | 'analytics_advanced'
  | 'multi_branch' | 'branch_comparison'
  | 'pos' | 'hr' | 'api_access' | 'white_label';

export interface PlanLimits {
  branches: number;      // -1 = fair-use "unlimited"
  customers: number;     // -1 = fair-use "unlimited"
  messagesPerMonth: number;
  staff: number;
}

export interface PlanDef {
  tier: Tier;
  slug: string;          // internal slug for billing mapping
  name: string;          // public display name
  priceMonthlyGBP: number;
  recommended?: boolean;
  publicVisible: boolean; // shown on the public pricing page
  tagline: string;
  limits: PlanLimits;
  features: FeatureKey[];
  // Marketing bullet points (live features only — no roadmap promises here).
  highlights: string[];
}

const BASE: FeatureKey[] = ['qr_checkin', 'basic_campaigns', 'customer_profiles'];
const STARTER_F: FeatureKey[] = [...BASE, 'loyalty_wallet', 'referrals', 'segments'];
const GROWTH_F: FeatureKey[] = [
  ...STARTER_F, 'store_credit', 'campaign_builder', 'automations',
  'ai_advisor', 'ai_reports', 'analytics_advanced',
];
const PRO_F: FeatureKey[] = [
  ...GROWTH_F, 'multi_branch', 'branch_comparison', 'pos', 'hr', 'api_access', 'white_label',
];

export const PLANS: Record<Tier, PlanDef> = {
  FREE: {
    tier: 'FREE', slug: 'free', name: 'Free', priceMonthlyGBP: 0, publicVisible: true,
    tagline: 'Start with a 14-day Growth trial, then a limited free plan.',
    limits: { branches: 1, customers: 100, messagesPerMonth: 100, staff: 2 },
    features: BASE,
    highlights: ['14-day Growth trial', '1 location', 'Up to 100 customers', 'Basic QR check-in & dashboard'],
  },
  STARTER: {
    tier: 'STARTER', slug: 'starter_39_99', name: 'Starter', priceMonthlyGBP: 39.99, publicVisible: true,
    tagline: 'For very small single-location businesses.',
    limits: { branches: 1, customers: 2_000, messagesPerMonth: 3_000, staff: 3 },
    features: STARTER_F,
    highlights: ['1 branch', 'Up to 2,000 customers', '3,000 messages/mo', 'Loyalty points, coupons, referrals', 'Basic campaigns & analytics'],
  },
  GROWTH: {
    tier: 'GROWTH', slug: 'growth_99_99', name: 'Growth', priceMonthlyGBP: 99.99, recommended: true, publicVisible: true,
    tagline: 'Bring customers back automatically. The plan most businesses choose.',
    limits: { branches: 1, customers: 16_000, messagesPerMonth: 24_000, staff: 10 },
    features: GROWTH_F,
    highlights: ['Up to 16,000 customers', '24,000 messages/mo', 'Full CRM, loyalty wallet & store credit', 'Campaign builder & comeback campaigns', 'AI advisor + weekly & monthly reports', 'Retention, loyalty & campaign analytics'],
  },
  PROFESSIONAL: {
    tier: 'PROFESSIONAL', slug: 'pro_199_99', name: 'Pro', priceMonthlyGBP: 199.99, publicVisible: true,
    tagline: 'For stronger operators running up to 3 branches.',
    limits: { branches: 3, customers: -1, messagesPerMonth: 100_000, staff: 25 },
    features: PRO_F,
    highlights: ['Up to 3 branches', 'Unlimited customers (fair use)', 'High-volume messaging (fair-use, provider limits apply)', 'Branch comparison & advanced analytics', 'Staff permissions & advanced controls', 'Priority support'],
  },
  // Internal only — never shown on public pricing. No custom/enterprise public plan.
  ENTERPRISE: {
    tier: 'ENTERPRISE', slug: 'enterprise_internal', name: 'Enterprise (internal)', priceMonthlyGBP: 0, publicVisible: false,
    tagline: 'Internal/unlimited tier.',
    limits: { branches: -1, customers: -1, messagesPerMonth: -1, staff: -1 },
    features: PRO_F,
    highlights: [],
  },
};

// Tier ordering for requirePlan(minTier) comparisons.
export const TIER_RANK: Record<Tier, number> = { FREE: 0, STARTER: 1, GROWTH: 2, PROFESSIONAL: 3, ENTERPRISE: 4 };

// Which tier a feature first becomes available on (for "Available on X" copy).
export const featureMinTier = (feature: FeatureKey): Tier => {
  for (const t of ['FREE', 'STARTER', 'GROWTH', 'PROFESSIONAL'] as Tier[]) {
    if (PLANS[t].features.includes(feature)) return t;
  }
  return 'PROFESSIONAL';
};

export const publicPlans = (): PlanDef[] =>
  (['FREE', 'STARTER', 'GROWTH', 'PROFESSIONAL'] as Tier[]).map(t => PLANS[t]);

export const TRIAL_DAYS = 14;
export const TRIAL_TIER: Tier = 'GROWTH'; // new signups get Growth access during trial

// ── Plugins / add-on modules status ────────────────────────────────
// Default to coming_soon unless proven active, tested and entitlement-safe.
export type PluginStatus = 'active' | 'coming_soon' | 'beta' | 'internal_only' | 'disabled';
export const PLUGIN_STATUS: Record<string, PluginStatus> = {
  qr_checkin:        'active',
  loyalty_wallet:    'active',
  campaigns:         'active',
  segments:          'active',
  ai_advisor:        'active',
  ai_reports:        'active',
  hr:                'active',       // Operations · HR & Staff module is implemented
  integrations:      'active',       // integrations config + test exists
  pos:               'beta',         // POS screens exist; treat as beta
  api_access:        'coming_soon',
  apple_wallet:      'coming_soon',
  google_wallet:     'coming_soon',
  advanced_automations: 'coming_soon',
  inventory:         'coming_soon',
  devices:           'coming_soon',
  ordering:          'coming_soon',
  accounting:        'coming_soon',
};
