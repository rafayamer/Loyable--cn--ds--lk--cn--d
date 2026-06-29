// ================================================================
//  ai-report-email-service.ts
//  Renders the weekly/monthly report as a branded, responsive email
//  (HTML + plain text) and sends it to the business owner. Sending is
//  idempotent at the report-record level: a report already marked SENT
//  is never re-sent. Per-tenant failures are logged and do not throw,
//  so a batch job can continue to the next tenant.
// ================================================================

import { prisma } from '../../config/prisma';
import { sendEmail, emailProvider } from '../../utils/email.util';
import { ReportContent, Recommendation } from './business-report-service';

const ORANGE = '#E8743B';   // warm Loyaly accent
const DARK   = '#241B17';   // espresso heading
const PAPER  = '#FBF7F2';

const esc = (s: string) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const block = (title: string, items: string[], color: string) =>
  items.length ? `
    <tr><td style="padding:14px 24px 4px;">
      <div style="font-size:13px;font-weight:700;color:${color};text-transform:uppercase;letter-spacing:.4px;">${esc(title)}</div>
    </td></tr>
    <tr><td style="padding:0 24px 8px;">
      ${items.map(i => `<div style="font-size:14px;color:${DARK};line-height:1.5;padding:4px 0;">• ${esc(i)}</div>`).join('')}
    </td></tr>` : '';

const recBlock = (recs: Recommendation[]) => recs.map((r, i) => `
  <tr><td style="padding:8px 24px;">
    <div style="background:#fff;border:1px solid #efe6dc;border-radius:12px;padding:14px 16px;">
      <div style="font-size:14px;font-weight:700;color:${DARK};">${i + 1}. ${esc(r.what)}</div>
      <div style="font-size:13px;color:#6b5d52;margin-top:4px;"><b>Why:</b> ${esc(r.why)}</div>
      <div style="font-size:13px;color:#6b5d52;margin-top:2px;"><b>How:</b> ${esc(r.how)}</div>
    </div>
  </td></tr>`).join('');

const metricCard = (label: string, value: string) => `
  <td style="padding:6px;" width="50%">
    <div style="background:#fff;border:1px solid #efe6dc;border-radius:12px;padding:14px;text-align:center;">
      <div style="font-size:22px;font-weight:800;color:${DARK};">${esc(value)}</div>
      <div style="font-size:11px;color:#8a7c70;text-transform:uppercase;letter-spacing:.5px;margin-top:2px;">${esc(label)}</div>
    </div>
  </td>`;

