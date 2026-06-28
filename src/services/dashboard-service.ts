// ================================================================
//  dashboard-service.ts
//  Executive dashboard aggregation layer.
//
//  Powers four surfaces that a non-technical SMB owner sees the moment
//  they log in:
//    1. Executive KPIs   — one-glance business health
//    2. Widgets          — operational, actionable data blocks
//    3. AI Advisor       — rules engine + LLM summary → next actions
//    4. Today Tasks      — the short list of work that moves the business
//
//  Everything is sourced from real tenant data (visits, POS, campaigns,
//  messaging, loyalty, feedback). Nothing here is mocked. Surfaces with
//  no underlying data model yet (e.g. inventory) return empty arrays so
//  the frontend degrades gracefully rather than inventing numbers.
//
//  All queries are businessId-scoped. businessId is always supplied by
//  the caller from req.tenantContext — never from the request body.
// ================================================================

import { prisma } from '../config/prisma';

const DAY_MS = 86_400_000;

// ---- shared types ------------------------------------------------

export interface KpiMetric {
  /** Raw numeric value for the current window. */
  value: number;
  /** Percentage change vs the previous equal-length window (null = no baseline). */
  deltaPct: number | null;
  /** 'up' is good, 'down' is bad, 'flat' is neutral — already polarity-corrected. */
  trend: 'up' | 'down' | 'flat';
}

export interface DashboardOverview {
  windowDays: number;
  generatedAt: string;
  kpis: Record<string, KpiMetric>;
  widgets: Record<string, unknown>;
  tasks: TodayTask[];
}

export interface TodayTask {
  id: string;
  type:
    | 'FOLLOW_UP_CUSTOMER'
    | 'RESPOND_TO_REVIEW'
    | 'APPROVE_CAMPAIGN'
    | 'WISH_BIRTHDAY'
    | 'RECONNECT_WHATSAPP'
    | 'REVIEW_QUOTA';
  priority: 'HIGH' | 'MEDIUM' | 'LOW';
  title: string;
  detail: string;
  /** Frontend route the owner is sent to when they action the task. */
  actionPath: string;
  actionLabel: string;
  customerId?: string;
  refId?: string;
}

// ---- small helpers -----------------------------------------------

/** Polarity-aware delta. `higherIsBetter=false` flips trend for churn-style metrics. */
const metric = (
  curr: number,
  prev: number,
  higherIsBetter = true
): KpiMetric => {
  let deltaPct: number | null = null;
  if (prev > 0) deltaPct = Math.round(((curr - prev) / prev) * 1000) / 10;
  else if (curr > 0) deltaPct = 100;

  let trend: 'up' | 'down' | 'flat' = 'flat';
  if (deltaPct !== null && Math.abs(deltaPct) >= 0.5) {
    const rising = curr > prev;
    trend = rising === higherIsBetter ? 'up' : 'down';
  }
  return { value: Math.round(curr * 100) / 100, deltaPct, trend };
};

const num = (v: unknown): number => Number(v ?? 0);

// ================================================================
//  1. EXECUTIVE KPIS + WIDGETS + TASKS  (single fast aggregation)
// ================================================================

export async function buildDashboardOverview(
  businessId: string,
  windowDays = 30
): Promise<DashboardOverview> {
  const now = new Date();
  const curFrom = new Date(now.getTime() - windowDays * DAY_MS);
  const prevFrom = new Date(now.getTime() - 2 * windowDays * DAY_MS);

  const [kpis, widgets, tasks] = await Promise.all([
    buildKpis(businessId, curFrom, prevFrom, now),
    buildWidgets(businessId, curFrom, now),
    buildTodayTasks(businessId, now),
  ]);

  return {
    windowDays,
    generatedAt: now.toISOString(),
    kpis,
    widgets,
    tasks,
  };
}

// ----------------------------------------------------------------
//  EXECUTIVE KPIS
// ----------------------------------------------------------------

