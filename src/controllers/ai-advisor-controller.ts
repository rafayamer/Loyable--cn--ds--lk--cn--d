// ================================================================
//  ai-advisor-controller.ts
//  In-app AI Business Advisor + Business Reports API.
//
//  Routes (all tenant-scoped; businessId comes from server context):
//    POST /api/ai-advisor/ask                 → grounded answer to a question
//    GET  /api/ai-advisor/reports             → list recent reports
//    POST /api/ai-advisor/reports/preview     → build report (no persist/email)
//    POST /api/ai-advisor/reports/generate    → generate + persist (+ optional email)
// ================================================================

import { Request, Response, Router } from 'express';
import { Role } from '@prisma/client';
import { prisma } from '../config/prisma';
import { tenantScope, requireRoles } from '../middleware/tenant-scope-middleware';
import { answerQuestion } from '../services/ai/business-advisor-service';
import { buildReport } from '../services/ai/business-report-service';
import { deliverReportForBusiness } from '../services/ai/ai-report-runner';
import { requireFeature } from '../services/entitlement-service';

export const aiAdvisorRouter = Router();
aiAdvisorRouter.use(tenantScope as any);
// AI advisor + reports are a Growth feature (also included in Pro/trial).
aiAdvisorRouter.use(requireFeature('ai_advisor') as any);

const READERS = [Role.TENANT_OWNER, Role.BRANCH_MANAGER, Role.MARKETING_STAFF];

const wrap = (fn: (req: Request, res: Response) => Promise<void>) =>
  async (req: Request, res: Response) => {
    try { await fn(req, res); }
    catch (err) { console.error('[ai.advisor]', (err as Error).message); res.status(500).json({ error: 'ADVISOR_ERROR' }); }
  };

// POST /ask  { question }
aiAdvisorRouter.post('/ask', requireRoles(...READERS) as any, wrap(async (req, res) => {
  const { businessId, userId } = req.tenantContext;
  const question = String((req.body?.question ?? '')).trim();
  if (question.length < 3) { res.status(400).json({ error: 'question is required' }); return; }
  if (question.length > 500) { res.status(400).json({ error: 'question too long' }); return; }
  const result = await answerQuestion(businessId, question);
  await prisma.auditLog.create({
    data: { businessId, userId, action: 'AI_ADVISOR_QUERY', metaJson: { question: question.slice(0, 200), llmUsed: result.llmUsed } },
  }).catch(() => {});
  res.json(result);
}));

// GET /reports
aiAdvisorRouter.get('/reports', requireRoles(...READERS) as any, wrap(async (req, res) => {
  const { businessId } = req.tenantContext;
  const reports = await prisma.businessReport.findMany({
    where: { businessId },
    orderBy: { periodStart: 'desc' },
    take: 24,
    select: { id: true, type: true, periodStart: true, periodEnd: true, status: true, subject: true, summary: true, previewText: true, recommendationsJson: true, emailStatus: true, llmUsed: true, createdAt: true, sentAt: true },
  });
  res.json({ reports });
}));

// POST /reports/preview  { type }  — dry run, never persists or emails
aiAdvisorRouter.post('/reports/preview', requireRoles(...READERS) as any, wrap(async (req, res) => {
  const { businessId } = req.tenantContext;
  const type = (req.body?.type === 'MONTHLY' ? 'MONTHLY' : 'WEEKLY') as 'WEEKLY' | 'MONTHLY';
  const content = await buildReport(businessId, type);
  res.json({ content });
}));

// POST /reports/generate  { type, email? }  — owner only (sends email if requested)
aiAdvisorRouter.post('/reports/generate', requireRoles(Role.TENANT_OWNER) as any, wrap(async (req, res) => {
  const { businessId, userId } = req.tenantContext;
  const type = (req.body?.type === 'MONTHLY' ? 'MONTHLY' : 'WEEKLY') as 'WEEKLY' | 'MONTHLY';
  const email = req.body?.email === true;
  const result = await deliverReportForBusiness(businessId, type, { email });
  await prisma.auditLog.create({
    data: { businessId, userId, action: 'AI_REPORT_GENERATED', entityType: 'BusinessReport', entityId: result.id, metaJson: { type, email, emailStatus: result.emailStatus } },
  }).catch(() => {});
  res.json(result);
}));
