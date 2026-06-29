// ================================================================
//  customers-controller.ts
//  The Customers Module — the retention-intelligence core of Loyable.
//
//  Six submodules, all businessId-scoped (businessId from tenantContext):
//    1. Customer Database  — search, filters, tags, saved views, export
//    2. Customer Profile   — aggregated personal + membership + enrichment
//    3. Customer Timeline  — unified chronological event feed
//    4. Customer Financials— spend, AOV, CLV, predicted CLV, contribution
//    5. Customer Segments  — distribution + per-customer history
//    6. Reviews & Referrals— feedback, referral graph, referral revenue
//
//  Mounted at /api/customers. Complements (does not replace) the existing
//  /api/loyalty endpoints — those remain for backward compatibility.
// ================================================================

import { Request, Response, Router } from 'express';
import { z, ZodError } from 'zod';
import { Role, Prisma } from '@prisma/client';
import { prisma } from '../config/prisma';
import { tenantScope, requireRoles } from '../middleware/tenant-scope-middleware';

const ROLES = [Role.TENANT_OWNER, Role.BRANCH_MANAGER, Role.MARKETING_STAFF] as const;
const DAY_MS = 86_400_000;

const handleError = (err: unknown, res: Response): void => {
  if (err instanceof ZodError) {
    res.status(400).json({ error: 'VALIDATION_ERROR', fields: err.errors });
    return;
  }
  console.error('[customers]', err);
  res.status(500).json({ error: 'INTERNAL_ERROR' });
};

const num = (v: unknown): number => Number(v ?? 0);

// ================================================================
//  1. CUSTOMER DATABASE — list with rich filters + saved views + export
// ================================================================

/** Builds a Prisma `where` from query filters shared by list + export. */
function buildCustomerWhere(businessId: string, q: Record<string, any>): Prisma.CustomerWhereInput {
  const search = (q.q as string)?.trim();
  const segment = (q.segment as string)?.trim();
  const tag = (q.tag as string)?.trim();
  const consent = (q.consent as string)?.trim(); // OPTED_IN | OPTED_OUT
  const branchLocationId = (q.branch as string)?.trim();

  return {
    businessId,
    isActive: true,
    ...(search && {
      OR: [
        { fullName: { contains: search, mode: 'insensitive' } },
        { whatsappNumber: { contains: search } },
        { email: { contains: search, mode: 'insensitive' } },
      ],
    }),
    ...(segment && segment !== 'ALL' && { segment: segment as any }),
    ...(tag && { tags: { has: tag } }),
    ...(consent === 'OPTED_IN' && { marketingConsentWhatsapp: true, isSuppressed: false }),
    ...(consent === 'OPTED_OUT' && { OR: [{ marketingConsentWhatsapp: false }, { isSuppressed: true }] }),
    ...(branchLocationId && { visits: { some: { branchLocationId } } }),
  };
}

const SORT_FIELDS: Record<string, string> = {
  recent: 'lastVisitAt',
  spend: 'totalSpend',
  visits: 'visitCount',
  points: 'currentPointsBalance',
  name: 'fullName',
  created: 'createdAt',
};

const listHandler = async (req: Request, res: Response): Promise<void> => {
  try {
    const { businessId } = req.tenantContext;
    const page = Math.max(1, Number(req.query.page ?? 1));
    const limit = Math.min(200, Number(req.query.limit ?? 50));
    const [sortKey, sortDir] = String(req.query.sort ?? 'recent:desc').split(':');
    const orderField = SORT_FIELDS[sortKey] ?? 'lastVisitAt';
    const orderBy = { [orderField]: sortDir === 'asc' ? 'asc' : 'desc' } as any;

    const where = buildCustomerWhere(businessId, req.query);

    const [customers, total] = await Promise.all([
      prisma.customer.findMany({
        where,
        orderBy,
        skip: (page - 1) * limit,
        take: limit,
        select: {
          id: true, fullName: true, whatsappNumber: true, email: true, avatarUrl: true,
          segment: true, tags: true, visitCount: true, totalSpend: true, averageOrderValue: true,
          currentPointsBalance: true, currentTierId: true, lastVisitAt: true, firstVisitAt: true,
          createdAt: true, referralCode: true, isStaff: true,
          marketingConsentWhatsapp: true, isSuppressed: true,
        },
      }),
      prisma.customer.count({ where }),
    ]);

    res.status(200).json({
      customers: customers.map((c) => ({ ...c, phone: c.whatsappNumber, pointsBalance: c.currentPointsBalance })),
      total,
      page,
      pages: Math.ceil(total / limit),
    });
  } catch (err) { handleError(err, res); }
};

