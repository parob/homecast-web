// Homecast Automation Engine - Action Executor
// Executes action chains: set characteristic, scene, delay, choose, repeat, parallel

import type { StateStore } from '../state/StateStore';
import type { ConditionEvaluator } from './ConditionEvaluator';
import type { ExecutionContext } from './ExecutionContext';
import type {
  Action,
  SetCharacteristicAction,
  SetServiceGroupAction,
  ExecuteSceneAction,
  DelayAction,
  WaitForTriggerAction,
  WaitForTemplateAction,
  ChooseAction,
  IfThenElseAction,
  RepeatAction,
  ParallelAction,
  VariablesAction,
  StopAction,
  FireEventAction,
  FireWebhookAction,
  ToggleAutomationAction,
  CallScriptAction,
  NotifyAction,
  CodeAction,
  MergeAction,
  HelperAction,
  TriggerData,
} from '../types/automation';
import { durationToMs } from '../types/automation';
import type { StepTags } from '../types/execution';
import { capLarge } from './trace-summaries';
import type { NotifyDelivery } from '../types/notify';
import { NOTIFY_DELIVERY_UNKNOWN, NOTIFY_DELIVERY_PENDING } from '../types/notify';
import { describeError } from '../../lib/describe-error';
import { ExpressionEngine } from '../expression/ExpressionEngine';
import type { ExpressionContext } from '../expression/ExpressionEngine';
import { WorkerCodeSandbox, type CodeSandbox } from './CodeSandbox';
import type { HelperManager } from '../state/HelperManager';
import { assertSafeOutboundUrl } from './ssrfGuard';

/** Bridge interface for calling HomeKit operations */
export interface HomeKitBridge {
  setCharacteristic(accessoryId: string, characteristicType: string, value: unknown, homeId?: string): Promise<void>;
  setServiceGroup(groupId: string, characteristicType: string, value: unknown, homeId?: string): Promise<void>;
  executeScene(sceneId: string, homeId?: string): Promise<void>;
}

/** Interface for the engine to fire events, notifications, and automation control */
export interface EngineCallbacks {
  fireEvent(eventType: string, eventData?: Record<string, unknown>): void;
  /**
   * Deliver a notification. Resolves with what was actually delivered where
   * the deliverer can say; resolving with void means "no report", which the
   * trace records as unknown rather than as success.
   */
  sendNotification(message: string, title?: string, data?: Record<string, unknown>, automationId?: string): Promise<NotifyDelivery | void>;
  setAutomationEnabled(automationId: string, enabled: boolean): void;
  /**
   * Trigger another automation. `ancestorIds` lists the IDs of automations
   * already in this trigger chain — used by the engine to detect cycles.
   */
  triggerAutomation(automationId: string, ancestorIds?: readonly string[]): Promise<void>;
  executeScript(scriptId: string, variables?: Record<string, unknown>): Promise<Record<string, unknown> | undefined>;
  registerTemporaryTrigger(triggers: import('../types/automation').Trigger[], callback: (data: TriggerData) => void): () => void;
}

/** Longest chain of `toggle_automation → trigger` allowed before the engine bails. */
export const MAX_SUB_AUTOMATION_DEPTH = 5;
/** Maximum duration a `delay` action may wait, to avoid piling up long-lived timers. */
export const MAX_DELAY_MS = 24 * 60 * 60 * 1000;

// Safety limits
const MAX_LOOP_ITERATIONS = 1000;
const MAX_EXECUTION_TIME_MS = 5 * 60 * 1000; // 5 minutes

/** Thrown when a StopAction is encountered */
export class StopExecutionError extends Error {
  constructor(
    public readonly reason: string,
    public readonly isError: boolean,
    public readonly responseVariable?: string,
  ) {
    super(reason);
    this.name = 'StopExecutionError';
  }
}

/**
 * Executes action chains with support for control flow:
 * delay, choose/if-then-else, repeat, parallel, variables, stop.
 */
/**
 * Refuse to write a value the automation never specified.
 *
 * A "Set Device" node saves with `value: undefined` if its Value field was
 * never filled in — JSON.stringify then drops the key entirely, so the stored
 * automation has an action with no value at all. Passing that to the bridge
 * produced a native failure whose message said nothing about the real problem.
 * Fail here instead, naming the field the user has to go and fill in.
 */
function requireValue(value: unknown, characteristicType: string): void {
  if (value === undefined || value === null) {
    throw Object.assign(
      new Error(`No value set for "${characteristicType}" — open the action and choose one`),
      { code: 'VALUE_NOT_SET' },
    );
  }
}

export class ActionExecutor {
  private executionStart = 0;
  private expressionEngine = new ExpressionEngine();

  constructor(
    private stateStore: StateStore,
    private conditionEvaluator: ConditionEvaluator,
    private bridge: HomeKitBridge,
    private callbacks: EngineCallbacks,
    private codeSandbox: CodeSandbox = new WorkerCodeSandbox(),
    /** Absent in tests that don't exercise helper actions. */
    private helperManager?: HelperManager,
  ) {}

