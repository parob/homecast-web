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
  setCharacteristic(accessoryId: string, characteristicType: string, value: unknown): Promise<void>;
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
   */
  async executeSequence(actions: Action[], ctx: ExecutionContext): Promise<void> {
    this.executionStart = Date.now();

    for (const action of actions) {
      if (ctx.isAborted) break;
      this.checkTimeout();

      if (action.enabled === false) continue;

      await this.executeActionWithErrorHandling(action, ctx);
    }
  }

  private async executeActionWithErrorHandling(action: Action, ctx: ExecutionContext): Promise<void> {
    const errorStrategy = action.onError ?? 'stop';

    if (errorStrategy === 'stop') {
      // Default behavior — errors propagate up
      return this.executeAction(action, ctx);
    }

    if (errorStrategy === 'retry') {
      const maxRetries = action.maxRetries ?? 3;
      const retryDelay = action.retryDelayMs ?? 1000;
      let lastError: unknown;

      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
          await this.executeAction(action, ctx);
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
      return;
    }

    // 'continue' — catch errors, log them, and proceed
    try {
      await this.executeAction(action, ctx);
    } catch (e) {
      if (e instanceof StopExecutionError) throw e;
      ctx.setNodeOutput(action.id, {
        ...(ctx.getNodeOutput(action.id) ?? {}),
        error: true,
        errorMessage: describeError(e),
      });
    }
  }

  private async executeAction(action: Action, ctx: ExecutionContext): Promise<void> {
    switch (action.type) {
      case 'set_characteristic':
        return this.executeSetCharacteristic(action, ctx);
      case 'set_service_group':
        return this.executeSetServiceGroup(action, ctx);
      case 'execute_scene':
        return this.executeScene(action, ctx);
      case 'delay':
        return this.executeDelay(action, ctx);
      case 'choose':
        return this.executeChoose(action, ctx);
      case 'if_then_else':
        return this.executeIfThenElse(action, ctx);
      case 'repeat':
        return this.executeRepeat(action, ctx);
      case 'parallel':
        return this.executeParallel(action, ctx);
      case 'variables':
        return this.executeVariables(action, ctx);
      case 'stop':
        return this.executeStop(action);
      case 'fire_event':
        return this.executeFireEvent(action, ctx);
      case 'fire_webhook':
        return this.executeFireWebhook(action, ctx);
      case 'toggle_automation':
        return this.executeToggleAutomation(action, ctx);
      case 'call_script':
        return this.executeCallScript(action, ctx);
      case 'notify':
        return this.executeNotify(action, ctx);
      case 'wait_for_trigger':
        return this.executeWaitForTrigger(action, ctx);
      case 'wait_for_template':
        return this.executeWaitForTemplate(action, ctx);
      case 'code':
        return this.executeCode(action, ctx);
      case 'merge':
        return this.executeMerge(action, ctx);
      case 'helper':
        return this.executeHelper(action, ctx);
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
  ): Promise<void> {
    const stepIdx = ctx.beginStep('action', action.id, 'set_characteristic',
      `Set ${action.accessoryId} ${action.characteristicType}`,
      { accessoryId: action.accessoryId, characteristicType: action.characteristicType, value: action.value });

    try {
      const resolvedValue = this.resolveTemplateValue(action.value, ctx);
      requireValue(resolvedValue, action.characteristicType);
      const resolvedAccessoryId = this.resolveTemplateString(action.accessoryId, ctx);

      // Record before writing so the resulting state change can be attributed
      // to us rather than to a human reaching for the switch.
      this.stateStore.recordWrite(resolvedAccessoryId, action.characteristicType, resolvedValue);
      await this.bridge.setCharacteristic(resolvedAccessoryId, action.characteristicType, resolvedValue);
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
  ): Promise<void> {
    const stepIdx = ctx.beginStep('action', action.id, 'set_service_group',
      `Set group ${action.groupId}`, { groupId: action.groupId });

    try {
      const resolvedValue = this.resolveTemplateValue(action.value, ctx);
      requireValue(resolvedValue, action.characteristicType);
      await this.bridge.setServiceGroup(action.groupId, action.characteristicType, resolvedValue, action.homeId);
      const output = { groupId: action.groupId, characteristicType: action.characteristicType, value: resolvedValue, success: true };
      ctx.setNodeOutput(action.id, output);
      ctx.endStep(stepIdx, 'executed', output);
    } catch (e) {
      ctx.setNodeOutput(action.id, { groupId: action.groupId, success: false, error: describeError(e) });
      ctx.endStep(stepIdx, 'error', undefined, describeError(e));
      throw e;
    }
  }

  private async executeScene(action: ExecuteSceneAction, ctx: ExecutionContext): Promise<void> {
    const stepIdx = ctx.beginStep('action', action.id, 'execute_scene',
      `Execute scene ${action.sceneId}`, { sceneId: action.sceneId });

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

  private async executeHelper(action: HelperAction, ctx: ExecutionContext): Promise<void> {
    const stepIdx = ctx.beginStep('action', action.id, 'helper',
      `Helper ${action.operation} ${action.helperId}`,
      { helperId: action.helperId, operation: action.operation });

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

      switch (action.operation) {
        case 'turn_on': h.turnOn(id); break;
        case 'turn_off': h.turnOff(id); break;
        case 'toggle': h.toggle(id); break;
        case 'set': h.setHelperValue(id, value); break;
        case 'increment': h.incrementHelper(id, action.step); break;
        case 'decrement': h.decrementHelper(id, action.step); break;
        case 'reset': h.resetCounter(id); break;
        case 'start': h.startTimer(id, action.duration); break;
        case 'pause': h.pauseTimer(id); break;
        case 'resume': h.resumeTimer(id); break;
        case 'cancel': h.cancelTimer(id); break;
        case 'finish': h.finishTimer(id); break;
      }

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

  private async executeDelay(action: DelayAction, ctx: ExecutionContext): Promise<void> {
    const raw = durationToMs(action.duration);
    const ms = Math.max(0, Math.min(raw, MAX_DELAY_MS));
    const stepIdx = ctx.beginStep('action', action.id, 'delay',
      `Wait ${this.formatDuration(action.duration)}`, { durationMs: ms, requestedMs: raw });

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

  private async executeChoose(action: ChooseAction, ctx: ExecutionContext): Promise<void> {
    const stepIdx = ctx.beginStep('action', action.id, 'choose',
      `Choose (${action.choices.length} branches)`, {});

    let matched = false;
    for (let i = 0; i < action.choices.length; i++) {
      const choice = action.choices[i];
      if (this.conditionEvaluator.evaluate(choice.conditions, ctx.triggerData, ctx.variables)) {
        matched = true;
        const output = { branch: choice.alias ?? String(i), index: i };
        ctx.setNodeOutput(action.id, output);
        ctx.endStep(stepIdx, 'executed', output);
        await this.executeSequence(choice.actions, ctx);
        break;
      }
    }

    if (!matched) {
      if (action.default && action.default.length > 0) {
        const output = { branch: 'default', index: -1 };
        ctx.setNodeOutput(action.id, output);
        ctx.endStep(stepIdx, 'executed', output);
        await this.executeSequence(action.default, ctx);
      } else {
        ctx.setNodeOutput(action.id, { branch: 'none', index: -1 });
        ctx.endStep(stepIdx, 'skipped', { reason: 'no matching branch' });
      }
    }
  }

  private async executeIfThenElse(action: IfThenElseAction, ctx: ExecutionContext): Promise<void> {
    const result = this.conditionEvaluator.evaluate(action.condition, ctx.triggerData, ctx.variables);
    const stepIdx = ctx.beginStep('action', action.id, 'if_then_else',
      result ? 'If → Then' : 'If → Else', { conditionResult: result });

    const output = { branch: result ? 'then' : 'else', result };
    ctx.setNodeOutput(action.id, output);
    ctx.endStep(stepIdx, 'executed', output);

    if (result) {
      await this.executeSequence(action.then, ctx);
    } else if (action.else) {
      await this.executeSequence(action.else, ctx);
    }
  }

  // ============================================================
  // Repeat
  // ============================================================

  private async executeRepeat(action: RepeatAction, ctx: ExecutionContext): Promise<void> {
    const stepIdx = ctx.beginStep('action', action.id, 'repeat',
      `Repeat (${action.mode})`, { mode: action.mode });

    let iterations = 0;

    switch (action.mode) {
      case 'count': {
        const count = action.count ?? 0;
        for (let i = 0; i < count && !ctx.isAborted; i++) {
          if (++iterations > MAX_LOOP_ITERATIONS) break;
          ctx.repeat = { index: i, first: i === 0, last: i === count - 1 };
          await this.executeSequence(action.sequence, ctx);
        }
        break;
      }

      case 'while': {
        while (
          !ctx.isAborted &&
          action.whileCondition &&
          this.conditionEvaluator.evaluate(action.whileCondition, ctx.triggerData, ctx.variables)
        ) {
          if (++iterations > MAX_LOOP_ITERATIONS) break;
          ctx.repeat = { index: iterations - 1, first: iterations === 1, last: false };
          await this.executeSequence(action.sequence, ctx);
        }
        break;
      }

      case 'until': {
        do {
          if (++iterations > MAX_LOOP_ITERATIONS) break;
          ctx.repeat = { index: iterations - 1, first: iterations === 1, last: false };
          await this.executeSequence(action.sequence, ctx);
        } while (
          !ctx.isAborted &&
          action.untilCondition &&
          !this.conditionEvaluator.evaluate(action.untilCondition, ctx.triggerData, ctx.variables)
        );
        break;
      }

      case 'for_each': {
        const items = action.forEachItems ?? [];
        for (let i = 0; i < items.length && !ctx.isAborted; i++) {
          if (++iterations > MAX_LOOP_ITERATIONS) break;
          ctx.repeat = { index: i, first: i === 0, last: i === items.length - 1, item: items[i] };
          await this.executeSequence(action.sequence, ctx);
        }
        break;
      }
    }

    const output = { iterations };
    ctx.setNodeOutput(action.id, output);
    ctx.endStep(stepIdx, 'executed', output);
  }

  // ============================================================
  // Parallel
  // ============================================================

  private async executeParallel(action: ParallelAction, ctx: ExecutionContext): Promise<void> {
    const stepIdx = ctx.beginStep('action', action.id, 'parallel',
      `Parallel (${action.branches.length} branches)`, {});

    const promises = action.branches.map((branch) =>
      this.executeSequence(branch, ctx),
    );

    await Promise.all(promises);
    ctx.endStep(stepIdx, 'executed');
  }

  // ============================================================
  // Variables
  // ============================================================

  private async executeVariables(action: VariablesAction, ctx: ExecutionContext): Promise<void> {
    const stepIdx = ctx.beginStep('action', action.id, 'variables',
      `Set ${Object.keys(action.variables).length} variable(s)`, {});

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

  private executeStop(action: StopAction): never {
    throw new StopExecutionError(
      action.reason ?? 'Automation stopped',
      action.error ?? false,
      action.responseVariable,
    );
  }

  // ============================================================
  // Fire Event
  // ============================================================

  private async executeFireEvent(action: FireEventAction, ctx: ExecutionContext): Promise<void> {
    const stepIdx = ctx.beginStep('action', action.id, 'fire_event',
      `Fire event: ${action.eventType}`, { eventType: action.eventType });

    this.callbacks.fireEvent(action.eventType, action.eventData);
    const output = { eventType: action.eventType, eventData: action.eventData };
    ctx.setNodeOutput(action.id, output);
    ctx.endStep(stepIdx, 'executed', output);
  }

  // ============================================================
  // Notify
  // ============================================================

  private async executeNotify(action: NotifyAction, ctx: ExecutionContext): Promise<void> {
    const message = this.resolveTemplateString(action.message, ctx);
    const title = action.title ? this.resolveTemplateString(action.title, ctx) : undefined;

    const stepIdx = ctx.beginStep('action', action.id, 'notify',
      `Notify: ${message.slice(0, 50)}`, { message, title });

    try {
      // Deliberately not awaited. Delivery is decided by the server, a round
      // trip away; awaiting it here put that round trip between this action and
      // the next, so an automation that notified and then turned a light on
      // took over a second to turn the light on. Hand the notification off,
      // carry on, and fold the outcome into the trace at the end of the run.
      const delivery = Promise.resolve(
        this.callbacks.sendNotification(message, title, action.data, ctx.automationId),
      ).then((d) => {
        const result = d || NOTIFY_DELIVERY_UNKNOWN;
        return {
          delivered: result.delivered,
          channels: result.channels,
          ...(result.rateLimited ? { rateLimited: true } : {}),
          ...(result.reason ? { reason: result.reason } : {}),
        };
      });

      // `success` stays true: the action ran and did not fail. Whether anything
      // reached a device is a separate fact, and conflating the two is what hid
      // rate-limited notifications in the first place.
      const output = { message, title, success: true, ...NOTIFY_DELIVERY_PENDING };
      ctx.setNodeOutput(action.id, output);
      ctx.endStep(stepIdx, 'executed', output);
      ctx.awaitStepDetail(stepIdx, delivery);
    } catch (e) {
      ctx.setNodeOutput(action.id, { message, title, success: false, error: describeError(e) });
      ctx.endStep(stepIdx, 'error', undefined, describeError(e));
      throw e;
    }
  }

  // ============================================================
  // Wait for Trigger
  // ============================================================

  private async executeWaitForTrigger(action: WaitForTriggerAction, ctx: ExecutionContext): Promise<void> {
    const timeoutMs = action.timeout ? durationToMs(action.timeout) : undefined;
    const stepIdx = ctx.beginStep('action', action.id, 'wait_for_trigger',
      `Wait for trigger${timeoutMs ? ` (timeout: ${timeoutMs / 1000}s)` : ''}`, {});

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

  private async executeWaitForTemplate(action: WaitForTemplateAction, ctx: ExecutionContext): Promise<void> {
    const timeoutMs = action.timeout ? durationToMs(action.timeout) : undefined;
    const stepIdx = ctx.beginStep('action', action.id, 'wait_for_template',
      `Wait for expression to be true`, {});

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

  private async executeFireWebhook(action: FireWebhookAction, ctx: ExecutionContext): Promise<void> {
    const url = this.resolveTemplateString(action.url, ctx);
    const stepIdx = ctx.beginStep('action', action.id, 'fire_webhook',
      `${action.method ?? 'POST'} ${url.slice(0, 50)}`, { url, method: action.method });

    try {
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
        status: response.status,
        statusText: response.statusText,
        body: responseBody,
        headers: Object.fromEntries(response.headers.entries()),
        ok: response.ok,
      };
      ctx.setNodeOutput(action.id, output);
      ctx.endStep(stepIdx, 'executed', output);
    } catch (e) {
      ctx.setNodeOutput(action.id, { status: 0, ok: false, error: describeError(e) });
      ctx.endStep(stepIdx, 'error', undefined, describeError(e));
      // Don't throw — webhook failures shouldn't stop the automation
    }
  }

  // ============================================================
  // Toggle Automation
  // ============================================================

  private async executeToggleAutomation(action: ToggleAutomationAction, ctx: ExecutionContext): Promise<void> {
    const stepIdx = ctx.beginStep('action', action.id, 'toggle_automation',
      `${action.action} automation ${action.automationId.slice(0, 8)}`, {});

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

  private async executeCallScript(action: CallScriptAction, ctx: ExecutionContext): Promise<void> {
    const stepIdx = ctx.beginStep('action', action.id, 'call_script',
      `Run script ${action.scriptId.slice(0, 8)}`, {});

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

      const output = { response: response ?? null, scriptId: action.scriptId };
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

  private async executeMerge(action: MergeAction, ctx: ExecutionContext): Promise<void> {
    const stepIdx = ctx.beginStep('action', action.id, 'merge',
      `Merge (${action.mode}, ${action.inputIds.length} inputs)`, { mode: action.mode, inputIds: action.inputIds });

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

  private async executeCode(action: CodeAction, ctx: ExecutionContext): Promise<void> {
    const stepIdx = ctx.beginStep('action', action.id, 'code',
      `Code (${action.code.length} chars)`, {});

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
      ctx.endStep(stepIdx, 'executed', output);
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
