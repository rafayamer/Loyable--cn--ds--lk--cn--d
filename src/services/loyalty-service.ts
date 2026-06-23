// ================================================================
//  loyalty.service.ts
//  All loyalty operations — append-only points ledger, tier
//  classification, atomic coupon redemption, birthday automation
//  dispatch, and referral programme conversion.
//
//  Architectural rules enforced here:
//   - Points are NEVER modified: only appended (CREDIT / DEBIT rows)
//   - currentPointsBalance is a denormalized cache updated atomically
//     alongside each ledger append inside a $transaction
//   - Coupon redemption uses a raw SELECT FOR UPDATE to prevent
//     double-spending under concurrent cashier requests
//   - Referral conversion is fully atomic: signup discount + referrer
//     credit either both commit or both roll back — no partial state
// ================================================================

import { Prisma } from '@prisma/client';
import { prisma } from '../config/prisma';
import { verifyPassword, hashPassword } from './token-service';
import {
  enqueueMessage,
  enqueueAutomationTrigger,
  enqueueOutboundWebhook,
} from '../services/messaging-queue';


// ================================================================
// CONFIGURABLE CONSTANTS
// Per-business configuration is a roadmap item;
// these are safe platform-wide defaults.
// ================================================================

const POINTS_PER_POUND        = 1;    // 1 point per £1 spent
const VISIT_BASE_POINTS       = 5;    // Flat bonus per visit
const REFERRAL_REWARD_POINTS  = 100;  // Credited to referrer
const SIGNUP_DISCOUNT_PCT     = 10;   // % off for new referred customer
const SIGNUP_COUPON_EXPIRY_D  = 30;   // Days until signup coupon expires
const BIG_SPENDER_THRESHOLD   = 500;  // £ lifetime spend for BIG_SPENDER

// ================================================================
// PART 1 — IMMUTABLE POINTS LEDGER
// ================================================================

/**
 * Append a CREDIT row to the RewardPointsLedger.
 * Updates the customer's denormalized currentPointsBalance atomically.
 *
 * MUST be called inside a Prisma $transaction — never standalone.
 * Returns the new running balance.
 */
export const creditPoints = async (
  tx:            Prisma.TransactionClient,
  businessId:    string,
  customerId:    string,
  points:        number,
  reason:        string,
  referenceId?:  string,
  referenceType?: string
): Promise<number> => {
  const customer = await tx.customer.findUnique({
    where:  { id: customerId },
    select: { currentPointsBalance: true },
  });

  const current    = customer?.currentPointsBalance ?? 0;
  const newBalance = current + points;

  await tx.rewardPointsLedger.create({
    data: {
      businessId, customerId,
      type:          'CREDIT',
      points,
      balanceAfter:  newBalance,
      reason,
      referenceId,
      referenceType,
    },
  });
  await tx.customer.update({
    where: { id: customerId },
    data:  { currentPointsBalance: newBalance },
  });

  return newBalance;
};

/**
 * Append a DEBIT row. Throws INSUFFICIENT_POINTS_BALANCE if the
 * customer cannot cover the redemption — caller must handle.
 *
 * MUST be called inside a $transaction.
 */
export const debitPoints = async (
  tx:            Prisma.TransactionClient,
  businessId:    string,
  customerId:    string,
  points:        number,
  reason:        string,
  referenceId?:  string,
  referenceType?: string
): Promise<number> => {
  const customer = await tx.customer.findUnique({
    where:  { id: customerId },
    select: { currentPointsBalance: true },
  });

  const current = customer?.currentPointsBalance ?? 0;
  if (current < points) throw new Error('INSUFFICIENT_POINTS_BALANCE');

  const newBalance = current - points;

  await tx.rewardPointsLedger.create({
    data: {
      businessId, customerId,
      type:          'DEBIT',
      points,
      balanceAfter:  newBalance,
      reason,
      referenceId,
      referenceType,
    },
  });
  await tx.customer.update({
    where: { id: customerId },
    data:  { currentPointsBalance: newBalance },
  });

  return newBalance;
};

/**
 * Reconcile the denormalized balance against the full ledger.
 * Used for integrity audits — not called on hot paths.
 */