  /**
   * Execute a sequence of actions in order.
   *
   * `tags` labels every step begun in this sequence with the container/branch/
   * iteration it ran under. Threaded explicitly through the call chain rather
   * than stored on the context: parallel branches share one ExecutionContext,
   * so ambient state would mislabel interleaved steps.
   */
  async executeSequence(actions: Action[], ctx: ExecutionContext, tags?: StepTags): Promise<void> {
    this.executionStart = Date.now();

    for (const action of actions) {
      if (ctx.isAborted) break;
      this.checkTimeout();

      if (action.enabled === false) continue;

      await this.executeActionWithErrorHandling(action, ctx, tags);
    }
  }

  private async executeActionWithErrorHandling(action: Action, ctx: ExecutionContext, tags?: StepTags): Promise<void> {
    const errorStrategy = action.onError ?? 'stop';

    if (errorStrategy === 'stop') {
      // Default behavior — errors propagate up
      return this.executeAction(action, ctx, tags);
    }

    if (errorStrategy === 'retry') {
      const maxRetries = action.maxRetries ?? 3;
      const retryDelay = action.retryDelayMs ?? 1000;
      let lastError: unknown;

      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
          // Re-runs tag their step with the (1-based) attempt number; the
          // first try stays untagged so the common case adds no noise.
          await this.executeAction(action, ctx, attempt > 0 ? { ...tags, attempt: attempt + 1 } : tags);
          return; // Success — exit retry loop
        } catch (e) {
          lastError = e;
          // StopExecutionError should not be retried
          if (e instanceof StopExecutionError) throw e;

          if (attempt < maxRetries) {
            // Wait before retrying (with exponential backoff)
            const delay = retryDelay * Math.pow(2, attempt);
            await this.abortableDelay(Math.min(delay, 30_000), ctx);
            if (ctx.isAborted) return;
          }
        }
      }

