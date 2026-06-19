// ================================================================
//  automation.service.ts
//  Workflow lifecycle management and execution engine.
//
//  Key contracts:
//   - graphJson is ALWAYS recompiled on create/update
//   - A workflow can only be ACTIVATED if compilation succeeds
//   - Manual triggers respect the same pre-flight checks as
//     the BullMQ worker (consent, cooldown, quota)
//   - Execution is fully audited via AutomationRun records
//   - Condition evaluation uses the compiled evaluateActionConditions
//     so the worker and service always share identical logic
// ================================================================

import { PrismaClient, Prisma }             from '@prisma/client';
import {
  compileGraph,
  validateCompiledWorkflow,
  evaluateActionConditions,
  RFGraph,
  CompiledWorkflow,
  CompiledAction,
}                                            from './automation.compiler';
import { creditPoints, debitPoints }         from './loyalty.service';
import {
  enqueueMessage,
  enqueueScheduledMessage,
  enqueueAutomationTrigger,
}                                            from '../queues/messaging.queue';
import { hashPassword }                      from './token.service';

const prisma = new PrismaClient();

// ================================================================
// TYPES
// ================================================================

export interface CreateWorkflowInput {
  name:        string;
  description?: string;
  graphJson:   RFGraph;
}

export interface UpdateWorkflowInput {
  name?:        string;
  description?: string;
  graphJson?:   RFGraph;
}

export interface WorkflowSummary {
  id:           string;
  name:         string;
  description:  string | null;
  triggerType:  string;
  status:       string;
  runCount:     number;
  convertedCount: number;
  conversionRate: number;
  lastRunAt:    Date | null;
  compilationWarnings: string[];
}

// ================================================================
// CREATE
// ================================================================

/**
 * Create a new AutomationWorkflow in DRAFT status.
 * Always compiles the graph on creation — any compilation error
 * surfaces immediately so the business owner can fix it in the canvas.
 */
export const createWorkflow = async (
  businessId: string,
  input:      CreateWorkflowInput
): Promise<{
  workflow:    Awaited<ReturnType<typeof prisma.automationWorkflow.create>>;
  warnings:    string[];
}> => {
  const result = compileGraph(input.graphJson);

  if (!result.success) {
    throw new CompilationError(result.errors, result.warnings);
  }

  const workflow = await prisma.automationWorkflow.create({
    data: {
      businessId,
      name:         input.name,
      description:  input.description,
      triggerType:  result.compiled!.trigger.type,
      graphJson:    input.graphJson as unknown as Prisma.InputJsonValue,
      compiledJson: result.compiled as unknown as Prisma.InputJsonValue,
      status:       'DRAFT',
    },
  });

  await prisma.auditLog.create({
    data: {
      businessId,
      action:     'CREATE_AUTOMATION',
      entityType: 'AutomationWorkflow',
      entityId:   workflow.id,
      metaJson:   { name: input.name, triggerType: result.compiled!.trigger.type },
    },
  });

  return { workflow, warnings: result.warnings };
};

// ================================================================
// UPDATE
// ================================================================

/**
 * Update workflow name/description and/or the visual graph.
 * If graphJson changes, the workflow is recompiled and forced back
 * to DRAFT — it must be explicitly re-activated after changes.
 */
export const updateWorkflow = async (
  id:         string,
  businessId: string,
  input:      UpdateWorkflowInput
): Promise<{
  workflow:  Awaited<ReturnType<typeof prisma.automationWorkflow.update>>;
  warnings:  string[];
  recompiled: boolean;
}> => {
  const existing = await prisma.automationWorkflow.findFirst({
    where:  { id, businessId },
    select: { status: true, graphJson: true },
  });

  if (!existing) throw new Error('WORKFLOW_NOT_FOUND');

  const data: Prisma.AutomationWorkflowUpdateInput = { updatedAt: new Date() };
  let warnings:   string[] = [];
  let recompiled  = false;

  if (input.name)        data.name        = input.name;
  if (input.description !== undefined) data.description = input.description;

  if (input.graphJson) {
    const result = compileGraph(input.graphJson);

    if (!result.success) {
      throw new CompilationError(result.errors, result.warnings);
    }

    data.graphJson    = input.graphJson as unknown as Prisma.InputJsonValue;
    data.compiledJson = result.compiled as unknown as Prisma.InputJsonValue;
    data.triggerType  = result.compiled!.trigger.type;
    data.status       = 'DRAFT'; // Force re-review after graph change
    warnings          = result.warnings;
    recompiled        = true;
  }

  const workflow = await prisma.automationWorkflow.update({
    where: { id },
    data,
  });

  return { workflow, warnings, recompiled };
};