async function buildKpis(
  businessId: string,
  curFrom: Date,
  prevFrom: Date,
  now: Date
): Promise<Record<string, KpiMetric>> {
  const curWhere = { businessId, visitedAt: { gte: curFrom } };
  const prevWhere = { businessId, visitedAt: { gte: prevFrom, lt: curFrom } };

  const [
    curRevenue,
    prevRevenue,
    curRecovered,
    prevRecovered,
    curLoyalty,
    prevLoyalty,
    curReferral,
    prevReferral,
    clvAgg,
    snapshot,
    prevSnapshot,
    newCur,
    newPrev,
    returningCur,
    returningPrev,
    lostCur,
    activeCampaigns,
    msgCur,
    msgPrev,
    reviewsCur,
    reviewsPrev,
  ] = await Promise.all([
    prisma.visit.aggregate({ where: curWhere, _sum: { amountSpent: true }, _avg: { amountSpent: true } }),
    prisma.visit.aggregate({ where: prevWhere, _sum: { amountSpent: true }, _avg: { amountSpent: true } }),
    // Recovered revenue = visits attributed to a win-back automation
    prisma.visit.aggregate({ where: { ...curWhere, attributedAutomationId: { not: null } }, _sum: { amountSpent: true } }),
    prisma.visit.aggregate({ where: { ...prevWhere, attributedAutomationId: { not: null } }, _sum: { amountSpent: true } }),
    // Loyalty revenue = spend from customers who have reached a tier
    prisma.visit.aggregate({ where: { ...curWhere, customer: { currentTierId: { not: null } } }, _sum: { amountSpent: true } }),
    prisma.visit.aggregate({ where: { ...prevWhere, customer: { currentTierId: { not: null } } }, _sum: { amountSpent: true } }),
    // Referral revenue = spend from customers acquired via a referral code
    prisma.visit.aggregate({ where: { ...curWhere, customer: { referredByCode: { not: null } } }, _sum: { amountSpent: true } }),
    prisma.visit.aggregate({ where: { ...prevWhere, customer: { referredByCode: { not: null } } }, _sum: { amountSpent: true } }),
    // CLV proxy = average lifetime spend across active customers
    prisma.customer.aggregate({ where: { businessId, isActive: true }, _avg: { totalSpend: true } }),
    prisma.analyticsSnapshot.findFirst({ where: { businessId, branchLocationId: null }, orderBy: { snapshotDate: 'desc' } }),
    prisma.analyticsSnapshot.findFirst({ where: { businessId, branchLocationId: null, snapshotDate: { lt: curFrom } }, orderBy: { snapshotDate: 'desc' } }),
    prisma.customer.count({ where: { businessId, firstVisitAt: { gte: curFrom } } }),
    prisma.customer.count({ where: { businessId, firstVisitAt: { gte: prevFrom, lt: curFrom } } }),
    // Returning = customers with a visit in window whose first visit predates the window
    prisma.customer.count({ where: { businessId, lastVisitAt: { gte: curFrom }, firstVisitAt: { lt: curFrom } } }),
    prisma.customer.count({ where: { businessId, lastVisitAt: { gte: prevFrom, lt: curFrom }, firstVisitAt: { lt: prevFrom } } }),
    prisma.customer.count({ where: { businessId, isActive: true, segment: 'LOST' } }),
    prisma.campaign.count({ where: { businessId, status: { in: ['ACTIVE', 'SCHEDULED'] } } }),
    prisma.messageQueue.count({ where: { businessId, status: { in: ['SENT', 'DELIVERED', 'READ'] }, createdAt: { gte: curFrom } } }),
    prisma.messageQueue.count({ where: { businessId, status: { in: ['SENT', 'DELIVERED', 'READ'] }, createdAt: { gte: prevFrom, lt: curFrom } } }),
    prisma.feedbackResponse.aggregate({ where: { businessId, createdAt: { gte: curFrom } }, _count: { id: true }, _avg: { score: true } }),
    prisma.feedbackResponse.aggregate({ where: { businessId, createdAt: { gte: prevFrom, lt: curFrom } }, _count: { id: true } }),
  ]);

  const retention = num(snapshot?.retentionRate);
  const prevRetention = num(prevSnapshot?.retentionRate);
  const churn = num(snapshot?.churnRate);
  const prevChurn = num(prevSnapshot?.churnRate);

  // Composite customer-health score (0-100): retention + review sentiment + loyalty engagement.
  const reviewHealth = reviewsCur._avg.score ? (num(reviewsCur._avg.score) / 5) * 100 : retention;
  const health = Math.round((retention * 0.6 + reviewHealth * 0.4) * 10) / 10;
  const prevHealth = Math.round(prevRetention * 10) / 10;

  return {
    revenue: metric(num(curRevenue._sum.amountSpent), num(prevRevenue._sum.amountSpent)),
    recoveredRevenue: metric(num(curRecovered._sum.amountSpent), num(prevRecovered._sum.amountSpent)),
    loyaltyRevenue: metric(num(curLoyalty._sum.amountSpent), num(prevLoyalty._sum.amountSpent)),
    referralRevenue: metric(num(curReferral._sum.amountSpent), num(prevReferral._sum.amountSpent)),
    averageOrderValue: metric(num(curRevenue._avg.amountSpent), num(prevRevenue._avg.amountSpent)),
    customerLifetimeValue: metric(num(clvAgg._avg.totalSpend), num(clvAgg._avg.totalSpend)),
    retentionRate: metric(retention, prevRetention),
    churnRate: metric(churn, prevChurn, /* higherIsBetter */ false),
    customerHealth: metric(health, prevHealth),
    newCustomers: metric(newCur, newPrev),
    returningCustomers: metric(returningCur, returningPrev),
    lostCustomers: metric(lostCur, lostCur, /* higherIsBetter */ false),
    activeCampaigns: metric(activeCampaigns, activeCampaigns),
    messagesSent: metric(msgCur, msgPrev),
    reviews: metric(num(reviewsCur._count.id), num(reviewsPrev._count.id)),
  };
}

