// ================================================================
//  business-metrics-service.ts
//  THE RULES ENGINE. Computes verified, tenant-scoped business metrics
//  for a period vs the previous period. This is the source of truth —
//  the LLM only narrates what this produces.
//
//  Every query is scoped by the businessId passed in from server-side
//  tenant context (never from client input). Where a data model does
//  not exist for a metric, the metric is returned with available=false
//  and a hint on how to start collecting it — never an invented value.
// ================================================================

import { prisma } from '../../config/prisma';

export interface PeriodWindow { start: Date; end: Date; prevStart: Date; prevEnd: Date; }

export interface MetricDelta { current: number; previous: number; changePct: number | null; }

export interface MetricsBundle {
  businessId: string;
  type: 'WEEKLY' | 'MONTHLY' | 'YEARLY';
  window: PeriodWindow;
  currency: string;
  revenue:        MetricDelta & { available: boolean };
  visits:         MetricDelta & { available: boolean };
  averageOrderValue: { current: number; previous: number };
  customers:      { total: number; new: MetricDelta; returning: number; available: boolean };
  segments:       { atRisk: number; lost: number; vip: number; loyal: number; new: number; bigSpender: number };
  loyalty:        { pointsIssued: number; pointsRedeemed: number; available: boolean };
  storeCredit:    { outstanding: number; issued: number; redeemed: number; available: boolean };
  coupons:        { redemptions: MetricDelta; available: boolean };
  referrals:      { current: number; previous: number; available: boolean };
  messages:       { sent: number; delivered: number; read: number; failed: number; droppedQuota: number; droppedConsent: number; deliveryRate: number | null; failureRate: number | null; available: boolean };
  campaigns:      { created: number; completed: number; available: boolean };
  birthdays:      { next7: number; next30: number; available: boolean };
  reviews:        { available: false; reason: string };
  subscription:   { tier: string; status: string; messageQuota: number; messagesUsed: number; remaining: number; available: boolean };
  missing:        string[]; // human-readable list of what couldn't be measured
}

const pctChange = (cur: number, prev: number): number | null =>
  prev === 0 ? (cur > 0 ? 100 : null) : Math.round(((cur - prev) / prev) * 1000) / 10;

const num = (v: unknown): number => Number(v ?? 0);

/** Build the comparison window for a weekly, monthly or yearly report ending "now". */
export const buildWindow = (type: 'WEEKLY' | 'MONTHLY' | 'YEARLY', now = new Date()): PeriodWindow => {
  if (type === 'WEEKLY') {
    const end = now;
    const start = new Date(end.getTime() - 7 * 86_400_000);
    const prevEnd = start;
    const prevStart = new Date(start.getTime() - 7 * 86_400_000);
    return { start, end, prevStart, prevEnd };
  }
  if (type === 'YEARLY') {
    // YEARLY: current calendar year-to-date vs the previous full year.
    const end = now;
    const start = new Date(Date.UTC(now.getUTCFullYear(), 0, 1));
    const prevEnd = start;
    const prevStart = new Date(Date.UTC(now.getUTCFullYear() - 1, 0, 1));
    return { start, end, prevStart, prevEnd };
  }
  // MONTHLY: current calendar month-to-date vs previous full month-equivalent span
  const end = now;
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const prevEnd = start;
  const prevStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  return { start, end, prevStart, prevEnd };
};

/**
 * Compute the full metrics bundle for one tenant. All queries are bounded
 * (date-ranged aggregates / counts / groupBy) and scoped by businessId.
 */
