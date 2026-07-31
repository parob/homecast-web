// Automation Editor - Run view mapping
//
// Pure translation from a stored execution trace to per-canvas-node execution
// state, so selecting a run in the Executions tab lights the path up on the
// canvas. Canvas node ids equal engine trigger/action ids (see
// serialization/), so steps map by id. Engine-internal step ids that have no
// canvas node — the automation-level condition block, blocked-run markers,
// and the synthetic wrappers multi-trigger serialization creates — are
// skipped.

import type { TraceStep } from '@/automation/types/execution';

export type NodeExecutionState = 'running' | 'completed' | 'failed' | 'skipped';

export interface NodeRunState {
  executionState: NodeExecutionState;
  executionTime?: number;
  executionError?: string;
}

/** Step nodeIds that never correspond to a canvas node. */
const SYNTHETIC_IDS = new Set(['conditions', '__blocked__', '__manual__']);
/** Prefixes of synthetic wrappers created by multi-trigger serialization. */
const SYNTHETIC_PREFIXES = ['choose-by-trigger-', 'trigger-is-'];

function isSyntheticStepId(nodeId: string): boolean {
  return SYNTHETIC_IDS.has(nodeId) || SYNTHETIC_PREFIXES.some((p) => nodeId.startsWith(p));
}

function mapResult(result: TraceStep['result']): NodeExecutionState {
  switch (result) {
    case 'running':
      return 'running';
    case 'passed':
    case 'executed':
      return 'completed';
    case 'failed':
    case 'error':
    case 'timeout':
      return 'failed';
    default:
      return 'skipped';
  }
}

function stepDuration(step: TraceStep): number | undefined {
  if (typeof step.durationMs === 'number') return step.durationMs;
  if (step.startedAt && step.finishedAt) {
    const d = Date.parse(step.finishedAt) - Date.parse(step.startedAt);
    return Number.isNaN(d) ? undefined : d;
  }
  return undefined;
}

/**
 * Aggregate a trace's steps per canvas node. A node can produce several steps
 * (retry attempts, repeat iterations): the LAST step's outcome wins — a retry
 * that eventually succeeded reads as completed — except an in-flight step,
 * which pins the node to running. Durations sum across the node's steps.
 * Canvas nodes with no step at all are simply absent from the map; the caller
 * dims them as skipped so the executed path pops.
 */
export function mapTraceToNodeStates(
  steps: TraceStep[] | undefined,
  nodeIds: Iterable<string>,
): Map<string, NodeRunState> {
  const canvasIds = new Set(nodeIds);
  const out = new Map<string, NodeRunState>();

  for (const step of steps ?? []) {
    const nodeId = step.nodeId;
    if (!nodeId || isSyntheticStepId(nodeId) || !canvasIds.has(nodeId)) continue;

    const prev = out.get(nodeId);
    const mapped = mapResult(step.result);
    const duration = stepDuration(step);

    const executionState: NodeExecutionState =
      prev?.executionState === 'running' || mapped === 'running' ? 'running' : mapped;

    const executionTime =
      prev?.executionTime != null || duration != null
        ? (prev?.executionTime ?? 0) + (duration ?? 0)
        : undefined;

    out.set(nodeId, {
      executionState,
      executionTime,
      executionError: step.error ?? prev?.executionError,
    });
  }

  return out;
}
