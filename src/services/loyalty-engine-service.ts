// ================================================================
//  loyalty-engine-service.ts
//  The mechanics behind Loyable's loyalty engine extensions:
//    • Rewards Engine   — redeem point-priced catalogue items
//    • Gift Cards       — issue + redeem prepaid stored value
//    • Gamification     — evaluate challenges, grant points & badges
//    • Signed QR        — branch/table/event scoped check-in tokens
//
//  Reuses the existing immutable ledgers (RewardPointsLedger via
//  debitPoints, WalletLedger) and idempotency conventions. Every
//  point/balance mutation happens inside a $transaction so a partial
//  failure can never leave the ledger and the cached balance disagreeing.
// ================================================================

import crypto from 'crypto';
import { prisma } from '../config/prisma';
import { debitPoints, creditPoints } from './loyalty-service';
import { hashPassword } from './token-service';

const QR_SECRET = process.env.JWT_SECRET || 'loyable-qr-dev-secret';
const b64url = (b: Buffer) => b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

// ================================================================
//  SIGNED QR TOKENS (HMAC-SHA256) — scoped to branch/table/event
// ================================================================

export interface QrScope {
  businessId: string;
  scope: 'BRANCH' | 'TABLE' | 'EVENT' | 'DYNAMIC';
  branchLocationId?: string;
  tableId?: string;
  eventId?: string;
  /** Epoch ms expiry. Dynamic QRs rotate; static branch QRs can omit. */
  exp?: number;
  /** Optional geofence the scanning client must satisfy. */
  geo?: { lat: number; lng: number; radiusM: number };
}

/** Produces a compact signed token: base64url(payload).base64url(hmac). */
export function signQrPayload(scope: QrScope): string {
  const payload = b64url(Buffer.from(JSON.stringify(scope)));
  const sig = b64url(crypto.createHmac('sha256', QR_SECRET).update(payload).digest());
  return `${payload}.${sig}`;
}

