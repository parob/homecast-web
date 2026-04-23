// Homecast Automation Engine - Execution Context
// Per-run state: variables, trigger data, abort controller, trace recording

import type { TriggerData } from '../types/automation';
import type {
  ExecutionTrace,
  ExecutionStatus,
  TraceStep,
  TraceStepResult,
  RepeatState,
  WaitResult,
} from '../types/execution';

/**
 * Per-execution-run context. Holds variables, trigger data,
 * abort controller for cancellation, and trace recording.
 */
export class ExecutionContext {
  readonly traceId: string;
  readonly automationId: string;
  readonly automationName: string;
  readonly triggerData: TriggerData;
  readonly abortController: AbortController;
  /**
   * Chain of automationIds that led to this execution (via toggle_automation
   * "trigger" action). Used to detect sub-workflow cycles. The current
   * automationId is NOT included in this list — it is appended when this
   * context triggers a further sub-automation.
   */
  readonly ancestorIds: readonly string[];

  // Mutable state
  variables: Record<string, unknown>;
  wait: WaitResult = { completed: false };
  repeat: RepeatState = { index: 0, first: true, last: false };

  // Per-node output data (n8n-style data flow between nodes)
  readonly nodeOutputs = new Map<string, Record<string, unknown>>();

  // Trace recording
  private steps: TraceStep[] = [];
  private stepIndex = 0;
  private startedAt: string;

  constructor(
    automationId: string,
    automationName: string,
    triggerData: TriggerData,
    initialVariables?: Record<string, unknown>,
    ancestorIds: readonly string[] = [],
  ) {
    this.traceId = crypto.randomUUID();
    this.automationId = automationId;
    this.automationName = automationName;
    this.triggerData = triggerData;
    this.abortController = new AbortController();
    this.variables = { ...initialVariables };
    this.startedAt = new Date().toISOString();
    this.ancestorIds = ancestorIds;
  }

  get signal(): AbortSignal {
    return this.abortController.signal;
  }

  get isAborted(): boolean {
    return this.abortController.signal.aborted;
  }

  /**
   * Cancel this execution run.
   */
  cancel(): void {
    this.abortController.abort();
  }

  // ============================================================
  // Trace recording
  // ============================================================

  /**
   * Record the start of a step. Returns the step index.
   */
  beginStep(
    type: 'trigger' | 'condition' | 'action',
    nodeId: string,
    nodeType: string,
    nodeSummary: string,
    input?: Record<string, unknown>,
  ): number {
    const idx = this.stepIndex++;
    this.steps.push({
      index: idx,
      type,
      nodeId,
      nodeType,
      nodeSummary,
      startedAt: new Date().toISOString(),
      result: 'running',
      input,
    });
    return idx;
  }

  /**
   * Record the end of a step.
   */
  endStep(
    index: number,
    result: TraceStepResult,
    output?: Record<string, unknown>,
    error?: string,
    children?: TraceStep[],
  ): void {
    const step = this.steps[index];
    if (step) {
      step.finishedAt = new Date().toISOString();
      step.result = result;
      if (output) step.output = output;
      if (error) step.error = error;
      if (children) step.children = children;
    }
  }

  /**
   * Build the final execution trace.
   */
  buildTrace(status: ExecutionStatus, error?: string): ExecutionTrace {
    return {
      id: this.traceId,
      automationId: this.automationId,
      automationName: this.automationName,
      startedAt: this.startedAt,
      finishedAt: new Date().toISOString(),
      status,
      triggerData: this.triggerData,
      steps: this.steps,
      variables: { ...this.variables },
      error,
    };
  }

  // ============================================================
  // Node output helpers (data flow between nodes)
  // ============================================================

  /**
   * Store output data from a node, making it available to downstream nodes
   * via expressions: {{ nodes.<nodeId>.data.<field> }}
   */
  setNodeOutput(nodeId: string, output: Record<string, unknown>): void {
    this.nodeOutputs.set(nodeId, output);
  }

  getNodeOutput(nodeId: string): Record<string, unknown> | undefined {
    return this.nodeOutputs.get(nodeId);
  }

  /**
   * Get all node outputs as a plain object for expression context.
   */
  getNodeOutputsForExpressions(): Record<string, { data: Record<string, unknown> }> {
    const result: Record<string, { data: Record<string, unknown> }> = {};
    for (const [nodeId, data] of this.nodeOutputs) {
      result[nodeId] = { data };
    }
    return result;
  }

  // ============================================================
  // Variable helpers
  // ============================================================

  setVariable(name: string, value: unknown): void {
    this.variables[name] = value;
  }

  getVariable(name: string): unknown {
    return this.variables[name];
  }
}
