// Homecast Automation Engine - Execution Trace Types

import type { TriggerData } from './automation';

// ============================================================
// Execution Trace
// ============================================================

export type ExecutionStatus = 'running' | 'success' | 'error' | 'stopped' | 'timeout' | 'cancelled';

/**
 * Why a run never started. Deliberately NOT a new ExecutionStatus: old clients
 * map unknown statuses to "error", so blocked runs ship as status 'stopped'
 * with this field alongside — additive, old traces unaffected.
 */
export type BlockedReason = 'rate_limit' | 'mode_single' | 'mode_queued' | 'disabled';

export interface ExecutionTrace {
  id: string;
  automationId: string;
  automationName: string;
  startedAt: string;
  finishedAt?: string;
  status: ExecutionStatus;
  triggerData: TriggerData;
  steps: TraceStep[];
  variables: Record<string, unknown>;
  error?: string;
  /** Set on stub traces recorded when the run was blocked before starting. */
  blockedReason?: BlockedReason;
}

// ============================================================
// Trace Steps
// ============================================================

export type TraceStepResult = 'passed' | 'failed' | 'executed' | 'skipped' | 'error' | 'running' | 'timeout';

export interface TraceStep {
  index: number;
  type: 'trigger' | 'condition' | 'action';
  nodeId: string;
  nodeType: string;
  nodeSummary: string;
  startedAt: string;
  finishedAt?: string;
  result: TraceStepResult;
  input?: Record<string, unknown>;
  output?: Record<string, unknown>;
  error?: string;
  children?: TraceStep[];
  /** Stamped by endStep; measures the step's own work. */
  durationMs?: number;
  /** Container node (choose/if/repeat/parallel) this step ran under. Steps
      stay flat in the array; these tags carry the nesting so the UI can
      reconstruct it, and old traces without them render flat as before. */
  parentNodeId?: string;
  /** Branch within the container: 'then' | 'else' | choice alias/index | 'default' | parallel index. */
  branch?: string;
  /** Repeat iteration this step ran in (0-based). */
  iteration?: number;
  /** Retry attempt that produced this step (1-based; absent on the first try). */
  attempt?: number;
}

/**
 * Tags passed down an executeSequence call chain so nested steps record which
 * container/branch/iteration they ran under. Passed explicitly (not stored on
 * the context): parallel branches share one ExecutionContext and interleave,
 * so any ambient "current container" would mislabel steps.
 */
export interface StepTags {
  parentNodeId?: string;
  branch?: string;
  iteration?: number;
  attempt?: number;
}

/**
 * Rich result of evaluating a condition tree. `evaluate()` still returns the
 * bare boolean (`.passed`); this shape is what the trace records so a blocked
 * run can show each leaf's actual value against what it wanted.
 */
export interface ConditionEvalDetail {
  passed: boolean;
  kind: 'block' | 'leaf';
  /** Block operator (blocks only). */
  operator?: 'and' | 'or' | 'not';
  /** Leaf condition type (leaves only). */
  type?: string;
  /** Capture-time text; may contain raw ids — the UI humanizes at render time. */
  description: string;
  /** Present on device-state leaves so the UI can resolve the device name. */
  accessoryId?: string;
  characteristicType?: string;
  actual?: unknown;
  expected?: unknown;
  /** Leaf was disabled and skipped (counts as passing). */
  disabled?: boolean;
  /** Evaluation failed — no longer silently indistinguishable from false. */
  error?: string;
  children?: ConditionEvalDetail[];
}

// ============================================================
// Execution Context (runtime state during a single automation run)
// ============================================================

export interface ExecutionVariables {
  [key: string]: unknown;
}

export interface WaitResult {
  completed: boolean;
  trigger?: TriggerData;
  remainingTimeout?: number;
}

export interface RepeatState {
  index: number;
  first: boolean;
  last: boolean;
  item?: unknown; // Current item for for_each
}

// ============================================================
// Execution Events (for real-time trace streaming)
// ============================================================

export type ExecutionEvent =
  | { type: 'started'; traceId: string; automationId: string; timestamp: string; triggerData?: TriggerData }
  | { type: 'step'; traceId: string; automationId: string; step: TraceStep }
  | { type: 'variables_changed'; traceId: string; automationId: string; variables: Record<string, unknown> }
  | { type: 'finished'; traceId: string; automationId: string; status: ExecutionStatus; error?: string; timestamp: string };

// ============================================================
// State Change Event (from StateStore)
// ============================================================

export interface StateChangeEvent {
  accessoryId: string;
  characteristicType: string;
  newValue: unknown;
  oldValue: unknown;
  timestamp: number;
}

// ============================================================
// Custom Event (inter-automation)
// ============================================================

export interface AutomationEvent {
  type: string;
  data?: Record<string, unknown>;
  source?: string; // automation ID that fired the event
  timestamp: number;
}