/** Verifies signature + expiry. Returns the decoded scope or null. */
export function verifyQrPayload(token: string): QrScope | null {
  const [payload, sig] = (token || '').split('.');
  if (!payload || !sig) return null;
  const expected = b64url(crypto.createHmac('sha256', QR_SECRET).update(payload).digest());
  // Constant-time comparison to avoid signature-timing leaks
  if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  try {
    const scope = JSON.parse(Buffer.from(payload.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString()) as QrScope;
    if (scope.exp && Date.now() > scope.exp) return null;
    return scope;
  } catch { return null; }
}

/** Haversine distance in metres — used for geolocation fraud prevention. */
export function distanceMeters(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6_371_000;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.sin(dLng / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
  return 2 * R * Math.asin(Math.sqrt(h));
}

// ================================================================
//  REWARDS ENGINE — redeem a catalogue item for points
// ================================================================

export type RewardRedeemError =
  | 'REWARD_NOT_FOUND' | 'REWARD_INACTIVE' | 'OUT_OF_STOCK'
  | 'TIER_TOO_LOW' | 'PER_CUSTOMER_LIMIT' | 'INSUFFICIENT_POINTS_BALANCE';

export interface RewardRedeemResult {
  redemptionId: string;
  pointsSpent: number;
  newPointsBalance: number;
  status: 'PENDING' | 'FULFILLED';
  couponCode?: string;
  walletCredited?: number;
}

/**
 * Atomically redeem a reward: validate eligibility, debit points, and
 * materialise the reward (cashback → wallet credit; discount/voucher →
 * coupon; free item/experience → PENDING for staff fulfilment).
 */
export async function redeemReward(
  businessId: string,
  customerId: string,
  rewardTemplateId: string
): Promise<{ ok: true; result: RewardRedeemResult } | { ok: false; error: RewardRedeemError }> {
  const reward = await prisma.rewardTemplate.findFirst({ where: { id: rewardTemplateId, businessId } });
  if (!reward) return { ok: false, error: 'REWARD_NOT_FOUND' };
  if (!reward.isActive) return { ok: false, error: 'REWARD_INACTIVE' };
  if (reward.stock !== null && reward.stock <= 0) return { ok: false, error: 'OUT_OF_STOCK' };

  // Tier eligibility
  if (reward.minTierRank != null) {
    const customer = await prisma.customer.findUnique({ where: { id: customerId }, select: { currentTierId: true } });
    const tier = customer?.currentTierId
      ? await prisma.loyaltyTier.findUnique({ where: { id: customer.currentTierId }, select: { rank: true } })
      : null;
    if ((tier?.rank ?? 0) < reward.minTierRank) return { ok: false, error: 'TIER_TOO_LOW' };
  }

  // Per-customer limit
  if (reward.perCustomerLimit != null) {
    const used = await prisma.rewardRedemption.count({ where: { businessId, customerId, rewardTemplateId, status: { not: 'CANCELLED' } } });
    if (used >= reward.perCustomerLimit) return { ok: false, error: 'PER_CUSTOMER_LIMIT' };
  }

  const isCashback = reward.type === 'CASHBACK';
  const isCoupon = reward.type === 'DISCOUNT' || reward.type === 'VOUCHER';
  const systemPin = await hashPassword('0000'); // staff auto-approve PIN (matches existing coupon convention)

  try {
    const out = await prisma.$transaction(async (tx) => {
      // 1. Debit points (throws INSUFFICIENT_POINTS_BALANCE)
      const newBalance = await debitPoints(tx, businessId, customerId, reward.pointsCost, `REWARD_REDEMPTION:${reward.name}`, reward.id, 'RewardTemplate');

      // 2. Decrement stock if tracked
      if (reward.stock !== null) {
        await tx.rewardTemplate.update({ where: { id: reward.id }, data: { stock: { decrement: 1 } } });
      }

      let couponId: string | undefined;
      let couponCode: string | undefined;
      let walletLedgerId: string | undefined;
      let walletCredited: number | undefined;
      let status: 'PENDING' | 'FULFILLED' = 'PENDING';

      if (isCashback && reward.value) {
        // Credit the customer's wallet (stored value)
        const cust = await tx.customer.findUnique({ where: { id: customerId }, select: { currentWalletBalance: true } });
        const newWallet = Number(cust?.currentWalletBalance ?? 0) + Number(reward.value);
        const wl = await tx.walletLedger.create({
          data: { businessId, customerId, type: 'CREDIT', amount: reward.value, balanceAfter: newWallet, reason: 'REWARD_CREDIT', referenceId: reward.id, referenceType: 'RewardTemplate' },
        });
        await tx.customer.update({ where: { id: customerId }, data: { currentWalletBalance: newWallet } });
        walletLedgerId = wl.id;
        walletCredited = Number(reward.value);
        status = 'FULFILLED';
      } else if (isCoupon) {
        const coupon = await tx.coupon.create({
          data: {
            businessId, customerId,
            type: reward.type === 'DISCOUNT' ? 'PERCENTAGE_DISCOUNT' : 'FIXED_VALUE',
            value: reward.value ?? 0,
            status: 'ACTIVE',
            cashierPinHash: systemPin,
            expiresAt: new Date(Date.now() + 90 * 86_400_000),
            qrPayload: `reward:${reward.id}`,
          },
        });
        couponId = coupon.id;
        couponCode = coupon.code;
      }
      // FREE_ITEM / EXPERIENCE stay PENDING until staff marks fulfilled

      const redemption = await tx.rewardRedemption.create({
        data: { businessId, customerId, rewardTemplateId: reward.id, pointsSpent: reward.pointsCost, status, couponId, walletLedgerId, fulfilledAt: status === 'FULFILLED' ? new Date() : null },
      });

      return { redemptionId: redemption.id, newBalance, status, couponCode, walletCredited };
    });

    return {
      ok: true,
      result: { redemptionId: out.redemptionId, pointsSpent: reward.pointsCost, newPointsBalance: out.newBalance, status: out.status, couponCode: out.couponCode, walletCredited: out.walletCredited },
    };
  } catch (e) {
    if ((e as Error).message === 'INSUFFICIENT_POINTS_BALANCE') return { ok: false, error: 'INSUFFICIENT_POINTS_BALANCE' };
    throw e;
  }
}

// ================================================================
//  GIFT CARDS
// ================================================================

const GIFT_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no ambiguous chars

function generateGiftCode(): string {
  const pick = () => GIFT_CODE_ALPHABET[crypto.randomInt(GIFT_CODE_ALPHABET.length)];
  const block = () => Array.from({ length: 4 }, pick).join('');
  return `GC-${block()}-${block()}-${block()}`;
}

export async function issueGiftCard(businessId: string, data: { initialBalance: number; purchaserName?: string; recipientName?: string; recipientPhone?: string; message?: string; expiresAt?: Date | null; issuedToCustomerId?: string | null; allowedItems?: string[] }) {
  // Retry on the (astronomically unlikely) code collision
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = generateGiftCode();
    const exists = await prisma.giftCard.findUnique({ where: { code }, select: { id: true } });
    if (exists) continue;
    const card = await prisma.giftCard.create({
      data: {
        businessId, code,
        initialBalance: data.initialBalance, currentBalance: data.initialBalance,
        purchaserName: data.purchaserName, recipientName: data.recipientName,
        recipientPhone: data.recipientPhone, message: data.message, expiresAt: data.expiresAt ?? null,
        issuedToCustomerId: data.issuedToCustomerId ?? null,
        allowedItems: data.allowedItems ?? [],
      },
    });
    // If issued directly to a customer, let them know it's waiting in their portal.
    if (data.issuedToCustomerId) {
      const from = data.purchaserName ? ` from ${data.purchaserName}` : '';
      await notifyCustomer(businessId, data.issuedToCustomerId, `🎁 You've been given a gift card worth £${data.initialBalance}${from}!${data.message ? ` "${data.message}"` : ''} It's waiting in your rewards portal.`);
    }
    return card;
  }
  throw new Error('GIFT_CODE_GENERATION_FAILED');
}

/** Builds the customer's rewards-portal URL for this business, if resolvable. */
async function portalUrl(businessId: string): Promise<string | null> {
  try {
    const biz = await prisma.business.findUnique({ where: { id: businessId }, select: { slug: true } });
    const base = process.env.API_BASE_URL?.replace(/\/$/, '');
    if (!biz?.slug || !base) return null;
    return `${base}/portal/${biz.slug}`;
  } catch { return null; }
}

/**
 * Fire-and-forget plain-text WhatsApp to a customer (best-effort).
 * Every change notification ends with a clear call to log in to the portal
 * (with the link when we can build it) so the customer knows where to act.
 */
async function notifyCustomer(businessId: string, customerId: string, body: string): Promise<void> {
  try {
    const customer = await prisma.customer.findFirst({ where: { id: customerId, businessId }, select: { whatsappNumber: true } });
    if (!customer?.whatsappNumber) return;
    const url = await portalUrl(businessId);
    const fullBody = `${body}\n\n👉 Log in to your rewards portal${url ? `: ${url}` : ' to see this.'}`;
    const { routeMessage } = await import('./messaging-gateway');
    await routeMessage({ businessId, provider: 'AUTO', recipientPhone: customer.whatsappNumber, payload: { type: 'TEXT', body: fullBody } as any });
  } catch (e) {
    console.warn('[gift-card] notifyCustomer failed: %s', (e as Error)?.message);
  }
}

export type GiftDeleteError = 'GIFT_CARD_NOT_FOUND' | 'GIFT_CARD_ISSUED' | 'GIFT_CARD_REDEEMED';

/**
 * Hard-delete a gift card. Permitted ONLY when the card has not been issued to
 * a customer and has not been redeemed. Issued cards must go through the
 * consent-gated requestGiftCardDeletion flow instead.
 */
export async function deleteGiftCard(businessId: string, id: string): Promise<{ ok: true } | { ok: false; error: GiftDeleteError }> {
  const card = await prisma.giftCard.findFirst({ where: { id, businessId } });
  if (!card) return { ok: false, error: 'GIFT_CARD_NOT_FOUND' };
  if (card.status === 'REDEEMED' || card.redeemedByCustomerId) return { ok: false, error: 'GIFT_CARD_REDEEMED' };
  if (card.issuedToCustomerId) return { ok: false, error: 'GIFT_CARD_ISSUED' };
  await prisma.giftCard.delete({ where: { id } });
  return { ok: true };
}

/**
 * Begin consent-gated deletion of an *issued* card: mark it PENDING_DELETE and
 * message the holder asking them to accept. Only the customer accepting (or the
 * business after acceptance) finalises the removal.
 */
export async function requestGiftCardDeletion(businessId: string, id: string, reason?: string): Promise<{ ok: true } | { ok: false; error: GiftDeleteError }> {
  const card = await prisma.giftCard.findFirst({ where: { id, businessId } });
  if (!card) return { ok: false, error: 'GIFT_CARD_NOT_FOUND' };
  if (!card.issuedToCustomerId) return { ok: false, error: 'GIFT_CARD_ISSUED' }; // not issued → use deleteGiftCard
  if (card.status === 'REDEEMED') return { ok: false, error: 'GIFT_CARD_REDEEMED' };

  await prisma.giftCard.update({ where: { id }, data: { status: 'PENDING_DELETE', deletionReason: reason ?? null, deletionRequestedAt: new Date() } });

  const msg = reason?.trim()
    ? `Hi — about your gift card ${card.code} (£${Number(card.currentBalance)}): ${reason.trim()} We're sorry for the inconvenience. You can accept or decline this change.`
    : `Hi — your gift card ${card.code} (£${Number(card.currentBalance)}) was issued in error and we'd like to cancel it. We're sorry for the mix-up. You can accept or decline this change.`;
  await notifyCustomer(businessId, card.issuedToCustomerId, msg);
  return { ok: true };
}

/** Customer's response to a pending deletion request. */
export async function respondToGiftCardDeletion(businessId: string, id: string, customerId: string, accept: boolean): Promise<{ ok: boolean; error?: string }> {
  const card = await prisma.giftCard.findFirst({ where: { id, businessId, issuedToCustomerId: customerId } });
  if (!card) return { ok: false, error: 'GIFT_CARD_NOT_FOUND' };
  if (card.status !== 'PENDING_DELETE') return { ok: false, error: 'NO_PENDING_REQUEST' };
  if (accept) {
    // Voided (kept for the business history panel, marked accordingly).
    await prisma.giftCard.update({ where: { id }, data: { status: 'VOIDED', currentBalance: 0 } });
    await notifyCustomer(businessId, customerId, `Thanks — your gift card ${card.code} has been cancelled as requested.`);
  } else {
    // Customer declined — restore to active.
    await prisma.giftCard.update({ where: { id }, data: { status: 'ACTIVE', deletionReason: null, deletionRequestedAt: null } });
  }
  return { ok: true };
}

/**
 * Re-gift an issued card to anyone by international phone (+ optional email).
 * The recipient need not exist yet — we find or create their customer record,
 * assign the card, WhatsApp them, and send a warm email on the store's and the
 * gifter's behalf so they know how to claim it.
 */
export async function transferGiftCard(
  businessId: string,
  id: string,
  fromCustomerId: string,
  toPhone: string,
  toEmail?: string,
  recipientName?: string,
): Promise<{ ok: boolean; error?: string }> {
  const card = await prisma.giftCard.findFirst({ where: { id, businessId, issuedToCustomerId: fromCustomerId } });
  if (!card) return { ok: false, error: 'GIFT_CARD_NOT_FOUND' };
  if (card.status !== 'ACTIVE') return { ok: false, error: 'GIFT_CARD_NOT_TRANSFERABLE' };

  // Require a sane international-format number (E.164-ish): leading + and 8–15 digits.
  const normPhone = toPhone.replace(/[\s-]/g, '');
  if (!/^\+\d{8,15}$/.test(normPhone)) return { ok: false, error: 'INVALID_PHONE_FORMAT' };

  const [sender, gifter] = await Promise.all([
    prisma.business.findUnique({ where: { id: businessId }, select: { name: true } }),
    prisma.customer.findFirst({ where: { id: fromCustomerId, businessId }, select: { fullName: true } }),
  ]);

  // Find or create the recipient customer.
  let recipient = await prisma.customer.findFirst({ where: { businessId, whatsappNumber: normPhone }, select: { id: true, fullName: true } });
  if (recipient && recipient.id === fromCustomerId) return { ok: false, error: 'CANNOT_GIFT_TO_SELF' };
  if (!recipient) {
    recipient = await prisma.customer.create({
      data: {
        businessId,
        fullName: recipientName?.trim() || (toEmail ? toEmail.split('@')[0] : 'Gift recipient'),
        whatsappNumber: normPhone,
        ...(toEmail ? { email: toEmail.trim() } : {}),
        segment: 'NEW',
      },
      select: { id: true, fullName: true },
    }).catch(async () => prisma.customer.findFirst({ where: { businessId, whatsappNumber: normPhone }, select: { id: true, fullName: true } }));
  }
  if (!recipient) return { ok: false, error: 'RECIPIENT_NOT_FOUND' };

  await prisma.giftCard.update({ where: { id }, data: { issuedToCustomerId: recipient.id, recipientName: recipient.fullName, recipientPhone: normPhone } });

  const amount = Number(card.currentBalance);
  const bizName = sender?.name ?? 'us';
  const fromName = gifter?.fullName ?? 'A friend';
  await notifyCustomer(businessId, recipient.id, `🎁 ${fromName} sent you a gift card worth £${amount} for ${bizName}!`);

  // Warm email on the store's + gifter's behalf.
  if (toEmail?.trim()) {
    const portal = await portalUrl(businessId);
    await sendGiftEmail(toEmail.trim(), { bizName, fromName, amount, code: card.code, message: card.message, portal }).catch(() => {});
  }
  return { ok: true };
}

/** A warm, on-brand gift-card email. */
async function sendGiftEmail(to: string, p: { bizName: string; fromName: string; amount: number; code: string; message?: string | null; portal?: string | null }): Promise<void> {
  try {
    const { sendEmail } = await import('../utils/email.util');
    const cta = p.portal ? `<a href="${p.portal}" style="display:inline-block;background:linear-gradient(135deg,#8b5cf6,#7c3aed);color:#fff;text-decoration:none;padding:14px 28px;border-radius:14px;font-weight:700;font-size:15px">Open your rewards portal &rarr;</a>` : '';
    const html = `
    <div style="margin:0;padding:24px;background:#f5f3ff;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif">
      <div style="max-width:480px;margin:0 auto;background:#fff;border-radius:24px;overflow:hidden;box-shadow:0 10px 40px rgba(124,58,237,.15)">
        <div style="background:linear-gradient(135deg,#6d28d9,#9333ea 55%,#c026d3);padding:36px 28px;text-align:center;color:#fff">
          <div style="font-size:44px;line-height:1">🎁</div>
          <div style="font-size:13px;letter-spacing:2px;text-transform:uppercase;opacity:.85;margin-top:8px">A gift for you</div>
          <div style="font-size:40px;font-weight:800;margin-top:6px">£${p.amount}</div>
          <div style="font-size:14px;opacity:.9;margin-top:2px">to spend at ${p.bizName}</div>
        </div>
        <div style="padding:28px;text-align:center;color:#1f2937">
          <p style="font-size:16px;margin:0 0 8px">Hi there 👋</p>
          <p style="font-size:15px;line-height:1.6;color:#475569;margin:0 0 16px">
            <strong>${p.fromName}</strong> thought of you and sent you a gift card for <strong>${p.bizName}</strong>.
            ${p.message ? `<br/><em style="color:#6d28d9">"${p.message}"</em>` : ''}
          </p>
          <div style="background:#f8fafc;border:1px dashed #c4b5fd;border-radius:14px;padding:16px;margin:0 0 20px">
            <div style="font-size:12px;color:#64748b">Your gift code</div>
            <div style="font-family:monospace;font-size:20px;font-weight:700;letter-spacing:2px;color:#6d28d9;margin-top:4px">${p.code}</div>
          </div>
          ${cta}
          <p style="font-size:12px;color:#94a3b8;margin:20px 0 0;line-height:1.6">
            Log in to your rewards portal with this number, open <strong>Gift Cards</strong>, and tap &ldquo;Have a gift code?&rdquo; to add it to your balance &mdash; then spend it in store. Enjoy! 💜
          </p>
        </div>
        <div style="background:#faf5ff;padding:16px;text-align:center;font-size:11px;color:#a78bfa">Sent with love on behalf of ${p.fromName} &amp; ${p.bizName}</div>
      </div>
    </div>`;
    await sendEmail({ to, subject: `🎁 ${p.fromName} sent you a £${p.amount} gift card for ${p.bizName}`, templateId: 'gift-card', variables: {}, html });
  } catch (e) {
    console.warn('[gift-card] gift email failed: %s', (e as Error)?.message);
  }
}

export type GiftRedeemError = 'GIFT_CARD_NOT_FOUND' | 'GIFT_CARD_INACTIVE' | 'GIFT_CARD_EXPIRED' | 'GIFT_CARD_EMPTY';

/** Redeem a gift card's full remaining balance into a customer's wallet. */
export async function redeemGiftCard(
  businessId: string,
  code: string,
  customerId: string
): Promise<{ ok: true; credited: number; walletBalance: number } | { ok: false; error: GiftRedeemError }> {
  const card = await prisma.giftCard.findFirst({ where: { code: code.trim().toUpperCase(), businessId } });
  if (!card) return { ok: false, error: 'GIFT_CARD_NOT_FOUND' };
  if (card.status !== 'ACTIVE') return { ok: false, error: 'GIFT_CARD_INACTIVE' };
  if (card.expiresAt && Date.now() > card.expiresAt.getTime()) {
    await prisma.giftCard.update({ where: { id: card.id }, data: { status: 'EXPIRED' } }).catch(() => {});
    return { ok: false, error: 'GIFT_CARD_EXPIRED' };
  }
  const amount = Number(card.currentBalance);
  if (amount <= 0) return { ok: false, error: 'GIFT_CARD_EMPTY' };

  const walletBalance = await prisma.$transaction(async (tx) => {
    const cust = await tx.customer.findUnique({ where: { id: customerId }, select: { currentWalletBalance: true } });
    const newWallet = Number(cust?.currentWalletBalance ?? 0) + amount;
    await tx.walletLedger.create({
      data: { businessId, customerId, type: 'CREDIT', amount, balanceAfter: newWallet, reason: 'GIFT_CARD_REDEMPTION', referenceId: card.id, referenceType: 'GiftCard' },
    });
    await tx.customer.update({ where: { id: customerId }, data: { currentWalletBalance: newWallet } });
    await tx.giftCard.update({ where: { id: card.id }, data: { currentBalance: 0, status: 'REDEEMED', redeemedByCustomerId: customerId } });
    return newWallet;
  });

  return { ok: true, credited: amount, walletBalance };
}

// ================================================================
//  GAMIFICATION — evaluate challenges & grant rewards/badges
// ================================================================

/**
 * Recompute a customer's progress against every active challenge and,
 * for any newly completed one, grant the reward points + badge exactly
 * once (guarded by ChallengeProgress.rewardedAt). Safe to call on every
 * check-in — it is idempotent.
 */
export async function evaluateChallenges(customerId: string, businessId: string): Promise<{ completed: string[] }> {
  const now = new Date();
  const challenges = await prisma.challenge.findMany({
    where: {
      businessId, isActive: true,
      AND: [
        { OR: [{ startsAt: null }, { startsAt: { lte: now } }] },
        { OR: [{ endsAt: null }, { endsAt: { gte: now } }] },
      ],
    },
  });
  if (challenges.length === 0) return { completed: [] };

  const customer = await prisma.customer.findUnique({
    where: { id: customerId },
    select: { visitCount: true, totalSpend: true, referralCode: true },
  });
  if (!customer) return { completed: [] };

  const completed: string[] = [];

  for (const ch of challenges) {
    const windowStart = ch.startsAt ?? undefined;

    let value = 0;
    if (ch.type === 'VISIT_COUNT') {
      value = windowStart
        ? await prisma.visit.count({ where: { businessId, customerId, visitedAt: { gte: windowStart } } })
        : customer.visitCount;
    } else if (ch.type === 'SPEND_TOTAL') {
      if (windowStart) {
        const agg = await prisma.visit.aggregate({ where: { businessId, customerId, visitedAt: { gte: windowStart } }, _sum: { amountSpent: true } });
        value = Number(agg._sum.amountSpent ?? 0);
      } else {
        value = Number(customer.totalSpend);
      }
    } else if (ch.type === 'REFERRAL_COUNT') {
      value = await prisma.customer.count({ where: { businessId, referredByCode: customer.referralCode } });
    } else if (ch.type === 'VISIT_STREAK') {
      value = await computeVisitStreak(businessId, customerId);
    } else {
      // PRODUCT_TRY is updated externally (POS/manual); read existing progress
      const existing = await prisma.challengeProgress.findUnique({ where: { customerId_challengeId: { customerId, challengeId: ch.id } }, select: { progress: true } });
      value = existing?.progress ?? 0;
    }

    const isComplete = value >= ch.goal;

    const record = await prisma.challengeProgress.upsert({
      where: { customerId_challengeId: { customerId, challengeId: ch.id } },
      create: { businessId, customerId, challengeId: ch.id, progress: value, completed: isComplete, completedAt: isComplete ? now : null },
      update: { progress: value, completed: isComplete, completedAt: isComplete ? now : null },
    });

    // Grant reward exactly once
    if (isComplete && !record.rewardedAt) {
      await prisma.$transaction(async (tx) => {
        if (ch.rewardPoints > 0) {
          await creditPoints(tx, businessId, customerId, ch.rewardPoints, `CHALLENGE_REWARD:${ch.name}`, ch.id, 'Challenge');
        }
        if (ch.badgeName) {
          await tx.customerBadge.upsert({
            where: { customerId_name: { customerId, name: ch.badgeName } },
            create: { businessId, customerId, challengeId: ch.id, name: ch.badgeName, icon: ch.badgeIcon },
            update: {},
          });
        }
        await tx.challengeProgress.update({ where: { id: record.id }, data: { rewardedAt: now } });
      });
      completed.push(ch.id);
    }
  }

  return { completed };
}

/** Consecutive-day visit streak ending today (capped at 60 for performance). */
async function computeVisitStreak(businessId: string, customerId: string): Promise<number> {
  const since = new Date(Date.now() - 60 * 86_400_000);
  const visits = await prisma.visit.findMany({
    where: { businessId, customerId, visitedAt: { gte: since } },
    select: { visitedAt: true },
    orderBy: { visitedAt: 'desc' },
  });
  const days = new Set(visits.map((v) => v.visitedAt.toISOString().slice(0, 10)));
  let streak = 0;
  const cursor = new Date();
  // Allow the streak to count from today or yesterday (today may have no visit yet)
  if (!days.has(cursor.toISOString().slice(0, 10))) cursor.setDate(cursor.getDate() - 1);
  while (days.has(cursor.toISOString().slice(0, 10))) {
    streak++;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}