export const renderReportHtml = (content: ReportContent, bizName: string): string => {
  const m = content.metrics;
  const cur = m.currency;
  const f = (n: number) => `${cur}${Math.round(n).toLocaleString()}`;
  const appUrl = process.env.APP_PUBLIC_URL || process.env.API_BASE_URL || 'https://app.theloyaly.com';
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;background:${PAPER};font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${PAPER};padding:24px 0;"><tr><td align="center">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:${PAPER};">
  <tr><td style="padding:8px 24px 0;">
    <div style="font-size:13px;color:${ORANGE};font-weight:800;letter-spacing:.5px;">THE LOYALY</div>
    <h1 style="margin:6px 0 2px;font-size:22px;color:${DARK};">${esc(content.type === 'WEEKLY' ? 'Your weekly report' : 'Your monthly report')}</h1>
    <div style="font-size:13px;color:#8a7c70;">${esc(bizName)}</div>
  </td></tr>

  <tr><td style="padding:16px 24px 4px;">
    <div style="background:#fff;border:1px solid #efe6dc;border-radius:14px;padding:16px 18px;">
      <div style="font-size:12px;font-weight:700;color:${ORANGE};text-transform:uppercase;letter-spacing:.5px;">Business Feedback Summary</div>
      <div style="font-size:15px;color:${DARK};line-height:1.6;margin-top:6px;">${esc(content.summary)}</div>
    </div>
  </td></tr>

  <tr><td style="padding:12px 18px 0;"><table role="presentation" width="100%"><tr>
    ${metricCard('Revenue', m.revenue.available ? f(m.revenue.current) : 'n/a')}
    ${metricCard('Visits', m.visits.available ? String(m.visits.current) : 'n/a')}
  </tr><tr>
    ${metricCard('At-risk customers', String(m.segments.atRisk))}
    ${metricCard('Returning customers', String(m.customers.returning))}
  </tr></table></td></tr>

  ${block('What\'s going well', content.pros, '#2f9e5e')}
  ${block('What underperformed', content.cons, '#c2502f')}
  ${block('Pain points', content.painPoints, '#b9892f')}
  ${block('Power points', content.powerPoints, ORANGE)}

  <tr><td style="padding:16px 24px 4px;"><div style="font-size:13px;font-weight:700;color:${DARK};text-transform:uppercase;letter-spacing:.4px;">Recommended actions</div></td></tr>
  ${recBlock(content.recommendations)}

  <tr><td style="padding:12px 24px;">
    <div style="background:#fff;border:1px dashed ${ORANGE};border-radius:12px;padding:14px 16px;">
      <div style="font-size:12px;font-weight:700;color:${ORANGE};text-transform:uppercase;">${content.type === 'WEEKLY' ? 'Feature to use this week' : 'Feature to use this month'}</div>
      <div style="font-size:15px;font-weight:700;color:${DARK};margin-top:4px;">${esc(content.feature.title)}</div>
      <div style="font-size:13px;color:#6b5d52;margin-top:2px;">${esc(content.feature.reason)}</div>
      <div style="font-size:13px;color:#6b5d52;margin-top:2px;"><b>How:</b> ${esc(content.feature.how)}</div>
    </div>
  </td></tr>

  ${content.projection ? `<tr><td style="padding:4px 24px;">
    <div style="font-size:13px;color:#6b5d52;line-height:1.5;"><b>Growth projection (estimate):</b> ${esc(content.projection.text)}<br><span style="color:#8a7c70;">${esc(content.projection.assumption)}</span></div>
  </td></tr>` : ''}

  <tr><td style="padding:18px 24px;">
    <a href="${esc(appUrl)}" style="display:inline-block;background:${ORANGE};color:#fff;text-decoration:none;font-weight:700;font-size:14px;padding:12px 22px;border-radius:10px;">Open your retention dashboard</a>
  </td></tr>

  <tr><td style="padding:8px 24px 24px;">
    <div style="font-size:11px;color:#a99c90;line-height:1.5;">You're receiving this because you own a business on The Loyaly. Numbers are based on your own data for the period shown.${content.llmUsed ? '' : ' (Summary generated in template mode.)'}</div>
  </td></tr>
</table></td></tr></table></body></html>`;
};

export const renderReportText = (content: ReportContent, bizName: string): string => {
  const m = content.metrics;
  const f = (n: number) => `${m.currency}${Math.round(n).toLocaleString()}`;
  const sec = (t: string, items: string[]) => items.length ? `\n${t}:\n${items.map(i => `- ${i}`).join('\n')}` : '';
  return [
    `THE LOYALY — ${content.type === 'WEEKLY' ? 'Weekly' : 'Monthly'} report for ${bizName}`,
    ``,
    `BUSINESS FEEDBACK SUMMARY`,
    content.summary,
    ``,
    `KEY NUMBERS`,
    `- Revenue: ${m.revenue.available ? f(m.revenue.current) : 'n/a'}`,
    `- Visits: ${m.visits.available ? m.visits.current : 'n/a'}`,
    `- At-risk customers: ${m.segments.atRisk}`,
    `- Returning customers: ${m.customers.returning}`,
    sec('WHAT\'S GOING WELL', content.pros),
    sec('WHAT UNDERPERFORMED', content.cons),
    sec('PAIN POINTS', content.painPoints),
    sec('POWER POINTS', content.powerPoints),
    `\nRECOMMENDED ACTIONS`,
    ...content.recommendations.map((r, i) => `${i + 1}. What: ${r.what}\n   Why: ${r.why}\n   How: ${r.how}`),
    `\n${content.type === 'WEEKLY' ? 'FEATURE TO USE THIS WEEK' : 'FEATURE TO USE THIS MONTH'}: ${content.feature.title} — ${content.feature.reason} How: ${content.feature.how}`,
    content.projection ? `\nGROWTH PROJECTION (ESTIMATE): ${content.projection.text} ${content.projection.assumption}` : '',
  ].filter(Boolean).join('\n');
};

/**
 * Send a persisted report by id, idempotently. Returns the email status.
 * Owner email is resolved server-side from the tenant's TENANT_OWNER user.
 */
export const sendReportEmail = async (
  reportId: string,
  fullContent?: ReportContent,
): Promise<{ status: 'SENT' | 'SKIPPED' | 'FAILED'; reason?: string }> => {
  const report = await prisma.businessReport.findUnique({ where: { id: reportId } });
  if (!report) return { status: 'FAILED', reason: 'REPORT_NOT_FOUND' };
  if (report.emailStatus === 'SENT') return { status: 'SKIPPED', reason: 'ALREADY_SENT' };

  const owner = await prisma.user.findFirst({
    where: { businessId: report.businessId, role: 'TENANT_OWNER', isActive: true },
    select: { email: true, name: true },
  });
  const biz = await prisma.business.findUnique({ where: { id: report.businessId }, select: { name: true } });

  if (emailProvider() === 'none') {
    await prisma.businessReport.update({ where: { id: report.id }, data: { emailStatus: 'SKIPPED', emailError: 'No email provider configured' } });
    return { status: 'SKIPPED', reason: 'NO_EMAIL_PROVIDER' };
  }
  if (!owner?.email) {
    await prisma.businessReport.update({ where: { id: report.id }, data: { emailStatus: 'SKIPPED', emailError: 'No owner email' } });
    return { status: 'SKIPPED', reason: 'NO_OWNER_EMAIL' };
  }

  // Prefer the full in-memory content (complete Pros/Cons/Power/feature/projection).
  // Fall back to a reconstruction from stored fields for a manual by-id resend.
  const content: ReportContent = fullContent ?? ({
    type: report.type as 'WEEKLY' | 'MONTHLY',
    subject: report.subject ?? 'Your Loyaly report',
    previewText: report.previewText ?? '',
    summary: report.summary ?? '',
    pros: [], cons: [], painPoints: [], powerPoints: [],
    recommendations: (report.recommendationsJson as any) ?? [],
    feature: { title: 'Retention Dashboard', reason: '', how: 'Open your dashboard.' },
    projection: null,
    checklist: [],
    metrics: report.keyMetricsJson as any,
    llmUsed: report.llmUsed,
  } as ReportContent);

  try {
    const html = renderReportHtml(content, biz?.name ?? 'your business');
    await sendEmail({ to: owner.email, subject: report.subject ?? 'Your Loyaly report', templateId: 'business_report', variables: {}, html });
    await prisma.$transaction([
      prisma.businessReport.update({ where: { id: report.id }, data: { emailStatus: 'SENT', status: 'SENT', sentAt: new Date(), emailError: null } }),
      prisma.auditLog.create({ data: { businessId: report.businessId, action: 'AI_REPORT_EMAIL_SENT', entityType: 'BusinessReport', entityId: report.id, metaJson: { type: report.type, to: owner.email } } }),
    ]);
    return { status: 'SENT' };
  } catch (e) {
    await prisma.businessReport.update({ where: { id: report.id }, data: { emailStatus: 'FAILED', emailError: (e as Error).message.slice(0, 400) } });
    return { status: 'FAILED', reason: (e as Error).message };
  }
};
