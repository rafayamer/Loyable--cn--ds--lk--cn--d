// ================================================================
//  dashboard-controller.ts
//  Executive dashboard HTTP layer.
//
//  Route map (all behind tenantScope; businessId from req.tenantContext):
//   GET /api/dashboard/overview   → KPIs + widgets + today tasks (fast, no LLM)
//   GET /api/dashboard/advisor    → AI Business Advisor insights (rules + LLM summary)
//   GET /api/dashboard/tasks      → Today tasks only (lightweight poll)
// ================================================================

import { Request, Response, Router } from 'express';
import { Role } from '@prisma/client';

import { tenantScope, requireRoles } from '../middleware/tenant-scope-middleware';
import {
  buildDashboardOverview,
  buildAdvisorInsights,
  type AdvisorInsight,
} from '../services/dashboard-service';
import { callLLM, isAIConfigured } from './ai-bi-controller';

const ROLES = [Role.TENANT_OWNER, Role.BRANCH_MANAGER, Role.MARKETING_STAFF] as const;

export const dashboardRouter = Router();
dashboardRouter.use(tenantScope as any);

// ---- GET /overview ---------------------------------------------

dashboardRouter.get(
  '/overview',
  requireRoles(...ROLES) as any,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { businessId } = req.tenantContext;
      const windowDays = Math.min(Math.max(Number(req.query.days ?? 30), 1), 365);
      const overview = await buildDashboardOverview(businessId, windowDays);
      res.status(200).json(overview);
    } catch (err) {
      console.error('[dashboard.overview]', err);
      res.status(500).json({ error: 'DASHBOARD_FAILED' });
    }
  }
);

// ---- GET /tasks ------------------------------------------------

dashboardRouter.get(
  '/tasks',
  requireRoles(...ROLES) as any,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { businessId } = req.tenantContext;
      const overview = await buildDashboardOverview(businessId, 30);
      res.status(200).json({ tasks: overview.tasks });
    } catch (err) {
      console.error('[dashboard.tasks]', err);
      res.status(500).json({ error: 'TASKS_FAILED' });
    }
  }
);

// ---- GET /advisor ----------------------------------------------
//
// Rules engine runs first and always (grounded, zero-cost). If an LLM is
// configured, it adds ONE plain-language summary that prioritises the
// insights into a recommended next action — it never invents new facts.

dashboardRouter.get(
  '/advisor',
  requireRoles(...ROLES) as any,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { businessId } = req.tenantContext;
      const insights = await buildAdvisorInsights(businessId);

      let summary: string | null = null;
      if (insights.length && isAIConfigured()) {
        summary = await summariseInsights(insights).catch((e) => {
          console.error('[dashboard.advisor] LLM summary failed:', e);
          return null;
        });
      }

      res.status(200).json({
        generatedAt: new Date().toISOString(),
        summary,
        insights,
      });
    } catch (err) {
      console.error('[dashboard.advisor]', err);
      res.status(500).json({ error: 'ADVISOR_FAILED' });
    }
  }
);

/** One short owner-facing paragraph that turns the insight list into a next action. */
async function summariseInsights(insights: AdvisorInsight[]): Promise<string> {
  const facts = insights
    .map((i, idx) => `${idx + 1}. [${i.category}] ${i.title}${i.metric ? ` (${i.metric})` : ''}: ${i.body}`)
    .join('\n');

  return (
    await callLLM(
      [
        {
          role: 'system',
          content:
            'You are the AI business advisor inside Loyable, talking directly to a busy, non-technical small-business owner. ' +
            'You are given a list of grounded insights derived from their real data. ' +
            'Write ONE warm, plain-language paragraph (max 60 words) that names the single most important thing to do today and why it matters to their bottom line. ' +
            'Be encouraging, never alarmist. Do not invent numbers or facts beyond what is given. Do not list — write a flowing paragraph. No greetings, no sign-off.',
        },
        { role: 'user', content: `Today's insights:\n${facts}` },
      ],
      160
    )
  ).trim();
}
