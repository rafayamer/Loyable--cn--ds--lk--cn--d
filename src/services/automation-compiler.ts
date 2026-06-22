// ================================================================
//  automation.compiler.ts
//  Translates a raw reactflow { nodes, edges } graph into a
//  validated, executable CompiledWorkflow definition.
//
//  The visual graph is NEVER executed directly. It is always
//  compiled first. This provides:
//    - Structural validation before activation
//    - A stable, version-controlled execution contract
//    - Immunity from future reactflow schema changes
//    - Safe preview/dry-run without side effects
//
//  Compilation algorithm:
//    1. Validate graph structure (one trigger, no orphaned nodes)
//    2. BFS traversal from the trigger node following directed edges
//    3. Accumulate delay across DelayNodes into subsequent actions
//    4. Resolve conditional branches and tag actions with branch context
//    5. Produce CompiledWorkflow with full metadata
// ================================================================

// ================================================================
// REACTFLOW INPUT TYPES
// ================================================================

export interface RFNode {
  id:       string;
  type:     RFNodeType;
  data:     Record<string, unknown>;
  position: { x: number; y: number };
  selected?: boolean;
}

export type RFNodeType =
  | 'triggerNode'
  | 'actionNode'
  | 'delayNode'
  | 'conditionNode';

export interface RFEdge {
  id:            string;
  source:        string;
  target:        string;
  sourceHandle?: string; // 'yes' | 'no' on conditionNode edges
  label?:        string;
}

export interface RFGraph {
  nodes: RFNode[];
  edges: RFEdge[];
}

// ================================================================
// NODE DATA SHAPES (what the canvas stores in node.data)
// ================================================================

export type TriggerType =
  | 'BIRTHDAY'
  | 'INACTIVITY'
  | 'VISIT_MILESTONE'
  | 'TIER_UPGRADE'
  | 'SENTIMENT_NEGATIVE'
  | 'SPEND_THRESHOLD'
  | 'REFERRAL_CONVERTED';

export type ActionType =
  | 'SEND_WHATSAPP'
  | 'SEND_EMAIL'
  | 'AWARD_POINTS'
  | 'DEDUCT_POINTS'
  | 'CHANGE_SEGMENT'
  | 'CREATE_COUPON'
  | 'MANAGER_ALERT';

export interface TriggerNodeData {
  triggerType: TriggerType;
  config: {
    daysInactive?:   number; // INACTIVITY
    visitCount?:     number; // VISIT_MILESTONE
    spendThreshold?: number; // SPEND_THRESHOLD
  };
}

export interface ActionNodeData {
  actionType:     ActionType;
  // SEND_WHATSAPP
  templateName?:  string;
  langCode?:      string;
  // AWARD_POINTS / DEDUCT_POINTS
  points?:        number;
  reason?:        string;
  // CHANGE_SEGMENT
  targetSegment?: string;
  // CREATE_COUPON
  couponType?:    'PERCENTAGE_DISCOUNT' | 'FIXED_VALUE' | 'FREE_PRODUCT';
  couponValue?:   number;
  expiryDays?:    number;
  // MANAGER_ALERT
  alertMessage?:  string;
  alertPriority?: 'LOW' | 'MEDIUM' | 'HIGH';
  // SEND_EMAIL
  emailTemplateId?: string;
  emailSubject?:    string;
}

export interface DelayNodeData {
  delayMinutes: number;
  label?:       string;
}

export interface ConditionNodeData {
  field:    string;   // Customer property: visitCount, totalSpend, segment, etc.
  operator: 'eq' | 'neq' | 'gt' | 'lt' | 'gte' | 'lte' | 'in' | 'not_in';
  value:    unknown;
  label?:   string;
}

// ================================================================
// COMPILED OUTPUT TYPES
// ================================================================

export interface CompiledTrigger {
  type:   TriggerType;
  config: Record<string, unknown>;
}

export interface CompiledCondition {
  field:    string;
  operator: string;
  value:    unknown;
  branch:   'yes' | 'no';
}

