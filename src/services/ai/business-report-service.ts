// ================================================================
//  business-report-service.ts
//  Builds the weekly / monthly business report from VERIFIED metrics.
//  The rules engine derives Pros, Cons, Pain Points, Power Points,
//  recommendations (What/Why/How), the feature to use, and a labelled
//  growth projection. The LLM is used ONLY to write the ~100-word
//  Business Feedback Summary; if no LLM is configured a clean template
//  summary is produced instead. Reports are idempotent per
//  (businessId, type, periodStart).
// ================================================================

import { prisma } from '../../config/prisma';
import { computeMetrics, metricsToBlock, MetricsBundle } from './business-metrics-service';
import { reportSystemPrompt, reportUserPrompt, BANNED_PHRASES } from './prompt-registry';
import { isAIConfigured, callLLM } from '../../controllers/ai-bi-controller';
import { logAIRun } from './ai-run-log';

export interface Recommendation { what: string; why: string; how: string; }
export interface ReportContent {
  type: 'WEEKLY' | 'MONTHLY';
  subject: string;
  previewText: string;
  summary: string;
  pros: string[];
  cons: string[];
  painPoints: string[];
  powerPoints: string[];
  recommendations: Recommendation[];
  feature: { title: string; reason: string; how: string };
  projection: { text: string; isEstimate: true; assumption: string } | null;
  checklist: string[];
  metrics: MetricsBundle;
  llmUsed: boolean;
}

const money = (m: MetricsBundle, n: number) => `${m.currency}${Math.round(n).toLocaleString()}`;
const up = (d: { changePct: number | null }) => d.changePct != null && d.changePct > 0;
const down = (d: { changePct: number | null }) => d.changePct != null && d.changePct < 0;

// ── Rules: Pros / Cons / Pain Points / Power Points ────────────────
const derivePros = (m: MetricsBundle): string[] => {
  const out: string[] = [];
  if (m.revenue.available && up(m.revenue)) out.push(`Revenue rose ${m.revenue.changePct}% to ${money(m, m.revenue.current)}.`);
  if (m.visits.available && up(m.visits)) out.push(`Visits increased ${m.visits.changePct}% (${m.visits.current} this period).`);
  if (m.customers.returning > 0) out.push(`${m.customers.returning} customers came back and visited this period.`);
  if (up(m.customers.new)) out.push(`New customers grew ${m.customers.new.changePct}% (${m.customers.new.current} added).`);
  if (m.storeCredit.available && m.storeCredit.redeemed > 0) out.push(`Customers redeemed ${money(m, m.storeCredit.redeemed)} of in-store reward value — loyalty is driving return visits.`);
  if (m.messages.available && m.messages.deliveryRate != null && m.messages.deliveryRate >= 90) out.push(`Message delivery was strong at ${m.messages.deliveryRate}%.`);
  if (m.coupons.available && up(m.coupons.redemptions)) out.push(`Coupon redemptions rose ${m.coupons.redemptions.changePct}%.`);
  return out;
};
const deriveCons = (m: MetricsBundle): string[] => {
  const out: string[] = [];
  if (m.revenue.available && down(m.revenue)) out.push(`Revenue fell ${Math.abs(m.revenue.changePct!)}% to ${money(m, m.revenue.current)}.`);
  if (m.visits.available && down(m.visits)) out.push(`Visits dropped ${Math.abs(m.visits.changePct!)}%.`);
  if (down(m.customers.new)) out.push(`New customers fell ${Math.abs(m.customers.new.changePct!)}%.`);
  if (m.messages.available && m.messages.failureRate != null && m.messages.failureRate > 10) out.push(`Message failure rate was high at ${m.messages.failureRate}%.`);
  if (m.loyalty.available && m.loyalty.pointsIssued > 0 && m.loyalty.pointsRedeemed === 0) out.push(`Points were issued but none were redeemed — reward value is building up unused.`);
  if (m.campaigns.available === false || m.campaigns.created === 0) out.push(`No campaigns were sent this period.`);
  return out;
};
const derivePainPoints = (m: MetricsBundle): string[] => {
  const out: string[] = [];
  if (m.segments.atRisk > 0) out.push(`${m.segments.atRisk} customers are drifting to at-risk and need a comeback nudge.`);
  if (m.segments.lost > 0) out.push(`${m.segments.lost} customers are now lost — they stopped coming back.`);
  if (m.storeCredit.available && m.storeCredit.outstanding > 0 && m.storeCredit.redeemed === 0) out.push(`${money(m, m.storeCredit.outstanding)} of in-store reward value is outstanding and unused.`);
  if (m.birthdays.available && m.birthdays.next30 > 0) out.push(`${m.birthdays.next30} birthdays are coming in 30 days with no birthday campaign set.`);
  if (m.messages.available && m.messages.failureRate != null && m.messages.failureRate > 10) out.push(`Failed messages mean some customers never heard from you.`);
  if (!m.visits.available) out.push(`Visits aren't being captured, so repeat-customer behaviour can't be measured yet.`);
  return out;
};
const derivePowerPoints = (m: MetricsBundle): string[] => {
  const out: string[] = [];
  if (m.segments.atRisk > 0) out.push(`${m.segments.atRisk} at-risk customers are ready for a customer comeback campaign.`);
  if (m.segments.vip > 0) out.push(`${m.segments.vip} VIP customers are worth a thank-you reward to keep them loyal.`);
  if (m.birthdays.available && m.birthdays.next7 > 0) out.push(`${m.birthdays.next7} birthdays in the next 7 days — an easy, warm reason to message.`);
  if (m.referrals.available && m.referrals.current > 0) out.push(`Referrals are working (${m.referrals.current} new sign-ups) — worth promoting harder.`);
  if (m.storeCredit.available && m.storeCredit.outstanding > 0) out.push(`${money(m, m.storeCredit.outstanding)} of reward value can pull customers back for another visit.`);
  if (m.segments.loyal > 0) out.push(`${m.segments.loyal} loyal customers could be promoted into a higher tier.`);
  return out;
};