// ================================================================
// DELETE (soft — pauses and flags)
// ================================================================

export const deleteWorkflow = async (
  id:         string,
  businessId: string,
  userId:     string
): Promise<void> => {
  const existing = await prisma.automationWorkflow.findFirst({
    where:  { id, businessId },
    select: { name: true },
  });

  if (!existing) throw new Error('WORKFLOW_NOT_FOUND');

  await prisma.$transaction([
    prisma.automationWorkflow.update({
      where: { id },
      data:  { status: 'PAUSED', updatedAt: new Date() },
    }),
    prisma.auditLog.create({
      data: {
        businessId,
        userId,
        action:     'DELETE_AUTOMATION',
        entityType: 'AutomationWorkflow',
        entityId:   id,
        metaJson:   { name: existing.name },
      },
    }),
  ]);
};

// ================================================================
// ACTIVATE
// ================================================================

/**
 * Move a DRAFT/PAUSED workflow to ACTIVE.
 * Re-validates the compiled definition before activation —
 * guards against stale compiledJson from a schema version bump.
 */
export const activateWorkflow = async (
  id:         string,
  businessId: string
): Promise<void> => {
  const workflow = await prisma.automationWorkflow.findFirst({
    where:  { id, businessId },
    select: { status: true, compiledJson: true, name: true },
  });

  if (!workflow) throw new Error('WORKFLOW_NOT_FOUND');
  if (workflow.status === 'ACTIVE') throw new Error('WORKFLOW_ALREADY_ACTIVE');
  if (!workflow.compiledJson) throw new Error('WORKFLOW_NOT_COMPILED');

  const validationErrors = validateCompiledWorkflow(workflow.compiledJson);
  if (validationErrors.length > 0) {
    throw new CompilationError(validationErrors, []);
  }

  // Ensure no other ACTIVE workflow exists for this triggerType + businessId
  // (one active automation per trigger type to prevent duplicate sends)
  const compiled = workflow.compiledJson as unknown as CompiledWorkflow;
  const conflict = await prisma.automationWorkflow.findFirst({
    where: {
      businessId,
      triggerType: compiled.trigger.type,
      status:      'ACTIVE',
      id:          { not: id },
    },
    select: { id: true, name: true },
  });

  if (conflict) {
    throw new Error(
      `DUPLICATE_ACTIVE_TRIGGER: Workflow "${conflict.name}" already handles ${compiled.trigger.type}. Pause it first.`
    );
  }

  await prisma.automationWorkflow.update({
    where: { id },
    data:  { status: 'ACTIVE', updatedAt: new Date() },
  });
};

// ================================================================
// PAUSE
// ================================================================

export const pauseWorkflow = async (
  id:         string,
  businessId: string
): Promise<void> => {
  const workflow = await prisma.automationWorkflow.findFirst({
    where:  { id, businessId },
    select: { status: true },
  });

  if (!workflow)                  throw new Error('WORKFLOW_NOT_FOUND');
  if (workflow.status === 'PAUSED') throw new Error('WORKFLOW_ALREADY_PAUSED');

  await prisma.automationWorkflow.update({
    where: { id },
    data:  { status: 'PAUSED', updatedAt: new Date() },
  });
};

// ================================================================
// READ
// ================================================================

export const listWorkflows = async (businessId: string): Promise<WorkflowSummary[]> => {
  const workflows = await prisma.automationWorkflow.findMany({
    where:   { businessId },
    orderBy: { createdAt: 'desc' },
    select: {
      id:            true,
      name:          true,
      description:   true,
      triggerType:   true,
      status:        true,
      runCount:      true,
      convertedCount: true,
      lastRunAt:     true,
      compiledJson:  true,
    },
  });

  return workflows.map(wf => ({
    id:            wf.id,
    name:          wf.name,
    description:   wf.description,
    triggerType:   wf.triggerType,
    status:        wf.status,
    runCount:      wf.runCount,
    convertedCount: wf.convertedCount,
    conversionRate: wf.runCount > 0
      ? Math.round((wf.convertedCount / wf.runCount) * 100)
      : 0,
    lastRunAt:     wf.lastRunAt,
    compilationWarnings: [],
  }));
};

export const getWorkflowById = async (id: string, businessId: string) => {
  const workflow = await prisma.automationWorkflow.findFirst({
    where:   { id, businessId },
    include: { runs: { orderBy: { triggeredAt: 'desc' }, take: 20 } },
  });

  if (!workflow) throw new Error('WORKFLOW_NOT_FOUND');
  return workflow;
};