export interface CompiledAction {
  order:            number;
  nodeId:           string;   // Traces back to the canvas for debugging
  type:             ActionType;
  delayMinutes:     number;   // Absolute delay from trigger fire, not relative
  config:           Record<string, unknown>;
  branchConditions: CompiledCondition[];  // Empty = unconditional
}

export interface CompiledWorkflow {
  schemaVersion: number;        // Bump when compiled format changes
  trigger:       CompiledTrigger;
  actions:       CompiledAction[];
  metadata: {
    nodeCount:      number;
    actionCount:    number;
    maxDelayMinutes: number;
    hasConditions:  boolean;
    hasBranching:   boolean;
    compiledAt:     string;
    triggerType:    TriggerType;
  };
}

export interface CompilationResult {
  success:  boolean;
  compiled: CompiledWorkflow | null;
  errors:   string[];
  warnings: string[];
}

// ================================================================
// SCHEMA VERSION
// ================================================================

const COMPILED_SCHEMA_VERSION = 1;

// ================================================================
// VALIDATION RULES
// ================================================================

const VALID_TRIGGER_TYPES = new Set<TriggerType>([
  'BIRTHDAY', 'INACTIVITY', 'VISIT_MILESTONE', 'TIER_UPGRADE',
  'SENTIMENT_NEGATIVE', 'SPEND_THRESHOLD', 'REFERRAL_CONVERTED',
]);

const VALID_ACTION_TYPES = new Set<ActionType>([
  'SEND_WHATSAPP', 'SEND_EMAIL', 'AWARD_POINTS', 'DEDUCT_POINTS',
  'CHANGE_SEGMENT', 'CREATE_COUPON', 'MANAGER_ALERT',
]);

const VALID_OPERATORS = new Set([
  'eq', 'neq', 'gt', 'lt', 'gte', 'lte', 'in', 'not_in',
]);

const VALID_SEGMENTS = new Set([
  'NEW', 'LOYAL', 'VIP', 'AT_RISK', 'LOST', 'BIG_SPENDER', 'COUPON_HUNTER',
]);

// Max 20 action nodes per workflow to prevent runaway automation
const MAX_ACTION_NODES = 20;

// ================================================================
// MAIN COMPILER ENTRY POINT
// ================================================================

/**
 * Compile a raw reactflow graph into an executable CompiledWorkflow.
 *
 * This is the ONLY path through which a visual graph becomes a
 * runnable workflow. The output is stored in AutomationWorkflow.compiledJson.
 */