// ── Rules: recommendations (What / Why / How) ──────────────────────
const deriveRecommendations = (m: MetricsBundle): Recommendation[] => {
  const recs: Recommendation[] = [];
  const hasData = m.customers.total > 0 || m.visits.available;
  if (!hasData) {
    recs.push({ what: 'Connect your POS or set up QR check-in.', why: 'The Loyaly needs visit data to know who your customers are and who stops coming back.', how: 'Open Operations → POS or Loyalty → QR Check-in and follow the setup.' });
    recs.push({ what: 'Import your existing customers.', why: 'Your current customers are the cheapest to bring back.', how: 'Open Customers → Import and upload your list.' });
    recs.push({ what: 'Send your first campaign once data is in.', why: 'A simple welcome or comeback message starts repeat-visit revenue.', how: 'Open Campaigns → New Campaign.' });
    return recs;
  }
  if (m.segments.atRisk + m.segments.lost > 0)
    recs.push({ what: `Send a comeback offer to your ${m.segments.atRisk + m.segments.lost} at-risk and lost customers.`, why: 'They already know you and are cheaper to bring back than finding new customers.', how: 'Open Campaigns, choose the At Risk audience, pick a friendly offer, review the message and schedule it.' });
  if (m.birthdays.available && m.birthdays.next30 > 0)
    recs.push({ what: `Set up a birthday reward campaign for the ${m.birthdays.next30} birthdays coming this month.`, why: 'Birthday messages have a warm reason to reach out and drive a guaranteed visit reason.', how: 'Open Campaigns → Birthday, choose the reward and let it send automatically.' });
  if (m.loyalty.available && m.loyalty.pointsIssued > 0 && m.loyalty.pointsRedeemed === 0)
    recs.push({ what: 'Remind customers they have in-store reward value waiting.', why: 'Unused reward value is a strong, no-cost reason for customers to come back.', how: 'Open Campaigns, target customers with store credit, and send a "your reward is waiting" message.' });
  if (m.messages.available && m.messages.failureRate != null && m.messages.failureRate > 10)
    recs.push({ what: 'Check your message health — failures are above 10%.', why: 'Failed messages mean customers never got your offer, wasting the send.', how: 'Open Campaigns → Message Health to see failures and fix the connection.' });
  if (m.campaigns.created === 0 && m.customers.total > 0)
    recs.push({ what: 'Send at least one campaign this period.', why: 'Customers who hear from you come back more often than those who don\'t.', how: 'Open Campaigns → New Campaign and pick a goal.' });
  if (m.segments.vip > 0)
    recs.push({ what: `Reward your ${m.segments.vip} VIP customers.`, why: 'A small thank-you keeps your best customers loyal and spending.', how: 'Open Campaigns, choose the VIP audience, and send a reward.' });
  // Always at least 3
  while (recs.length < 3) {
    recs.push({ what: 'Keep capturing every visit with QR check-in.', why: 'More visit data means sharper insights and better comeback timing.', how: 'Open Loyalty → QR Check-in and display the code at your counter.' });
    break;
  }
  return recs.slice(0, 5);
};

