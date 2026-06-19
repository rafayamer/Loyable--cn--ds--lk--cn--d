// ================================================================
//  automation.controller.ts
//  Express HTTP handlers + router for automation workflow management.
//
//  Route map:
//   GET    /api/automations                           → listHandler
//   POST   /api/automations                           → createHandler
//   GET    /api/automations/:id                       → getHandler
//   PUT    /api/automations/:id                       → updateHandler
//   DELETE /api/automations/:id                       → deleteHandler
//   POST   /api/automations/:id/activate              → activateHandler
//   POST   /api/automations/:id/pause                 → pauseHandler
//   POST   /api/automations/:id/trigger/:customerId   → manualTriggerHandler
//   GET    /api/automations/:id/runs                  → runsHandler
//   POST   /api/automations/preview                   → previewHandler
//
//  The frontend canvas sends raw reactflow graphJson.
//  This controller compiles it and either surfaces errors or persists
//  the workflow — the business owner never sees compilation internals.
// ================================================================

import { Request, Response, NextFunction, Router } from 'express';
import { z, ZodError }                             from 'zod';
import { Role }                                    from '@prisma/client';

import {
  createWorkflow,
  updateWorkflow,
  deleteWorkflow,
  activateWorkflow,
  pauseWorkflow,
  executeWorkflowForCustomer,
  listWorkflows,
  getWorkflowById,
  getAutomationRuns,
  previewCompile,
  CompilationError,
} from '../services/automation-service';

import {
  tenantScope,
  requireRoles,
} from '../middleware/tenant-scope-middleware';

// ================================================================
// ZOD SCHEMAS
// ================================================================

/** Lenient RFNode schema — we let the compiler do deep validation */
const RFNodeSchema = z.object({
  id:       z.string().min(1),
  type:     z.string().min(1),
  data:     z.record(z.unknown()),
  position: z.object({ x: z.number(), y: z.number() }),
  selected: z.boolean().optional(),
}).passthrough();

const RFEdgeSchema = z.object({
  id:            z.string().min(1),
  source:        z.string().min(1),
  target:        z.string().min(1),
  sourceHandle:  z.string().optional(),
  label:         z.string().optional(),
}).passthrough();

const GraphSchema = z.object({
  nodes: z.array(RFNodeSchema).min(1, 'Graph must have at least one node'),
  edges: z.array(RFEdgeSchema),
});

const CreateWorkflowSchema = z.object({
  name:        z.string().min(1, 'Name is required').max(100),
  description: z.string().max(500).optional(),
  graphJson:   GraphSchema,
});

const UpdateWorkflowSchema = z.object({
  name:        z.string().min(1).max(100).optional(),
  description: z.string().max(500).optional(),
  graphJson:   GraphSchema.optional(),
});

const ManualTriggerSchema = z.object({
  triggerPayload: z.record(z.unknown()).optional().default({}),
}).optional().default({});

const RunsFilterSchema = z.object({
  status: z.enum(['RUNNING', 'COMPLETED', 'FAILED', 'SKIPPED_CONSENT']).optional(),
  limit:  z.coerce.number().int().min(1).max(200).optional().default(50),
});

// ================================================================
// VALIDATION MIDDLEWARE
// ================================================================

const validate = (schema: z.ZodSchema) =>
  (req: Request, res: Response, next: NextFunction): void => {
    try {
      req.body = schema.parse(req.body);
      next();
    } catch (err) {
      if (err instanceof ZodError) {
        res.status(400).json({
          error:  'VALIDATION_ERROR',
          fields: err.errors.map(e => ({ path: e.path.join('.'), message: e.message })),
        });
      } else {
        next(err);
      }
    }
  };

// ================================================================
// ERROR HANDLER
// ================================================================

const AUTOMATION_ERROR_STATUS: Record<string, number> = {
  WORKFLOW_NOT_FOUND:               404,
  WORKFLOW_ALREADY_ACTIVE:          409,
  WORKFLOW_ALREADY_PAUSED:          409,
  WORKFLOW_NOT_COMPILED:            422,
  CUSTOMER_NOT_FOUND:               404,
  WORKFLOW_NOT_FOUND_OR_INACTIVE:   404,
  COMPILATION_FAILED:               422,
};