export const compileGraph = (graphJson: unknown): CompilationResult => {
  const errors:   string[] = [];
  const warnings: string[] = [];

  // ── Type guard / parse ────────────────────────────────────────
  if (!graphJson || typeof graphJson !== 'object') {
    return fail(['Graph JSON must be a non-null object.']);
  }

  const graph = graphJson as Partial<RFGraph>;

  if (!Array.isArray(graph.nodes) || !Array.isArray(graph.edges)) {
    return fail(['Graph must contain nodes and edges arrays.']);
  }

  const nodes: RFNode[] = graph.nodes;
  const edges: RFEdge[] = graph.edges;

  // ── Structural validation ─────────────────────────────────────
  const structureErrors = validateStructure(nodes, edges);
  if (structureErrors.length > 0) return fail(structureErrors);

  // ── Find trigger node ─────────────────────────────────────────
  const triggerNodes = nodes.filter(n => n.type === 'triggerNode');
  const triggerNode  = triggerNodes[0];
  const triggerData  = triggerNode.data as unknown as TriggerNodeData;

  // ── Build adjacency list ──────────────────────────────────────
  const adjacency = buildAdjacency(edges);

  // ── Check for orphaned non-trigger nodes ──────────────────────
  const reachable = getReachableNodeIds(triggerNode.id, adjacency);
  nodes
    .filter(n => n.type !== 'triggerNode' && !reachable.has(n.id))
    .forEach(n => warnings.push(
      `Node "${n.id}" (${n.type}) is not reachable from the trigger and will be ignored.`
    ));

  // ── Validate individual nodes ─────────────────────────────────
  for (const node of nodes) {
    const nodeErrors = validateNode(node);
    errors.push(...nodeErrors);
  }

  if (errors.length > 0) return fail(errors, warnings);

  // ── BFS traversal from trigger ────────────────────────────────
  const { actions, traversalErrors } = traverseGraph(
    triggerNode.id,
    adjacency,
    buildNodeMap(nodes),
    edges
  );
  errors.push(...traversalErrors);

  if (errors.length > 0) return fail(errors, warnings);

  if (actions.length === 0) {
    errors.push('Workflow must have at least one action node connected to the trigger.');
    return fail(errors, warnings);
  }

  // ── Check action count limit ──────────────────────────────────
  if (actions.length > MAX_ACTION_NODES) {
    errors.push(`Workflow has ${actions.length} actions. Maximum is ${MAX_ACTION_NODES}.`);
    return fail(errors, warnings);
  }

  // ── Produce compiled output ───────────────────────────────────
  const maxDelay     = actions.reduce((max, a) => Math.max(max, a.delayMinutes), 0);
  const hasConditions = actions.some(a => a.branchConditions.length > 0);
  const hasBranching  = edges.some(e => e.sourceHandle === 'yes' || e.sourceHandle === 'no');

  const compiled: CompiledWorkflow = {
    schemaVersion: COMPILED_SCHEMA_VERSION,
    trigger: {
      type:   triggerData.triggerType,
      config: extractTriggerConfig(triggerData),
    },
    actions,
    metadata: {
      nodeCount:       nodes.length,
      actionCount:     actions.length,
      maxDelayMinutes: maxDelay,
      hasConditions,
      hasBranching,
      compiledAt:      new Date().toISOString(),
      triggerType:     triggerData.triggerType,
    },
  };

  return { success: true, compiled, errors: [], warnings };
};

// ================================================================
// STRUCTURAL VALIDATION
// ================================================================

const validateStructure = (nodes: RFNode[], edges: RFEdge[]): string[] => {
  const errors: string[] = [];

  if (nodes.length === 0) {
    errors.push('Workflow must contain at least one node.');
    return errors;
  }

  const triggerNodes = nodes.filter(n => n.type === 'triggerNode');
  if (triggerNodes.length === 0) errors.push('Workflow must have exactly one Trigger node.');
  if (triggerNodes.length > 1)  errors.push('Workflow must have exactly one Trigger node (found multiple).');

  const actionNodes = nodes.filter(n => n.type === 'actionNode');
  if (actionNodes.length === 0) errors.push('Workflow must have at least one Action node.');

  // All edge endpoints must reference existing node IDs
  const nodeIds = new Set(nodes.map(n => n.id));
  for (const edge of edges) {
    if (!nodeIds.has(edge.source)) {
      errors.push(`Edge "${edge.id}" references non-existent source node "${edge.source}".`);
    }
    if (!nodeIds.has(edge.target)) {
      errors.push(`Edge "${edge.id}" references non-existent target node "${edge.target}".`);
    }
  }

  // No self-loops
  for (const edge of edges) {
    if (edge.source === edge.target) {
      errors.push(`Edge "${edge.id}" creates a self-loop on node "${edge.source}".`);
    }
  }

  // Cycle detection (DFS)
  if (errors.length === 0) {
    const cycleErrors = detectCycles(nodes, edges);
    errors.push(...cycleErrors);
  }

  return errors;
};

// ================================================================
// PER-NODE VALIDATION
// ================================================================

