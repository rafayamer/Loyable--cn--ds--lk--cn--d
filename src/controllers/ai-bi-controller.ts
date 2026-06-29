// ================================================================
//  ai.bi.ts
//  Natural language business intelligence controller.
//
//  Security model (HARD RULES):
//   - The LLM NEVER executes queries directly
//   - The LLM NEVER sees raw SQL
//   - businessId is ALWAYS injected server-side — never from user input
//   - The LLM ONLY interacts with pre-built, read-only Prisma functions
//   - LLM output is used for response generation ONLY — never as code
//
//  Two-pass architecture:
//   Pass 1 (Intent Classification):
//     User query → LLM → { queryName, parameters }
//     LLM picks one of N named query functions from a manifest
//
//   Pass 2 (Response Generation):
//     Query results → LLM → actionable natural language insight
//
//  The query function manifest is the ONLY interface the LLM can
//  reference. It cannot invent queries or access other data.
// ================================================================

import { Request, Response, Router } from 'express';
import { z, ZodError }               from 'zod';
import { }              from '@prisma/client';
import { prisma } from '../config/prisma';
import { tenantScope, requireRoles } from '../middleware/tenant-scope-middleware';
import { Role }                      from '@prisma/client';


// ================================================================
// QUERY LIBRARY — Read-only Prisma wrappers
// The LLM can trigger ONLY these functions, NEVER arbitrary queries.
// Each function injects businessId automatically.
// ================================================================

interface QueryResult {
  queryName:  string;
  data:       unknown;
  count?:     number;
  summary?:   string;
  chartType?: string;
}

const QUERY_LIBRARY: Record<
  string,
  (businessId: string, params: Record<string, unknown>) => Promise<QueryResult>
