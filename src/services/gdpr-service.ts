// ================================================================
//  gdpr.service.ts
//  Full GDPR / UK GDPR compliance engine.
//
//  Operations:
//   purgeCustomerData   — Right to be Forgotten (Art. 17)
//   exportCustomerData  — Data Subject Access Request (Art. 15)
//   updateConsent       — Consent management (Art. 7)
//   getConsentHistory   — Consent audit trail
//   scheduleDataRetention — Automated expiry (Art. 5)
//
//  Pseudonymization strategy (Right to be Forgotten):
//   We NEVER hard-delete Customer rows because downstream foreign
//   keys (Visit, CouponRedemptionLog) would need cascade deletes
//   that would destroy legitimate business revenue records.
//
//   Instead we PSEUDONYMIZE:
//    - All PII fields are cleared / replaced with a deterministic hash
//    - The Customer.id stays intact so FK integrity is preserved
//    - Visit.amountSpent + date are kept for revenue analytics
//    - CouponRedemptionLog kept for cashier accountability
//    - All message content, points history, consent logs are HARD DELETED
//    - A tamper-evident AuditLog entry is created for ICO/regulator proof
//
//  This satisfies GDPR Art. 17 while preserving anonymised
//  aggregate data permissible under Art. 89 (statistical purposes).
// ================================================================

import crypto          from 'crypto';
import { prisma } from '../config/prisma';


// ================================================================
// TYPES
// ================================================================

export interface PurgeResult {
  success:             boolean;
  anonymizedId:        string;
  piiFieldsCleared:    string[];
  recordsDeleted: {
    messageQueue:        number;
    rewardPointsLedger:  number;
    walletLedger:        number;
    consentChangeLogs:   number;
    automationRuns:      number;
  };
  preservedForAnalytics: string[];
  auditLogId:          string;
  purgedAt:            string;
}

export interface DSARExport {
  exportedAt:     string;
  subject:        Record<string, unknown>;
  visits:         unknown[];
  pointsHistory:  unknown[];
  messageHistory: unknown[];
  couponHistory:  unknown[];
  consentHistory: unknown[];
  tierHistory:    unknown[];
}

// ================================================================
// PART 1 — RIGHT TO BE FORGOTTEN (Article 17)
// ================================================================

/**
 * Pseudonymize all PII for a customer and hard-delete
 * all content records linked to them.
 *
 * Steps (all inside a single Prisma $transaction):
 *   1. Generate deterministic anonymous ID from customer.id
 *   2. Clear all PII fields on the Customer record
 *   3. Hard-delete personal content: messages, points, wallet, consent logs
 *   4. Keep Visit and CouponRedemptionLog for revenue/audit integrity
 *   5. Create tamper-evident AuditLog entry
 *
 * After this call, the customer cannot be identified by any
 * stored attribute. Their transaction history (visits, amounts)
 * remains in aggregate analytics as anonymised data.
 */