// ── Rules: feature to use this week/month ──────────────────────────
const deriveFeature = (m: MetricsBundle): { title: string; reason: string; how: string } => {
  if (!m.visits.available && m.customers.total === 0)
    return { title: 'QR Check-in', reason: 'You need visit data before The Loyaly can bring customers back.', how: 'Open Loyalty → QR Check-in and display the code at your counter.' };
  if (m.segments.atRisk + m.segments.lost > 0)
    return { title: 'Customer Comeback Campaign', reason: `You have ${m.segments.atRisk + m.segments.lost} customers slipping away.`, how: 'Open Campaigns → choose At Risk → send a comeback offer.' };
  if (m.birthdays.available && m.birthdays.next7 > 0)
    return { title: 'Birthday Campaign', reason: `${m.birthdays.next7} birthdays in the next 7 days.`, how: 'Open Campaigns → Birthday and set the reward.' };
  if (m.loyalty.available && m.loyalty.pointsIssued > 0 && m.loyalty.pointsRedeemed === 0)
    return { title: 'Loyalty Wallet / Store Credit', reason: 'Reward value is building up but not being used.', how: 'Open Campaigns and remind customers their in-store reward value is waiting.' };
  if (m.campaigns.created === 0)
    return { title: 'Campaign Builder', reason: 'No campaign went out this period.', how: 'Open Campaigns → New Campaign and pick a goal.' };
  if (m.messages.available && m.messages.failureRate != null && m.messages.failureRate > 10)
    return { title: 'Message Health Check', reason: `Message failures are at ${m.messages.failureRate}%.`, how: 'Open Campaigns → Message Health.' };
  return { title: 'Retention Dashboard', reason: 'Keep an eye on customer health and recovered revenue.', how: 'Open Dashboard to see who is drifting and act early.' };
};

// ── Rules: growth projection (clearly an estimate) ─────────────────
const deriveProjection = (m: MetricsBundle): ReportContent['projection'] => {
  if (!m.revenue.available || m.revenue.previous === 0) return null;
  const rate = (m.revenue.current - m.revenue.previous) / m.revenue.previous;
  const clamped = Math.max(-0.5, Math.min(0.5, rate)); // avoid wild extrapolation
  const next = Math.round(m.revenue.current * (1 + clamped));
  const span = m.type === 'WEEKLY' ? 'next week' : 'next month';
  return {
    text: `If the current trend holds, ${span} could land around ${money(m, next)}.`,
    isEstimate: true,
    assumption: `Estimate only — assumes the same ${Math.round(clamped * 100)}% change vs the previous period continues. Real results depend on the actions you take.`,
  };
};

const deriveChecklist = (recs: Recommendation[]): string[] => recs.slice(0, 4).map(r => r.what);

// ── Template summary (used when LLM disabled) ──────────────────────
const templateSummary = (m: MetricsBundle, pros: string[], cons: string[]): string => {
  const period = m.type === 'WEEKLY' ? 'This week' : 'This month';
  const movement = m.revenue.available
    ? (up(m.revenue) ? `revenue moved up ${m.revenue.changePct}% to ${money(m, m.revenue.current)}` : down(m.revenue) ? `revenue dipped ${Math.abs(m.revenue.changePct!)}% to ${money(m, m.revenue.current)}` : `revenue held at ${money(m, m.revenue.current)}`)
    : `visit data is not flowing yet`;
  const watch = m.segments.atRisk + m.segments.lost > 0 ? `${m.segments.atRisk + m.segments.lost} customers are drifting and worth a comeback message` : `customer health looks steady`;
  const opp = m.birthdays.available && m.birthdays.next30 > 0 ? `${m.birthdays.next30} birthdays are coming up` : (m.segments.vip > 0 ? `your ${m.segments.vip} VIPs are worth rewarding` : `keep capturing every visit`);
  return `${period}, ${movement}. ${pros[0] ?? 'Customer activity continued.'} On the watch list, ${watch}. ${cons[0] ?? ''} The clearest opportunity right now: ${opp}. Focus next on bringing recent customers back before they slip further.`.replace(/\s+/g, ' ').trim();
};