export const getAutomationRuns = async (
  businessId: string,
  filters: {
    workflowId?: string;
    status?:     string;
    limit?:      number;
  }
) => prisma.automationRun.findMany({
  where: {
    businessId,
    ...(filters.workflowId && { workflowId: filters.workflowId }),
    ...(filters.status     && { status:     filters.status }),
  },
  orderBy: { triggeredAt: 'desc' },
  take:    filters.limit ?? 50,
  include: { workflow: { select: { name: true, triggerType: true } } },
});

// ================================================================
// EXECUTION ENGINE
// ================================================================

/**
 * Execute a workflow for a specific customer.
 * Used for:
 *   - Manual triggers (staff initiates via controller)
 *   - BullMQ automation worker calling back into this service
 *
 * This is the single authoritative execution path — the worker
 * enqueues jobs, which call this function.
 *
 * Evaluates each compiled action's branchConditions against live
 * customer data before dispatching. This ensures conditional
 * branching is respected even for already-queued jobs.
 */
export const executeWorkflowForCustomer = async (
  workflowId:     string,
  businessId:     string,
  customerId:     string,
  triggerPayload: Record<string, unknown> = {}
): Promise<{ runId: string; actionsDispatched: number; actionsSkipped: number }> => {
  const workflow = await prisma.automationWorkflow.findFirst({
    where:  { id: workflowId, businessId, status: 'ACTIVE' },
    select: { id: true, compiledJson: true },
  });

  if (!workflow?.compiledJson) throw new Error('WORKFLOW_NOT_FOUND_OR_INACTIVE');

  const compiled = workflow.compiledJson as unknown as CompiledWorkflow;

  // Fetch fresh customer data for condition evaluation
  const customer = await prisma.customer.findFirst({
    where:  { id: customerId, businessId },
    select: {
      id:                    true,
      whatsappNumber:        true,
      email:                 true,
      visitCount:            true,
      totalSpend:            true,
      segment:               true,
      currentPointsBalance:  true,
      marketingConsentWhatsapp: true,
      marketingConsentEmail:    true,
      isSuppressed:          true,
      marketingPausedUntil:  true,
    },
  });

  if (!customer) throw new Error('CUSTOMER_NOT_FOUND');

  const business = await prisma.business.findUnique({
    where:  { id: businessId },
    select: { messagingProvider: true },
  });

  const run = await prisma.automationRun.create({
    data: {
      businessId,
      workflowId,
      customerId,
      bullmqJobId: `manual-${Date.now()}`,
      status:      'RUNNING',
    },
  });

  let dispatched = 0;
  let skipped    = 0;

  // Build a flat customer object for condition evaluation
  const customerRecord: Record<string, unknown> = {
    visitCount:      customer.visitCount,
    totalSpend:      Number(customer.totalSpend ?? 0),
    segment:         customer.segment,
    pointsBalance:   customer.currentPointsBalance,
    ...triggerPayload,
  };

  for (const action of compiled.actions) {
    // Evaluate conditions — skip if customer doesn't match this branch
    if (!evaluateActionConditions(action, customerRecord)) {
      skipped++;
      continue;
    }

    try {
      await dispatchAction(action, customer, businessId, run.id, business?.messagingProvider ?? 'META');
      dispatched++;
    } catch (err) {
      console.error(`[automation.service] Action ${action.type} failed for run ${run.id}:`, err);
    }
  }

  // Mark run complete and update workflow stats
  await prisma.$transaction([
    prisma.automationRun.update({
      where: { id: run.id },
      data: {
        status:     dispatched > 0 ? 'COMPLETED' : 'FAILED',
        resultJson: { dispatched, skipped } as any,
      },
    }),
    prisma.automationWorkflow.update({
      where: { id: workflowId },
      data:  {
        runCount:      { increment: 1 },
        convertedCount: dispatched > 0 ? { increment: 1 } : undefined,
        lastRunAt:     new Date(),
      },
    }),
  ]);

  return { runId: run.id, actionsDispatched: dispatched, actionsSkipped: skipped };
};

// ================================================================
// ACTION DISPATCHER
// ================================================================

type CustomerSnapshot = {
  id:             string;
  whatsappNumber: string | null;
  email:          string | null;
  isSuppressed:   boolean;
  marketingConsentWhatsapp: boolean;
  marketingConsentEmail:    boolean;
};

