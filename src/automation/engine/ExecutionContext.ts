// Homecast Automation Engine - Execution Context
// Per-run state: variables, trigger data, abort controller, trace recording

import type { TriggerData } from '../types/automation';
import { describeError } from '../../lib/describe-error';
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
  private pendingStepDetails: Promise<void>[] = [];
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
   * Attach a fact about a step that is only known later, without holding the
   * automation up for it.
   *
   * Notification delivery is the case this exists for. Whether a push was
   * actually sent is decided by the server, a round trip away, and awaiting it
   * inline put ~1.2s (worst case 8s) between a notify action and whatever came
   * after it — an automation that notified and *then* turned a light on took
   * over a second to turn the light on. The action chain now carries on
   * immediately and the answer is folded into the trace at the end, so the
   * history stays honest and costs nothing.
   */
  awaitStepDetail(index: number, detail: Promise<Record<string, unknown> | undefined>): void {
    this.pendingStepDetails.push(
      detail
        .then((extra) => {
          const step = this.steps[index];
          if (step && extra) {
            step.output = { ...(step.output ?? {}), ...extra };
            if (step.nodeId) this.setNodeOutput(step.nodeId, step.output);
          }
        })
        .catch((e) => {
          // The step already reported as executed and the actions after it have
          // run, so this cannot halt anything — but it must still be visible.
          // A notification transport failure is deliberately not fatal: the
          // devices matter more than the message about them.
          const step = this.steps[index];
          if (step) {
            step.result = 'error';
            step.error = describeError(e);
          }
        }),
    );
  }

  /**
   * Fold in any late details before the trace is built. Bounded: a detail that
   * never arrives must not hold up the trace, and its step already says
   * "unknown" rather than claiming success.
   */
  async settleStepDetails(timeoutMs = 5000): Promise<void> {
    if (this.pendingStepDetails.length === 0) return;
    const pending = this.pendingStepDetails.splice(0);
    await Promise.race([
      Promise.all(pending),
      new Promise((resolve) => setTimeout(resolve, timeoutMs)),
    ]);
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