const handleError = (err: unknown, res: Response): void => {
  if (err instanceof CompilationError) {
    res.status(422).json({
      error:    'COMPILATION_FAILED',
      errors:   err.compilationErrors,
      warnings: err.compilationWarnings,
      hint:     'Fix the errors in the automation canvas and save again.',
    });
    return;
  }

  const msg    = err instanceof Error ? err.message : 'UNKNOWN_ERROR';
  const base   = msg.split(':')[0].trim();
  const status = AUTOMATION_ERROR_STATUS[base] ?? 500;

  if (status === 500) console.error('[automation.controller]', err);

  res.status(status).json({ error: status === 500 ? 'INTERNAL_ERROR' : msg });
};

// ================================================================
// HANDLERS
// ================================================================

/**
 * GET /api/automations
 * List all workflows for the tenant with stats.
 */
const listHandler = async (req: Request, res: Response): Promise<void> => {
  try {
    const workflows = await listWorkflows(req.tenantContext.businessId);
    res.status(200).json(workflows);
  } catch (err) { handleError(err, res); }
};

/**
 * POST /api/automations
 * Create a new workflow. Compiles graphJson immediately.
 * Returns compilation warnings if any (non-fatal).
 * Returns 422 with structured errors if compilation fails.
 */
const createHandler = async (req: Request, res: Response): Promise<void> => {
  try {
    const { businessId } = req.tenantContext;
    const input          = req.body as z.infer<typeof CreateWorkflowSchema>;

    const { workflow, warnings } = await createWorkflow(businessId, input);

    res.status(201).json({
      workflow,
      warnings,
      message: warnings.length > 0
        ? 'Workflow created with warnings. Review before activating.'
        : 'Workflow created in DRAFT status. Activate when ready.',
    });
  } catch (err) { handleError(err, res); }
};

/**
 * GET /api/automations/:id
 * Full workflow detail including last 20 runs.
 */
const getHandler = async (req: Request, res: Response): Promise<void> => {
  try {
    const workflow = await getWorkflowById(req.params.id, req.tenantContext.businessId);
    res.status(200).json(workflow);
  } catch (err) { handleError(err, res); }
};

/**
 * PUT /api/automations/:id
 * Update name/description and/or graphJson.
 * If graphJson changes: recompiles, forces back to DRAFT.
 */
const updateHandler = async (req: Request, res: Response): Promise<void> => {
  try {
    const { businessId } = req.tenantContext;
    const input          = req.body as z.infer<typeof UpdateWorkflowSchema>;

    const { workflow, warnings, recompiled } = await updateWorkflow(
      req.params.id,
      businessId,
      input
    );

    res.status(200).json({
      workflow,
      warnings,
      recompiled,
      message: recompiled
        ? 'Workflow graph updated and recompiled. Status reset to DRAFT — re-activate to resume.'
        : 'Workflow metadata updated.',
    });
  } catch (err) { handleError(err, res); }
};

/**
 * DELETE /api/automations/:id
 * Soft-deletes by pausing. Preserves run history.
 */
const deleteHandler = async (req: Request, res: Response): Promise<void> => {
  try {
    const { businessId, userId } = req.tenantContext;
    await deleteWorkflow(req.params.id, businessId, userId);
    res.status(204).send();
  } catch (err) { handleError(err, res); }
};

/**
 * POST /api/automations/:id/activate
 * Validates compiled definition and sets status to ACTIVE.
 * Returns 409 if another workflow for the same trigger type is already active.
 */
const activateHandler = async (req: Request, res: Response): Promise<void> => {
  try {
    await activateWorkflow(req.params.id, req.tenantContext.businessId);
    res.status(200).json({ message: 'Workflow activated. BullMQ worker will pick up new triggers.' });
  } catch (err) { handleError(err, res); }
};

/**
 * POST /api/automations/:id/pause
 * Pauses an ACTIVE workflow. In-flight runs complete normally.
 */
const pauseHandler = async (req: Request, res: Response): Promise<void> => {
  try {
    await pauseWorkflow(req.params.id, req.tenantContext.businessId);
    res.status(200).json({ message: 'Workflow paused. In-flight runs will complete.' });
  } catch (err) { handleError(err, res); }
};

/**
 * POST /api/automations/:id/trigger/:customerId
 * Manually execute a workflow for a specific customer.
 * Respects the same condition evaluation as the BullMQ worker.
 * Useful for testing, staff-initiated win-back, or customer service.
 */
const manualTriggerHandler = async (req: Request, res: Response): Promise<void> => {
  try {
    const { businessId } = req.tenantContext;
    const { id: workflowId, customerId } = req.params;
    const { triggerPayload } = (req.body ?? {}) as { triggerPayload?: Record<string, unknown> };

    const result = await executeWorkflowForCustomer(
      workflowId,
      businessId,
      customerId,
      triggerPayload ?? {}
    );

    res.status(200).json({
      runId:             result.runId,
      actionsDispatched: result.actionsDispatched,
      actionsSkipped:    result.actionsSkipped,
      message: `Workflow executed. ${result.actionsDispatched} actions dispatched, ${result.actionsSkipped} skipped (conditions not met).`,
    });
  } catch (err) { handleError(err, res); }
};