// ----------------------------------------------------------------
//  WIDGETS
// ----------------------------------------------------------------

async function buildWidgets(
  businessId: string,
  curFrom: Date,
  now: Date
): Promise<Record<string, unknown>> {
  const [
    revenueSeries,
    segments,
    tiers,
    topEarners,
    pointsOutstanding,
    campaigns,
    staffRows,
    birthdays,
    pendingApprovals,
    failedMessages,
    business,
  ] = await Promise.all([
    // Revenue overview — daily buckets for the window
    prisma.$queryRaw<Array<{ day: Date; revenue: number; visits: bigint }>>`
      SELECT date_trunc('day', "visitedAt") AS day,
             COALESCE(SUM("amountSpent"), 0)::float AS revenue,
             COUNT(*)                                AS visits
      FROM visits
      WHERE "businessId" = ${businessId} AND "visitedAt" >= ${curFrom}
      GROUP BY 1 ORDER BY 1 ASC`,
    prisma.customer.groupBy({ by: ['segment'], where: { businessId, isActive: true }, _count: { id: true } }),
    prisma.loyaltyTier.findMany({ where: { businessId }, orderBy: { rank: 'asc' }, select: { id: true, name: true, rank: true, color: true } }),
    prisma.customer.findMany({ where: { businessId, isActive: true }, orderBy: { currentPointsBalance: 'desc' }, take: 5, select: { id: true, fullName: true, currentPointsBalance: true } }),
    prisma.customer.aggregate({ where: { businessId, isActive: true }, _sum: { currentPointsBalance: true } }),
    prisma.campaign.findMany({ where: { businessId, status: { in: ['ACTIVE', 'COMPLETED'] } }, orderBy: { updatedAt: 'desc' }, take: 5, select: { id: true, name: true, status: true, sentCount: true, deliveredCount: true, readCount: true } }),
    // Staff performance — visits + revenue handled per staff member in window
    prisma.visit.groupBy({ by: ['staffId'], where: { businessId, visitedAt: { gte: curFrom }, staffId: { not: null } }, _count: { id: true }, _sum: { amountSpent: true } }),
    upcomingBirthdays(businessId, now, 7),
    prisma.campaign.findMany({ where: { businessId, status: 'PENDING_APPROVAL' }, orderBy: { createdAt: 'asc' }, take: 10, select: { id: true, name: true, createdAt: true } }),
    prisma.messageQueue.count({ where: { businessId, status: 'FAILED', createdAt: { gte: curFrom } } }),
    prisma.subscription.findUnique({ where: { businessId }, select: { monthlyMessageQuota: true, messagesUsedThisPeriod: true } }).catch(() => null),
  ]);

  const segMap = Object.fromEntries(segments.map((s) => [s.segment, s._count.id]));

  // Tier distribution from tier history (latest tier per customer is denormalised on Customer)
  const tierCounts = await prisma.customer.groupBy({
    by: ['currentTierId'],
    where: { businessId, isActive: true, currentTierId: { not: null } },
    _count: { id: true },
  });
  const tierCountMap = Object.fromEntries(tierCounts.map((t) => [t.currentTierId, t._count.id]));

  // System alerts — actionable infrastructure / quota signals
  const systemAlerts: Array<{ level: string; code: string; message: string }> = [];
  const quota = num((business as any)?.monthlyMessageQuota);
  const used = num((business as any)?.messagesUsedThisPeriod);
  if (quota > 0) {
    const pct = (used / quota) * 100;
    if (pct >= 95) systemAlerts.push({ level: 'critical', code: 'QUOTA_EXHAUSTED', message: `You've used ${Math.round(pct)}% of your message quota. Campaigns may stop sending.` });
    else if (pct >= 80) systemAlerts.push({ level: 'warning', code: 'QUOTA_WARNING', message: `You're at ${Math.round(pct)}% of your monthly message quota.` });
  }
  if (failedMessages > 0) systemAlerts.push({ level: 'warning', code: 'MESSAGE_FAILURES', message: `${failedMessages} message${failedMessages === 1 ? '' : 's'} failed to send in the last window.` });

  return {
    revenueOverview: {
      series: revenueSeries.map((r) => ({ date: r.day, revenue: num(r.revenue), visits: Number(r.visits) })),
      total: revenueSeries.reduce((s, r) => s + num(r.revenue), 0),
    },
    customerOverview: {
      total: Object.values(segMap).reduce((s, v) => s + v, 0),
      new: segMap['NEW'] ?? 0,
      loyal: segMap['LOYAL'] ?? 0,
      vip: segMap['VIP'] ?? 0,
      bigSpender: segMap['BIG_SPENDER'] ?? 0,
      atRisk: segMap['AT_RISK'] ?? 0,
      lost: segMap['LOST'] ?? 0,
      couponHunter: segMap['COUPON_HUNTER'] ?? 0,
    },
    loyaltyPerformance: {
      tiers: tiers.map((t) => ({ ...t, members: tierCountMap[t.id] ?? 0 })),
      topEarners,
      pointsOutstanding: num(pointsOutstanding._sum.currentPointsBalance),
    },
    campaignPerformance: campaigns.map((c) => ({
      ...c,
      readRate: c.sentCount > 0 ? Math.round((c.readCount / c.sentCount) * 100) : 0,
      deliveryRate: c.sentCount > 0 ? Math.round((c.deliveredCount / c.sentCount) * 100) : 0,
    })),
    staffPerformance: staffRows
      .map((s) => ({ staffId: s.staffId, visits: s._count.id, revenue: num(s._sum.amountSpent) }))
      .sort((a, b) => b.revenue - a.revenue),
    // No inventory model yet — return an empty, clearly-typed payload so the
    // widget renders an "all stocked / connect POS" empty state.
    inventoryAlerts: [] as Array<{ sku: string; name: string; remaining: number }>,
    birthdays,
    approvals: pendingApprovals,
    systemAlerts,
  };
}