export const computeMetrics = async (
  businessId: string,
  type: 'WEEKLY' | 'MONTHLY' | 'YEARLY',
  now = new Date(),
): Promise<MetricsBundle> => {
  const w = buildWindow(type, now);
  const missing: string[] = [];

  const biz = await prisma.business.findUnique({ where: { id: businessId }, select: { currency: true } });
  const currency = biz?.currency ?? 'GBP';

  // ── Revenue & visits (Visit.amountSpent / visitedAt) ──
  const [revCur, revPrev] = await Promise.all([
    prisma.visit.aggregate({ where: { businessId, visitedAt: { gte: w.start, lt: w.end } }, _sum: { amountSpent: true }, _count: { id: true } }),
    prisma.visit.aggregate({ where: { businessId, visitedAt: { gte: w.prevStart, lt: w.prevEnd } }, _sum: { amountSpent: true }, _count: { id: true } }),
  ]);
  const revenueCur = num(revCur._sum.amountSpent), revenuePrev = num(revPrev._sum.amountSpent);
  const visitsCur = revCur._count.id, visitsPrev = revPrev._count.id;
  const visitsAvailable = visitsCur + visitsPrev > 0;
  if (!visitsAvailable) missing.push('No visits recorded yet — set up QR check-in or connect your POS so The Loyaly can track repeat customers.');

  // ── Customers & segments ──
  const [totalCustomers, newCur, newPrev, segGroups] = await Promise.all([
    prisma.customer.count({ where: { businessId, isActive: true } }),
    prisma.customer.count({ where: { businessId, createdAt: { gte: w.start, lt: w.end } } }),
    prisma.customer.count({ where: { businessId, createdAt: { gte: w.prevStart, lt: w.prevEnd } } }),
    prisma.customer.groupBy({ by: ['segment'], where: { businessId, isActive: true }, _count: { id: true } }),
  ]);
  const segCount = (s: string) => segGroups.find(g => g.segment === s)?._count.id ?? 0;
  // Returning customers = distinct customers (created before the window) with a visit in the window.
  const returningRows = await prisma.visit.groupBy({
    by: ['customerId'],
    where: { businessId, visitedAt: { gte: w.start, lt: w.end } },
  });
  const returning = returningRows.length;

  // ── Loyalty points (RewardPointsLedger) ──
  const [ptsIssued, ptsRedeemed] = await Promise.all([
    prisma.rewardPointsLedger.aggregate({ where: { businessId, type: 'CREDIT', createdAt: { gte: w.start, lt: w.end } }, _sum: { points: true } }),
    prisma.rewardPointsLedger.aggregate({ where: { businessId, type: 'DEBIT', createdAt: { gte: w.start, lt: w.end } }, _sum: { points: true } }),
  ]);
  const pointsIssued = num(ptsIssued._sum.points), pointsRedeemed = num(ptsRedeemed._sum.points);
  const loyaltyAvailable = pointsIssued + pointsRedeemed > 0;

  // ── Store credit (Customer.currentWalletBalance = outstanding liability; WalletLedger = flow) ──
  const [outstandingAgg, scIssued, scRedeemed] = await Promise.all([
    prisma.customer.aggregate({ where: { businessId, isActive: true }, _sum: { currentWalletBalance: true } }),
    prisma.walletLedger.aggregate({ where: { businessId, type: 'CREDIT', createdAt: { gte: w.start, lt: w.end } }, _sum: { amount: true } }),
    prisma.walletLedger.aggregate({ where: { businessId, type: 'DEBIT', createdAt: { gte: w.start, lt: w.end } }, _sum: { amount: true } }),
  ]);
  const scOutstanding = num(outstandingAgg._sum.currentWalletBalance);
  const storeCreditIssued = num(scIssued._sum.amount), storeCreditRedeemed = num(scRedeemed._sum.amount);
  const storeCreditAvailable = scOutstanding + storeCreditIssued + storeCreditRedeemed > 0;

  // ── Coupons ──
  const [couponCur, couponPrev] = await Promise.all([
    prisma.couponRedemptionLog.count({ where: { businessId, redeemedAt: { gte: w.start, lt: w.end } } }),
    prisma.couponRedemptionLog.count({ where: { businessId, redeemedAt: { gte: w.prevStart, lt: w.prevEnd } } }),
  ]);

  // ── Referrals (customers acquired via a referral code in the window) ──
  const [refCur, refPrev] = await Promise.all([
    prisma.customer.count({ where: { businessId, referredByCode: { not: null }, createdAt: { gte: w.start, lt: w.end } } }),
    prisma.customer.count({ where: { businessId, referredByCode: { not: null }, createdAt: { gte: w.prevStart, lt: w.prevEnd } } }),
  ]);

  // ── Message health (MessageQueue.status in window) ──
  const msgGroups = await prisma.messageQueue.groupBy({
    by: ['status'], where: { businessId, createdAt: { gte: w.start, lt: w.end } }, _count: { id: true },
  });
  const msg = (s: string) => msgGroups.find(g => g.status === s)?._count.id ?? 0;
  const mSent = msg('SENT') + msg('DELIVERED') + msg('READ');
  const mDelivered = msg('DELIVERED') + msg('READ');
  const mRead = msg('READ');
  const mFailed = msg('FAILED');
  const mTotal = msgGroups.reduce((s, g) => s + g._count.id, 0);
  const messagesAvailable = mTotal > 0;

  // ── Campaigns ──
  const [campCreated, campCompleted] = await Promise.all([
    prisma.campaign.count({ where: { businessId, createdAt: { gte: w.start, lt: w.end } } }),
    prisma.campaign.count({ where: { businessId, status: 'COMPLETED', updatedAt: { gte: w.start, lt: w.end } } }),
  ]);

  // ── Birthdays upcoming (next 7 / 30 days) via month/day match ──
  let bd7 = 0, bd30 = 0, birthdaysAvailable = false;
  try {
    const rows = await prisma.$queryRawUnsafe<{ d: number }[]>(`
      SELECT ( (date_part('doy', make_date(2000, date_part('month',"birthday")::int, date_part('day',"birthday")::int)) -
                date_part('doy', make_date(2000, date_part('month', CURRENT_DATE)::int, date_part('day', CURRENT_DATE)::int)) + 366) % 366 ) AS d
      FROM "customers" WHERE "businessId" = $1 AND "isActive" = true AND "birthday" IS NOT NULL
    `, businessId);
    birthdaysAvailable = rows.length > 0;
    bd7 = rows.filter(r => num(r.d) <= 7).length;
    bd30 = rows.filter(r => num(r.d) <= 30).length;
  } catch { /* birthday column / data absent → leave unavailable */ }
  if (!birthdaysAvailable) missing.push('No customer birthdays on file — capture birthdays at sign-up to run birthday reward campaigns.');

  // ── Subscription / quota ──
  const sub = await prisma.subscription.findUnique({
    where: { businessId },
    select: { tier: true, status: true, monthlyMessageQuota: true, messagesUsedThisPeriod: true },
  });

  // ── Reviews: no tenant-scoped review model exists (PublicReview is platform-wide) ──
  missing.push('Per-business customer reviews are not tracked yet — a tenant-scoped review model would be needed to report review activity.');

  return {
    businessId, type, window: w, currency,
    revenue:  { current: revenueCur, previous: revenuePrev, changePct: pctChange(revenueCur, revenuePrev), available: visitsAvailable },
    visits:   { current: visitsCur, previous: visitsPrev, changePct: pctChange(visitsCur, visitsPrev), available: visitsAvailable },
    averageOrderValue: { current: visitsCur ? Math.round(revenueCur / visitsCur * 100) / 100 : 0, previous: visitsPrev ? Math.round(revenuePrev / visitsPrev * 100) / 100 : 0 },
    customers: { total: totalCustomers, new: { current: newCur, previous: newPrev, changePct: pctChange(newCur, newPrev) }, returning, available: totalCustomers > 0 },
    segments: { atRisk: segCount('AT_RISK'), lost: segCount('LOST'), vip: segCount('VIP'), loyal: segCount('LOYAL'), new: segCount('NEW'), bigSpender: segCount('BIG_SPENDER') },
    loyalty: { pointsIssued, pointsRedeemed, available: loyaltyAvailable },
    storeCredit: { outstanding: Math.round(scOutstanding * 100) / 100, issued: Math.round(storeCreditIssued * 100) / 100, redeemed: Math.round(storeCreditRedeemed * 100) / 100, available: storeCreditAvailable },
    coupons: { redemptions: { current: couponCur, previous: couponPrev, changePct: pctChange(couponCur, couponPrev) }, available: couponCur + couponPrev > 0 },
    referrals: { current: refCur, previous: refPrev, available: refCur + refPrev > 0 },
    messages: {
      sent: mSent, delivered: mDelivered, read: mRead, failed: mFailed,
      droppedQuota: msg('DROPPED_QUOTA'), droppedConsent: msg('CONSENT_REVOKED'),
      deliveryRate: mSent ? Math.round(mDelivered / mSent * 1000) / 10 : null,
      failureRate: mTotal ? Math.round(mFailed / mTotal * 1000) / 10 : null,
      available: messagesAvailable,
    },
    campaigns: { created: campCreated, completed: campCompleted, available: campCreated + campCompleted > 0 },
    birthdays: { next7: bd7, next30: bd30, available: birthdaysAvailable },
    reviews: { available: false, reason: 'No tenant-scoped review model.' },
    subscription: {
      tier: sub?.tier ?? 'FREE', status: sub?.status ?? 'TRIALING',
      messageQuota: sub?.monthlyMessageQuota ?? 0, messagesUsed: sub?.messagesUsedThisPeriod ?? 0,
      remaining: Math.max(0, (sub?.monthlyMessageQuota ?? 0) - (sub?.messagesUsedThisPeriod ?? 0)),
      available: !!sub,
    },
    missing,
  };
};