> = {

  getInactiveCustomers: async (businessId, { days = 60 }) => {
    const cutoff = new Date(Date.now() - Number(days) * 86_400_000);
    const customers = await prisma.customer.findMany({
      where:  {
        businessId,
        isActive:   true,
        segment:    { in: ['AT_RISK', 'LOST'] },
        lastVisitAt: { lte: cutoff },
      },
      select:  { id: true, fullName: true, lastVisitAt: true, totalSpend: true, segment: true },
      orderBy: { lastVisitAt: 'asc' },
      take:    50,
    });
    return {
      queryName: 'getInactiveCustomers',
      data:      customers,
      count:     customers.length,
      summary:   `${customers.length} customers haven't visited in over ${days} days.`,
    };
  },

  getTopSpenders: async (businessId, { days = 30, limit = 10 }) => {
    const cutoff = new Date(Date.now() - Number(days) * 86_400_000);
    const customers = await prisma.customer.findMany({
      where:   { businessId, isActive: true, lastVisitAt: { gte: cutoff } },
      select:  { id: true, fullName: true, totalSpend: true, visitCount: true, segment: true },
      orderBy: { totalSpend: 'desc' },
      take:    Number(limit),
    });
    return {
      queryName: 'getTopSpenders',
      data:      customers,
      count:     customers.length,
      summary:   `Top ${limit} spenders in the last ${days} days.`,
    };
  },

  getNewCustomers: async (businessId, { days = 7 }) => {
    const cutoff = new Date(Date.now() - Number(days) * 86_400_000);
    const count  = await prisma.customer.count({
      where: { businessId, createdAt: { gte: cutoff }, isActive: true },
    });
    const customers = await prisma.customer.findMany({
      where:   { businessId, createdAt: { gte: cutoff }, isActive: true },
      select:  { id: true, fullName: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
      take:    20,
    });
    return {
      queryName: 'getNewCustomers',
      data:      customers,
      count,
      summary:   `${count} new customers acquired in the last ${days} days.`,
    };
  },

  getSegmentBreakdown: async (businessId, _) => {
    const breakdown = await prisma.customer.groupBy({
      by:    ['segment'],
      where: { businessId, isActive: true },
      _count: { id: true },
    });
    const total = breakdown.reduce((s, b) => s + b._count.id, 0);
    return {
      queryName: 'getSegmentBreakdown',
      data:      breakdown.map(b => ({
        segment:    b.segment,
        count:      b._count.id,
        percentage: total > 0 ? Math.round(b._count.id / total * 100) : 0,
      })),
      count:   total,
      summary: `Customer segment distribution across ${total} active customers.`,
    };
  },

  getCampaignPerformance: async (businessId, { limit = 5 }) => {
    const campaigns = await prisma.campaign.findMany({
      where:   { businessId, status: { in: ['ACTIVE', 'COMPLETED'] } },
      select:  { name: true, sentCount: true, deliveredCount: true, readCount: true, targetSegment: true },
      orderBy: { readCount: 'desc' },
      take:    Number(limit),
    });
    return {
      queryName: 'getCampaignPerformance',
      data:      campaigns.map(c => ({
        ...c,
        readRate: c.sentCount > 0 ? Math.round(c.readCount / c.sentCount * 100) : 0,
      })),
      count:   campaigns.length,
      summary: `Performance of top ${campaigns.length} campaigns.`,
    };
  },

  getRevenueStats: async (businessId, { days = 30 }) => {
    const cutoff = new Date(Date.now() - Number(days) * 86_400_000);
    const stats  = await prisma.visit.aggregate({
      where: { businessId, visitedAt: { gte: cutoff } },
      _sum:  { amountSpent: true },
      _avg:  { amountSpent: true },
      _count: { id: true },
    });
    const snapshot = await prisma.analyticsSnapshot.findFirst({
      where:   { businessId, branchLocationId: null },
      orderBy: { snapshotDate: 'desc' },
      select:  { churnRate: true, retentionRate: true, averageLtv: true },
    });
    return {
      queryName: 'getRevenueStats',
      data: {
        totalRevenue:    Number(stats._sum.amountSpent ?? 0),
        averageOrder:    Number(stats._avg.amountSpent ?? 0),
        totalVisits:     stats._count.id,
        retentionRate:   snapshot?.retentionRate ?? 0,
        churnRate:       snapshot?.churnRate ?? 0,
        averageLtv:      Number(snapshot?.averageLtv ?? 0),
      },
      summary: `Revenue and retention stats for the last ${days} days.`,
    };
  },

  getBirthdaysThisMonth: async (businessId, _) => {
    const month = new Date().getUTCMonth() + 1;
    const customers = await prisma.$queryRaw<Array<{ id: string; fullName: string; birthday: Date }>>`
      SELECT id, "fullName", birthday
      FROM customers
      WHERE "businessId" = ${businessId}
        AND "isActive"   = true
        AND birthday IS NOT NULL
        AND EXTRACT(MONTH FROM birthday) = ${month}
      ORDER BY EXTRACT(DAY FROM birthday)
    `;
    return {
      queryName: 'getBirthdaysThisMonth',
      data:      customers,
      count:     customers.length,
      summary:   `${customers.length} customer birthdays this month.`,
    };
  },

  getChurnRiskCustomers: async (businessId, _) => {
    const snapshot = await prisma.analyticsSnapshot.findFirst({
      where:   { businessId, branchLocationId: null },
      orderBy: { snapshotDate: 'desc' },
      select:  { atRiskCustomers: true, lostCustomers: true, churnRate: true },
    });
    const highRisk = await prisma.customer.findMany({
      where:   { businessId, isActive: true, segment: { in: ['AT_RISK', 'LOST'] } },
      select:  { id: true, fullName: true, lastVisitAt: true, totalSpend: true },
      orderBy: { lastVisitAt: 'asc' },
      take:    20,
    });
    return {
      queryName: 'getChurnRiskCustomers',
      data:      { highRisk, snapshot },
      count:     highRisk.length,
      summary:   `${highRisk.length} customers at high churn risk (churn rate: ${snapshot?.churnRate?.toFixed(1) ?? 0}%).`,
    };
  },

  getLoyaltyStats: async (businessId, _) => {
    const tierCounts = await prisma.customerTierHistory.groupBy({
      by:    ['tierId'],
      where: { businessId },
      _count: { id: true },
    });
    const tiers = await prisma.loyaltyTier.findMany({
      where:   { businessId },
      orderBy: { rank: 'asc' },
      select:  { id: true, name: true, rank: true },
    });
    const topEarners = await prisma.customer.findMany({
      where:   { businessId, isActive: true },
      select:  { fullName: true, currentPointsBalance: true, currentTierId: true },
      orderBy: { currentPointsBalance: 'desc' },
      take:    5,
    });
    return {
      queryName: 'getLoyaltyStats',
      data:      { tiers, topEarners },
      summary:   `Loyalty tier distribution and top points earners.`,
    };
  },

  getMessageQueueHealth: async (businessId, _) => {
    const statuses = await prisma.messageQueue.groupBy({
      by:    ['status'],
      where: { businessId, createdAt: { gte: new Date(Date.now() - 7 * 86_400_000) } },
      _count: { id: true },
    });
    const total = statuses.reduce((s, x) => s + x._count.id, 0);
    return {
      queryName: 'getMessageQueueHealth',
      data:      statuses.map(s => ({ status: s.status, count: s._count.id })),
      count:     total,
      summary:   `Message queue breakdown for the last 7 days (${total} total messages).`,
    };
  },

  getCampaignRoi: async (businessId, { days = 30 }) => {
    const since = new Date(Date.now() - Number(days) * 86_400_000);
    const campaigns = await (prisma as any).campaign.findMany({
      where:  { businessId, status: 'COMPLETED', updatedAt: { gte: since } },
      select: { id: true, name: true, audienceSize: true, discountValue: true, totalRevenue: true, deliveredCount: true, readCount: true },
      take:   20,
    }) as Array<{ id: string; name: string; audienceSize: number; discountValue: number | null; totalRevenue: number | null; deliveredCount: number | null; readCount: number | null }>;
    const rows = campaigns.map(c => ({
      name:           c.name,
      audienceSize:   c.audienceSize ?? 0,
      discountCost:   Number(c.discountValue ?? 0) * (c.audienceSize ?? 0),
      revenueLifted:  Number(c.totalRevenue ?? 0),
      roi:            c.totalRevenue && c.discountValue && c.audienceSize
        ? Number(c.totalRevenue) / (Number(c.discountValue) * c.audienceSize) - 1
        : null,
      readRate:       c.deliveredCount ? ((c.readCount ?? 0) / c.deliveredCount * 100).toFixed(1) : null,
    }));
    const totalRev  = rows.reduce((s, r) => s + r.revenueLifted, 0);
    const totalCost = rows.reduce((s, r) => s + r.discountCost, 0);
    return {
      queryName:  'getCampaignRoi',
      data:       rows,
      count:      rows.length,
      chartType:  'table',
      summary:    `Campaign ROI for last ${days} days: £${totalRev.toFixed(0)} revenue from £${totalCost.toFixed(0)} in discounts across ${rows.length} campaigns.`,
    };
  },

  getWinBackRate: async (businessId, _) => {
    const ninetyDaysAgo = new Date(Date.now() - 90 * 86_400_000);
    const thirtyDaysAgo = new Date(Date.now() - 30 * 86_400_000);
    const atRiskCustomers = await prisma.customer.findMany({
      where:  { businessId, segment: { in: ['AT_RISK', 'LOST'] }, updatedAt: { gte: ninetyDaysAgo, lt: thirtyDaysAgo } },
      select: { id: true },
    });
    const atRiskIds = atRiskCustomers.map(c => c.id);
    const retained  = atRiskIds.length > 0
      ? await prisma.visit.groupBy({
          by:    ['customerId'],
          where: { businessId, customerId: { in: atRiskIds }, visitedAt: { gte: thirtyDaysAgo } },
        })
      : [];
    const winBackRate = atRiskIds.length > 0
      ? ((retained.length / atRiskIds.length) * 100).toFixed(1)
      : null;
    return {
      queryName: 'getWinBackRate',
      chartType: 'number',
      data:      { atRiskCount: atRiskIds.length, retainedCount: retained.length, winBackRate },
      summary:   `Win-back rate: ${winBackRate ?? 'N/A'}% — ${retained.length} of ${atRiskIds.length} AT_RISK/LOST customers returned in the last 30 days.`,
    };
  },

  getCohortRetention: async (businessId, _) => {
    const rows = await (prisma as any).$queryRawUnsafe(`
      SELECT "cohortMonth", "cohortSize", "retentionByOffset"
      FROM cohort_retention_snapshots
      WHERE "businessId" = $1
      ORDER BY "cohortMonth" DESC
      LIMIT 12
    `, businessId) as Array<{ cohortMonth: string; cohortSize: number; retentionByOffset: Record<string, number> }>;

    const heatmap = rows.map(r => ({
      cohortMonth: r.cohortMonth,
      cohortSize:  r.cohortSize,
      retention:   Object.fromEntries(
        Object.entries(r.retentionByOffset).map(([k, v]) => [
          `M${k}`,
          r.cohortSize > 0 ? Math.round((v / r.cohortSize) * 100) : 0,
        ])
      ),
    }));

    return {
      queryName: 'getCohortRetention',
      chartType: 'table',
      data:      heatmap,
      count:     heatmap.length,
      summary:   `Cohort retention across ${heatmap.length} monthly cohorts. ${heatmap[0] ? `Most recent cohort (${heatmap[0].cohortMonth}): ${heatmap[0].cohortSize} customers, M1 retention: ${heatmap[0].retention['M1'] ?? 'N/A'}%.` : 'No cohort data yet — run nightly cron or add visit data.'}`,
    };
  },

  getPointsLiability: async (businessId, _) => {
    const biz = await prisma.business.findUnique({
      where:  { id: businessId },
      select: { pointsPerPound: true },
    });
    const result = await prisma.customer.aggregate({
      where:  { businessId, isActive: true },
      _sum:   { currentPointsBalance: true },
      _count: { id: true },
    });
    const totalPoints         = Number(result._sum.currentPointsBalance ?? 0);
    const pointsPerPound      = Number(biz?.pointsPerPound ?? 1);
    const redemptionRateGuess = 0.3; // 30% industry average
    const cashExposure        = pointsPerPound > 0 ? (totalPoints / pointsPerPound) * redemptionRateGuess : 0;
    return {
      queryName: 'getPointsLiability',
      chartType: 'number',
      data:      { totalOutstandingPoints: totalPoints, estimatedCashExposure: cashExposure.toFixed(0), activeCustomers: result._count.id, pointsPerPound },
      summary:   `Points liability: ${totalPoints.toLocaleString()} outstanding points across ${result._count.id} customers. Estimated cash exposure at 30% redemption: £${cashExposure.toFixed(0)}.`,
    };
  },
};

// ================================================================
// QUERY MANIFEST (sent to LLM for intent classification)
// ================================================================

const QUERY_MANIFEST = [
  { name: 'getInactiveCustomers',   description: 'Customers who have not visited recently', params: ['days: number (default 60)'] },
  { name: 'getTopSpenders',         description: 'Highest spending customers', params: ['days: number (default 30)', 'limit: number (default 10)'] },
  { name: 'getNewCustomers',        description: 'Recently acquired customers', params: ['days: number (default 7)'] },
  { name: 'getSegmentBreakdown',    description: 'Distribution of customer segments', params: [] },
  { name: 'getCampaignPerformance', description: 'Campaign read rates and delivery stats', params: ['limit: number (default 5)'] },
  { name: 'getRevenueStats',        description: 'Revenue, average order value, retention and churn rates', params: ['days: number (default 30)'] },
  { name: 'getBirthdaysThisMonth',  description: 'Customers with birthdays this month', params: [] },
  { name: 'getChurnRiskCustomers',  description: 'Customers at risk of churning or already lost', params: [] },
  { name: 'getLoyaltyStats',        description: 'Loyalty tier distribution and top points earners', params: [] },
  { name: 'getMessageQueueHealth',  description: 'Message queue delivery rates and failure analysis', params: [] },
  { name: 'getCampaignRoi',         description: 'Campaign ROI: revenue attributed vs discount cost', params: ['days: number (default 30)'] },
  { name: 'getWinBackRate',         description: 'What percentage of AT_RISK/LOST customers were retained in the last 30 days', params: [] },
  { name: 'getPointsLiability',     description: 'Total outstanding loyalty points and estimated cash exposure', params: [] },
  { name: 'getCohortRetention',     description: 'Cohort retention heatmap: % of each monthly cohort still active over time', params: [] },
];

// ================================================================
// LLM CLIENT
// ================================================================

interface LLMMessage { role: 'system' | 'user' | 'assistant'; content: string; }

/** True if any supported LLM provider is configured. */
export const isAIConfigured = (): boolean =>
  !!(process.env.ANTHROPIC_API_KEY || process.env.OPENAI_API_KEY);

export const callLLM = async (messages: LLMMessage[], maxTokens = 500): Promise<string> => {
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  const openaiKey    = process.env.OPENAI_API_KEY;

  // Prefer Anthropic Claude (latest, most capable for this workload)
  if (anthropicKey) {
    const system = messages.filter(m => m.role === 'system').map(m => m.content).join('\n\n');
    const convo  = messages.filter(m => m.role !== 'system').map(m => ({ role: m.role, content: m.content }));
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method:  'POST',
      headers: {
        'Content-Type':      'application/json',
        'x-api-key':         anthropicKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model:      'claude-haiku-4-5-20251001',
        max_tokens: maxTokens,
        system,
        messages:   convo.length ? convo : [{ role: 'user', content: ' ' }],
      }),
    });
    if (!response.ok) {
      const err = await response.text();
      throw new Error(`Anthropic API error ${response.status}: ${err}`);
    }
    const json = await response.json() as { content: Array<{ type: string; text: string }> };
    return json.content.filter(c => c.type === 'text').map(c => c.text).join('') ?? '';
  }

  if (openaiKey) {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${openaiKey}` },
      body:    JSON.stringify({ model: 'gpt-4o-mini', max_tokens: maxTokens, temperature: 0.3, messages }),
    });
    if (!response.ok) {
      const err = await response.text();
      throw new Error(`OpenAI API error ${response.status}: ${err}`);
    }
    const json = await response.json() as { choices: Array<{ message: { content: string } }> };
    return json.choices[0]?.message?.content ?? '';
  }

  throw new Error('No AI provider configured.');
};

// ================================================================
// CORE: TWO-PASS AI QUERY ENGINE
// ================================================================

interface AIQueryResult {
  question:      string;
  queryExecuted: string;
  parameters:    Record<string, unknown>;
  rawData:       QueryResult;
  insight:       string;
  actionLabel?:  string;
  actionPath?:   string;
}

// ================================================================
// BUSINESS PROFILE LOADER
// Fetches full context about the tenant for the AI system prompt.
// ================================================================

async function loadBusinessContext(businessId: string): Promise<string> {
  const [biz, customerStats, recentSnapshot] = await Promise.all([
    prisma.business.findUnique({
      where:  { id: businessId },
      select: {
        name: true, industry: true, address: true, country: true,
        pointsPerPound: true, bigSpenderThreshold: true,
        _count: { select: { customers: true, campaigns: true } },
      },
    }),
    prisma.customer.aggregate({
      where: { businessId, isActive: true },
      _count: { id: true },
      _sum:   { totalSpend: true, visitCount: true },
      _avg:   { totalSpend: true, currentPointsBalance: true },
    }),
    prisma.analyticsSnapshot.findFirst({
      where:   { businessId, branchLocationId: null },
      orderBy: { snapshotDate: 'desc' },
      select:  {
        totalCustomers: true, newCustomers: true,
        atRiskCustomers: true, lostCustomers: true, bigSpenders: true,
        retentionRate: true, churnRate: true, averageLtv: true,
        totalRevenue: true, totalVisits: true,
      },
    }),
  ]);

  const bizName    = biz?.name        ?? 'this business';
  const industry   = biz?.industry    ?? 'retail/hospitality';
  const location   = [biz?.address, biz?.country].filter(Boolean).join(', ');
  const totalCust  = customerStats._count.id;
  const totalSpend = Number(customerStats._sum.totalSpend ?? 0).toFixed(0);
  const avgSpend   = Number(customerStats._avg.totalSpend ?? 0).toFixed(0);
  const avgPoints  = Number(customerStats._avg.currentPointsBalance ?? 0).toFixed(0);
  const snap       = recentSnapshot;

  return `
## PLATFORM CONTEXT
You are the AI Business Intelligence advisor inside **Loyable** — a WhatsApp-first customer retention platform built for SMBs (restaurants, cafés, salons, retail stores). Loyable is a long-term retention operating system, not a one-time tool. It combines loyalty points, automated WhatsApp campaigns, customer segmentation, and AI-driven insights to help business owners grow repeat revenue sustainably.

When giving advice, always frame recommendations within the context of Loyable's capabilities:
- **Loyalty Program**: points earned per visit/spend, redeemable for rewards
- **Campaigns**: WhatsApp broadcast messages to targeted customer segments
- **Automations**: rule-based WhatsApp flows (birthday messages, win-back, tier upgrades)
- **Segments**: NEW, REGULAR, VIP, BIG_SPENDER, AT_RISK, LOST — auto-assigned nightly
- **AI Insights**: this feature — natural language queries over real business data

Never suggest tools or platforms outside Loyable. If a need can be met inside Loyable, show how.

## BUSINESS PROFILE
- **Name**: ${bizName}
- **Industry**: ${industry}
- **Location**: ${location || 'not specified'}
- **Points per £/$ spent**: ${biz?.pointsPerPound ?? 1}
- **Big Spender threshold**: £${biz?.bigSpenderThreshold ?? 500}
- **Total campaigns created**: ${biz?._count?.campaigns ?? 0}

## LIVE CUSTOMER DATA SUMMARY
- **Total active customers**: ${totalCust}
- **Total revenue tracked**: £${totalSpend}
- **Average spend per customer**: £${avgSpend}
- **Average points balance**: ${avgPoints} pts
${snap ? `- **Retention rate**: ${snap.retentionRate?.toFixed(1) ?? 'N/A'}%
- **Churn rate**: ${snap.churnRate?.toFixed(1) ?? 'N/A'}%
- **Average LTV**: £${Number(snap.averageLtv ?? 0).toFixed(0)}
- **New customers (latest snapshot)**: ${snap.newCustomers ?? 0}
- **At-risk customers**: ${snap.atRiskCustomers ?? 0}
- **Lost customers**: ${snap.lostCustomers ?? 0}
- **Big spenders**: ${snap.bigSpenders ?? 0}
- **Total visits tracked**: ${snap.totalVisits ?? 0}` : '- (No analytics snapshot yet — run the nightly cron or add visit data via POS)'}
`.trim();
}

export const processNaturalLanguageQuery = async (
  question:   string,
  businessId: string
): Promise<AIQueryResult> => {
  // Load full business context once
  const bizContext = await loadBusinessContext(businessId);
  const bizName = bizContext.match(/\*\*Name\*\*: (.+)/)?.[1] ?? 'this business';

  // ── SINGLE-PASS: Classify intent + generate insight in one call ─
  const singlePassResponse = await callLLM([
    {
      role:    'system',
      content: `${bizContext}

## YOUR ROLE
You are the AI retention advisor for ${bizName} inside Loyable, a WhatsApp-first customer retention CRM.

## TASK
Given the owner's question, do TWO things in ONE response:
1. Identify which query to run (queryName + parameters)
2. After seeing the data summary placeholder, write the insight narrative

Return ONLY valid JSON (no markdown, no explanation):
{
  "queryName": string,
  "parameters": object,
  "chartType": "bar" | "line" | "pie" | "table" | "number"
}

Valid query names:
${QUERY_MANIFEST.map(q => `- ${q.name}(${q.params.join(', ')}): ${q.description}`).join('\n')}

If no query fits, use "getSegmentBreakdown" with {}.`,
    },
    { role: 'user', content: question },
  ], 300);

  let queryName  = 'getSegmentBreakdown';
  let parameters: Record<string, unknown> = {};
  let suggestedChartType: string | undefined;

  try {
    const cleaned = singlePassResponse.replace(/```json|```/g, '').trim();
    const parsed  = JSON.parse(cleaned) as { queryName: string; parameters: Record<string, unknown>; chartType?: string };
    if (parsed.queryName && QUERY_LIBRARY[parsed.queryName]) {
      queryName         = parsed.queryName;
      parameters        = parsed.parameters ?? {};
      suggestedChartType = parsed.chartType;
    }
  } catch {
    console.warn('[ai.bi] Single-pass classification parse failed, using fallback.');
  }

  // ── Execute Query (businessId ALWAYS injected here, not by LLM) ─
  const queryFn = QUERY_LIBRARY[queryName];
  const rawData = await queryFn(businessId, parameters);

  // ── Insight generation (second focused call on query results) ──
  const insightResponse = await callLLM([
    {
      role:    'system',
      content: `You are the AI retention advisor for ${bizName} inside Loyable.
Write 3-4 sentences max. Be specific — use actual numbers.
End with ONE action they can take TODAY inside Loyable.
Speak directly to the owner — warm, confident, data-driven. No jargon. No mention of SQL/APIs/code.`,
    },
    {
      role:    'user',
      content: `Question: "${question}"\nData summary: ${rawData.summary}\nFull data: ${JSON.stringify(rawData.data).substring(0, 2000)}`,
    },
  ], 400);

  // Determine if we can suggest a quick action
  const actionMap: Record<string, { label: string; path: string }> = {
    getInactiveCustomers:   { label: 'Launch Win-Back Campaign', path: '/campaigns/new?segment=AT_RISK' },
    getChurnRiskCustomers:  { label: 'Launch Win-Back Campaign', path: '/campaigns/new?segment=AT_RISK' },
    getBirthdaysThisMonth:  { label: 'Create Birthday Campaign', path: '/campaigns/new?segment=BIRTHDAY' },
    getTopSpenders:         { label: 'Reward Top Spenders',      path: '/campaigns/new?segment=VIP' },
    getNewCustomers:        { label: 'Send Welcome Campaign',    path: '/campaigns/new?segment=NEW' },
  };

  const action = actionMap[queryName];

  return {
    question,
    queryExecuted: queryName,
    parameters,
    rawData:      { ...rawData, chartType: (rawData.chartType ?? suggestedChartType) as string | undefined },
    insight:      insightResponse,
    actionLabel:  action?.label,
    actionPath:   action?.path,
  };
};

// ================================================================
// QUERY HISTORY (optional — stores past questions for the owner)
// ================================================================

const logBIQuery = async (
  businessId: string,
  userId:     string,
  question:   string,
  queryName:  string
): Promise<void> => {
  await prisma.auditLog.create({
    data: {
      businessId,
      userId,
      action:     'AI_BI_QUERY',
      metaJson:   { question: question.substring(0, 500), queryName },
    },
  }).catch(console.error);
};

// ================================================================
// ZOD + HTTP HANDLER
// ================================================================

const QuerySchema = z.object({
  question: z.string().min(3).max(500, 'Question must be under 500 characters'),
});

const biQueryHandler = async (req: Request, res: Response): Promise<void> => {
  try {
    const { question }   = req.body as z.infer<typeof QuerySchema>;
    const { businessId, userId } = req.tenantContext;

    if (!isAIConfigured()) {
      res.status(503).json({
        error:   'AI_NOT_CONFIGURED',
        message: 'AI is not configured. Add ANTHROPIC_API_KEY (recommended) or OPENAI_API_KEY to environment variables.',
      });
      return;
    }

    const result = await processNaturalLanguageQuery(question, businessId);

    // Fire-and-forget audit log
    void logBIQuery(businessId, userId, question, result.queryExecuted);

    res.status(200).json({
      question:      result.question,
      insight:       result.insight,
      actionLabel:   result.actionLabel,
      actionPath:    result.actionPath,
      dataSnapshot: {
        queryName:  result.queryExecuted,
        parameters: result.parameters,
        count:      result.rawData.count,
        summary:    result.rawData.summary,
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'AI_QUERY_FAILED';
    if (msg.startsWith('OpenAI API error')) {
      res.status(502).json({ error: 'AI_SERVICE_ERROR', message: msg });
    } else {
      console.error('[ai.bi]', err);
      res.status(500).json({ error: 'INTERNAL_ERROR' });
    }
  }
};

// GET available query functions (for frontend query suggestion chips)
const queryManifestHandler = (_req: Request, res: Response): void => {
  res.status(200).json({ queries: QUERY_MANIFEST });
};

// ================================================================
// ROUTER
// ================================================================

export const aiBiRouter = Router();
aiBiRouter.use(tenantScope as any);

aiBiRouter.post(
  '/query',
  requireRoles(Role.TENANT_OWNER, Role.BRANCH_MANAGER, Role.MARKETING_STAFF) as any,
  (req, res, next) => {
    try { req.body = QuerySchema.parse(req.body); next(); }
    catch (err) {
      if (err instanceof ZodError) {
        res.status(400).json({ error: 'VALIDATION_ERROR', fields: err.errors });
      } else next(err);
    }
  },
  biQueryHandler
);

aiBiRouter.get(
  '/manifest',
  requireRoles(Role.TENANT_OWNER, Role.BRANCH_MANAGER, Role.MARKETING_STAFF) as any,
  queryManifestHandler
);

// POST /ai/generate-message — generate a WhatsApp campaign message from a short prompt
aiBiRouter.post(
  '/generate-message',
  requireRoles(Role.TENANT_OWNER, Role.BRANCH_MANAGER, Role.MARKETING_STAFF) as any,
  async (req: Request, res: Response): Promise<void> => {
    const { prompt, bizName } = req.body as { prompt?: string; bizName?: string };
    if (!prompt?.trim()) { res.status(400).json({ error: 'prompt is required' }); return; }
    if (!isAIConfigured()) {
      res.status(503).json({ error: 'AI_NOT_CONFIGURED', message: 'Add ANTHROPIC_API_KEY or OPENAI_API_KEY to environment variables.' });
      return;
    }
    try {
      const name = bizName?.trim() || 'our business';
      const text = await callLLM([
        {
          role: 'system',
          content: `You are a WhatsApp marketing copywriter for SMBs. Write a short, friendly, personal WhatsApp message (under 80 words). Always start with "Hey {name}! " and include 1-2 relevant emojis. Never mention any competitor. Never add hashtags. Return ONLY the message text, nothing else.`,
        },
        {
          role: 'user',
          content: `Business name: ${name}\nCampaign idea: ${prompt}`,
        },
      ], 200);
      res.json({ message: text.trim() });
    } catch (err) {
      console.error('[ai] generate-message error:', err);
      res.status(502).json({ error: 'AI_SERVICE_ERROR', message: (err as Error).message });
    }
  }
);

// ================================================================
// COHORT RETENTION ANALYSIS  GET /ai/cohort-retention
// ================================================================

aiBiRouter.get(
  '/cohort-retention',
  requireRoles(Role.TENANT_OWNER, Role.BRANCH_MANAGER, Role.MARKETING_STAFF) as any,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { businessId } = req.tenantContext;
      const months = Math.min(12, Math.max(3, parseInt(req.query.months as string || '6', 10)));
      const cohorts = await computeCohortRetention(businessId, months);
      res.json({ cohorts, months });
    } catch (err) {
      console.error('[ai:cohort-retention]', err);
      res.status(500).json({ error: 'COHORT_ERROR' });
    }
  }
);

/**
 * Groups customers by signup month (up to `months` cohorts), then for each
 * cohort counts what % returned in Month+1, Month+3, Month+6.
 * Returns rows: [{ cohort: "2024-11", size: 42, m1: 71, m3: 52, m6: 38 }, ...]
 */
const computeCohortRetention = async (businessId: string, numMonths: number) => {
  const now   = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - numMonths, 1));

  // All customers in window grouped by signup month
  const customers = await prisma.customer.findMany({
    where:   { businessId, isActive: true, createdAt: { gte: start } },
    select:  { id: true, createdAt: true },
    orderBy: { createdAt: 'asc' },
  });

  if (customers.length === 0) return [];

  // Group by YYYY-MM
  const cohortMap = new Map<string, string[]>();
  for (const c of customers) {
    const key = `${c.createdAt.getUTCFullYear()}-${String(c.createdAt.getUTCMonth() + 1).padStart(2, '0')}`;
    if (!cohortMap.has(key)) cohortMap.set(key, []);
    cohortMap.get(key)!.push(c.id);
  }

  const results = [];
  for (const [cohort, ids] of cohortMap) {
    const [year, month] = cohort.split('-').map(Number);
    const cohortStart = new Date(Date.UTC(year, month - 1, 1));

    const retentionForWindow = async (offsetMonths: number): Promise<number> => {
      const winStart = new Date(Date.UTC(year, month - 1 + offsetMonths, 1));
      const winEnd   = new Date(Date.UTC(year, month - 1 + offsetMonths + 1, 1));
      if (winEnd > now) return -1; // data not yet available
      const returned = await prisma.visit.groupBy({
        by:    ['customerId'],
        where: { businessId, customerId: { in: ids }, visitedAt: { gte: winStart, lt: winEnd } },
        _count: { customerId: true },
      });
      return Math.round(returned.length / ids.length * 100);
    };

    const [m1, m3, m6] = await Promise.all([
      retentionForWindow(1),
      retentionForWindow(3),
      retentionForWindow(6),
    ]);

    results.push({ cohort, size: ids.length, m1, m3, m6 });
  }

  return results.sort((a, b) => a.cohort.localeCompare(b.cohort));
};

/** GET /ai/nps-stats — NPS score trend + response rate for the business */
aiBiRouter.get(
  '/nps-stats',
  requireRoles(Role.TENANT_OWNER, Role.BRANCH_MANAGER, Role.MARKETING_STAFF) as any,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { businessId } = req.tenantContext;
      const days = Math.min(365, Math.max(7, parseInt(req.query.days as string || '30', 10)));
      const since = new Date(Date.now() - days * 86_400_000);

      const [all, responded] = await Promise.all([
        (prisma as any).feedbackResponse.count({ where: { businessId, sentAt: { gte: since } } }),
        (prisma as any).feedbackResponse.count({ where: { businessId, sentAt: { gte: since }, score: { gt: 0 } } }),
      ]);

      const responses: Array<{ score: number; createdAt: Date }> = await (prisma as any).feedbackResponse.findMany({
        where:   { businessId, sentAt: { gte: since }, score: { gt: 0 } },
        select:  { score: true, createdAt: true },
        orderBy: { createdAt: 'asc' },
      });

      const promoters  = responses.filter(r => r.score >= 4).length;
      const detractors = responses.filter(r => r.score <= 2).length;
      const nps = responded > 0 ? Math.round(((promoters - detractors) / responded) * 100) : null;

      // Weekly buckets for trend chart
      const weekBuckets: Record<string, { total: number; sum: number }> = {};
      for (const r of responses) {
        const wk = r.createdAt.toISOString().slice(0, 10).replace(/\d$/, '0').replace(/-\d$/, '-0');
        const key = r.createdAt.toISOString().slice(0, 7);
        if (!weekBuckets[key]) weekBuckets[key] = { total: 0, sum: 0 };
        weekBuckets[key].total++;
        weekBuckets[key].sum += r.score;
      }
      const trend = Object.entries(weekBuckets).map(([month, { total, sum }]) => ({
        month, avg: total > 0 ? +(sum / total).toFixed(2) : 0, count: total,
      })).sort((a, b) => a.month.localeCompare(b.month));

      res.json({ nps, responseRate: all > 0 ? Math.round((responded / all) * 100) : 0, sent: all, responded, promoters, detractors, trend });
    } catch (err) {
      console.error('[ai:nps-stats]', err);
      res.status(500).json({ error: 'NPS_ERROR' });
    }
  }
);

// ================================================================
// MOUNT IN app.ts:
//   import { aiBiRouter }       from './controllers/ai.bi';
//   import { posWebhookRouter } from './controllers/webhook.pos';
//   app.use('/api/ai',             aiBiRouter);
//   app.use('/api/webhooks/pos',   posWebhookRouter);
// ================================================================