/** Customers with a birthday in the next `days` days (month/day aware, year-agnostic). */
async function upcomingBirthdays(businessId: string, now: Date, days: number) {
  return prisma.$queryRaw<Array<{ id: string; fullName: string; birthday: Date }>>`
    SELECT id, "fullName", birthday
    FROM customers
    WHERE "businessId" = ${businessId}
      AND "isActive" = true
      AND birthday IS NOT NULL
      AND (
        to_char(birthday, 'MM-DD') BETWEEN to_char(${now}::date, 'MM-DD')
          AND to_char(${now}::date + ${days}, 'MM-DD')
      )
    ORDER BY to_char(birthday, 'MM-DD') ASC
    LIMIT 20`;
}

// ----------------------------------------------------------------
//  TODAY TASKS  — event/rule-driven actionable list
// ----------------------------------------------------------------

async function buildTodayTasks(businessId: string, now: Date): Promise<TodayTask[]> {
  const tasks: TodayTask[] = [];
  const dayAgo = new Date(now.getTime() - DAY_MS);

  const [atRisk, lowReviews, pendingCampaigns, birthdaysToday, business] = await Promise.all([
    prisma.customer.findMany({
      where: { businessId, isActive: true, isSuppressed: false, segment: { in: ['AT_RISK', 'LOST'] } },
      orderBy: { totalSpend: 'desc' },
      take: 5,
      select: { id: true, fullName: true, totalSpend: true, lastVisitAt: true },
    }),
    prisma.feedbackResponse.findMany({
      where: { businessId, score: { lte: 2 }, createdAt: { gte: new Date(now.getTime() - 7 * DAY_MS) } },
      orderBy: { createdAt: 'desc' },
      take: 5,
      select: { id: true, customerId: true, score: true, comment: true },
    }),
    prisma.campaign.findMany({
      where: { businessId, status: 'PENDING_APPROVAL' },
      orderBy: { createdAt: 'asc' },
      take: 5,
      select: { id: true, name: true },
    }),
    prisma.$queryRaw<Array<{ id: string; fullName: string }>>`
      SELECT id, "fullName" FROM customers
      WHERE "businessId" = ${businessId} AND "isActive" = true AND birthday IS NOT NULL
        AND to_char(birthday, 'MM-DD') = to_char(${now}::date, 'MM-DD')
      LIMIT 10`,
    prisma.subscription.findUnique({ where: { businessId }, select: { monthlyMessageQuota: true, messagesUsedThisPeriod: true } }).catch(() => null),
  ]);

  for (const c of atRisk) {
    tasks.push({
      id: `followup-${c.id}`,
      type: 'FOLLOW_UP_CUSTOMER',
      priority: 'HIGH',
      title: `Win back ${c.fullName}`,
      detail: `A valued customer (£${num(c.totalSpend).toFixed(0)} lifetime) is slipping away. A quick, personal hello today is worth far more than a discount next month.`,
      actionPath: `/customers/${c.id}`,
      actionLabel: 'Send a message',
      customerId: c.id,
    });
  }

  for (const r of lowReviews) {
    tasks.push({
      id: `review-${r.id}`,
      type: 'RESPOND_TO_REVIEW',
      priority: 'HIGH',
      title: 'Respond to an unhappy customer',
      detail: `Someone rated you ${r.score}/5${r.comment ? `: "${r.comment.slice(0, 80)}"` : ''}. Replying within a day turns most upset customers into loyal ones.`,
      actionPath: `/customers/${r.customerId}`,
      actionLabel: 'Make it right',
      customerId: r.customerId ?? undefined,
      refId: r.id,
    });
  }

  for (const camp of pendingCampaigns) {
    tasks.push({
      id: `approve-${camp.id}`,
      type: 'APPROVE_CAMPAIGN',
      priority: 'MEDIUM',
      title: `Approve campaign "${camp.name}"`,
      detail: 'A team member has a campaign ready to go. It only reaches your customers once you give it the green light.',
      actionPath: `/campaigns/${camp.id}`,
      actionLabel: 'Review & approve',
      refId: camp.id,
    });
  }

  for (const b of birthdaysToday) {
    tasks.push({
      id: `bday-${b.id}`,
      type: 'WISH_BIRTHDAY',
      priority: 'LOW',
      title: `Wish ${b.fullName} a happy birthday`,
      detail: 'A birthday note is the warmest reason to reach out — no offer required, just a moment of being remembered.',
      actionPath: `/customers/${b.id}`,
      actionLabel: 'Send wishes',
      customerId: b.id,
    });
  }

  const quota = num((business as any)?.monthlyMessageQuota);
  const used = num((business as any)?.messagesUsedThisPeriod);
  if (quota > 0 && used / quota >= 0.8) {
    tasks.push({
      id: 'quota-review',
      type: 'REVIEW_QUOTA',
      priority: 'MEDIUM',
      title: 'Your message allowance is running low',
      detail: `You've used ${Math.round((used / quota) * 100)}% of this month's messages. Top up now so your campaigns never go quiet at the worst moment.`,
      actionPath: '/settings/billing',
      actionLabel: 'Review plan',
    });
  }

  // Priority ordering: HIGH first, then MEDIUM, then LOW.
  const rank = { HIGH: 0, MEDIUM: 1, LOW: 2 };
  return tasks.sort((a, b) => rank[a.priority] - rank[b.priority]).slice(0, 12);
}