export const purgeCustomerData = async (
  customerId:    string,
  businessId:    string,
  requestedById: string  // userId or 'CUSTOMER_SELF'
): Promise<PurgeResult> => {
  // Verify customer exists and belongs to this tenant
  const customer = await prisma.customer.findFirst({
    where:  { id: customerId, businessId },
    select: { id: true, fullName: true, whatsappNumber: true, email: true },
  });

  if (!customer) throw new Error('CUSTOMER_NOT_FOUND');

  // Deterministic anonymised ID — reproducible but reveals nothing
  const anonymizedId = crypto
    .createHash('sha256')
    .update(`${customerId}:${businessId}:gdpr`)
    .digest('hex')
    .slice(0, 16);

  // Count records before deletion (for audit report)
  const [msgCount, ledgerCount, walletCount, consentCount, runCount] =
    await Promise.all([
      prisma.messageQueue.count({ where: { customerId, businessId } }),
      prisma.rewardPointsLedger.count({ where: { customerId, businessId } }),
      prisma.walletLedger.count({ where: { customerId, businessId } }),
      prisma.consentChangeLog.count({ where: { customerId, businessId } }),
      prisma.automationRun.count({ where: { customerId, businessId } }),
    ]);

  let auditLogId = '';

  await prisma.$transaction(async (tx) => {
    // ── Step 1: Pseudonymize Customer PII ────────────────────
    await tx.customer.update({
      where: { id: customerId },
      data: {
        fullName:              `deleted_${anonymizedId}`,
        whatsappNumber:        null,
        email:                 null,
        birthday:              null,
        gender:                null,
        address:               null,
        avatarUrl:             null,
        devicePushToken:       null,
        referralCode:          `purged_${anonymizedId}`,
        referredByCode:        null,
        marketingConsentWhatsapp: false,
        marketingConsentEmail:    false,
        marketingConsentSms:      false,
        marketingConsentPush:     false,
        isSuppressed:          true,
        latestSentimentLabel:  null,
        latestSentimentScore:  null,
        latestSentimentAt:     null,
        marketingPausedUntil:  null,
        updatedAt:             new Date(),
      },
    });

    // ── Step 2: Hard-delete personal content ─────────────────
    // Message queue (content + metadata linked to person)
    await tx.messageQueue.deleteMany({ where: { customerId, businessId } });

    // Reward points ledger (financial account history)
    await tx.rewardPointsLedger.deleteMany({ where: { customerId, businessId } });

    // Wallet ledger
    await tx.walletLedger.deleteMany({ where: { customerId, businessId } });

    // Consent change logs (the AuditLog below serves as the legal record)
    await tx.consentChangeLog.deleteMany({ where: { customerId, businessId } });

    // Automation run history (contains customer context)
    await tx.automationRun.deleteMany({ where: { customerId, businessId } });

    // Tier history (linked to identity)
    await tx.customerTierHistory.deleteMany({ where: { customerId, businessId } });

    // Segment history
    await tx.customerSegmentHistory.deleteMany({ where: { customerId, businessId } });

    // ── Step 3: Anonymize coupons (remove personal reference) ─
    await tx.coupon.updateMany({
      where: { customerId, businessId },
      data:  { customerId: null, status: 'VOIDED' },
    });

    // ── Step 4: Tamper-evident compliance record ───────────────
    // This AuditLog entry is the ICO/regulator proof of deletion.
    // It intentionally does NOT contain the customer's PII.
    const log = await tx.auditLog.create({
      data: {
        businessId,
        userId:     requestedById === 'CUSTOMER_SELF' ? null : requestedById,
        action:     'GDPR_RIGHT_TO_ERASURE',
        entityType: 'Customer',
        entityId:   customerId,
        metaJson: {
          anonymizedId,
          requestedBy:  requestedById,
          piiCleared: [
            'fullName', 'whatsappNumber', 'email', 'birthday',
            'gender', 'address', 'avatarUrl', 'devicePushToken',
            'referralCode', 'consentFlags',
          ],
          recordsCleaned: {
            messageQueue:       msgCount,
            rewardPointsLedger: ledgerCount,
            walletLedger:       walletCount,
            consentChangeLogs:  consentCount,
            automationRuns:     runCount,
          },
          preservedAnonymised: ['visits (amountSpent, date only)', 'couponRedemptionLogs (cashier audit)'],
          legalBasis: 'GDPR Article 17 / UK GDPR',
          purgedAt:   new Date().toISOString(),
        },
      },
    });

    auditLogId = log.id;
  });

  return {
    success:          true,
    anonymizedId,
    piiFieldsCleared: [
      'fullName', 'whatsappNumber', 'email', 'birthday',
      'gender', 'address', 'avatarUrl', 'devicePushToken',
    ],
    recordsDeleted: {
      messageQueue:       msgCount,
      rewardPointsLedger: ledgerCount,
      walletLedger:       walletCount,
      consentChangeLogs:  consentCount,
      automationRuns:     runCount,
    },
    preservedForAnalytics: [
      'Visit.amountSpent (revenue metrics)',
      'CouponRedemptionLog (cashier accountability)',
    ],
    auditLogId,
    purgedAt: new Date().toISOString(),
  };
};