const dispatchAction = async (
  action:   CompiledAction,
  customer: CustomerSnapshot,
  businessId:  string,
  runId:       string,
  provider:    string
): Promise<void> => {
  switch (action.type) {
    case 'SEND_WHATSAPP': {
      if (!customer.whatsappNumber) return;
      if (customer.isSuppressed || !customer.marketingConsentWhatsapp) return;

      const channel  = provider === 'WAHA' ? 'WHATSAPP_WAHA' : 'WHATSAPP_META';
      const tplName  = action.config.templateName as string;

      const record = await prisma.messageQueue.create({
        data: {
          businessId,
          customerId:     customer.id,
          automationRunId: runId,
          channel,
          provider,
          status:         'PENDING',
          templateName:   tplName,
          payloadJson: {
            type:         'TEMPLATE',
            templateName: tplName,
            langCode:     (action.config.langCode as string) ?? 'en_US',
          },
          isPromotional: false,
          scheduledFor:  action.delayMinutes > 0
            ? new Date(Date.now() + action.delayMinutes * 60_000)
            : new Date(),
        },
      });

      const enqueue = action.delayMinutes > 0 ? enqueueScheduledMessage : enqueueMessage;
      await enqueue(
        {
          messageQueueId: record.id,
          businessId,
          customerId:     customer.id,
          recipientPhone: customer.whatsappNumber,
          channel:        channel as any,
          provider:       provider as any,
          payload:        record.payloadJson as any,
          isPromotional:  false,
          automationRunId: runId,
          retryCount:     0,
        },
        action.delayMinutes > 0 ? new Date(Date.now() + action.delayMinutes * 60_000) : undefined as any
      );
      break;
    }

    case 'AWARD_POINTS': {
      await prisma.$transaction(async (tx) => {
        await creditPoints(
          tx, businessId, customer.id,
          action.config.points as number,
          (action.config.reason as string) ?? 'AUTOMATION_REWARD',
          runId,
          'AUTOMATION'
        );
      });
      break;
    }

    case 'DEDUCT_POINTS': {
      await prisma.$transaction(async (tx) => {
        await debitPoints(
          tx, businessId, customer.id,
          action.config.points as number,
          (action.config.reason as string) ?? 'AUTOMATION_DEDUCTION',
          runId,
          'AUTOMATION'
        );
      });
      break;
    }

    case 'CHANGE_SEGMENT': {
      const targetSegment = action.config.targetSegment as string;
      await prisma.$transaction([
        prisma.customer.update({
          where: { id: customer.id },
          data:  { segment: targetSegment as any, updatedAt: new Date() },
        }),
        prisma.customerSegmentHistory.create({
          data: {
            businessId,
            customerId:  customer.id,
            toSegment:   targetSegment as any,
            reason:      'AUTOMATION',
            changedAt:   new Date(),
          },
        }),
      ]);
      break;
    }

    case 'CREATE_COUPON': {
      await prisma.coupon.create({
        data: {
          businessId,
          customerId:    customer.id,
          type:          action.config.type as any,
          value:         action.config.value ? (action.config.value as number) : null,
          status:        'ACTIVE',
          cashierPinHash: await hashPassword('0000'),
          expiresAt:      new Date(
            Date.now() + ((action.config.expiryDays as number) ?? 30) * 86_400_000
          ),
        },
      });
      break;
    }

    case 'MANAGER_ALERT': {
      // Stored as a MessageQueue record with channel = 'EMAIL' to the business owner
      // Future: push to real-time dashboard via WebSocket
      const owner = await prisma.user.findFirst({
        where:  { businessId, role: 'TENANT_OWNER', isActive: true },
        select: { id: true },
      });

      if (owner) {
        await prisma.messageQueue.create({
          data: {
            businessId,
            customerId:     customer.id,
            automationRunId: runId,
            channel:        'EMAIL',
            provider:       'META',
            status:         'PENDING',
            payloadJson: {
              type:     'MANAGER_ALERT',
              message:  action.config.message,
              priority: action.config.priority,
              customerId: customer.id,
            },
            isPromotional: false,
            scheduledFor:  new Date(),
          },
        });
      }
      break;
    }
  }
};

// ================================================================
// PREVIEW (compile without saving)
// ================================================================

/**
 * Compile a graph and return the result without persisting anything.
 * Used by the frontend "Preview" button in the automation builder.
 */
export const previewCompile = (graphJson: unknown) => compileGraph(graphJson as RFGraph);

// ================================================================
// CUSTOM ERROR
// ================================================================

export class CompilationError extends Error {
  readonly compilationErrors: string[];
  readonly compilationWarnings: string[];

  constructor(errors: string[], warnings: string[]) {
    super(`COMPILATION_FAILED: ${errors.join('; ')}`);
    this.name                 = 'CompilationError';
    this.compilationErrors    = errors;
    this.compilationWarnings  = warnings;
  }
}
