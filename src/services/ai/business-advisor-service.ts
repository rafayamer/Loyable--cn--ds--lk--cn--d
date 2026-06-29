// ================================================================
//  business-advisor-service.ts
//  In-app AI Business Advisor. Answers one practical owner question
//  using ONLY verified, tenant-scoped metrics. Rules engine runs first
//  (computeMetrics); the LLM only narrates. If no LLM is configured a
//  structured, grounded template answer is returned instead.
// ================================================================

import { computeMetrics, metricsToBlock, MetricsBundle } from './business-metrics-service';
import { advisorSystemPrompt, advisorUserPrompt, BANNED_PHRASES } from './prompt-registry';
import { isAIConfigured, callLLM } from '../../controllers/ai-bi-controller';
import { logAIRun } from './ai-run-log';

export interface AdvisorAnswer {
  question: string;
  answer: string;       // structured text (Short Answer / Data Used / ...)
  llmUsed: boolean;
  dataBlock: string;    // the exact verified data the answer is grounded in
}

const money = (m: MetricsBundle, n: number) => `${m.currency}${Math.round(n).toLocaleString()}`;

const scrub = (t: string): string => {
  let s = t;
  for (const p of BANNED_PHRASES) s = s.replace(new RegExp(p, 'ig'), 'strong retention results');
  return s;
};

// Grounded fallback answer when no LLM key is configured. Still uses the
// real metrics and the required section structure.
const templateAnswer = (question: string, m: MetricsBundle): string => {
  const atRisk = m.segments.atRisk + m.segments.lost;
  const lines = [
    `Short Answer: ${atRisk > 0 ? `${atRisk} customers are at risk or lost and should be your focus today.` : `Your customer base looks steady — keep capturing visits and stay consistent.`}`,
    `Data Used: ${m.customers.total} customers, ${m.segments.atRisk} at-risk, ${m.segments.lost} lost, ${m.visits.available ? `${m.visits.current} visits` : 'no visit data yet'}, revenue ${m.revenue.available ? money(m, m.revenue.current) : 'not available'}.`,
    `What It Means: ${atRisk > 0 ? 'A group of customers who used to come in have started to drift away.' : 'No urgent churn signal right now.'}`,
    `What To Do: ${atRisk > 0 ? 'Send a customer comeback offer to the At Risk audience.' : 'Send a simple thank-you or reward to recent customers.'}`,
    `Why It Matters: Customers who already know you are cheaper to bring back than finding new ones, and they spend more once they return.`,
    `How To Do It In The Loyaly: Open Campaigns, choose the At Risk audience, pick a friendly offer, review the message and schedule it.`,
    `What To Check Next: Watch how many at-risk customers come back over the next 2 weeks on the Dashboard.`,
  ];
  if (m.missing.length) lines.push(`Note: ${m.missing[0]}`);
  return lines.join('\n');
};

export const answerQuestion = async (
  businessId: string,
  question: string,
): Promise<AdvisorAnswer> => {
  const m = await computeMetrics(businessId, 'WEEKLY');
  const dataBlock = metricsToBlock(m);

  if (!isAIConfigured()) {
    await logAIRun({ businessId, taskType: 'ADVISOR', inputSummary: question.slice(0, 120), status: 'LLM_DISABLED' });
    return { question, answer: templateAnswer(question, m), llmUsed: false, dataBlock };
  }

  try {
    const out = await callLLM([
      { role: 'system', content: advisorSystemPrompt() },
      { role: 'user', content: advisorUserPrompt(question, dataBlock) },
    ], 600);
    await logAIRun({ businessId, taskType: 'ADVISOR', inputSummary: question.slice(0, 120), outputSummary: 'advisor answer', status: 'OK' });
    const answer = out && out.trim().length > 30 ? scrub(out.trim()) : templateAnswer(question, m);
    return { question, answer, llmUsed: out.trim().length > 30, dataBlock };
  } catch (e) {
    await logAIRun({ businessId, taskType: 'ADVISOR', inputSummary: question.slice(0, 120), status: 'ERROR', error: (e as Error).message });
    return { question, answer: templateAnswer(question, m), llmUsed: false, dataBlock };
  }
};