const scrub = (text: string): string => {
  let t = text;
  for (const p of BANNED_PHRASES) t = t.replace(new RegExp(p, 'ig'), 'strong retention results');
  return t;
};

/** Build the full report content for a tenant + period (rules + optional LLM narration). */
export const buildReport = async (
  businessId: string,
  type: 'WEEKLY' | 'MONTHLY',
  now = new Date(),
): Promise<ReportContent> => {
  const m = await computeMetrics(businessId, type, now);
  const pros = derivePros(m), cons = deriveCons(m);
  const painPoints = derivePainPoints(m), powerPoints = derivePowerPoints(m);
  const recommendations = deriveRecommendations(m);
  const feature = deriveFeature(m);
  const projection = deriveProjection(m);

  // Business Feedback Summary — LLM narration with template fallback.
  let summary = templateSummary(m, pros, cons);
  let llmUsed = false;
  if (isAIConfigured()) {
    try {
      const out = await callLLM([
        { role: 'system', content: reportSystemPrompt(type) },
        { role: 'user', content: reportUserPrompt(metricsToBlock(m)) },
      ], 320);
      if (out && out.trim().length > 40) { summary = scrub(out.trim()); llmUsed = true; }
      await logAIRun({ businessId, taskType: type === 'WEEKLY' ? 'WEEKLY_REPORT' : 'MONTHLY_REPORT', inputSummary: `${type} metrics`, outputSummary: 'feedback summary', status: 'OK' });
    } catch (e) {
      await logAIRun({ businessId, taskType: type === 'WEEKLY' ? 'WEEKLY_REPORT' : 'MONTHLY_REPORT', status: 'ERROR', error: (e as Error).message });
    }
  } else {
    await logAIRun({ businessId, taskType: type === 'WEEKLY' ? 'WEEKLY_REPORT' : 'MONTHLY_REPORT', status: 'LLM_DISABLED', outputSummary: 'template summary' });
  }

  const periodLabel = type === 'WEEKLY' ? 'Weekly' : 'Monthly';
  const trend = m.revenue.available && m.revenue.changePct != null ? (m.revenue.changePct >= 0 ? `up ${m.revenue.changePct}%` : `down ${Math.abs(m.revenue.changePct)}%`) : 'your latest numbers';
  return {
    type,
    subject: `Your ${periodLabel} Loyaly report — revenue ${trend}`,
    previewText: summary.slice(0, 120),
    summary,
    pros, cons, painPoints, powerPoints,
    recommendations, feature, projection,
    checklist: deriveChecklist(recommendations),
    metrics: m,
    llmUsed,
  };
};

/**
 * Generate + persist a report idempotently. If a report already exists for
 * (businessId, type, periodStart) it is returned as-is (no duplicate, no
 * re-send). Returns the report row id and whether it was freshly created.
 */
export const generateAndPersistReport = async (
  businessId: string,
  type: 'WEEKLY' | 'MONTHLY',
  now = new Date(),
): Promise<{ id: string; created: boolean; content: ReportContent; periodStart: Date }> => {
  const content = await buildReport(businessId, type, now);
  const periodStart = content.metrics.window.start;
  const periodEnd = content.metrics.window.end;

  const existing = await prisma.businessReport.findUnique({
    where: { businessId_type_periodStart: { businessId, type, periodStart } },
  });
  if (existing) return { id: existing.id, created: false, content, periodStart };

  const row = await prisma.businessReport.create({
    data: {
      businessId, type, periodStart, periodEnd, status: 'GENERATED',
      subject: content.subject, previewText: content.previewText, summary: content.summary,
      keyMetricsJson: content.metrics as any,
      recommendationsJson: content.recommendations as any,
      llmUsed: content.llmUsed,
    },
  });
  return { id: row.id, created: true, content, periodStart };
};