const validateNode = (node: RFNode): string[] => {
  const errors: string[] = [];
  const loc = `Node "${node.id}" (${node.type})`;

  switch (node.type) {
    case 'triggerNode': {
      const d = node.data as Partial<TriggerNodeData>;
      if (!d.triggerType) {
        errors.push(`${loc}: triggerType is required.`);
      } else if (!VALID_TRIGGER_TYPES.has(d.triggerType)) {
        errors.push(`${loc}: Unknown triggerType "${d.triggerType}".`);
      } else {
        // Type-specific config requirements
        if (d.triggerType === 'INACTIVITY' && !d.config?.daysInactive) {
          errors.push(`${loc}: INACTIVITY trigger requires config.daysInactive.`);
        }
        if (d.triggerType === 'VISIT_MILESTONE' && !d.config?.visitCount) {
          errors.push(`${loc}: VISIT_MILESTONE trigger requires config.visitCount.`);
        }
        if (d.triggerType === 'SPEND_THRESHOLD' && !d.config?.spendThreshold) {
          errors.push(`${loc}: SPEND_THRESHOLD trigger requires config.spendThreshold.`);
        }
      }
      break;
    }

    case 'actionNode': {
      const d = node.data as Partial<ActionNodeData>;
      if (!d.actionType) {
        errors.push(`${loc}: actionType is required.`);
        break;
      }
      if (!VALID_ACTION_TYPES.has(d.actionType)) {
        errors.push(`${loc}: Unknown actionType "${d.actionType}".`);
        break;
      }
      // Type-specific requirements
      if (d.actionType === 'SEND_WHATSAPP' && !d.templateName) {
        errors.push(`${loc}: SEND_WHATSAPP action requires templateName.`);
      }
      if (d.actionType === 'SEND_EMAIL' && !d.emailTemplateId) {
        errors.push(`${loc}: SEND_EMAIL action requires emailTemplateId.`);
      }
      if ((d.actionType === 'AWARD_POINTS' || d.actionType === 'DEDUCT_POINTS') && !d.points) {
        errors.push(`${loc}: ${d.actionType} requires points > 0.`);
      }
      if (d.actionType === 'CHANGE_SEGMENT') {
        if (!d.targetSegment) {
          errors.push(`${loc}: CHANGE_SEGMENT requires targetSegment.`);
        } else if (!VALID_SEGMENTS.has(d.targetSegment)) {
          errors.push(`${loc}: Unknown targetSegment "${d.targetSegment}".`);
        }
      }
      if (d.actionType === 'CREATE_COUPON' && !d.couponType) {
        errors.push(`${loc}: CREATE_COUPON requires couponType.`);
      }
      break;
    }

    case 'delayNode': {
      const d = node.data as Partial<DelayNodeData>;
      if (d.delayMinutes === undefined || d.delayMinutes === null) {
        errors.push(`${loc}: delayMinutes is required.`);
      } else if (!Number.isInteger(d.delayMinutes) || d.delayMinutes < 0) {
        errors.push(`${loc}: delayMinutes must be a non-negative integer.`);
      } else if (d.delayMinutes > 525_600) {
        errors.push(`${loc}: delayMinutes cannot exceed 1 year (525,600 minutes).`);
      }
      break;
    }

    case 'conditionNode': {
      const d = node.data as Partial<ConditionNodeData>;
      if (!d.field)    errors.push(`${loc}: field is required.`);
      if (!d.operator) errors.push(`${loc}: operator is required.`);
      else if (!VALID_OPERATORS.has(d.operator)) {
        errors.push(`${loc}: Unknown operator "${d.operator}".`);
      }
      if (d.value === undefined) errors.push(`${loc}: value is required.`);
      break;
    }

    default:
      errors.push(`Unknown node type "${node.type}" on node "${node.id}".`);
  }

  return errors;
};

// ================================================================
// BFS TRAVERSAL WITH DELAY ACCUMULATION
// ================================================================

interface TraversalState {
  nodeId:           string;
  accDelayMinutes:  number;
  branchConditions: CompiledCondition[];
}