export const reconcilePointsBalance = async (
  customerId: string,
  businessId: string
): Promise<number> => {
  const ledger = await prisma.rewardPointsLedger.findMany({
    where:  { customerId, businessId },
    select: { type: true, points: true },
  });

  const balance = ledger.reduce(
    (acc, row) => row.type === 'CREDIT' ? acc + row.points : acc - row.points,
    0
  );

  const corrected = Math.max(0, balance);

  await prisma.customer.update({
    where: { id: customerId },
    data:  { currentPointsBalance: corrected },
  });

  return corrected;
};

// ================================================================
// PART 2 — VISIT ACCRUAL
// ================================================================

/**
 * Accrue points immediately after a Visit is registered.
 * Calls evaluateAndUpgradeTier to check for tier promotion.
 */
export const accruePointsForVisit = async (
  visitId:     string,
  businessId:  string,
  customerId:  string,
  amountSpent: number
): Promise<{ pointsEarned: number; newBalance: number; tierUpgraded: boolean }> => {
  const biz = await prisma.business.findUnique({
    where:  { id: businessId },
    select: { pointsPerPound: true, visitBasePoints: true },
  });
  const perPound   = biz?.pointsPerPound  ?? POINTS_PER_POUND;
  const basePoints = biz?.visitBasePoints ?? VISIT_BASE_POINTS;
  const pointsEarned = basePoints + Math.floor(amountSpent * perPound);

  const newBalance = await prisma.$transaction(async (tx) => {
    await tx.visit.update({
      where: { id: visitId },
      data:  { pointsEarned },
    });
    return creditPoints(tx, businessId, customerId, pointsEarned, 'VISIT_ACCRUAL', visitId, 'VISIT');
  });

  const tierUpgraded = await evaluateAndUpgradeTier(customerId, businessId);
  return { pointsEarned, newBalance, tierUpgraded };
};

/**
 * Self-healing backfill: credit points for any of a customer's visits that
 * never produced a VISIT_ACCRUAL ledger entry (e.g. visits recorded while
 * the pointsPerPound/visitBasePoints columns were missing, so accrual threw
 * and was swallowed). Idempotent — only accrues visits absent from the ledger.
 * Returns the number of visits backfilled. Safe to call on every profile read.
 */
export const backfillVisitPoints = async (
  customerId: string,
  businessId: string
): Promise<number> => {
  const biz = await prisma.business.findUnique({
    where:  { id: businessId },
    select: { pointsPerPound: true, visitBasePoints: true },
  });
  const perPound   = biz?.pointsPerPound  ?? POINTS_PER_POUND;
  const basePoints = biz?.visitBasePoints ?? VISIT_BASE_POINTS;

  const [visits, accrualLedger] = await Promise.all([
    prisma.visit.findMany({
      where:  { customerId, businessId },
      select: { id: true, amountSpent: true },
    }),
    prisma.rewardPointsLedger.findMany({
      where:  { customerId, businessId, reason: 'VISIT_ACCRUAL' },
      select: { referenceId: true },
    }),
  ]);

  const accruedVisitIds = new Set(accrualLedger.map(l => l.referenceId).filter(Boolean));
  const missing = visits.filter(v => !accruedVisitIds.has(v.id));
  if (missing.length === 0) return 0;

  for (const v of missing) {
    const spent = Number(v.amountSpent ?? 0);
    const pointsEarned = basePoints + Math.floor(spent * perPound);
    await prisma.$transaction(async (tx) => {
      await tx.visit.update({ where: { id: v.id }, data: { pointsEarned } });
      await creditPoints(tx, businessId, customerId, pointsEarned, 'VISIT_ACCRUAL', v.id, 'VISIT');
    });
  }

  await evaluateAndUpgradeTier(customerId, businessId);
  return missing.length;
};

// ================================================================
// PART 3 — LOYALTY TIER ENGINE
// ================================================================

/**
 * After every visit or spend update, evaluate whether the customer
 * qualifies for a higher tier (sorted desc — highest first).
 *
 * On upgrade:
 *   - Updates customer.currentTierId
 *   - Appends CustomerTierHistory
 *   - Enqueues TIER_UPGRADE automation via BullMQ (non-blocking)
 *   - Promotes segment to VIP if reaching the highest tier
 *
 * Returns true if an upgrade occurred.
 */
