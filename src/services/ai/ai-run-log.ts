// ================================================================
//  ai-run-log.ts
//  Records AI usage per tenant for cost control + auditing. Stores only
//  short, non-sensitive summaries — never raw customer PII.
// ================================================================

import { prisma } from '../../config/prisma';

// Rough cost estimate (USD) for the routing models. Used for visibility only.
const COST_PER_1K: Record<string, { in: number; out: number }> = {
  'claude-haiku-4-5-20251001': { in: 0.0008, out: 0.004 },
  'gpt-4o-mini':               { in: 0.00015, out: 0.0006 },
  default:                     { in: 0.0005, out: 0.0015 },
};

export interface AIRunInput {
  businessId: string;
  taskType: 'ADVISOR' | 'WEEKLY_REPORT' | 'MONTHLY_REPORT' | 'YEARLY_REPORT' | 'PROJECTION';
  inputSummary?: string;
  outputSummary?: string;
  model?: string;
  promptTokens?: number;
  completionTokens?: number;
  status?: 'OK' | 'ERROR' | 'LLM_DISABLED';
  error?: string;
}

export const estimateCost = (model: string, promptTokens: number, completionTokens: number): number => {
  const c = COST_PER_1K[model] ?? COST_PER_1K.default;
  return Math.round((promptTokens / 1000 * c.in + completionTokens / 1000 * c.out) * 1e6) / 1e6;
};

/** Best-effort: a logging failure must never break the AI feature. */
export const logAIRun = async (input: AIRunInput): Promise<void> => {
  try {
    const pt = input.promptTokens ?? 0;
    const ct = input.completionTokens ?? 0;
    await prisma.aIRunLog.create({
      data: {
        businessId: input.businessId,
        taskType: input.taskType,
        inputSummary: input.inputSummary?.slice(0, 300) ?? null,
        outputSummary: input.outputSummary?.slice(0, 300) ?? null,
        model: input.model ?? null,
        promptTokens: pt,
        completionTokens: ct,
        costEstimate: input.model ? estimateCost(input.model, pt, ct) : 0,
        status: input.status ?? 'OK',
        error: input.error?.slice(0, 500) ?? null,
      },
    });
  } catch { /* swallow */ }
};