const traverseGraph = (
  startId:   string,
  adjacency: Map<string, Array<{ targetId: string; handle?: string; edgeId: string }>>,
  nodeMap:   Map<string, RFNode>,
  edges:     RFEdge[]
): { actions: CompiledAction[]; traversalErrors: string[] } => {
  const actions:         CompiledAction[] = [];
  const errors:          string[]         = [];
  const visited          = new Set<string>();
  const queue:           TraversalState[] = [];
  let   order            = 0;

  queue.push({ nodeId: startId, accDelayMinutes: 0, branchConditions: [] });

  while (queue.length > 0) {
    const state = queue.shift()!;
    const { nodeId, accDelayMinutes, branchConditions } = state;

    if (visited.has(nodeId)) continue;
    visited.add(nodeId);

    const node = nodeMap.get(nodeId);
    if (!node) continue;

    const outgoing = adjacency.get(nodeId) ?? [];

    switch (node.type) {
      case 'triggerNode': {
        // Queue all children with zero delay and no branch context
        for (const { targetId } of outgoing) {
          queue.push({ nodeId: targetId, accDelayMinutes: 0, branchConditions: [] });
        }
        break;
      }

      case 'delayNode': {
        // Accumulate delay and pass to children
        const d = node.data as unknown as DelayNodeData;
        const newDelay = accDelayMinutes + (d.delayMinutes ?? 0);
        for (const { targetId } of outgoing) {
          queue.push({ nodeId: targetId, accDelayMinutes: newDelay, branchConditions });
        }
        break;
      }

      case 'actionNode': {
        const d = node.data as unknown as ActionNodeData;
        actions.push({
          order:            order++,
          nodeId:           node.id,
          type:             d.actionType,
          delayMinutes:     accDelayMinutes,
          config:           extractActionConfig(d),
          branchConditions: [...branchConditions],
        });
        // Propagate same delay and branch context to children
        for (const { targetId } of outgoing) {
          queue.push({ nodeId: targetId, accDelayMinutes, branchConditions });
        }
        break;
      }

      case 'conditionNode': {
        const d = node.data as unknown as ConditionNodeData;
        // Each outgoing edge is tagged with 'yes' or 'no' via sourceHandle
        for (const { targetId, handle } of outgoing) {
          const branch = (handle === 'no' ? 'no' : 'yes') as 'yes' | 'no';
          const newConditions: CompiledCondition[] = [
            ...branchConditions,
            { field: d.field, operator: d.operator, value: d.value, branch },
          ];
          queue.push({ nodeId: targetId, accDelayMinutes, branchConditions: newConditions });
        }
        break;
      }
    }
  }

  return { actions, traversalErrors: errors };
};

// ================================================================
// CONFIG EXTRACTORS
// ================================================================

const extractTriggerConfig = (d: TriggerNodeData): Record<string, unknown> => {
  const config: Record<string, unknown> = {};
  if (d.config?.daysInactive !== undefined)   config.daysInactive   = d.config.daysInactive;
  if (d.config?.visitCount !== undefined)     config.visitCount     = d.config.visitCount;
  if (d.config?.spendThreshold !== undefined) config.spendThreshold = d.config.spendThreshold;
  return config;
};

const extractActionConfig = (d: ActionNodeData): Record<string, unknown> => {
  switch (d.actionType) {
    case 'SEND_WHATSAPP':
      return { templateName: d.templateName, langCode: d.langCode ?? 'en_US' };
    case 'SEND_EMAIL':
      return { templateId: d.emailTemplateId, subject: d.emailSubject };
    case 'AWARD_POINTS':
    case 'DEDUCT_POINTS':
      return { points: d.points, reason: d.reason ?? d.actionType };
    case 'CHANGE_SEGMENT':
      return { targetSegment: d.targetSegment };
    case 'CREATE_COUPON':
      return { type: d.couponType, value: d.couponValue, expiryDays: d.expiryDays ?? 30 };
    case 'MANAGER_ALERT':
      return { message: d.alertMessage, priority: d.alertPriority ?? 'MEDIUM' };
    default:
      return {};
  }
};

// ================================================================
// GRAPH UTILITIES
// ================================================================

type AdjacencyMap = Map<string, Array<{ targetId: string; handle?: string; edgeId: string }>>;

const buildAdjacency = (edges: RFEdge[]): AdjacencyMap => {
  const map: AdjacencyMap = new Map();
  for (const edge of edges) {
    if (!map.has(edge.source)) map.set(edge.source, []);
    map.get(edge.source)!.push({
      targetId: edge.target,
      handle:   edge.sourceHandle,
      edgeId:   edge.id,
    });
  }
  return map;
};