export const evaluateAndUpgradeTier = async (
  customerId: string,
  businessId: string
): Promise<boolean> => {
  const [customer, tiers] = await Promise.all([
    prisma.customer.findUnique({
      where:  { id: customerId },
      select: { visitCount: true, totalSpend: true, currentTierId: true },
    }),
    prisma.loyaltyTier.findMany({
      where:   { businessId },
      orderBy: { rank: 'desc' },
    }),
  ]);

  if (!customer || tiers.length === 0) return false;

  const totalSpend = Number(customer.totalSpend ?? 0);

  const qualifyingTier = tiers.find(t => {
    const meetsVisits = t.minVisitCount === null || customer.visitCount >= t.minVisitCount;
    const meetsSpend  = !t.minTotalSpend   || totalSpend >= Number(t.minTotalSpend);
    return meetsVisits && meetsSpend;
  });

  if (!qualifyingTier || qualifyingTier.id === customer.currentTierId) {
    return false;
  }

  const isHighestTier = tiers[0]?.id === qualifyingTier.id;

  await prisma.$transaction([
    prisma.customer.update({
      where: { id: customerId },
      data: {
        currentTierId: qualifyingTier.id,
        ...(isHighestTier && { segment: 'VIP' }),
        updatedAt: new Date(),
      },
    }),
    prisma.customerTierHistory.create({
      data: {
        businessId,
        customerId,
        tierId:    qualifyingTier.id,
        reason:    'SPEND_THRESHOLD',
        changedAt: new Date(),
      },
    }),
  ]);

  // Non-blocking — tier upgrade automation
  void dispatchAutomationForTrigger(businessId, customerId, 'TIER_UPGRADE', {
    tierName: qualifyingTier.name,
    tierRank: qualifyingTier.rank,
  });

  return true;
};

// ================================================================
// PART 4 — ATOMIC COUPON REDEMPTION
// ================================================================

export interface RedemptionResult {
  success:      boolean;
  couponId?:    string;
  discountText?: string;
  error?:       string;
}

/**
 * Validate and consume a coupon with a row-level lock.
 *
 * Flow inside a single Prisma $transaction:
 *   1. SELECT coupon FOR UPDATE  → exclusive lock on this row
 *   2. Verify status === 'ACTIVE'
 *   3. Argon2id-verify cashier PIN
 *   4. UPDATE status → 'USED'
 *   5. INSERT CouponRedemptionLog (immutable audit record)
 *
 * Any concurrent request hitting the same coupon waits on the lock,
 * then reads the committed USED status and is immediately rejected.
 * Double-spending is structurally impossible.
 */
export const redeemCoupon = async (
  couponCode:       string,
  rawCashierPin:    string,
  cashierId:        string,
  branchLocationId: string,
  businessId:       string,
  wasOffline:       boolean = false
): Promise<RedemptionResult> => {
  try {
    const result = await prisma.$transaction(async (tx) => {
      // ── Exclusive row-level lock ─────────────────────────────
      type CouponRow = {
        id:             string;
        status:         string;
        cashierPinHash: string;
        type:           string;
        value:          number | null;
        freeProductName: string | null;
        customerId:     string | null;
      };

      const locked = await tx.$queryRaw<CouponRow[]>`
        SELECT
          id,
          status,
          "cashierPinHash",
          type,
          value::float,
          "freeProductName",
          "customerId"
        FROM coupons
        WHERE code        = ${couponCode}
          AND "businessId" = ${businessId}
        FOR UPDATE
      `;

      if (locked.length === 0) throw new Error('COUPON_NOT_FOUND');

      const coupon = locked[0];

      if (coupon.status !== 'ACTIVE') {
        throw new Error(`COUPON_${coupon.status}`);
      }

      // ── Cashier PIN verification ─────────────────────────────
      const pinValid = await verifyPassword(coupon.cashierPinHash, rawCashierPin);
      if (!pinValid) throw new Error('INVALID_CASHIER_PIN');

      // ── Mark USED ────────────────────────────────────────────
      await tx.coupon.update({
        where: { id: coupon.id },
        data:  {
          status:          'USED',
          redemptionCount: { increment: 1 },
          updatedAt:       new Date(),
        },
      });

      // ── Immutable audit record ────────────────────────────────
      await tx.couponRedemptionLog.create({
        data: {
          businessId,
          couponId:        coupon.id,
          customerId:      coupon.customerId!,
          cashierId,
          branchLocationId,
          wasOffline,
          syncedAt:        wasOffline ? new Date() : undefined,
        },
      });

      return coupon;
    });

    const discountText =
      result.type === 'PERCENTAGE_DISCOUNT' ? `${result.value}% off` :
      result.type === 'FIXED_VALUE'         ? `£${result.value} off` :
      result.type === 'FREE_PRODUCT'        ? `Free: ${result.freeProductName}` :
      'BOGO offer applied';

    return { success: true, couponId: result.id, discountText };

  } catch (err) {
    const error = err instanceof Error ? err.message : 'REDEMPTION_FAILED';
    return { success: false, error };
  }
};