/** GET /customers/export — streams a CSV of the filtered set (max 50k rows). */
const exportHandler = async (req: Request, res: Response): Promise<void> => {
  try {
    const { businessId } = req.tenantContext;
    const where = buildCustomerWhere(businessId, req.query);

    const customers = await prisma.customer.findMany({
      where,
      orderBy: { totalSpend: 'desc' },
      take: 50_000,
      select: {
        fullName: true, whatsappNumber: true, email: true, segment: true, tags: true,
        visitCount: true, totalSpend: true, averageOrderValue: true, currentPointsBalance: true,
        lastVisitAt: true, firstVisitAt: true, createdAt: true, referralCode: true,
        marketingConsentWhatsapp: true,
      },
    });

    const esc = (v: unknown): string => {
      const s = v == null ? '' : String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const headers = ['Name', 'Phone', 'Email', 'Segment', 'Tags', 'Visits', 'Total Spend', 'Avg Order', 'Points', 'Last Visit', 'First Visit', 'Joined', 'Referral Code', 'WhatsApp Consent'];
    const rows = customers.map((c) => [
      c.fullName, c.whatsappNumber, c.email, c.segment, (c.tags ?? []).join('; '),
      c.visitCount, num(c.totalSpend).toFixed(2), num(c.averageOrderValue).toFixed(2), c.currentPointsBalance,
      c.lastVisitAt?.toISOString().slice(0, 10) ?? '', c.firstVisitAt?.toISOString().slice(0, 10) ?? '',
      c.createdAt.toISOString().slice(0, 10), c.referralCode, c.marketingConsentWhatsapp ? 'Yes' : 'No',
    ].map(esc).join(','));

    const csv = [headers.join(','), ...rows].join('\n');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="customers-${new Date().toISOString().slice(0, 10)}.csv"`);
    res.status(200).send(csv);
  } catch (err) { handleError(err, res); }
};

// ================================================================
//  5. CUSTOMER SEGMENTS — distribution snapshot
// ================================================================

const segmentsHandler = async (req: Request, res: Response): Promise<void> => {
  try {
    const { businessId } = req.tenantContext;
    const breakdown = await prisma.customer.groupBy({
      by: ['segment'],
      where: { businessId, isActive: true },
      _count: { id: true },
      _sum: { totalSpend: true },
    });
    const total = breakdown.reduce((s, b) => s + b._count.id, 0);
    res.status(200).json({
      total,
      segments: breakdown.map((b) => ({
        segment: b.segment,
        count: b._count.id,
        percentage: total > 0 ? Math.round((b._count.id / total) * 100) : 0,
        revenue: num(b._sum.totalSpend),
      })),
    });
  } catch (err) { handleError(err, res); }
};

// ── Saved views ────────────────────────────────────────────────

const SavedViewSchema = z.object({
  name: z.string().min(1).max(60),
  filtersJson: z.record(z.any()),
  isShared: z.boolean().optional(),
});

const listSavedViewsHandler = async (req: Request, res: Response): Promise<void> => {
  try {
    const { businessId, userId } = req.tenantContext;
    const views = await prisma.savedView.findMany({
      where: { businessId, OR: [{ userId }, { isShared: true }] },
      orderBy: { createdAt: 'desc' },
    });
    res.status(200).json({ views });
  } catch (err) { handleError(err, res); }
};

const createSavedViewHandler = async (req: Request, res: Response): Promise<void> => {
  try {
    const { businessId, userId } = req.tenantContext;
    const body = SavedViewSchema.parse(req.body);
    const view = await prisma.savedView.create({
      data: { businessId, userId, name: body.name, filtersJson: body.filtersJson, isShared: body.isShared ?? false },
    });
    res.status(201).json(view);
  } catch (err) { handleError(err, res); }
};

const deleteSavedViewHandler = async (req: Request, res: Response): Promise<void> => {
  try {
    const { businessId, userId } = req.tenantContext;
    await prisma.savedView.deleteMany({ where: { id: req.params.id, businessId, userId } });
    res.status(204).end();
  } catch (err) { handleError(err, res); }
};

// ================================================================
//  2. CUSTOMER PROFILE — full aggregated context
// ================================================================

const profileHandler = async (req: Request, res: Response): Promise<void> => {
  try {
    const { businessId } = req.tenantContext;
    const { id } = req.params;

    const customer = await prisma.customer.findFirst({
      where: { id, businessId },
      include: {
        notes: { orderBy: [{ pinned: 'desc' }, { createdAt: 'desc' }], take: 50 },
      },
    });
    if (!customer) { res.status(404).json({ error: 'CUSTOMER_NOT_FOUND' }); return; }

    const [tier, referralCount, feedbackAgg, lastFeedback] = await Promise.all([
      customer.currentTierId
        ? prisma.loyaltyTier.findUnique({ where: { id: customer.currentTierId }, select: { name: true, rank: true, color: true } })
        : Promise.resolve(null),
      prisma.customer.count({ where: { businessId, referredByCode: customer.referralCode } }),
      prisma.feedbackResponse.aggregate({ where: { businessId, customerId: id }, _avg: { score: true }, _count: { id: true } }),
      prisma.feedbackResponse.findFirst({ where: { businessId, customerId: id }, orderBy: { createdAt: 'desc' } }),
    ]);

    const prefs = (customer.preferencesJson as any) ?? {};
    res.status(200).json({
      id: customer.id,
      fullName: customer.fullName,
      phone: customer.whatsappNumber,
      email: customer.email,
      birthday: customer.birthday,
      gender: customer.gender,
      address: customer.address,
      avatarUrl: customer.avatarUrl,
      segment: customer.segment,
      tags: customer.tags ?? [],
      preferences: prefs.preferences ?? {},
      favouriteProducts: prefs.favouriteProducts ?? [],
      social: prefs.social ?? {},
      membership: {
        tier: tier?.name ?? null,
        tierRank: tier?.rank ?? null,
        tierColor: tier?.color ?? null,
        pointsBalance: customer.currentPointsBalance,
        walletBalance: num(customer.currentWalletBalance),
      },
      consent: {
        whatsapp: customer.marketingConsentWhatsapp,
        email: customer.marketingConsentEmail,
        sms: customer.marketingConsentSms,
        suppressed: customer.isSuppressed,
      },
      sentiment: {
        label: customer.latestSentimentLabel,
        score: customer.latestSentimentScore,
        at: customer.latestSentimentAt,
      },
      referral: { code: customer.referralCode, referredByCode: customer.referredByCode, referredCount: referralCount },
      reviews: { count: feedbackAgg._count.id, avgScore: feedbackAgg._avg.score ? Math.round(num(feedbackAgg._avg.score) * 10) / 10 : null, lastScore: lastFeedback?.score ?? null },
      notes: customer.notes,
      firstVisitAt: customer.firstVisitAt,
      lastVisitAt: customer.lastVisitAt,
      visitCount: customer.visitCount,
      totalSpend: num(customer.totalSpend),
      createdAt: customer.createdAt,
    });
  } catch (err) { handleError(err, res); }
};

// ── Tags + enrichment ──────────────────────────────────────────

const TagsSchema = z.object({ tags: z.array(z.string().min(1).max(40)).max(30) });

const updateTagsHandler = async (req: Request, res: Response): Promise<void> => {
  try {
    const { businessId } = req.tenantContext;
    const { tags } = TagsSchema.parse(req.body);
    const normalized = Array.from(new Set(tags.map((t) => t.trim()).filter(Boolean)));
    const result = await prisma.customer.updateMany({ where: { id: req.params.id, businessId }, data: { tags: normalized } });
    if (result.count === 0) { res.status(404).json({ error: 'CUSTOMER_NOT_FOUND' }); return; }
    res.status(200).json({ tags: normalized });
  } catch (err) { handleError(err, res); }
};

const EnrichmentSchema = z.object({
  preferences: z.record(z.any()).optional(),
  favouriteProducts: z.array(z.string()).optional(),
  social: z.record(z.string()).optional(),
});

const updateEnrichmentHandler = async (req: Request, res: Response): Promise<void> => {
  try {
    const { businessId } = req.tenantContext;
    const body = EnrichmentSchema.parse(req.body);
    const existing = await prisma.customer.findFirst({ where: { id: req.params.id, businessId }, select: { preferencesJson: true } });
    if (!existing) { res.status(404).json({ error: 'CUSTOMER_NOT_FOUND' }); return; }
    const current = (existing.preferencesJson as any) ?? {};
    const merged = {
      preferences: body.preferences ?? current.preferences ?? {},
      favouriteProducts: body.favouriteProducts ?? current.favouriteProducts ?? [],
      social: body.social ?? current.social ?? {},
    };
    await prisma.customer.update({ where: { id: req.params.id }, data: { preferencesJson: merged } });
    res.status(200).json(merged);
  } catch (err) { handleError(err, res); }
};

// ── Notes ──────────────────────────────────────────────────────

const NoteSchema = z.object({ body: z.string().min(1).max(2000), pinned: z.boolean().optional() });

const addNoteHandler = async (req: Request, res: Response): Promise<void> => {
  try {
    const { businessId, userId } = req.tenantContext;
    const { id } = req.params;
    const { body, pinned } = NoteSchema.parse(req.body);

    const customer = await prisma.customer.findFirst({ where: { id, businessId }, select: { id: true } });
    if (!customer) { res.status(404).json({ error: 'CUSTOMER_NOT_FOUND' }); return; }

    const author = await prisma.user.findUnique({ where: { id: userId }, select: { name: true } }).catch(() => null);
    const note = await prisma.customerNote.create({
      data: { businessId, customerId: id, authorUserId: userId, authorName: author?.name ?? 'Staff', body, pinned: pinned ?? false },
    });
    res.status(201).json(note);
  } catch (err) { handleError(err, res); }
};

const deleteNoteHandler = async (req: Request, res: Response): Promise<void> => {
  try {
    const { businessId } = req.tenantContext;
    await prisma.customerNote.deleteMany({ where: { id: req.params.noteId, businessId, customerId: req.params.id } });
    res.status(204).end();
  } catch (err) { handleError(err, res); }
};

// ── Manual points adjustment ───────────────────────────────────

const PointsSchema = z.object({
  points: z.number().int().positive().max(1_000_000),
  direction: z.enum(['CREDIT', 'DEBIT']).default('CREDIT'),
  reason: z.string().max(120).optional(),
});

/** POST /customers/:id/points — owner manually grants or removes points. */
const adjustPointsHandler = async (req: Request, res: Response): Promise<void> => {
  try {
    const { businessId } = req.tenantContext;
    const { id } = req.params;
    const { points, direction, reason } = PointsSchema.parse(req.body);

    const customer = await prisma.customer.findFirst({ where: { id, businessId }, select: { id: true } });
    if (!customer) { res.status(404).json({ error: 'CUSTOMER_NOT_FOUND' }); return; }

    const { creditPoints, debitPoints } = await import('../services/loyalty-service');
    const label = `MANUAL_ADJUSTMENT${reason ? `: ${reason}` : ''}`;
    try {
      const newBalance = await prisma.$transaction((tx) =>
        direction === 'DEBIT'
          ? debitPoints(tx, businessId, id, points, label, undefined, 'ManualAdjustment')
          : creditPoints(tx, businessId, id, points, label, undefined, 'ManualAdjustment'),
      );
      res.status(200).json({ ok: true, direction, points, newBalance });
    } catch (e) {
      if ((e as Error).message === 'INSUFFICIENT_POINTS_BALANCE') {
        res.status(409).json({ error: 'INSUFFICIENT_POINTS_BALANCE' });
        return;
      }
      throw e;
    }
  } catch (err) { handleError(err, res); }
};

// ================================================================
//  4. CUSTOMER FINANCIALS — spend, AOV, CLV, predicted CLV, share
// ================================================================

const financialsHandler = async (req: Request, res: Response): Promise<void> => {
  try {
    const { businessId } = req.tenantContext;
    const { id } = req.params;

    const customer = await prisma.customer.findFirst({
      where: { id, businessId },
      select: { totalSpend: true, visitCount: true, firstVisitAt: true, lastVisitAt: true, segment: true },
    });
    if (!customer) { res.status(404).json({ error: 'CUSTOMER_NOT_FOUND' }); return; }

    const [bizRevenue, last90] = await Promise.all([
      prisma.visit.aggregate({ where: { businessId }, _sum: { amountSpent: true } }),
      prisma.visit.aggregate({ where: { businessId, customerId: id, visitedAt: { gte: new Date(Date.now() - 90 * DAY_MS) } }, _sum: { amountSpent: true }, _count: { id: true } }),
    ]);

    const totalSpend = num(customer.totalSpend);
    const visits = customer.visitCount || 0;
    const avgOrderValue = visits > 0 ? totalSpend / visits : 0;

    // Visit frequency: visits per month since first visit (min 1 month).
    const firstVisit = customer.firstVisitAt ?? customer.lastVisitAt;
    const monthsActive = firstVisit ? Math.max(1, (Date.now() - new Date(firstVisit).getTime()) / (30 * DAY_MS)) : 1;
    const visitsPerMonth = visits / monthsActive;

    // Predicted CLV: project the next 24 months of value, discounted by churn risk
    // (segment-derived survival probability). Grounded, explainable, no black box.
    const survival: Record<string, number> = { VIP: 0.9, BIG_SPENDER: 0.85, LOYAL: 0.8, NEW: 0.6, COUPON_HUNTER: 0.5, AT_RISK: 0.3, LOST: 0.1 };
    const retention = survival[customer.segment] ?? 0.6;
    const projectedMonthly = avgOrderValue * visitsPerMonth * retention;
    const predictedClv = Math.round((totalSpend + projectedMonthly * 24) * 100) / 100;

    const businessRevenue = num(bizRevenue._sum.amountSpent);
    const revenueContribution = businessRevenue > 0 ? Math.round((totalSpend / businessRevenue) * 1000) / 10 : 0;

    res.status(200).json({
      totalSpend: Math.round(totalSpend * 100) / 100,
      averageOrderValue: Math.round(avgOrderValue * 100) / 100,
      visitCount: visits,
      visitsPerMonth: Math.round(visitsPerMonth * 100) / 100,
      lifetimeValue: Math.round(totalSpend * 100) / 100,
      predictedClv,
      revenueContribution, // percentage of total business revenue
      last90Spend: num(last90._sum.amountSpent),
      last90Visits: last90._count.id,
      retentionProbability: retention,
    });
  } catch (err) { handleError(err, res); }
};

// ================================================================
//  3. CUSTOMER TIMELINE — unified chronological feed
// ================================================================

interface TimelineEvent {
  type: string;
  at: Date;
  title: string;
  detail?: string;
  meta?: Record<string, unknown>;
}

const timelineHandler = async (req: Request, res: Response): Promise<void> => {
  try {
    const { businessId } = req.tenantContext;
    const { id } = req.params;
    const limit = Math.min(200, Number(req.query.limit ?? 80));

    const customer = await prisma.customer.findFirst({ where: { id, businessId }, select: { id: true, createdAt: true, fullName: true } });
    if (!customer) { res.status(404).json({ error: 'CUSTOMER_NOT_FOUND' }); return; }

    const [visits, messages, ledger, tierHist, segHist, feedback, notes, consent] = await Promise.all([
      prisma.visit.findMany({ where: { businessId, customerId: id }, orderBy: { visitedAt: 'desc' }, take: 50, select: { id: true, amountSpent: true, pointsEarned: true, visitedAt: true, source: true, attributedCampaignId: true } }),
      prisma.messageQueue.findMany({ where: { businessId, customerId: id }, orderBy: { createdAt: 'desc' }, take: 50, select: { id: true, status: true, channel: true, createdAt: true, templateName: true, campaignId: true } }),
      prisma.rewardPointsLedger.findMany({ where: { businessId, customerId: id }, orderBy: { createdAt: 'desc' }, take: 50, select: { id: true, type: true, points: true, reason: true, balanceAfter: true, createdAt: true } }),
      prisma.customerTierHistory.findMany({ where: { businessId, customerId: id }, orderBy: { changedAt: 'desc' }, take: 20, include: { tier: { select: { name: true } } } }),
      prisma.customerSegmentHistory.findMany({ where: { businessId, customerId: id }, orderBy: { changedAt: 'desc' }, take: 20 }),
      prisma.feedbackResponse.findMany({ where: { businessId, customerId: id }, orderBy: { createdAt: 'desc' }, take: 20 }),
      prisma.customerNote.findMany({ where: { businessId, customerId: id }, orderBy: { createdAt: 'desc' }, take: 30 }),
      prisma.consentChangeLog.findMany({ where: { businessId, customerId: id }, orderBy: { createdAt: 'desc' }, take: 20 }),
    ]);

    const events: TimelineEvent[] = [];

    for (const v of visits) {
      events.push({ type: 'VISIT', at: v.visitedAt, title: `Visit · £${num(v.amountSpent).toFixed(2)}`, detail: `${v.pointsEarned} pts earned${v.source ? ` · ${v.source.replace(/_/g, ' ').toLowerCase()}` : ''}`, meta: { amount: num(v.amountSpent), attributedCampaignId: v.attributedCampaignId } });
    }
    for (const m of messages) {
      events.push({ type: 'MESSAGE', at: m.createdAt, title: `Message ${m.campaignId ? '(campaign)' : ''} · ${m.status}`, detail: m.templateName ?? m.channel, meta: { status: m.status, campaignId: m.campaignId } });
    }
    for (const l of ledger) {
      const sign = l.type === 'CREDIT' ? '+' : '-';
      events.push({ type: 'POINTS', at: l.createdAt, title: `${sign}${l.points} points · ${l.reason}`, detail: `Balance: ${l.balanceAfter}`, meta: { type: l.type, points: l.points } });
    }
    for (const t of tierHist) {
      events.push({ type: 'TIER', at: t.changedAt, title: `Tier → ${t.tier?.name ?? 'Updated'}`, detail: t.reason ?? undefined });
    }
    for (const s of segHist) {
      events.push({ type: 'SEGMENT', at: s.changedAt, title: `Segment → ${s.toSegment}`, detail: s.fromSegment ? `from ${s.fromSegment}` : s.reason ?? undefined });
    }
    for (const f of feedback) {
      events.push({ type: 'REVIEW', at: f.createdAt, title: `Rated ${f.score}/5`, detail: f.comment ?? undefined, meta: { score: f.score } });
    }
    for (const n of notes) {
      events.push({ type: 'NOTE', at: n.createdAt, title: `Note by ${n.authorName ?? 'Staff'}`, detail: n.body, meta: { pinned: n.pinned } });
    }
    for (const c of consent) {
      events.push({ type: 'CONSENT', at: c.createdAt, title: `${c.channel} consent → ${c.toValue ? 'opted in' : 'opted out'}`, detail: c.triggerType });
    }
    events.push({ type: 'JOINED', at: customer.createdAt, title: 'Customer joined', detail: 'First added to your CRM' });

    events.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());

    res.status(200).json({ events: events.slice(0, limit) });
  } catch (err) { handleError(err, res); }
};

// ================================================================
//  6. REVIEWS & REFERRALS
// ================================================================

const referralsHandler = async (req: Request, res: Response): Promise<void> => {
  try {
    const { businessId } = req.tenantContext;
    const { id } = req.params;

    const customer = await prisma.customer.findFirst({ where: { id, businessId }, select: { referralCode: true, referredByCode: true } });
    if (!customer) { res.status(404).json({ error: 'CUSTOMER_NOT_FOUND' }); return; }

    const referred = await prisma.customer.findMany({
      where: { businessId, referredByCode: customer.referralCode },
      select: { id: true, fullName: true, totalSpend: true, createdAt: true, segment: true },
      orderBy: { createdAt: 'desc' },
    });

    // Referral revenue = total spend driven by the people this customer referred.
    const referralRevenue = referred.reduce((s, r) => s + num(r.totalSpend), 0);

    // Who referred THIS customer (if anyone)?
    const referrer = customer.referredByCode
      ? await prisma.customer.findFirst({ where: { businessId, referralCode: customer.referredByCode }, select: { id: true, fullName: true } })
      : null;

    res.status(200).json({
      referralCode: customer.referralCode,
      referrer,
      referredCount: referred.length,
      referralRevenue: Math.round(referralRevenue * 100) / 100,
      referred: referred.map((r) => ({ ...r, totalSpend: num(r.totalSpend) })),
    });
  } catch (err) { handleError(err, res); }
};

const reviewsHandler = async (req: Request, res: Response): Promise<void> => {
  try {
    const { businessId } = req.tenantContext;
    const { id } = req.params;
    const reviews = await prisma.feedbackResponse.findMany({
      where: { businessId, customerId: id },
      orderBy: { createdAt: 'desc' },
      take: 50,
      select: { id: true, score: true, comment: true, channel: true, createdAt: true },
    });
    const avg = reviews.length ? reviews.reduce((s, r) => s + r.score, 0) / reviews.length : null;
    res.status(200).json({ reviews, count: reviews.length, avgScore: avg ? Math.round(avg * 10) / 10 : null });
  } catch (err) { handleError(err, res); }
};

// ================================================================
//  ROUTER
// ================================================================

export const customersRouter = Router();
customersRouter.use(tenantScope as any);

// Database
customersRouter.get('/', requireRoles(...ROLES) as any, listHandler);
customersRouter.get('/export', requireRoles(Role.TENANT_OWNER, Role.BRANCH_MANAGER) as any, exportHandler);
customersRouter.get('/segments', requireRoles(...ROLES) as any, segmentsHandler);

// Saved views
customersRouter.get('/saved-views', requireRoles(...ROLES) as any, listSavedViewsHandler);
customersRouter.post('/saved-views', requireRoles(...ROLES) as any, createSavedViewHandler);
customersRouter.delete('/saved-views/:id', requireRoles(...ROLES) as any, deleteSavedViewHandler);

// Profile + submodules
customersRouter.get('/:id', requireRoles(...ROLES) as any, profileHandler);
customersRouter.get('/:id/timeline', requireRoles(...ROLES) as any, timelineHandler);
customersRouter.get('/:id/financials', requireRoles(...ROLES) as any, financialsHandler);
customersRouter.get('/:id/referrals', requireRoles(...ROLES) as any, referralsHandler);
customersRouter.get('/:id/reviews', requireRoles(...ROLES) as any, reviewsHandler);
customersRouter.patch('/:id/tags', requireRoles(...ROLES) as any, updateTagsHandler);
customersRouter.patch('/:id/enrichment', requireRoles(...ROLES) as any, updateEnrichmentHandler);
customersRouter.post('/:id/notes', requireRoles(...ROLES) as any, addNoteHandler);
customersRouter.delete('/:id/notes/:noteId', requireRoles(...ROLES) as any, deleteNoteHandler);
customersRouter.post('/:id/points', requireRoles(Role.TENANT_OWNER, Role.BRANCH_MANAGER) as any, adjustPointsHandler);
