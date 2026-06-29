// ================================================================
//  ai-report-runner.ts
//  Batch orchestration for weekly/monthly reports. Iterates active
//  tenants, generates (idempotently) and emails each report. One
//  tenant's failure is logged and never stops the rest.
// ================================================================

import { prisma } from '../../config/prisma';
import { generateAndPersistReport } from './business-report-service';
import { sendReportEmail } from './ai-report-email-service';

export interface ReportRunSummary { type: 'WEEKLY' | 'MONTHLY'; tenants: number; generated: number; sent: number; skipped: number; failed: number; }

/** Generate + deliver one tenant's report. Idempotent end-to-end. */
export const deliverReportForBusiness = async (
  businessId: string,
  type: 'WEEKLY' | 'MONTHLY',
  opts: { email?: boolean; now?: Date } = {},
): Promise<{ id: string; created: boolean; emailStatus: string }> => {
  const { id, created, content } = await generateAndPersistReport(businessId, type, opts.now);
  let emailStatus = 'SKIPPED';
  if (opts.email !== false) {
    const res = await sendReportEmail(id, content);
    emailStatus = res.status;
  }
  return { id, created, emailStatus };
};

/** Run reports for every active tenant. Safe to re-run (idempotent). */
export const runReportsForAllTenants = async (
  type: 'WEEKLY' | 'MONTHLY',
  opts: { email?: boolean; now?: Date } = {},
): Promise<ReportRunSummary> => {
  const businesses = await prisma.business.findMany({ where: { isActive: true }, select: { id: true } });
  const summary: ReportRunSummary = { type, tenants: businesses.length, generated: 0, sent: 0, skipped: 0, failed: 0 };

  for (const b of businesses) {
    try {
      const r = await deliverReportForBusiness(b.id, type, opts);
      if (r.created) summary.generated++;
      if (r.emailStatus === 'SENT') summary.sent++;
      else if (r.emailStatus === 'SKIPPED') summary.skipped++;
      else if (r.emailStatus === 'FAILED') summary.failed++;
    } catch (err) {
      summary.failed++;
      console.error(`[ai.report] tenant ${b.id} failed:`, (err as Error).message);
    }
  }
  return summary;
};