// ================================================================
// PART 5 — REFERRAL PROGRAMME (Atomic Conversion)
// ================================================================

/**
 * Process a referral conversion as a single atomic transaction.
 *
 * All 4 writes succeed together or not at all:
 *   1. New customer's referredByCode is set
 *   2. Signup discount coupon created for new customer
 *   3. CREDIT row appended to referrer's RewardPointsLedger
 *   4. Referrer's currentPointsBalance incremented
 *
 * After commit, an outbound webhook is emitted (fire-and-forget)
 * so connected Zapier/accounting integrations are notified.
 */
export const processReferralConversion = async (
  newCustomerId: string,
  referralCode:  string,
  businessId:    string
): Promise<{ success: boolean; discountCouponId?: string; error?: string }> => {
  // ── Pre-transaction reads (cheap path checks) ─────────────────
  const [referrer, newCustomer] = await Promise.all([
    prisma.customer.findFirst({
      where: { referralCode, businessId, isActive: true, id: { not: newCustomerId } },
      select: { id: true, currentPointsBalance: true, fullName: true },
    }),
    prisma.customer.findUnique({
      where:  { id: newCustomerId },
      select: { referredByCode: true },
    }),
  ]);

  if (!referrer)                    return { success: false, error: 'INVALID_REFERRAL_CODE' };
  if (newCustomer?.referredByCode)  return { success: false, error: 'REFERRAL_ALREADY_PROCESSED' };

  let couponId: string;

  try {
    await prisma.$transaction(async (tx) => {
      // 1. Bind referral to new customer
      await tx.customer.update({
        where: { id: newCustomerId },
        data:  { referredByCode: referralCode },
      });

      // 2. Create signup discount coupon
      const coupon = await tx.coupon.create({
        data: {
          businessId,
          customerId:    newCustomerId,
          type:          'PERCENTAGE_DISCOUNT',
          value:         SIGNUP_DISCOUNT_PCT,
          status:        'ACTIVE',
          // System auto-approve PIN (cashier validates with '0000')
          cashierPinHash: await hashPassword('0000'),
          expiresAt:      new Date(
            Date.now() + SIGNUP_COUPON_EXPIRY_D * 86_400_000
          ),
        },
      });

      couponId = coupon.id;

      // 3 + 4. Credit referrer (immutable ledger + balance update)
      await creditPoints(
        tx,
        businessId,
        referrer.id,
        REFERRAL_REWARD_POINTS,
        'REFERRAL_CREDIT',
        newCustomerId,
        'REFERRAL'
      );
    });

    // ── Emit outbound webhook (non-blocking) ──────────────────
    void emitReferralWebhook(businessId, referrer, newCustomerId, couponId!);

    return { success: true, discountCouponId: couponId! };

  } catch (err) {
    console.error('[loyalty.service] Referral conversion failed:', err);
    return { success: false, error: err instanceof Error ? err.message : 'TRANSACTION_FAILED' };
  }
};

// ================================================================
// PART 6 — BIRTHDAY AUTOMATION DISPATCHER
// ================================================================

/**
 * Called by the 00:30 node-cron job.
 * For each active business, finds today's birthdays, loads their
 * compiled BIRTHDAY automation graph, and enqueues BullMQ jobs.
 *
 * Birthday messages have isPromotional = false, so they bypass the
 * 72h cooldown interceptor in messaging.worker.ts.
 */