/**
 * GET /api/automations/:id/runs
 * Paginated run history for a workflow.
 */
const runsHandler = async (req: Request, res: Response): Promise<void> => {
  try {
    const { businessId } = req.tenantContext;
    const filters        = RunsFilterSchema.parse(req.query);

    const runs = await getAutomationRuns(businessId, {
      workflowId: req.params.id,
      status:     filters.status,
      limit:      filters.limit,
    });

    res.status(200).json(runs);
  } catch (err) { handleError(err, res); }
};

/**
 * POST /api/automations/preview
 * Compile a graph and return the compiled definition WITHOUT saving.
 * Used by the canvas "Validate" button — gives the owner instant
 * feedback on errors before they save the workflow.
 *
 * Returns 200 with compiled definition + warnings on success.
 * Returns 422 with structured errors on compilation failure.
 */
const previewHandler = async (req: Request, res: Response): Promise<void> => {
  try {
    const { graphJson } = req.body as { graphJson: unknown };

    if (!graphJson) {
      res.status(400).json({ error: 'graphJson is required' });
      return;
    }

    const result = previewCompile(graphJson);

    if (!result.success) {
      res.status(422).json({
        success:  false,
        errors:   result.errors,
        warnings: result.warnings,
        hint:     'Fix these errors in the canvas before saving.',
      });
      return;
    }

    res.status(200).json({
      success:  true,
      compiled: result.compiled,
      warnings: result.warnings,
      summary: {
        triggerType:     result.compiled!.trigger.type,
        actionCount:     result.compiled!.actions.length,
        maxDelayMinutes: result.compiled!.metadata.maxDelayMinutes,
        hasConditions:   result.compiled!.metadata.hasConditions,
        hasBranching:    result.compiled!.metadata.hasBranching,
      },
    });
  } catch (err) { handleError(err, res); }
};

// ================================================================
// ROUTER ASSEMBLY
// ================================================================

export const automationRouter = Router();

automationRouter.use(tenantScope as any);

// Preview: no role restriction — used by the canvas (MARKETING_STAFF+)
automationRouter.post(
  '/preview',
  requireRoles(
    Role.TENANT_OWNER, Role.BRANCH_MANAGER, Role.MARKETING_STAFF
  ) as any,
  previewHandler
);

// CRUD
automationRouter.get(
  '/',
  requireRoles(Role.TENANT_OWNER, Role.BRANCH_MANAGER, Role.MARKETING_STAFF) as any,
  listHandler
);

automationRouter.post(
  '/',
  requireRoles(Role.TENANT_OWNER, Role.MARKETING_STAFF) as any,
  validate(CreateWorkflowSchema) as any,
  createHandler
);

automationRouter.get(
  '/:id',
  requireRoles(Role.TENANT_OWNER, Role.BRANCH_MANAGER, Role.MARKETING_STAFF) as any,
  getHandler
);

automationRouter.put(
  '/:id',
  requireRoles(Role.TENANT_OWNER, Role.MARKETING_STAFF) as any,
  validate(UpdateWorkflowSchema) as any,
  updateHandler
);

automationRouter.delete(
  '/:id',
  requireRoles(Role.TENANT_OWNER) as any,
  deleteHandler
);

// Lifecycle control
automationRouter.post(
  '/:id/activate',
  requireRoles(Role.TENANT_OWNER) as any,
  activateHandler
);

automationRouter.post(
  '/:id/pause',
  requireRoles(Role.TENANT_OWNER, Role.BRANCH_MANAGER) as any,
  pauseHandler
);

// Manual trigger: Owner + Branch Manager only (not Marketing Staff)
automationRouter.post(
  '/:id/trigger/:customerId',
  requireRoles(Role.TENANT_OWNER, Role.BRANCH_MANAGER) as any,
  validate(ManualTriggerSchema) as any,
  manualTriggerHandler
);

// Run history
automationRouter.get(
  '/:id/runs',
  requireRoles(Role.TENANT_OWNER, Role.BRANCH_MANAGER, Role.MARKETING_STAFF) as any,
  runsHandler
);

// ================================================================
// MOUNT IN app.ts:
//   import { automationRouter } from './controllers/automation.controller';
//   app.use('/api/automations', automationRouter);
// ================================================================