      // All retries exhausted — record error in output and continue
      ctx.setNodeOutput(action.id, {
        ...(ctx.getNodeOutput(action.id) ?? {}),
        error: true,
        errorMessage: String(lastError),
        retryCount: maxRetries,
      });
      const exhaustedIdx = ctx.lastStepIndexForNode(action.id);
      if (exhaustedIdx >= 0) {
        ctx.annotateStep(exhaustedIdx, { onError: 'retry', retriesExhausted: true, maxRetries });
      }
      return;
    }

    // 'continue' — catch errors, log them, and proceed
    try {
      await this.executeAction(action, ctx, tags);
    } catch (e) {
      if (e instanceof StopExecutionError) throw e;
      ctx.setNodeOutput(action.id, {
        ...(ctx.getNodeOutput(action.id) ?? {}),
        error: true,
        errorMessage: describeError(e),
      });
      const continuedIdx = ctx.lastStepIndexForNode(action.id);
      if (continuedIdx >= 0) {
        ctx.annotateStep(continuedIdx, { onError: 'continue', continued: true });
      }
    }
  }

  private async executeAction(action: Action, ctx: ExecutionContext, tags?: StepTags): Promise<void> {
    switch (action.type) {
      case 'set_characteristic':
        return this.executeSetCharacteristic(action, ctx, tags);
      case 'set_service_group':
        return this.executeSetServiceGroup(action, ctx, tags);
      case 'execute_scene':
        return this.executeScene(action, ctx, tags);
      case 'delay':
        return this.executeDelay(action, ctx, tags);
      case 'choose':
        return this.executeChoose(action, ctx, tags);
      case 'if_then_else':
        return this.executeIfThenElse(action, ctx, tags);
      case 'repeat':
        return this.executeRepeat(action, ctx, tags);
      case 'parallel':
        return this.executeParallel(action, ctx, tags);
      case 'variables':
        return this.executeVariables(action, ctx, tags);
      case 'stop':
        return this.executeStop(action, ctx, tags);
      case 'fire_event':
        return this.executeFireEvent(action, ctx, tags);
      case 'fire_webhook':
        return this.executeFireWebhook(action, ctx, tags);
      case 'toggle_automation':
        return this.executeToggleAutomation(action, ctx, tags);
      case 'call_script':
        return this.executeCallScript(action, ctx, tags);
      case 'notify':
        return this.executeNotify(action, ctx, tags);
      case 'wait_for_trigger':
        return this.executeWaitForTrigger(action, ctx, tags);
      case 'wait_for_template':
        return this.executeWaitForTemplate(action, ctx, tags);
      case 'code':
        return this.executeCode(action, ctx, tags);
      case 'merge':
        return this.executeMerge(action, ctx, tags);
      case 'helper':
        return this.executeHelper(action, ctx, tags);
      default:
        console.warn(`[ActionExecutor] Unsupported action type: ${(action as Action).type}`);
    }
  }

  // ============================================================
  // Device control actions
  // ============================================================

  private async executeSetCharacteristic(
    action: SetCharacteristicAction,
    ctx: ExecutionContext,
    tags?: StepTags,
  ): Promise<void> {
    const stepIdx = ctx.beginStep('action', action.id, 'set_characteristic',
      `Set ${action.accessoryId} ${action.characteristicType}`,
      { accessoryId: action.accessoryId, characteristicType: action.characteristicType, value: action.value }, tags);

    try {
      const resolvedValue = this.resolveTemplateValue(action.value, ctx);
      requireValue(resolvedValue, action.characteristicType);
      const resolvedAccessoryId = this.resolveTemplateString(action.accessoryId, ctx);

      // Record before writing so the resulting state change can be attributed
      // to us rather than to a human reaching for the switch.
      this.stateStore.recordWrite(resolvedAccessoryId, action.characteristicType, resolvedValue);
      await this.bridge.setCharacteristic(resolvedAccessoryId, action.characteristicType, resolvedValue, ctx.homeId);
      const output = { accessoryId: resolvedAccessoryId, characteristicType: action.characteristicType, value: resolvedValue, success: true };
      ctx.setNodeOutput(action.id, output);
      ctx.endStep(stepIdx, 'executed', output);
    } catch (e) {
      ctx.setNodeOutput(action.id, { accessoryId: action.accessoryId, characteristicType: action.characteristicType, success: false, error: describeError(e) });
      ctx.endStep(stepIdx, 'error', undefined, describeError(e));
      throw e;
    }
  }

  private async executeSetServiceGroup(
    action: SetServiceGroupAction,
    ctx: ExecutionContext,
    tags?: StepTags,
  ): Promise<void> {
    const stepIdx = ctx.beginStep('action', action.id, 'set_service_group',
      `Set group ${action.groupId}`,
      { groupId: action.groupId, characteristicType: action.characteristicType, value: action.value }, tags);

    try {
      const resolvedValue = this.resolveTemplateValue(action.value, ctx);
      requireValue(resolvedValue, action.characteristicType);
      // The automation is scoped to a home; actions created by older versions
      // commonly have no per-action homeId. Use the execution context so the
      // relay announcement carries the home through to cloud MQTT publishing.
      await this.bridge.setServiceGroup(
        action.groupId,
        action.characteristicType,
        resolvedValue,
        action.homeId ?? ctx.homeId,
      );
      const output = { groupId: action.groupId, characteristicType: action.characteristicType, value: resolvedValue, success: true };
      ctx.setNodeOutput(action.id, output);
      ctx.endStep(stepIdx, 'executed', output);
    } catch (e) {
      ctx.setNodeOutput(action.id, { groupId: action.groupId, success: false, error: describeError(e) });
      ctx.endStep(stepIdx, 'error', undefined, describeError(e));
      throw e;
    }
  }

  private async executeScene(action: ExecuteSceneAction, ctx: ExecutionContext, tags?: StepTags): Promise<void> {
    const stepIdx = ctx.beginStep('action', action.id, 'execute_scene',
      `Execute scene ${action.sceneId}`, { sceneId: action.sceneId }, tags);

    try {
      await this.bridge.executeScene(action.sceneId, action.homeId);
      const output = { sceneId: action.sceneId, success: true };
      ctx.setNodeOutput(action.id, output);
      ctx.endStep(stepIdx, 'executed', output);
    } catch (e) {
      ctx.setNodeOutput(action.id, { sceneId: action.sceneId, success: false, error: describeError(e) });
      ctx.endStep(stepIdx, 'error', undefined, describeError(e));
      throw e;
    }
  }

  // ============================================================
  // Helpers (virtual switches, timers, counters, modes)
  // ============================================================

  private async executeHelper(action: HelperAction, ctx: ExecutionContext, tags?: StepTags): Promise<void> {
    const stepIdx = ctx.beginStep('action', action.id, 'helper',
      `Helper ${action.operation} ${action.helperId}`,
      { helperId: action.helperId, operation: action.operation }, tags);

    if (!this.helperManager) {
      const error = 'Helpers are not available in this engine instance';
      ctx.setNodeOutput(action.id, { helperId: action.helperId, success: false, error });
      ctx.endStep(stepIdx, 'error', undefined, error);
      throw new Error(error);
    }

    try {
      const h = this.helperManager;
      const id = action.helperId;
      const value = action.value !== undefined ? this.resolveTemplateValue(action.value, ctx) : undefined;

      // Dispatch lives on HelperManager so this action and a person operating
      // the same helper from the Helpers list cannot diverge.
      h.apply(id, action.operation, { value, step: action.step, duration: action.duration });

      const output = {
        helperId: id,
        operation: action.operation,
        state: this.stateStore.getHelperState(id),
        success: true,
      };
      ctx.setNodeOutput(action.id, output);
      ctx.endStep(stepIdx, 'executed', output);
    } catch (e) {
      ctx.setNodeOutput(action.id, { helperId: action.helperId, success: false, error: describeError(e) });
      ctx.endStep(stepIdx, 'error', undefined, describeError(e));
      throw e;
    }
  }

  // ============================================================
  // Delay
  // ============================================================

  private async executeDelay(action: DelayAction, ctx: ExecutionContext, tags?: StepTags): Promise<void> {
    const raw = durationToMs(action.duration);
    const ms = Math.max(0, Math.min(raw, MAX_DELAY_MS));
    const stepIdx = ctx.beginStep('action', action.id, 'delay',
      `Wait ${this.formatDuration(action.duration)}`, { durationMs: ms, requestedMs: raw }, tags);

    if (raw > MAX_DELAY_MS) {
      console.warn(`[ActionExecutor] Delay clamped from ${raw}ms to ${MAX_DELAY_MS}ms (24h cap)`);
    }

    await this.abortableDelay(ms, ctx);
    const output = { durationMs: ms };
    ctx.setNodeOutput(action.id, output);
    ctx.endStep(stepIdx, ctx.isAborted ? 'skipped' : 'executed', output);
  }

  private abortableDelay(ms: number, ctx: ExecutionContext): Promise<void> {
    return new Promise((resolve) => {
      const timer = setTimeout(resolve, ms);
      ctx.signal.addEventListener('abort', () => {
        clearTimeout(timer);
        resolve();
      }, { once: true });
    });
  }

  // ============================================================
  // Choose / If-Then-Else
  // ============================================================

  private async executeChoose(action: ChooseAction, ctx: ExecutionContext, tags?: StepTags): Promise<void> {
    const stepIdx = ctx.beginStep('action', action.id, 'choose',
      `Choose (${action.choices.length} branches)`, {}, tags);

    // Which branches were tested and how each verdict fell — previously the
    // trace only named the winner, so "why did it take THIS branch" was
    // unanswerable. Branches after the match stay untested (and unlisted).
    const tested: { index: number; alias?: string; passed: boolean }[] = [];

    let matched = false;
    for (let i = 0; i < action.choices.length; i++) {
      const choice = action.choices[i];
      const detail = this.conditionEvaluator.evaluateDetailed(choice.conditions, ctx.triggerData, ctx.variables);
      tested.push({ index: i, alias: choice.alias, passed: detail.passed });
      if (detail.passed) {
        matched = true;
        const branch = choice.alias ?? String(i);
        const output = { branch, index: i, tested, condition: capLarge(detail) };
        ctx.setNodeOutput(action.id, output);
        ctx.endStep(stepIdx, 'executed', output);
        await this.executeSequence(choice.actions, ctx, { parentNodeId: action.id, branch });
        break;
      }
    }

    if (!matched) {
      if (action.default && action.default.length > 0) {
        const output = { branch: 'default', index: -1, tested };
        ctx.setNodeOutput(action.id, output);
        ctx.endStep(stepIdx, 'executed', output);
        await this.executeSequence(action.default, ctx, { parentNodeId: action.id, branch: 'default' });
      } else {
        ctx.setNodeOutput(action.id, { branch: 'none', index: -1, tested });
        ctx.endStep(stepIdx, 'skipped', { reason: 'no matching branch', tested });
      }
    }
  }

  private async executeIfThenElse(action: IfThenElseAction, ctx: ExecutionContext, tags?: StepTags): Promise<void> {
    const detail = this.conditionEvaluator.evaluateDetailed(action.condition, ctx.triggerData, ctx.variables);
    const result = detail.passed;
    const stepIdx = ctx.beginStep('action', action.id, 'if_then_else',
      result ? 'If → Then' : 'If → Else', { conditionResult: result, condition: capLarge(detail) }, tags);

    const output = { branch: result ? 'then' : 'else', result };
    ctx.setNodeOutput(action.id, output);
    ctx.endStep(stepIdx, 'executed', output);

    if (result) {
      await this.executeSequence(action.then, ctx, { parentNodeId: action.id, branch: 'then' });
    } else if (action.else) {
      await this.executeSequence(action.else, ctx, { parentNodeId: action.id, branch: 'else' });
    }
  }

  // ============================================================
  // Repeat
  // ============================================================

  private async executeRepeat(action: RepeatAction, ctx: ExecutionContext, tags?: StepTags): Promise<void> {
    const stepIdx = ctx.beginStep('action', action.id, 'repeat',
      `Repeat (${action.mode})`, { mode: action.mode }, tags);

    let iterations = 0;
    // The while/until verdict that ended the loop — the answer to "why did it
    // stop (or never start)" that the bare iteration count can't give.
    let lastCondition: ReturnType<ConditionEvaluator['evaluateDetailed']> | undefined;
    const iterTags = (i: number): StepTags => ({ parentNodeId: action.id, iteration: i });

    switch (action.mode) {
      case 'count': {
        const count = action.count ?? 0;
        for (let i = 0; i < count && !ctx.isAborted; i++) {
          if (++iterations > MAX_LOOP_ITERATIONS) break;
          ctx.repeat = { index: i, first: i === 0, last: i === count - 1 };
          await this.executeSequence(action.sequence, ctx, iterTags(i));
        }
        break;
      }

      case 'while': {
        while (!ctx.isAborted && action.whileCondition) {
          lastCondition = this.conditionEvaluator.evaluateDetailed(action.whileCondition, ctx.triggerData, ctx.variables);
          if (!lastCondition.passed) break;
          if (++iterations > MAX_LOOP_ITERATIONS) break;
          ctx.repeat = { index: iterations - 1, first: iterations === 1, last: false };
          await this.executeSequence(action.sequence, ctx, iterTags(iterations - 1));
        }
        break;
      }

      case 'until': {
        do {
          if (++iterations > MAX_LOOP_ITERATIONS) break;
          ctx.repeat = { index: iterations - 1, first: iterations === 1, last: false };
          await this.executeSequence(action.sequence, ctx, iterTags(iterations - 1));
          if (ctx.isAborted || !action.untilCondition) break;
          lastCondition = this.conditionEvaluator.evaluateDetailed(action.untilCondition, ctx.triggerData, ctx.variables);
        } while (lastCondition && !lastCondition.passed);
        break;
      }

      case 'for_each': {
        const items = action.forEachItems ?? [];
        for (let i = 0; i < items.length && !ctx.isAborted; i++) {
          if (++iterations > MAX_LOOP_ITERATIONS) break;
          ctx.repeat = { index: i, first: i === 0, last: i === items.length - 1, item: items[i] };
          await this.executeSequence(action.sequence, ctx, iterTags(i));
        }
        break;
      }
    }

    const output = {
      iterations,
      ...(lastCondition ? { lastCondition: capLarge(lastCondition) } : {}),
    };
    ctx.setNodeOutput(action.id, output);
    ctx.endStep(stepIdx, 'executed', output);
  }

  // ============================================================
  // Parallel
  // ============================================================

  private async executeParallel(action: ParallelAction, ctx: ExecutionContext, tags?: StepTags): Promise<void> {
    const stepIdx = ctx.beginStep('action', action.id, 'parallel',
      `Parallel (${action.branches.length} branches)`, {}, tags);

    const promises = action.branches.map((branch, i) =>
      this.executeSequence(branch, ctx, { parentNodeId: action.id, branch: String(i) }),
    );

    await Promise.all(promises);
    ctx.endStep(stepIdx, 'executed', { branches: action.branches.length });
  }

  // ============================================================
  // Variables
  // ============================================================

  private async executeVariables(action: VariablesAction, ctx: ExecutionContext, tags?: StepTags): Promise<void> {
    const stepIdx = ctx.beginStep('action', action.id, 'variables',
      `Set ${Object.keys(action.variables).length} variable(s)`, {}, tags);

    const setVars: Record<string, unknown> = {};
    for (const [name, value] of Object.entries(action.variables)) {
      const resolved = this.resolveTemplateValue(value, ctx);
      ctx.setVariable(name, resolved);
      setVars[name] = resolved;
    }

    ctx.setNodeOutput(action.id, setVars);
    ctx.endStep(stepIdx, 'executed', { variables: { ...ctx.variables } });
  }

  // ============================================================
  // Stop
  // ============================================================

  private executeStop(action: StopAction, ctx: ExecutionContext, tags?: StepTags): never {
    // Recorded before throwing — a stop used to leave no step at all, so the
    // history showed a run that just ended with nothing saying which node
    // ended it.
    const stepIdx = ctx.beginStep('action', action.id, 'stop',
      action.reason ?? 'Stop', { reason: action.reason, isError: action.error ?? false }, tags);
    ctx.endStep(stepIdx, 'executed', { reason: action.reason ?? 'Automation stopped', isError: action.error ?? false });
    throw new StopExecutionError(
      action.reason ?? 'Automation stopped',
      action.error ?? false,
      action.responseVariable,
    );
  }

  // ============================================================
  // Fire Event
  // ============================================================

  private async executeFireEvent(action: FireEventAction, ctx: ExecutionContext, tags?: StepTags): Promise<void> {
    const stepIdx = ctx.beginStep('action', action.id, 'fire_event',
      `Fire event: ${action.eventType}`, { eventType: action.eventType }, tags);

    this.callbacks.fireEvent(action.eventType, action.eventData);
    const output = { eventType: action.eventType, eventData: action.eventData };
    ctx.setNodeOutput(action.id, output);
    ctx.endStep(stepIdx, 'executed', output);
  }

  // ============================================================
  // Notify
  // ============================================================

  /**
   * Resolve the notify icon, refusing one that points somewhere it shouldn't.
   *
   * A custom icon is a templatable URL that something downstream *fetches*: the
   * relay Mac for its local banner, and the user's phone for a push. The relay
   * has line-of-sight to localhost and the LAN, which is the same exposure the
   * HTTP Request node is guarded against — so the icon goes through the same
   * `assertSafeOutboundUrl`, and https-only on top, since neither APNs nor
   * Android will load plaintext anyway.
   *
   * Rejection drops the icon rather than failing the action. An icon is
   * decoration; a suppressed notification is a missed alert. The trace records
   * why so it isn't merely silent.
   */
  private resolveNotifyIcon(
    action: NotifyAction,
    ctx: ExecutionContext,
  ): { icon?: string; iconColor?: string; iconRejected?: string } {
    if (!action.icon) return {};

    const resolved = this.resolveTemplateString(action.icon, ctx);
    if (!resolved) return {};

    // A built-in slug is a name, not a URL — nothing fetches it cross-network.
    // Colour rides along only here: a custom URL is the author's own image, and
    // recolouring someone's camera snapshot would be nonsense.
    if (!resolved.includes('://')) return { icon: resolved, iconColor: action.iconColor };

    if (!/^https:\/\//i.test(resolved)) {
      return { iconRejected: `icon URL must be https (got ${resolved.slice(0, 40)})` };
    }

    try {
      assertSafeOutboundUrl(resolved);
      return { icon: resolved };
    } catch (e) {
      return { iconRejected: describeError(e) };
    }
  }

  private async executeNotify(action: NotifyAction, ctx: ExecutionContext, tags?: StepTags): Promise<void> {
    // beginStep comes before template resolution: the input keeps the raw
    // templates (so a bad expression is diagnosable from the trace), and a
    // resolution failure now lands on a recorded step instead of vanishing.
    const stepIdx = ctx.beginStep('action', action.id, 'notify',
      `Notify: ${action.message.slice(0, 50)}`, { message: action.message, title: action.title }, tags);

    try {
      const message = this.resolveTemplateString(action.message, ctx);
      const title = action.title ? this.resolveTemplateString(action.title, ctx) : undefined;
      const { icon, iconColor, iconRejected } = this.resolveNotifyIcon(action, ctx);

      // Carried inside `data` rather than as a fourth argument. `data` is already
      // the platform-specific bag and already reaches both onNotify implementations
      // — and from there the cloud server and the Swift bridge — untouched, so an
      // icon rides to every channel without widening a callback declared in five
      // places.
      const data = icon
        ? { ...action.data, icon, ...(iconColor ? { iconColor } : {}) }
        : action.data;

      // Deliberately not awaited. Delivery is decided by the server, a round
      // trip away; awaiting it here put that round trip between this action and
      // the next, so an automation that notified and then turned a light on
      // took over a second to turn the light on. Hand the notification off,
      // carry on, and fold the outcome into the trace at the end of the run.
      const delivery = Promise.resolve(
        this.callbacks.sendNotification(message, title, data, ctx.automationId),
      ).then((d) => {
        const result = d || NOTIFY_DELIVERY_UNKNOWN;
        return {
          delivered: result.delivered,
          channels: result.channels,
          rateLimited: result.rateLimited ?? undefined,
          // Always carried, never conditional. Omitting it left the pending
          // placeholder's `reason: 'unknown'` sitting next to a delivered:true
          // that had just overwritten the fields around it — a trace reading
          // "delivered, reason unknown", which is a contradiction, in the one
          // record built specifically to be trusted about delivery.
          reason: result.reason ?? undefined,
        };
      });

      // `success` stays true: the action ran and did not fail. Whether anything
      // reached a device is a separate fact, and conflating the two is what hid
      // rate-limited notifications in the first place.
      const output = { message, title, icon, iconColor, iconRejected, success: true, ...NOTIFY_DELIVERY_PENDING };
      ctx.setNodeOutput(action.id, output);
      ctx.endStep(stepIdx, 'executed', output);
      ctx.awaitStepDetail(stepIdx, delivery);
    } catch (e) {
      ctx.setNodeOutput(action.id, { message: action.message, title: action.title, success: false, error: describeError(e) });
      ctx.endStep(stepIdx, 'error', undefined, describeError(e));
      throw e;
    }
  }

  // ============================================================
  // Wait for Trigger
  // ============================================================

  private async executeWaitForTrigger(action: WaitForTriggerAction, ctx: ExecutionContext, tags?: StepTags): Promise<void> {
    const timeoutMs = action.timeout ? durationToMs(action.timeout) : undefined;
    const stepIdx = ctx.beginStep('action', action.id, 'wait_for_trigger',
      `Wait for trigger${timeoutMs ? ` (timeout: ${timeoutMs / 1000}s)` : ''}`,
      { timeoutMs, triggerCount: action.triggers.length }, tags);

    ctx.wait = { completed: false };

    const result = await new Promise<{ completed: boolean; triggerData?: TriggerData }>((resolve) => {
      let timeoutTimer: ReturnType<typeof setTimeout> | undefined;

      // Register temporary triggers
      const unregister = this.callbacks.registerTemporaryTrigger(
        action.triggers,
        (triggerData) => {
          if (timeoutTimer) clearTimeout(timeoutTimer);
          unregister();
          resolve({ completed: true, triggerData });
        },
      );

      // Set up timeout
      if (timeoutMs) {
        timeoutTimer = setTimeout(() => {
          unregister();
          resolve({ completed: false });
        }, timeoutMs);
      }

      // Handle abort
      ctx.signal.addEventListener('abort', () => {
        if (timeoutTimer) clearTimeout(timeoutTimer);
        unregister();
        resolve({ completed: false });
      }, { once: true });
    });

    ctx.wait = {
      completed: result.completed,
      trigger: result.triggerData,
    };

    const output = { triggered: result.completed, triggerData: result.triggerData ?? null };
    ctx.setNodeOutput(action.id, output);

    const stepResult = result.completed ? 'executed' : (action.continueOnTimeout !== false ? 'timeout' : 'failed');
    ctx.endStep(stepIdx, stepResult, output);

    // If timeout and continueOnTimeout is false, stop execution
    if (!result.completed && action.continueOnTimeout === false) {
      throw new StopExecutionError('Wait for trigger timed out', false);
    }
  }

  // ============================================================
  // Wait for Template
  // ============================================================

  private async executeWaitForTemplate(action: WaitForTemplateAction, ctx: ExecutionContext, tags?: StepTags): Promise<void> {
    const timeoutMs = action.timeout ? durationToMs(action.timeout) : undefined;
    const stepIdx = ctx.beginStep('action', action.id, 'wait_for_template',
      `Wait for expression to be true`,
      { expression: action.expression, timeoutMs }, tags);

    ctx.wait = { completed: false };

    const result = await new Promise<boolean>((resolve) => {
      let timeoutTimer: ReturnType<typeof setTimeout> | undefined;

      // Poll the expression on state changes
      const unsubscribe = this.stateStore.onAnyStateChange(() => {
        try {
          const exprCtx = this.buildExpressionContext(ctx);
          if (this.expressionEngine.evaluateBoolean(action.expression, exprCtx)) {
            if (timeoutTimer) clearTimeout(timeoutTimer);
            unsubscribe();
            resolve(true);
          }
        } catch { /* ignore evaluation errors */ }
      });

      // Check immediately
      try {
        const exprCtx = this.buildExpressionContext(ctx);
        if (this.expressionEngine.evaluateBoolean(action.expression, exprCtx)) {
          unsubscribe();
          resolve(true);
          return;
        }
      } catch { /* ignore */ }

      if (timeoutMs) {
        timeoutTimer = setTimeout(() => {
          unsubscribe();
          resolve(false);
        }, timeoutMs);
      }

      ctx.signal.addEventListener('abort', () => {
        if (timeoutTimer) clearTimeout(timeoutTimer);
        unsubscribe();
        resolve(false);
      }, { once: true });
    });

    ctx.wait = { completed: result };
    const output = { completed: result };
    ctx.setNodeOutput(action.id, output);
    ctx.endStep(stepIdx, result ? 'executed' : 'timeout', output);

    if (!result && action.continueOnTimeout === false) {
      throw new StopExecutionError('Wait for template timed out', false);
    }
  }

  // ============================================================
  // Fire Webhook
  // ============================================================

  private async executeFireWebhook(action: FireWebhookAction, ctx: ExecutionContext, tags?: StepTags): Promise<void> {
    // Raw url recorded first; a template that resolves wrong is only
    // diagnosable if the trace still shows what it resolved FROM.
    const stepIdx = ctx.beginStep('action', action.id, 'fire_webhook',
      `${action.method ?? 'POST'} ${action.url.slice(0, 50)}`, { rawUrl: action.url, method: action.method }, tags);

    try {
      const url = this.resolveTemplateString(action.url, ctx);
      assertSafeOutboundUrl(url);
      const body = action.body ? JSON.stringify(this.resolveTemplateValue(action.body, ctx)) : undefined;
      const headers: Record<string, string> = { ...action.headers };
      if (body && !headers['Content-Type']) {
        headers['Content-Type'] = 'application/json';
      }

      const response = await fetch(url, {
        method: action.method ?? 'POST',
        headers,
        body,
        redirect: 'error',
        signal: AbortSignal.timeout(30_000),
      });

      // Capture response body for downstream nodes
      let responseBody: unknown = null;
      const contentType = response.headers.get('content-type') ?? '';
      try {
        if (contentType.includes('application/json')) {
          responseBody = await response.json();
        } else {
          responseBody = await response.text();
        }
      } catch { /* ignore body parse errors */ }

      const output = {
        url,
        status: response.status,
        statusText: response.statusText,
        body: responseBody,
        headers: Object.fromEntries(response.headers.entries()),
        ok: response.ok,
      };
      ctx.setNodeOutput(action.id, output);
      // Node output keeps the full body for downstream expressions; the trace
      // step gets a size-capped copy so one chatty response can't balloon it.
      ctx.endStep(stepIdx, 'executed', { ...output, body: capLarge(responseBody) });
    } catch (e) {
      ctx.setNodeOutput(action.id, { status: 0, ok: false, error: describeError(e) });
      ctx.endStep(stepIdx, 'error', undefined, describeError(e));
      // Don't throw — webhook failures shouldn't stop the automation
    }
  }

  // ============================================================
  // Toggle Automation
  // ============================================================

  private async executeToggleAutomation(action: ToggleAutomationAction, ctx: ExecutionContext, tags?: StepTags): Promise<void> {
    const stepIdx = ctx.beginStep('action', action.id, 'toggle_automation',
      `${action.action} automation ${action.automationId.slice(0, 8)}`,
      { automationId: action.automationId, action: action.action }, tags);

    try {
      switch (action.action) {
        case 'enable':
          this.callbacks.setAutomationEnabled(action.automationId, true);
          break;
        case 'disable':
          this.callbacks.setAutomationEnabled(action.automationId, false);
          break;
        case 'toggle':
          // Toggle is handled by the engine
          this.callbacks.setAutomationEnabled(action.automationId, true); // simplified
          break;
        case 'trigger': {
          const chain = [...ctx.ancestorIds, ctx.automationId];
          if (chain.includes(action.automationId)) {
            throw new Error(`[Automation] Cycle detected — ${action.automationId} is already in the trigger chain: ${chain.join(' → ')}`);
          }
          if (chain.length > MAX_SUB_AUTOMATION_DEPTH) {
            throw new Error(`[Automation] Sub-automation depth exceeded (max ${MAX_SUB_AUTOMATION_DEPTH})`);
          }
          await this.callbacks.triggerAutomation(action.automationId, chain);
          break;
        }
      }
      const output = { automationId: action.automationId, action: action.action, success: true };
      ctx.setNodeOutput(action.id, output);
      ctx.endStep(stepIdx, 'executed', output);
    } catch (e) {
      ctx.setNodeOutput(action.id, { automationId: action.automationId, action: action.action, success: false, error: describeError(e) });
      ctx.endStep(stepIdx, 'error', undefined, describeError(e));
      throw e;
    }
  }

  // ============================================================
  // Call Script
  // ============================================================

  private async executeCallScript(action: CallScriptAction, ctx: ExecutionContext, tags?: StepTags): Promise<void> {
    const stepIdx = ctx.beginStep('action', action.id, 'call_script',
      `Run script ${action.scriptId.slice(0, 8)}`, { scriptId: action.scriptId }, tags);

    try {
      const vars = action.variables
        ? Object.fromEntries(
            Object.entries(action.variables).map(([k, v]) => [k, this.resolveTemplateValue(v, ctx)]),
          )
        : undefined;

      const response = await this.callbacks.executeScript(action.scriptId, vars);

      // Capture response variable if specified
      if (action.responseVariable && response) {
        ctx.setVariable(action.responseVariable, response);
      }

      const output = {
        response: response ?? null,
        scriptId: action.scriptId,
        ...(vars ? { variables: capLarge(vars, 2048) } : {}),
      };
      ctx.setNodeOutput(action.id, output);
      ctx.endStep(stepIdx, 'executed', output);
    } catch (e) {
      ctx.setNodeOutput(action.id, { scriptId: action.scriptId, error: describeError(e) });
      ctx.endStep(stepIdx, 'error', undefined, describeError(e));
      throw e;
    }
  }

  // ============================================================
  // Merge (combine data from multiple upstream nodes)
  // ============================================================

  private async executeMerge(action: MergeAction, ctx: ExecutionContext, tags?: StepTags): Promise<void> {
    const stepIdx = ctx.beginStep('action', action.id, 'merge',
      `Merge (${action.mode}, ${action.inputIds.length} inputs)`, { mode: action.mode, inputIds: action.inputIds }, tags);

    try {
      // Gather outputs from input nodes
      const inputData: Record<string, unknown>[] = [];
      for (const nodeId of action.inputIds) {
        const nodeOutput = ctx.getNodeOutput(nodeId);
        if (nodeOutput) inputData.push(nodeOutput);
      }

      let merged: unknown;

      switch (action.mode) {
        case 'append':
          // Combine all input arrays/objects into a single array
          merged = inputData;
          break;

        case 'combine': {
          // Merge objects by shared key field
          const result: Record<string, unknown> = {};
          for (const data of inputData) {
            for (const [key, value] of Object.entries(data)) {
              if (action.combineKey && key === action.combineKey) continue;
              result[key] = value;
            }
          }
          merged = result;
          break;
        }

        case 'wait_all':
          // Just gather all — the fact that we're executing means all inputs completed
          merged = inputData;
          break;
      }

      const output = { merged, inputCount: inputData.length };
      ctx.setNodeOutput(action.id, output);
      ctx.endStep(stepIdx, 'executed', output);
    } catch (e) {
      ctx.setNodeOutput(action.id, { error: true, errorMessage: describeError(e) });
      ctx.endStep(stepIdx, 'error', undefined, describeError(e));
      throw e;
    }
  }

  // ============================================================
  // Code execution (sandboxed)
  // ============================================================

  private async executeCode(action: CodeAction, ctx: ExecutionContext, tags?: StepTags): Promise<void> {
    // The step input records the source and (capped) variables — a failing
    // code node was previously undiagnosable from the trace, which kept
    // neither the code nor what it received. stateSnapshot stays out: it is
    // the whole home's state and would dwarf everything else in the trace.
    const stepIdx = ctx.beginStep('action', action.id, 'code',
      `Code (${action.code.length} chars)`,
      { code: capLarge(action.code, 2000), variables: capLarge({ ...ctx.variables }, 2048) }, tags);

    try {
      const input = {
        trigger: ctx.triggerData,
        variables: { ...ctx.variables },
        nodes: ctx.getNodeOutputsForExpressions(),
        stateSnapshot: this.stateStore.snapshot(),
      };

      const timeoutMs = action.timeout ?? 5000;
      const result = await this.codeSandbox.run(action.code, input, timeoutMs);

      const output: Record<string, unknown> = typeof result === 'object' && result !== null
        ? (result as Record<string, unknown>)
        : { result };

      ctx.setNodeOutput(action.id, output);
      ctx.endStep(stepIdx, 'executed', capLarge(output) as Record<string, unknown>);
    } catch (e) {
      ctx.setNodeOutput(action.id, { error: true, errorMessage: describeError(e) });
      ctx.endStep(stepIdx, 'error', undefined, describeError(e));
      throw e;
    }
  }

  // ============================================================
  // Template resolution (via ExpressionEngine)
  // ============================================================

  private resolveTemplateString(value: string, ctx: ExecutionContext): string {
    const exprCtx = this.buildExpressionContext(ctx);
    const result = this.expressionEngine.resolveTemplate(value, exprCtx);
    return String(result ?? '');
  }

  private resolveTemplateValue(value: unknown, ctx: ExecutionContext): unknown {
    const exprCtx = this.buildExpressionContext(ctx);
    return this.expressionEngine.resolveTemplate(value, exprCtx);
  }

  private buildExpressionContext(ctx: ExecutionContext): ExpressionContext {
    return ExpressionEngine.buildContext(
      this.stateStore,
      ctx.triggerData,
      ctx.variables,
      ctx.repeat,
      ctx.wait,
      ctx.getNodeOutputsForExpressions(),
    );
  }

  // ============================================================
  // Safety
  // ============================================================

  private checkTimeout(): void {
    if (Date.now() - this.executionStart > MAX_EXECUTION_TIME_MS) {
      throw new Error('Automation execution timeout (5 minutes)');
    }
  }

  // ============================================================
  // Utilities
  // ============================================================

  private formatDuration(d: { hours?: number; minutes?: number; seconds?: number }): string {
    const parts: string[] = [];
    if (d.hours) parts.push(`${d.hours}h`);
    if (d.minutes) parts.push(`${d.minutes}m`);
    if (d.seconds) parts.push(`${d.seconds}s`);
    return parts.join(' ') || '0s';
  }
}