export const processBirthdayAutomations = async (): Promise<{
  processed: number;
  enqueued:  number;
  errors:    number;
}> => {
  const today = new Date();
  const month = today.getUTCMonth() + 1;
  const day   = today.getUTCDate();

  const workflows = await prisma.automationWorkflow.findMany({
    where: {
      triggerType:  'BIRTHDAY',
      status:       'ACTIVE',
      compiledJson: { not: Prisma.JsonNull },
    },
    select: { id: true, businessId: true, compiledJson: true },
  });

  let processed = 0, enqueued = 0, errors = 0;

  for (const wf of workflows) {
    type BirthdayRow = { id: string; whatsappNumber: string | null; fullName: string };

    // Efficient DOB match: only month + day, not year
    const todaysBirthdays = await prisma.$queryRaw<BirthdayRow[]>`
      SELECT id, "whatsappNumber", "fullName"
      FROM   customers
      WHERE  "businessId"              = ${wf.businessId}
        AND  "isActive"                = true
        AND  "isSuppressed"            = false
        AND  "marketingConsentWhatsapp" = true
        AND  birthday IS NOT NULL
        AND  EXTRACT(MONTH FROM birthday) = ${month}
        AND  EXTRACT(DAY   FROM birthday) = ${day}
    `;

    const compiled = wf.compiledJson as {
      actions: Array<{
        type:          string;
        templateName?: string;
        delayMinutes?: number;
        points?:       number;
      }>;
    };

    const business = await prisma.business.findUnique({
      where:  { id: wf.businessId },
      select: { messagingProvider: true },
    });

    for (const customer of todaysBirthdays) {
      processed++;
      try {
        const run = await prisma.automationRun.create({
          data: {
            businessId: wf.businessId,
            workflowId: wf.id,
            customerId: customer.id,
            status:     'RUNNING',
          },
        });

        for (const action of compiled.actions) {
          if (action.type === 'SEND_WHATSAPP' && customer.whatsappNumber && action.templateName) {
            const channel  = business?.messagingProvider === 'WAHA' ? 'WHATSAPP_WAHA' : 'WHATSAPP_META';
            const provider = business?.messagingProvider ?? 'META';

            const msgRecord = await prisma.messageQueue.create({
              data: {
                businessId:     wf.businessId,
                customerId:     customer.id,
                automationRunId: run.id,
                channel,
                provider,
                status:         'PENDING',
                templateName:   action.templateName,
                payloadJson: {
                  type:         'TEMPLATE',
                  templateName: action.templateName,
                  langCode:     'en_US',
                  components: [{
                    type:       'body',
                    parameters: [{ type: 'text', text: customer.fullName.split(' ')[0] }],
                  }],
                },
                isPromotional: false,   // Bypass 72h cooldown
                scheduledFor:  action.delayMinutes
                  ? new Date(Date.now() + action.delayMinutes * 60_000)
                  : new Date(),
              },
            });

            await enqueueMessage({
              messageQueueId: msgRecord.id,
              businessId:     wf.businessId,
              customerId:     customer.id,
              recipientPhone: customer.whatsappNumber,
              channel:        channel as any,
              provider:       provider as any,
              payload:        msgRecord.payloadJson as any,
              isPromotional:  false,
              automationRunId: run.id,
              retryCount:     0,
            });

            enqueued++;
          }

          if (action.type === 'AWARD_POINTS' && action.points) {
            await prisma.$transaction(async (tx) => {
              await creditPoints(
                tx, wf.businessId, customer.id,
                action.points!, 'BIRTHDAY_BONUS', wf.id, 'AUTOMATION'
              );
            });
          }
        }

        await prisma.$transaction([
          prisma.automationRun.update({
            where: { id: run.id },
            data:  { status: 'COMPLETED' },
          }),
          prisma.automationWorkflow.update({
            where: { id: wf.id },
            data:  { runCount: { increment: 1 }, lastRunAt: new Date() },
          }),
        ]);

      } catch (err) {
        errors++;
        console.error(`[loyalty.service] Birthday error for ${customer.id}:`, err);
      }
    }
  }

  return { processed, enqueued, errors };
};

// ================================================================
// PART 7 — READ OPERATIONS (Controller-facing)
// ================================================================

