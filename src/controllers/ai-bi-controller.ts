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
  queryName: string;
  data:      unknown;
  count?:    number;
  summary?:  string;
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
];

// ================================================================
// LLM CLIENT
// ================================================================

interface LLMMessage { role: 'system' | 'user' | 'assistant'; content: string; }

/** True if any supported LLM provider is configured. */
export const isAIConfigured = (): boolean =>
  !!(process.env.ANTHROPIC_API_KEY || process.env.OPENAI_API_KEY);

const callLLM = async (messages: LLMMessage[], maxTokens = 500): Promise<string> => {
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

export const processNaturalLanguageQuery = async (
  question:   string,
  businessId: string
): Promise<AIQueryResult> => {
  // ── PASS 1: Intent Classification ────────────────────────────
  const classificationResponse = await callLLM([
    {
      role:    'system',
      content: `You are a query classifier for a customer retention CRM.
Given a business owner's question, identify which query function to run.
Return ONLY a valid JSON object: { "queryName": string, "parameters": object }
Valid query names and their parameters:
${QUERY_MANIFEST.map(q => `- ${q.name}(${q.params.join(', ')}): ${q.description}`).join('\n')}
If no query fits, use "getSegmentBreakdown" with no parameters.
ONLY return JSON. No explanation.`,
    },
    { role: 'user', content: question },
  ], 200);

  let queryName  = 'getSegmentBreakdown';
  let parameters: Record<string, unknown> = {};

  try {
    // Strip markdown code fences if present
    const cleaned = classificationResponse.replace(/```json|```/g, '').trim();
    const parsed  = JSON.parse(cleaned) as { queryName: string; parameters: Record<string, unknown> };
    if (parsed.queryName && QUERY_LIBRARY[parsed.queryName]) {
      queryName  = parsed.queryName;
      parameters = parsed.parameters ?? {};
    }
  } catch {
    // Classification failed — fall back to segment breakdown
    console.warn('[ai.bi] Intent classification parse failed, using fallback.');
  }

  // ── Execute Query (businessId ALWAYS injected here, not by LLM) ─
  const queryFn  = QUERY_LIBRARY[queryName];
  const rawData  = await queryFn(businessId, parameters);

  // ── PASS 2: Insight Generation ────────────────────────────────
  const insightResponse = await callLLM([
    {
      role:    'system',
      content: `You are an expert business analyst for a customer retention platform.
Your job: give the business owner a short (2-3 sentence), actionable insight based on query results.
Always end with ONE concrete recommended action.
Be specific — use the actual numbers from the data.
Do NOT mention technology, APIs, or SQL.
Respond in plain English as if speaking to a restaurant/café/salon owner.`,
    },
    {
      role:    'user',
      content: `Question: "${question}"\nQuery summary: ${rawData.summary}\nData: ${JSON.stringify(rawData.data).substring(0, 2000)}`,
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
    rawData,
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

// ================================================================
// MOUNT IN app.ts:
//   import { aiBiRouter }       from './controllers/ai.bi';
//   import { posWebhookRouter } from './controllers/webhook.pos';
//   app.use('/api/ai',             aiBiRouter);
//   app.use('/api/webhooks/pos',   posWebhookRouter);
// ================================================================