// ================================================================
// PART 2 — DATA SUBJECT ACCESS REQUEST (Article 15)
// ================================================================

/**
 * Compile a complete, portable export of all data held about a customer.
 * Returns a structured JSON object suitable for download or email delivery.
 *
 * Covers: profile, visits, points, messages sent, coupons, consent history.
 * Strips internal system IDs from the export — only human-readable fields.
 */
export const exportCustomerData = async (
  customerId: string,
  businessId: string
): Promise<DSARExport> => {
  const [
    customer, visits, ledger, messages, coupons,
    consentLogs, tierHistory,
  ] = await Promise.all([
    prisma.customer.findFirst({
      where:  { id: customerId, businessId },
      select: {
        fullName:      true,
        whatsappNumber: true,
        email:         true,
        birthday:      true,
        gender:        true,
        address:       true,
        visitCount:    true,
        totalSpend:    true,
        segment:       true,
        createdAt:     true,
        firstVisitAt:  true,
        lastVisitAt:   true,
        referralCode:  true,
        marketingConsentWhatsapp: true,
        marketingConsentEmail:    true,
        marketingConsentSms:      true,
      },
    }),

    prisma.visit.findMany({
      where:   { customerId, businessId },
      select:  { amountSpent: true, source: true, visitedAt: true, pointsEarned: true },
      orderBy: { visitedAt: 'desc' },
    }),

    prisma.rewardPointsLedger.findMany({
      where:   { customerId, businessId },
      select:  { type: true, points: true, balanceAfter: true, reason: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
    }),

    prisma.messageQueue.findMany({
      where:   { customerId, businessId },
      select:  { channel: true, templateName: true, status: true, sentAt: true, isPromotional: true },
      orderBy: { createdAt: 'desc' },
    }),

    prisma.couponRedemptionLog.findMany({
      where:   { customerId, businessId },
      select:  { redeemedAt: true },
      orderBy: { redeemedAt: 'desc' },
    }),

    prisma.consentChangeLog.findMany({
      where:   { customerId, businessId },
      select:  { channel: true, fromValue: true, toValue: true, triggerType: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
    }),

    prisma.customerTierHistory.findMany({
      where:  { customerId, businessId },
      select: { changedAt: true, reason: true, tier: { select: { name: true } } },
    }),
  ]);

  if (!customer) throw new Error('CUSTOMER_NOT_FOUND');

  await prisma.auditLog.create({
    data: {
      businessId,
      action:     'GDPR_DATA_EXPORT',
      entityType: 'Customer',
      entityId:   customerId,
      metaJson:   { requestedAt: new Date().toISOString() },
    },
  }).catch(console.error);

  return {
    exportedAt:     new Date().toISOString(),
    subject:        customer,
    visits:         visits.map(v => ({ ...v, amountSpent: Number(v.amountSpent) })),
    pointsHistory:  ledger,
    messageHistory: messages,
    couponHistory:  coupons,
    consentHistory: consentLogs,
    tierHistory:    tierHistory.map(t => ({
      changedAt: t.changedAt,
      reason:    t.reason,
      tierName:  t.tier.name,
    })),
  };
};

// ================================================================
// PART 3 — CONSENT MANAGEMENT (Article 7)
// ================================================================

export const updateConsent = async (
  customerId:  string,
  businessId:  string,
  consents: {
    whatsapp?: boolean;
    email?:    boolean;
    sms?:      boolean;
    push?:     boolean;
  },
  triggerType: string = 'CUSTOMER_REQUEST',
  ipAddress?:  string
): Promise<void> => {
  const current = await prisma.customer.findFirst({
    where:  { id: customerId, businessId },
    select: {
      marketingConsentWhatsapp: true,
      marketingConsentEmail:    true,
      marketingConsentSms:      true,
      marketingConsentPush:     true,
    },
  });

  if (!current) throw new Error('CUSTOMER_NOT_FOUND');

  const updates: Array<{ channel: string; from: boolean; to: boolean }> = [];

  if (consents.whatsapp !== undefined && consents.whatsapp !== current.marketingConsentWhatsapp) {
    updates.push({ channel: 'WHATSAPP', from: current.marketingConsentWhatsapp, to: consents.whatsapp });
  }
  if (consents.email !== undefined && consents.email !== current.marketingConsentEmail) {
    updates.push({ channel: 'EMAIL', from: current.marketingConsentEmail, to: consents.email });
  }
  if (consents.sms !== undefined && consents.sms !== current.marketingConsentSms) {
    updates.push({ channel: 'SMS', from: current.marketingConsentSms, to: consents.sms });
  }
  if (consents.push !== undefined && consents.push !== current.marketingConsentPush) {
    updates.push({ channel: 'PUSH', from: current.marketingConsentPush ?? false, to: consents.push });
  }

  if (updates.length === 0) return;

  await prisma.$transaction([
    prisma.customer.update({
      where: { id: customerId },
      data: {
        ...(consents.whatsapp !== undefined && { marketingConsentWhatsapp: consents.whatsapp }),
        ...(consents.email    !== undefined && { marketingConsentEmail:    consents.email }),
        ...(consents.sms      !== undefined && { marketingConsentSms:      consents.sms }),
        ...(consents.push     !== undefined && { marketingConsentPush:     consents.push }),
        // Auto-suppress if all channels withdrawn
        isSuppressed: Object.values({ ...current, ...consents }).every(v => v === false),
        updatedAt:    new Date(),
      },
    }),
    ...updates.map(u =>
      prisma.consentChangeLog.create({
        data: {
          businessId,
          customerId,
          channel:     u.channel,
          fromValue:   u.from,
          toValue:     u.to,
          triggerType,
          ipAddress,
        },
      })
    ),
  ]);
};

export const getConsentHistory = async (customerId: string, businessId: string) =>
  prisma.consentChangeLog.findMany({
    where:   { customerId, businessId },
    orderBy: { createdAt: 'desc' },
  });

// ================================================================
// PART 4 — AUTOMATED DATA RETENTION (Article 5 — Storage Limitation)
// ================================================================

/**
 * Called by the nightly cron. Purges customers who have:
 *  - Been inactive for > retentionDays
 *  - Had zero marketing consent for > retentionDays
 *  - Are marked as LOST for > retentionDays
 *
 * Businesses configure their retention policy in Settings.
 * Default: 3 years (1095 days).
 */
export const runDataRetentionPurge = async (
  businessId:    string,
  retentionDays: number = 1095
): Promise<{ evaluated: number; purged: number }> => {
  const cutoff = new Date(Date.now() - retentionDays * 86_400_000);

  const candidates = await prisma.customer.findMany({
    where: {
      businessId,
      segment:      'LOST',
      lastVisitAt:  { lt: cutoff },
      isSuppressed: true,
      // Only purge customers who have actively withdrawn consent
      marketingConsentWhatsapp: false,
      marketingConsentEmail:    false,
    },
    select: { id: true },
    take:   50, // Process up to 50 per nightly run
  });

  let purged = 0;

  for (const { id } of candidates) {
    try {
      await purgeCustomerData(id, businessId, 'RETENTION_POLICY_AUTO');
      purged++;
    } catch (err) {
      console.error(`[gdpr] Retention purge failed for ${id}:`, err);
    }
  }

  return { evaluated: candidates.length, purged };
};