const buildNodeMap = (nodes: RFNode[]): Map<string, RFNode> =>
  new Map(nodes.map(n => [n.id, n]));

const getReachableNodeIds = (startId: string, adjacency: AdjacencyMap): Set<string> => {
  const visited = new Set<string>();
  const stack   = [startId];
  while (stack.length > 0) {
    const id = stack.pop()!;
    if (visited.has(id)) continue;
    visited.add(id);
    for (const { targetId } of adjacency.get(id) ?? []) {
      stack.push(targetId);
    }
  }
  return visited;
};

/** DFS-based cycle detection — returns error messages for detected cycles */
const detectCycles = (nodes: RFNode[], edges: RFEdge[]): string[] => {
  const adjacency = buildAdjacency(edges);
  const WHITE = 0, GREY = 1, BLACK = 2;
  const color: Record<string, number> = {};
  const errors: string[] = [];

  for (const node of nodes) {
    color[node.id] = WHITE;
  }

  const dfs = (nodeId: string): void => {
    color[nodeId] = GREY;
    for (const { targetId } of adjacency.get(nodeId) ?? []) {
      if (color[targetId] === GREY) {
        errors.push(`Cycle detected involving node "${nodeId}" → "${targetId}". Automations cannot loop.`);
        return;
      }
      if (color[targetId] === WHITE) dfs(targetId);
    }
    color[nodeId] = BLACK;
  };

  for (const node of nodes) {
    if (color[node.id] === WHITE) dfs(node.id);
  }

  return errors;
};

// ================================================================
// COMPILED WORKFLOW RUNTIME EVALUATOR
// ================================================================

/**
 * Evaluate whether a compiled action's branchConditions are satisfied
 * by the given customer data.
 *
 * Called by the BullMQ automation worker before executing each action.
 * Returns true if the action should run for this customer.
 */
export const evaluateActionConditions = (
  action:   CompiledAction,
  customer: Record<string, unknown>
): boolean => {
  if (action.branchConditions.length === 0) return true;

  return action.branchConditions.every(cond => {
    const actual = customer[cond.field];

    switch (cond.operator) {
      case 'eq':      return actual === cond.value;
      case 'neq':     return actual !== cond.value;
      case 'gt':      return Number(actual) >  Number(cond.value);
      case 'lt':      return Number(actual) <  Number(cond.value);
      case 'gte':     return Number(actual) >= Number(cond.value);
      case 'lte':     return Number(actual) <= Number(cond.value);
      case 'in':      return Array.isArray(cond.value) && cond.value.includes(actual);
      case 'not_in':  return Array.isArray(cond.value) && !cond.value.includes(actual);
      default:        return true;
    }
  });
};

// ================================================================
// COMPILED WORKFLOW VALIDATOR (for re-validation on activation)
// ================================================================

/**
 * Validate an existing CompiledWorkflow without re-compiling from graph.
 * Used when activating a workflow that was saved in DRAFT state.
 */
export const validateCompiledWorkflow = (compiled: unknown): string[] => {
  const errors: string[] = [];

  if (!compiled || typeof compiled !== 'object') {
    return ['Compiled workflow is null or not an object.'];
  }

  const wf = compiled as Partial<CompiledWorkflow>;

  if (!wf.trigger?.type)       errors.push('Missing trigger.type');
  if (!Array.isArray(wf.actions)) errors.push('Missing or invalid actions array');
  if ((wf.actions?.length ?? 0) === 0) errors.push('Compiled workflow has no actions');
  if (wf.schemaVersion !== COMPILED_SCHEMA_VERSION) {
    errors.push(`Schema version mismatch: expected ${COMPILED_SCHEMA_VERSION}, found ${wf.schemaVersion}. Recompile the workflow.`);
  }

  return errors;
};

// ================================================================
// HELPER
// ================================================================

const fail = (errors: string[], warnings: string[] = []): CompilationResult =>
  ({ success: false, compiled: null, errors, warnings });