/** Render a compact, factual data block for the LLM (numbers only — no prose). */
export const metricsToBlock = (m: MetricsBundle): string => {
  const cur = m.currency;
  const d = (x: MetricDelta) => `${x.current} (prev ${x.previous}${x.changePct != null ? `, ${x.changePct >= 0 ? '+' : ''}${x.changePct}%` : ''})`;
  const lines = [
    `Period: ${m.type} | ${m.window.start.toISOString().slice(0,10)} → ${m.window.end.toISOString().slice(0,10)}`,
    `Currency: ${cur}`,
    m.revenue.available ? `Revenue: ${cur}${m.revenue.current} (prev ${cur}${m.revenue.previous}${m.revenue.changePct != null ? `, ${m.revenue.changePct >= 0 ? '+' : ''}${m.revenue.changePct}%` : ''})` : `Revenue: not available (no visits/POS data)`,
    m.visits.available ? `Visits: ${d(m.visits)}` : `Visits: not available`,
    `Average order value: ${cur}${m.averageOrderValue.current} (prev ${cur}${m.averageOrderValue.previous})`,
    `Customers total: ${m.customers.total}; new: ${d(m.customers.new)}; returning this period: ${m.customers.returning}`,
    `Segments — at-risk: ${m.segments.atRisk}, lost: ${m.segments.lost}, VIP: ${m.segments.vip}, loyal: ${m.segments.loyal}, new: ${m.segments.new}, big spender: ${m.segments.bigSpender}`,
    m.loyalty.available ? `Loyalty points — issued: ${m.loyalty.pointsIssued}, redeemed: ${m.loyalty.pointsRedeemed}` : `Loyalty points: not available`,
    m.storeCredit.available ? `Store credit (in-store reward value) — outstanding: ${cur}${m.storeCredit.outstanding}, issued: ${cur}${m.storeCredit.issued}, redeemed: ${cur}${m.storeCredit.redeemed}` : `Store credit: not available`,
    m.coupons.available ? `Coupon redemptions: ${d(m.coupons.redemptions)}` : `Coupon redemptions: none yet`,
    m.referrals.available ? `Referred sign-ups: ${m.referrals.current} (prev ${m.referrals.previous})` : `Referrals: none yet`,
    m.messages.available ? `Messages — sent: ${m.messages.sent}, delivered: ${m.messages.delivered}, read: ${m.messages.read}, failed: ${m.messages.failed}, delivery rate: ${m.messages.deliveryRate ?? 'n/a'}%, failure rate: ${m.messages.failureRate ?? 'n/a'}%` : `Messages: none sent this period`,
    m.campaigns.available ? `Campaigns — created: ${m.campaigns.created}, completed: ${m.campaigns.completed}` : `Campaigns: none this period`,
    m.birthdays.available ? `Birthdays — next 7 days: ${m.birthdays.next7}, next 30 days: ${m.birthdays.next30}` : `Birthdays: not on file`,
    `Plan: ${m.subscription.tier} (${m.subscription.status}); messages used ${m.subscription.messagesUsed}/${m.subscription.messageQuota}`,
    m.missing.length ? `Missing data: ${m.missing.join(' ')}` : '',
  ];
  return lines.filter(Boolean).join('\n');
};
