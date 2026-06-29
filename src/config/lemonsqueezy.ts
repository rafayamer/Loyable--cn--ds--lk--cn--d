// ================================================================
//  lemonsqueezy.ts
//  Lemon Squeezy product/variant → internal plan mapping.
//  Variant IDs come from env (with the known production defaults), so
//  they can be overridden per environment without a code change.
// ================================================================

import type { Tier } from './plans';

export const LS_PRODUCT_ID = process.env.LEMONSQUEEZY_PRODUCT_ID || '1183800';
export const LS_STORE_ID   = process.env.LEMONSQUEEZY_STORE_ID || '';
export const LS_CHECKOUT_URL = process.env.LEMONSQUEEZY_CHECKOUT_URL
  || 'https://theloyaly.lemonsqueezy.com/checkout/buy/fe409479-bb46-42a9-8714-be61e7d16fed';

// Standardized internal plan slugs (no malformed double-dots).
export type PlanSlug = 'free' | 'starter_39_99' | 'growth_99_99' | 'pro_199_99';

export interface LsPlan { slug: PlanSlug; tier: Tier; variantId: string; priceGBP: number; name: string; }

const STARTER_VARIANT = process.env.LEMONSQUEEZY_STARTER_VARIANT_ID || '1851145';
const GROWTH_VARIANT  = process.env.LEMONSQUEEZY_GROWTH_VARIANT_ID  || '1851301';
const PRO_VARIANT     = process.env.LEMONSQUEEZY_PRO_VARIANT_ID     || '1851299';

// Slug → plan (the three paid checkout plans).
export const LS_PLANS: Record<Exclude<PlanSlug, 'free'>, LsPlan> = {
  starter_39_99: { slug: 'starter_39_99', tier: 'STARTER',      variantId: STARTER_VARIANT, priceGBP: 39.99,  name: 'Starter' },
  growth_99_99:  { slug: 'growth_99_99',  tier: 'GROWTH',       variantId: GROWTH_VARIANT,  priceGBP: 99.99,  name: 'Growth'  },
  pro_199_99:    { slug: 'pro_199_99',    tier: 'PROFESSIONAL', variantId: PRO_VARIANT,     priceGBP: 199.99, name: 'Pro'     },
};

// Variant ID → plan (used by the webhook to map an incoming subscription).
export const variantToPlan = (variantId: string | number | undefined): LsPlan | null => {
  const v = String(variantId ?? '');
  return Object.values(LS_PLANS).find(p => p.variantId === v) ?? null;
};

export const slugToPlan = (slug: string | undefined): LsPlan | null =>
  (slug && slug in LS_PLANS) ? LS_PLANS[slug as Exclude<PlanSlug, 'free'>] : null;

// Internal message quota per tier (mirrors plans.ts / stripe-service.ts).
export const TIER_QUOTA: Record<Tier, number> = {
  FREE: 100, STARTER: 3_000, GROWTH: 24_000, PROFESSIONAL: 100_000, ENTERPRISE: 9_999_999,
};

export const lsConfigured = (): boolean => !!process.env.LEMONSQUEEZY_API_KEY;
export const lsWebhookConfigured = (): boolean => !!process.env.LEMONSQUEEZY_WEBHOOK_SECRET;
