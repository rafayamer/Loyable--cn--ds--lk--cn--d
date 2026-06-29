// ================================================================
//  promo-codes.ts
//  Test-only redeemable codes that switch a tenant's subscription tier
//  so plan/entitlement functionality can be exercised end-to-end.
//  Each code is 128 hex chars. Redeem via POST /api/entitlements/redeem.
//
//  NOTE: these are for testing. Rotate or remove before a public launch;
//  redemption is owner-only and audit-logged.
// ================================================================

import type { Tier } from './plans';

export const PROMO_CODES: Record<string, Tier> = {
  b8488bb6c870fbc1884f00e9d6a7f74e4995d228aaafeacc983b081397fd0f60aa4baae33c16ced63cfecd218b1b6415035c8e6dde4c1a02d1de873b89a2bd7e: 'FREE',
  a792e75be922cba61925f999f6a2a770e354dece3b578bcaec02be92b3dd67aacac1c1c7b67f86acf10ef1410b17e27415d78c7a392580bbafeb0d868694d481: 'STARTER',
  '569f4ca128f25c44887f78d52163baadf7a777fbed3a27a869598c88f40fb7bdb6cfc3c13ccd5000a15c0231de721a766162eb04df4dae93fa35e5b267151e9a': 'GROWTH',
  c17e5a8202efe852251af0916a65787cc2cd2154a48e1bdcd425c88ad7284728964907fe1e65b28ee9f15a80ef4e404900a667416350ab631b1978f033a0032c: 'PROFESSIONAL',
};

export const resolvePromoCode = (code: string): Tier | null =>
  PROMO_CODES[(code ?? '').trim().toLowerCase()] ?? null;

// Master test key (128 hex). When entered at checkout it SIMULATES a successful
// payment for the chosen plan for 1 month (activation + confirmation email),
// bypassing Lemon Squeezy — for testing only. Override via BILLING_TEST_KEY.
export const BILLING_TEST_KEY = (process.env.BILLING_TEST_KEY
  || 'afe4872eec1ec7ae565f6588f89c3fbb59504e3d955129d704367c388fa565798b7c1f9892a2e1304a413543c2c2fd4743abe9ca9128f15535cf50916835b873').toLowerCase();

export const isBillingTestKey = (code: string): boolean =>
  (code ?? '').trim().toLowerCase() === BILLING_TEST_KEY;