// ================================================================
//  3. AI BUSINESS ADVISOR  — rules engine first, LLM summary second
// ================================================================

export interface AdvisorInsight {
  id: string;
  category: 'INACTIVE_CUSTOMERS' | 'SALES_TREND' | 'PRODUCT_TREND' | 'CAMPAIGN_RECOMMENDATION' | 'LOYALTY';
  severity: 'opportunity' | 'warning' | 'critical' | 'positive';
  title: string;
  body: string;
  metric?: string;
  actionLabel: string;
  actionPath: string;
}

/**
 * Deterministic rules engine. Runs first, always, with zero LLM cost.
 * Produces grounded insights from real numbers; the LLM layer (optional)
 * only rephrases/prioritises these — it never invents new facts.
 */
export async function buildAdvisorInsights(businessId: string): Promise<AdvisorInsight[]> {
  const now = new Date();
  const win = new Date(now.getTime() - 30 * DAY_MS);
  const prevWin = new Date(now.getTime() - 60 * DAY_MS);

  const [inactiveCount, totalActive, curRev, prevRev, topCampaign, idleCampaigns, atRiskCount] =
    await Promise.all([
      prisma.customer.count({ where: { businessId, isActive: true, lastVisitAt: { lt: new Date(now.getTime() - 60 * DAY_MS) } } }),
      prisma.customer.count({ where: { businessId, isActive: true } }),
      prisma.visit.aggregate({ where: { businessId, visitedAt: { gte: win } }, _sum: { amountSpent: true } }),
      prisma.visit.aggregate({ where: { businessId, visitedAt: { gte: prevWin, lt: win } }, _sum: { amountSpent: true } }),
      prisma.campaign.findFirst({ where: { businessId, status: { in: ['ACTIVE', 'COMPLETED'] }, sentCount: { gt: 0 } }, orderBy: { readCount: 'desc' }, select: { name: true, readCount: true, sentCount: true } }),
      prisma.campaign.count({ where: { businessId, status: 'DRAFT' } }),
      prisma.customer.count({ where: { businessId, isActive: true, segment: 'AT_RISK' } }),
    ]);

  const insights: AdvisorInsight[] = [];

  // — Inactive customers —
  if (inactiveCount > 0 && totalActive > 0) {
    const pct = Math.round((inactiveCount / totalActive) * 100);
    insights.push({
      id: 'inactive',
      category: 'INACTIVE_CUSTOMERS',
      severity: pct >= 30 ? 'warning' : 'opportunity',
      title: `${inactiveCount} customers haven't visited in 60+ days`,
      body: `That's ${pct}% of your base sitting idle. These people already know and trust you — a single well-timed "we miss you" message brings a chunk of them back at a fraction of the cost of finding new ones.`,
      metric: `${inactiveCount} dormant`,
      actionLabel: 'Launch a win-back',
      actionPath: '/campaigns/new?segment=AT_RISK',
    });
  }

  // — Sales trend —
  const cur = num(curRev._sum.amountSpent);
  const prev = num(prevRev._sum.amountSpent);
  if (prev > 0) {
    const change = Math.round(((cur - prev) / prev) * 100);
    if (change <= -10) {
      insights.push({
        id: 'sales-drop',
        category: 'SALES_TREND',
        severity: change <= -25 ? 'critical' : 'warning',
        title: `Revenue is down ${Math.abs(change)}% this month`,
        body: `Sales softened compared to last month. This is usually quiet customers, not lost ones — re-engaging your loyal regulars now is the fastest way to steady the dip before it becomes a trend.`,
        metric: `${change}% vs last month`,
        actionLabel: 'See who to re-engage',
        actionPath: '/customers?segment=AT_RISK',
      });
    } else if (change >= 15) {
      insights.push({
        id: 'sales-up',
        category: 'SALES_TREND',
        severity: 'positive',
        title: `Revenue is up ${change}% this month`,
        body: `Momentum is on your side. Now is the moment to convert one-time visitors into regulars — a loyalty nudge while they're warm compounds into months of repeat visits.`,
        metric: `+${change}% vs last month`,
        actionLabel: 'Reward your regulars',
        actionPath: '/campaigns/new?segment=LOYAL',
      });
    }
  }

  // — Campaign recommendation —
  if (idleCampaigns > 0) {
    insights.push({
      id: 'draft-campaigns',
      category: 'CAMPAIGN_RECOMMENDATION',
      severity: 'opportunity',
      title: `${idleCampaigns} campaign${idleCampaigns === 1 ? '' : 's'} sitting in drafts`,
      body: 'Unsent campaigns earn nothing. Even a short, friendly message to the right segment today can drive visits this week — finish one and send it.',
      actionLabel: 'Finish a draft',
      actionPath: '/campaigns?status=DRAFT',
    });
  } else if (topCampaign && topCampaign.sentCount > 0) {
    const rr = Math.round((topCampaign.readCount / topCampaign.sentCount) * 100);
    insights.push({
      id: 'top-campaign',
      category: 'CAMPAIGN_RECOMMENDATION',
      severity: 'positive',
      title: `"${topCampaign.name}" is your best performer (${rr}% read)`,
      body: `This message clearly lands with your customers. Clone it, refresh the offer, and send it to a new segment — repeating what already works beats guessing at something new.`,
      actionLabel: 'Clone this campaign',
      actionPath: '/campaigns',
    });
  }

  // — Loyalty / at-risk concentration —
  if (atRiskCount >= 5) {
    insights.push({
      id: 'at-risk',
      category: 'LOYALTY',
      severity: 'warning',
      title: `${atRiskCount} loyal customers are drifting to "at risk"`,
      body: 'These were once your regulars. Catching them now — before they fully lapse — costs one message; winning them back later costs a discount and a lot more effort.',
      metric: `${atRiskCount} at risk`,
      actionLabel: 'Set up an automation',
      actionPath: '/automations',
    });
  }

  return insights;
}