export const getCustomerLoyaltyProfile = async (
  customerId: string,
  businessId: string
) => {
  const [customer, tiers, ledger] = await Promise.all([
    prisma.customer.findFirst({
      where:  { id: customerId, businessId },
      select: {
        currentPointsBalance: true,
        currentTierId:        true,
        visitCount:           true,
        totalSpend:           true,
        referralCode:         true,
        referredByCode:       true,
      },
    }),
    prisma.loyaltyTier.findMany({
      where:   { businessId },
      orderBy: { rank: 'asc' },
    }),
    prisma.rewardPointsLedger.findMany({
      where:   { customerId, businessId },
      orderBy: { createdAt: 'desc' },
      take:    25,
    }),
  ]);

  const referralStats = await prisma.customer.count({
    where: { businessId, referredByCode: customer?.referralCode ?? '' },
  });

  return { customer, tiers, ledger, referralCount: referralStats };
};

/**
 * Nightly tier demotion: if a customer's 90-day spend/visits no longer
 * meet their current tier threshold, drop them to the highest tier they
 * still qualify for. Sends a "We miss you" message via TIER_DOWNGRADE
 * automation trigger (bypasses marketing cooldown — transactional).
 */
export const evaluateAndDowngradeTier = async (
  customerId: string,
  businessId: string
): Promise<boolean> => {
  const WINDOW_DAYS = 90;
  const windowStart = new Date(Date.now() - WINDOW_DAYS * 86_400_000);

  const [customer, tiers, recentVisitCount] = await Promise.all([
    prisma.customer.findUnique({
      where:  { id: customerId },
      select: { currentTierId: true, visitCount: true, totalSpend: true },
    }),
    prisma.loyaltyTier.findMany({ where: { businessId }, orderBy: { rank: 'desc' } }),
    prisma.visit.count({ where: { customerId, businessId, visitedAt: { gte: windowStart } } }),
  ]);

  if (!customer || tiers.length === 0 || !customer.currentTierId) return false;

  // Evaluate against rolling 90-day visit count (spend is cumulative lifetime)
  const qualifyingTier = tiers.find(t => {
    const meetsVisits = t.minVisitCount === null || recentVisitCount >= (t.minVisitCount ?? 0);
    const meetsSpend  = !t.minTotalSpend || Number(customer.totalSpend ?? 0) >= Number(t.minTotalSpend);
    return meetsVisits && meetsSpend;
  });

  const lowestTier = tiers[tiers.length - 1];
  const targetTier = qualifyingTier ?? lowestTier;
  if (!targetTier || targetTier.id === customer.currentTierId) return false;

  // Check the target is actually lower rank than current
  const currentTier = tiers.find(t => t.id === customer.currentTierId);
  if (!currentTier || targetTier.rank >= currentTier.rank) return false;

  await prisma.$transaction([
    prisma.customer.update({
      where: { id: customerId },
      data:  { currentTierId: targetTier.id, updatedAt: new Date() },
    }),
    prisma.customerTierHistory.create({
      data: { businessId, customerId, tierId: targetTier.id, reason: 'DEMOTION', changedAt: new Date() },
    }),
  ]);

  // Fire TIER_DOWNGRADE automation non-blocking
  try {
    const { enqueueAutomationTrigger } = await import('./messaging-queue');
    await enqueueAutomationTrigger({
      workflowId:     'TIER_DOWNGRADE',
      businessId,
      customerId,
      triggerType:    'TIER_DOWNGRADE' as any,
      triggerPayload: { fromTier: currentTier.name, toTier: targetTier.name },
    });
  } catch { /* no automation configured — silent */ }

  return true;
};

/**
 * Inline segment evaluation for a single customer — called immediately
 * after a visit so the segment is correct without waiting for the nightly cron.
 * Mirrors the priority order in segmentRefreshJob.
 */
export const evaluateCustomerSegment = async (
  customerId: string,
  businessId: string
): Promise<void> => {
  const BIG_SPENDER_THRESHOLD = 500;

  const biz = await prisma.business.findUnique({
    where:  { id: businessId },
    select: { irregularGapDays: true, lostDaysThreshold: true },
  });
  if (!biz) return;

  const now          = new Date();
  const lostCutoff   = new Date(now.getTime() - (biz.lostDaysThreshold ?? 60) * 86_400_000);
  const atRiskCutoff = new Date(now.getTime() - (biz.irregularGapDays  ?? 14) * 86_400_000);
  const loyalCutoff  = new Date(now.getTime() - 30 * 86_400_000);

  const [c, highestTier] = await Promise.all([
    prisma.customer.findUnique({
      where:  { id: customerId },
      select: { segment: true, totalSpend: true, lastVisitAt: true, visitCount: true, currentTierId: true,
                couponRedemptions: { select: { id: true } } },
    }),
    prisma.loyaltyTier.findFirst({ where: { businessId }, orderBy: { rank: 'desc' }, select: { id: true } }),
  ]);

  if (!c) return;

  const spend       = Number(c.totalSpend ?? 0);
  const last        = c.lastVisitAt;
  const redemptions = c.couponRedemptions.length;
  let   next: string;

  if (spend >= BIG_SPENDER_THRESHOLD) {
    next = 'BIG_SPENDER';
  } else if (!last || last < lostCutoff) {
    next = 'LOST';
  } else if (last < atRiskCutoff) {
    next = 'AT_RISK';
  } else if (highestTier && c.currentTierId === highestTier.id) {
    next = 'VIP';
  } else if (redemptions > 3 && c.visitCount < 5) {
    next = 'COUPON_HUNTER';
  } else if (last >= loyalCutoff && c.visitCount >= 2) {
    next = 'LOYAL';
  } else {
    next = 'NEW';
  }

  if (next !== c.segment) {
    await prisma.customer.update({ where: { id: customerId }, data: { segment: next as any, updatedAt: now } });
  }
};

export const getTierConfiguration = async (businessId: string) =>
  prisma.loyaltyTier.findMany({
    where:   { businessId },
    orderBy: { rank: 'asc' },
  });

export const upsertTierConfiguration = async (
  businessId: string,
  tiers: Array<{
    rank:          number;
    name:          string;
    minVisitCount?: number;
    minTotalSpend?: number;
    color?:        string;
    benefitsJson?: unknown;
  }>
) => {
  return prisma.$transaction(
    tiers.map(t =>
      prisma.loyaltyTier.upsert({
        where:  { businessId_rank: { businessId, rank: t.rank } },
        update: {
          name:          t.name,
          minVisitCount: t.minVisitCount,
          minTotalSpend: t.minTotalSpend as any,
          color:         t.color,
          benefitsJson:  t.benefitsJson as any,
          updatedAt:     new Date(),
        },
        create: { businessId, ...t, benefitsJson: t.benefitsJson as any },
      })
    )
  );
};

// ================================================================
// INTERNAL HELPERS
// ================================================================

const dispatchAutomationForTrigger = async (
  businessId:     string,
  customerId:     string,
  triggerType:    string,
  triggerPayload: Record<string, unknown>
): Promise<void> => {
  const wf = await prisma.automationWorkflow.findFirst({
    where: { businessId, triggerType, status: 'ACTIVE', compiledJson: { not: Prisma.JsonNull } },
    select: { id: true },
  });
  if (!wf) return;
  await enqueueAutomationTrigger({ workflowId: wf.id, businessId, customerId, triggerType, triggerPayload });
};

const emitReferralWebhook = async (
  businessId:    string,
  referrer:      { id: string; fullName: string },
  newCustomerId: string,
  couponId:      string
): Promise<void> => {
  const hooks = await prisma.outboundWebhookConfig.findMany({
    where: { businessId, isActive: true, events: { has: 'REFERRAL_CONVERTED' } },
  });

  for (const hook of hooks) {
    const delivery = await prisma.outboundWebhookDelivery.create({
      data: {
        businessId,
        webhookId:   hook.id,
        event:       'REFERRAL_CONVERTED',
        payloadJson: { referrerId: referrer.id, newCustomerId, couponId, pointsAwarded: REFERRAL_REWARD_POINTS },
      },
    });
    await enqueueOutboundWebhook({
      deliveryId: delivery.id,
      businessId,
      webhookId:  hook.id,
      targetUrl:  hook.targetUrl,
      secret:     hook.signingSecret,
      event:      'REFERRAL_CONVERTED',
      payload: {
        referrerId:    referrer.id,
        referrerName:  referrer.fullName,
        newCustomerId,
        pointsAwarded: REFERRAL_REWARD_POINTS,
        discountCode:  couponId,
      },
    });
  }
};
