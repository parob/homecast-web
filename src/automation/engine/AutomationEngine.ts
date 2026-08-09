// Homecast Automation Engine - Main Orchestrator
// Lifecycle: initialize → load → register → execute → teardown

import { StateStore } from '../state/StateStore';
import { VirtualAccessoryManager } from '../state/VirtualAccessoryManager';
import { TriggerManager, type ServiceGroupResolver } from './TriggerManager';
import { ConditionEvaluator } from './ConditionEvaluator';
import { ActionExecutor, StopExecutionError } from './ActionExecutor';
import type { HomeKitBridge, EngineCallbacks } from './ActionExecutor';
import type { CodeSandbox } from './CodeSandbox';
import { ScriptRunner } from './ScriptRunner';
import { ExecutionContext } from './ExecutionContext';
import type {
  Automation, Trigger, TriggerData, AutomationMode, VirtualAccessoryDefinition,
  VirtualOperation, Duration,
} from '../types/automation';
import type { ExecutionTrace, ExecutionEvent, ExecutionStatus, BlockedReason } from '../types/execution';
import { describeTriggerData, capLarge } from './trace-summaries';
import type { NotifyDelivery } from '../types/notify';
import type { HomeKitEvent } from '../../native/homekit-bridge';
import { describeError } from '../../lib/describe-error';

// Rate limiting
const MAX_EXECUTIONS_PER_MINUTE = 10;
const RATE_WINDOW_MS = 60_000;

/**
 * Minimum gap between blocked-run stub traces per automation. A trigger storm
 * that trips the rate limit must not itself flood the trace store — one stub
 * says "runs are being skipped"; a hundred would bury the real history.
 */
const BLOCKED_TRACE_MIN_INTERVAL_MS = 10_000;

const BLOCKED_REASON_TEXT: Record<BlockedReason, string> = {
  rate_limit: `Rate limit exceeded (${MAX_EXECUTIONS_PER_MINUTE}/min) — run skipped`,
  mode_single: 'Already running (mode: single) — run skipped',
  mode_queued: 'Too many runs in flight — run skipped',
  disabled: 'Automation disabled — run skipped',
};

export interface AutomationEngineConfig {
  bridge: HomeKitBridge;
  serviceGroupResolver?: ServiceGroupResolver;
  onTraceComplete: (trace: ExecutionTrace) => void;
  onNotify: (message: string, title?: string, data?: Record<string, unknown>, automationId?: string) => Promise<NotifyDelivery | void>;
  /** Optional sandbox for Code action nodes. Defaults to the Worker-based sandbox in production. */
  codeSandbox?: CodeSandbox;
  /**
   * Called whenever a helper's value changes, so it can be persisted. Counters
   * and modes are worthless if they reset on every relay restart.
   */
  onVirtualStateChange?: (accessoryId: string, state: unknown) => void;
  /**
   * Live-view stream: started / step / variables_changed / finished, emitted
   * synchronously as the run progresses (never adding an await to the action
   * chain). Same-context consumers only — remote transports would fan this out
   * via local-broadcast (community) or AutomationSyncManager (cloud), neither
   * of which is wired yet.
   */
  onExecutionEvent?: (e: ExecutionEvent) => void;
}

/**
 * Main automation engine orchestrator.
 * Runs on the relay only (when isActiveRelay === true).
 */
export class AutomationEngine {
  readonly stateStore: StateStore;
  readonly virtualManager: VirtualAccessoryManager;
  /** Exposed so relay-initiated writes can be expanded to a group's members. */
  readonly serviceGroupResolver?: ServiceGroupResolver;
  private triggerManager: TriggerManager;
  private conditionEvaluator: ConditionEvaluator;
  private actionExecutor: ActionExecutor;
  readonly scriptRunner: ScriptRunner;

  private automations = new Map<string, Automation>();
  private runningExecutions = new Map<string, ExecutionContext[]>();
  private executionRates = new Map<string, number[]>(); // automationId -> timestamps
  private lastBlockedTraceAt = new Map<string, number>(); // automationId -> timestamp
  private temporaryTriggerCounter = 0;

  private config: AutomationEngineConfig;
  private homeKitUnsubscribe?: () => void;
  private initialized = false;

  constructor(config: AutomationEngineConfig) {
    this.config = config;
    this.stateStore = new StateStore();
    this.serviceGroupResolver = config.serviceGroupResolver;
    this.triggerManager = new TriggerManager(this.stateStore, config.serviceGroupResolver);
    this.conditionEvaluator = new ConditionEvaluator(this.stateStore);

    const callbacks: EngineCallbacks = {
      fireEvent: (type, data) => this.fireEvent(type, data),
      sendNotification: (msg, title, data, automationId) => this.config.onNotify(msg, title, data, automationId),
      setAutomationEnabled: (id, enabled) => this.setEnabled(id, enabled),
      triggerAutomation: (id, ancestorIds) => this.manualTrigger(id, { ancestorIds }).then(() => {}),
      executeScript: (id, vars) => this.scriptRunner.execute(id, vars),
      registerTemporaryTrigger: (triggers, callback) => this.registerTemporaryTrigger(triggers, callback),
    };

    this.virtualManager = new VirtualAccessoryManager(
      this.stateStore,
      (type, data) => this.fireEvent(type, data),
      (accessoryId, state) => this.config.onVirtualStateChange?.(accessoryId, state),
    );

    this.actionExecutor = new ActionExecutor(
      this.stateStore,
      this.conditionEvaluator,
      config.bridge,
      callbacks,
      config.codeSandbox,
      this.virtualManager,
    );

    this.scriptRunner = new ScriptRunner(this.actionExecutor, (trace) => {
      this.config.onTraceComplete(trace);
    });
  }

  /**
   * Register temporary triggers (for wait_for_trigger action).
   * Returns an unregister function.
   */
  private registerTemporaryTrigger(triggers: Trigger[], callback: (data: TriggerData) => void): () => void {
    const tempId = `__temp_${++this.temporaryTriggerCounter}`;
    this.triggerManager.registerTriggers(tempId, triggers, callback);
    return () => this.triggerManager.unregisterTriggers(tempId);
  }

  // ============================================================
  // Lifecycle
  // ============================================================

  /**
   * Initialize the engine. Call when relay becomes active.
   * @param subscribeToHomeKit - function to subscribe to HomeKit events
   */
  initialize(subscribeToHomeKit: (handler: (event: HomeKitEvent) => void) => () => void): void {
    if (this.initialized) return;

    // Subscribe to HomeKit events for state tracking
    this.homeKitUnsubscribe = subscribeToHomeKit((event) => {
      this.stateStore.handleHomeKitEvent(event);
    });

    // Initialize trigger manager (subscribes to state store)
    this.triggerManager.initialize();

    this.initialized = true;
    console.log('[AutomationEngine] Initialized');

    // Fire system trigger
    this.fireEvent('system.relay_connected');
  }

  /**
   * Set the home's coordinates for sun trigger/condition maths.
   *
   * Without this, sunrise/sunset resolve against lat 0 / lon 0, so every
   * sun-based automation fires at the wrong time.
   */
  setLocation(latitude: number, longitude: number): void {
    this.triggerManager.setLocation(latitude, longitude);
    this.conditionEvaluator.setLocation(latitude, longitude);
  }

  /**
   * Register helper definitions and reapply any persisted values.
   *
   * Call before `loadAutomations` so automations referencing a helper find it
   * already in the state store.
   */
  loadVirtualAccessories(helpers: VirtualAccessoryDefinition[], persistedStates?: Record<string, unknown>): void {
    this.virtualManager.loadAll(helpers);
    if (persistedStates) this.virtualManager.restoreStates(persistedStates);
    console.log(`[AutomationEngine] Loaded ${helpers.length} helpers`);
  }

  /**
   * Apply a complete helper set, as `sync_all` does for automations.
   *
   * Unlike `loadVirtualAccessories` this REPLACES — a helper missing from the set is
   * deleted rather than left running. Safe to call repeatedly: helpers whose
   * definition hasn't changed keep their value and their timers.
   */
  syncVirtualAccessories(
    helpers: VirtualAccessoryDefinition[],
    persistedStates?: Record<string, unknown>,
  ): void {
    this.virtualManager.replaceAll(helpers, persistedStates);
    console.log(`[AutomationEngine] Synced ${helpers.length} helpers`);
  }

  /** Create or update a single helper, keeping its current value if it exists. */
  upsertVirtualAccessory(helper: VirtualAccessoryDefinition): void {
    const existing = this.virtualManager.getVirtualAccessory(helper.id);
    const carried = existing ? this.stateStore.getVirtualState(helper.id) : undefined;
    if (existing) this.virtualManager.remove(helper.id);
    this.virtualManager.register(helper);
    if (carried !== undefined && helper.type !== 'timer') {
      this.stateStore.updateVirtualState(helper.id, carried);
    }
  }

  /** Remove a single helper and stop anything it was running. */
  removeVirtualAccessory(accessoryId: string): void {
    this.virtualManager.remove(accessoryId);
  }

  /** A helper's definition, or undefined if it isn't registered. */
  getVirtualAccessory(accessoryId: string): VirtualAccessoryDefinition | undefined {
    return this.virtualManager.getVirtualAccessory(accessoryId);
  }

  /** Current value of every registered helper, keyed by id. */
  getVirtualStates(): Record<string, unknown> {
    return this.virtualManager.getAllStates();
  }

  /**
   * Operate a helper by hand — the same operations the `helper` action uses.
   *
   * Goes through VirtualAccessoryManager.apply, so a manual change notifies listeners and
   * pushes state exactly as an automation's would. A person setting Home Mode
   * to Away must be able to trigger the automations that watch it; a separate
   * quieter path would have made manual changes invisible to the engine.
   */
  operateVirtualAccessory(
    accessoryId: string,
    operation: VirtualOperation,
    opts: { value?: unknown; step?: number; duration?: Duration } = {},
  ): void {
    this.virtualManager.apply(accessoryId, operation, opts);
  }

  /**
   * Load automations from the sync manager.
   */
  loadAutomations(automations: Automation[]): void {
    // Unregister all existing
    for (const id of this.automations.keys()) {
      this.unregisterAutomation(id);
    }

    // Register new
    for (const automation of automations) {
      this.automations.set(automation.id, automation);
      if (automation.enabled) {
        this.registerAutomation(automation);
      }
    }

    const enabled = automations.filter(a => a.enabled);
    const triggerCount = enabled.reduce((sum, a) => sum + (a.triggers?.length ?? 0), 0);
    console.log(`[AutomationEngine] Loaded ${automations.length} automations (${enabled.length} enabled, ${triggerCount} triggers registered)`);
  }

  /**
   * Update a single automation (from sync).
   */
  updateAutomation(automation: Automation): void {
    // Unregister old version
    this.unregisterAutomation(automation.id);

    // Store new version
    this.automations.set(automation.id, automation);

    // Register if enabled
    if (automation.enabled) {
      this.registerAutomation(automation);
    }
  }

  /**
   * Remove an automation.
   */
  removeAutomation(automationId: string): void {
    this.unregisterAutomation(automationId);
    this.automations.delete(automationId);
  }

  /**
   * Teardown: clean up all state, timers, subscriptions.
   */
  teardown(): void {
    if (!this.initialized) return;

    // Fire system trigger before teardown
    this.fireEvent('system.relay_disconnected');

    // Cancel all running executions
    for (const contexts of this.runningExecutions.values()) {
      for (const ctx of contexts) {
        ctx.cancel();
      }
    }
    this.runningExecutions.clear();

    // Teardown trigger manager, script runner and helper timers
    this.triggerManager.teardown();
    this.scriptRunner.teardown();
    this.virtualManager.teardown();

    // Unsubscribe from HomeKit
    if (this.homeKitUnsubscribe) {
      this.homeKitUnsubscribe();
      this.homeKitUnsubscribe = undefined;
    }

    // Clear state
    this.stateStore.clear();
    this.automations.clear();
    this.executionRates.clear();

    this.initialized = false;
    console.log('[AutomationEngine] Torn down');
  }

  // ============================================================
  // Registration
  // ============================================================

  private registerAutomation(automation: Automation): void {
    this.triggerManager.registerTriggers(
      automation.id,
      automation.triggers,
      (triggerData) => this.onTriggerFired(automation.id, triggerData),
    );
  }

  private unregisterAutomation(automationId: string): void {
    this.triggerManager.unregisterTriggers(automationId);

    // Cancel any running executions
    const running = this.runningExecutions.get(automationId);
    if (running) {
      for (const ctx of running) ctx.cancel();
      this.runningExecutions.delete(automationId);
    }
  }

  // ============================================================
  // Execution
  // ============================================================

  /**
   * Called when a trigger fires for an automation.
   */
  private async onTriggerFired(automationId: string, triggerData: TriggerData): Promise<void> {
    const automation = this.automations.get(automationId);
    if (!automation || !automation.enabled) return;

    console.log(`[AutomationEngine] Trigger fired: ${automation.name} (trigger=${triggerData.triggerType}, id=${triggerData.triggerId.slice(0, 8)})`);

    // Rate limiting
    if (!this.checkRateLimit(automationId)) {
      console.warn(`[AutomationEngine] Rate limit exceeded for ${automation.name}`);
      this.emitBlockedTrace(automation, triggerData, 'rate_limit');
      return;
    }

    // Mode handling
    const running = this.runningExecutions.get(automationId) ?? [];

    switch (automation.mode) {
      case 'single':
        if (running.length > 0) {
          this.emitBlockedTrace(automation, triggerData, 'mode_single');
          return;
        }
        break;
      case 'restart':
        // Cancel all running instances
        for (const ctx of running) ctx.cancel();
        this.runningExecutions.set(automationId, []);
        break;
      case 'queued':
        // Wait for all running to finish (simplified: just check max)
        if (running.length >= (automation.maxRunning ?? 10)) {
          this.emitBlockedTrace(automation, triggerData, 'mode_queued');
          return;
        }
        break;
      case 'parallel':
        if (running.length >= (automation.maxRunning ?? 10)) {
          this.emitBlockedTrace(automation, triggerData, 'mode_queued');
          return;
        }
        break;
    }

    await this.executeAutomation(automation, triggerData);
  }

  /**
   * Record a minimal stub trace for a run that was blocked before it could
   * start. Without this, a rate-limited or mode-blocked trigger is
   * indistinguishable from the trigger never having fired at all.
   */
  private emitBlockedTrace(automation: Automation, triggerData: TriggerData, reason: BlockedReason): void {
    const now = Date.now();
    const last = this.lastBlockedTraceAt.get(automation.id) ?? 0;
    if (now - last < BLOCKED_TRACE_MIN_INTERVAL_MS) return;
    this.lastBlockedTraceAt.set(automation.id, now);

    const nowIso = new Date(now).toISOString();
    const trigger = automation.triggers?.find((t) => t.id === triggerData.triggerId);
    const reasonText = BLOCKED_REASON_TEXT[reason];

    this.config.onTraceComplete({
      id: crypto.randomUUID(),
      automationId: automation.id,
      automationName: automation.name,
      startedAt: nowIso,
      finishedAt: nowIso,
      status: 'stopped',
      blockedReason: reason,
      triggerData,
      steps: [
        {
          index: 0, type: 'trigger', nodeId: triggerData.triggerId, nodeType: triggerData.triggerType,
          nodeSummary: describeTriggerData(triggerData, trigger),
          startedAt: nowIso, finishedAt: nowIso, durationMs: 0, result: 'passed',
        },
        {
          index: 1, type: 'condition', nodeId: '__blocked__', nodeType: 'blocked',
          nodeSummary: reasonText,
          startedAt: nowIso, finishedAt: nowIso, durationMs: 0, result: 'skipped',
        },
      ],
      variables: {},
    });
  }

  /**
   * Execute an automation (conditions → actions).
   */
  private async executeAutomation(automation: Automation, triggerData: TriggerData): Promise<void> {
    const ctx = new ExecutionContext(
      automation.id,
      automation.name,
      triggerData,
      automation.variables,
      [],
      automation.homeId,
    );
    this.beginLiveStream(ctx, triggerData);

    // Store trigger data as node output so downstream nodes can reference it
    // via {{ nodes.<triggerId>.data.to_value }}
    if (triggerData.triggerId) {
      ctx.setNodeOutput(triggerData.triggerId, {
        type: triggerData.triggerType,
        from_value: triggerData.fromValue,
        to_value: triggerData.toValue,
        accessoryId: triggerData.accessoryId,
        serviceGroupId: triggerData.serviceGroupId,
        characteristicType: triggerData.characteristicType,
        eventType: triggerData.eventType,
        eventData: triggerData.eventData,
        webhookPayload: triggerData.webhookPayload,
        timestamp: triggerData.timestamp,
      });
    }

    // Track running execution
    let running = this.runningExecutions.get(automation.id);
    if (!running) {
      running = [];
      this.runningExecutions.set(automation.id, running);
    }
    running.push(ctx);

    let status: ExecutionStatus = 'success';
    let error: string | undefined;

    try {
      this.recordTriggerStep(ctx, automation, triggerData);

      // Evaluate conditions
      const conditionsPassed = this.recordConditionStep(ctx, automation, triggerData);
      if (!conditionsPassed) {
        status = 'stopped';
        return;
      }

      // Execute actions
      await this.actionExecutor.executeSequence(automation.actions, ctx);

      if (ctx.isAborted) {
        status = 'cancelled';
      }
    } catch (e) {
      if (e instanceof StopExecutionError) {
        status = e.isError ? 'error' : 'stopped';
        error = e.reason;
      } else {
        status = 'error';
        error = describeError(e);
        console.error(`[AutomationEngine] Error in ${automation.name}:`, e);
      }
    } finally {
      // Remove from running
      const idx = running.indexOf(ctx);
      if (idx >= 0) running.splice(idx, 1);
      if (running.length === 0) this.runningExecutions.delete(automation.id);

      // Update metadata
      automation.metadata.lastTriggeredAt = new Date().toISOString();
      automation.metadata.triggerCount++;

      // Fire error event so error triggers can catch it
      if (status === 'error' && error) {
        this.fireEvent('automation.error', {
          automationId: automation.id,
          automationName: automation.name,
          error,
        });
      }

      // Build and emit trace
      await ctx.settleStepDetails();
      this.endLiveStream(ctx, status, error);
      const trace = ctx.buildTrace(status, error);
      this.config.onTraceComplete(trace);
    }
  }

  /**
   * Wire the run's live event stream, when anyone is listening. Every step
   * has already streamed by the time `finished` goes out — the closing status
   * waits on settleStepDetails (≤10s for a late notify report), which is the
   * same tradeoff the persisted trace makes.
   */
  private beginLiveStream(ctx: ExecutionContext, triggerData: TriggerData): void {
    const sink = this.config.onExecutionEvent;
    if (!sink) return;
    ctx.setEventSink(sink);
    sink({
      type: 'started',
      traceId: ctx.traceId,
      automationId: ctx.automationId,
      timestamp: new Date().toISOString(),
      triggerData,
    });
  }

  private endLiveStream(ctx: ExecutionContext, status: ExecutionStatus, error?: string): void {
    this.config.onExecutionEvent?.({
      type: 'finished',
      traceId: ctx.traceId,
      automationId: ctx.automationId,
      status,
      error,
      timestamp: new Date().toISOString(),
    });
  }

  /**
   * Record what fired the run as the trace's first step. The trigger data was
   * always captured on the trace; recording it as a step puts the from→to
   * values where the history actually shows them.
   */
  private recordTriggerStep(ctx: ExecutionContext, automation: Automation, triggerData: TriggerData): void {
    const trigger = automation.triggers?.find((t) => t.id === triggerData.triggerId);
    const idx = ctx.beginStep('trigger', triggerData.triggerId, triggerData.triggerType,
      describeTriggerData(triggerData, trigger), {
        fromValue: triggerData.fromValue,
        toValue: triggerData.toValue,
        accessoryId: triggerData.accessoryId,
        serviceGroupId: triggerData.serviceGroupId,
        characteristicType: triggerData.characteristicType,
        eventType: triggerData.eventType,
        webhookPayload: capLarge(triggerData.webhookPayload, 2048),
      });
    ctx.endStep(idx, 'passed');
  }

  /**
   * Evaluate the automation's conditions, recording the full per-leaf detail
   * tree (actual vs expected) so a blocked run explains itself. Shared by both
   * execution paths — they previously recorded different step shapes.
   */
  private recordConditionStep(ctx: ExecutionContext, automation: Automation, triggerData: TriggerData): boolean {
    const count = automation.conditions?.conditions?.length ?? 0;
    const idx = ctx.beginStep('condition', 'conditions', 'condition_block',
      count > 0 ? `${count} condition${count === 1 ? '' : 's'}` : 'No conditions',
      { operator: automation.conditions?.operator, count });

    const detail = this.conditionEvaluator.evaluateDetailed(
      automation.conditions,
      triggerData,
      ctx.variables,
    );

    ctx.endStep(idx, detail.passed ? 'passed' : 'failed',
      { detail: capLarge(detail) as Record<string, unknown> });
    return detail.passed;
  }

  /**
   * Manually trigger an automation (for testing).
   * Accepts optional custom trigger data and evaluates conditions when provided.
   */
  async manualTrigger(automationId: string, options?: { triggerData?: Partial<TriggerData>; skipConditions?: boolean; ancestorIds?: readonly string[] }): Promise<ExecutionTrace | null> {
    const automation = this.automations.get(automationId);
    if (!automation) return null;

    const ancestorIds = options?.ancestorIds ?? [];
    if (ancestorIds.includes(automationId)) {
      console.warn(`[AutomationEngine] Refusing to trigger ${automationId} — already in trigger chain: ${ancestorIds.join(' → ')}`);
      return null;
    }

    const triggerData: TriggerData = {
      triggerId: options?.triggerData?.triggerId ?? '__manual__',
      triggerType: options?.triggerData?.triggerType ?? 'event',
      eventType: options?.triggerData?.eventType ?? 'manual_trigger',
      timestamp: Date.now(),
      ...options?.triggerData,
    };

    const ctx = new ExecutionContext(
      automation.id,
      automation.name,
      triggerData,
      automation.variables,
      ancestorIds,
      automation.homeId,
    );
    this.beginLiveStream(ctx, triggerData);

    let status: ExecutionStatus = 'success';
    let error: string | undefined;

    try {
      this.recordTriggerStep(ctx, automation, triggerData);

      // Evaluate conditions if trigger data was provided (unless explicitly skipped)
      const shouldEvalConditions = options?.triggerData && !options?.skipConditions;
      if (shouldEvalConditions && automation.conditions?.conditions?.length > 0) {
        const conditionsPassed = this.recordConditionStep(ctx, automation, triggerData);
        if (!conditionsPassed) {
          status = 'stopped';
          await ctx.settleStepDetails();
          this.endLiveStream(ctx, status, error);
          const trace = ctx.buildTrace(status, error);
          this.config.onTraceComplete(trace);
          return trace;
        }
      }

      await this.actionExecutor.executeSequence(automation.actions, ctx);
    } catch (e) {
      if (e instanceof StopExecutionError) {
        status = e.isError ? 'error' : 'stopped';
        error = e.reason;
      } else {
        status = 'error';
        error = describeError(e);
      }
    }

    await ctx.settleStepDetails();
    this.endLiveStream(ctx, status, error);
    const trace = ctx.buildTrace(status, error);
    this.config.onTraceComplete(trace);
    return trace;
  }

  // ============================================================
  // Enable/Disable
  // ============================================================

  setEnabled(automationId: string, enabled: boolean): void {
    const automation = this.automations.get(automationId);
    if (!automation) return;

    automation.enabled = enabled;

    if (enabled) {
      this.registerAutomation(automation);
    } else {
      this.unregisterAutomation(automationId);
      // Re-store it (unregister removes from map only on full removal)
      this.automations.set(automationId, automation);
    }
  }

  // ============================================================
  // Custom Events
  // ============================================================

  /**
   * Fire a custom event on the internal event bus.
   * Used for inter-automation coordination and system events.
   */
  fireEvent(eventType: string, eventData?: Record<string, unknown>): void {
    this.triggerManager.handleEvent(eventType, eventData);
  }

  // ============================================================
  // Rate Limiting
  // ============================================================

  private checkRateLimit(automationId: string): boolean {
    const now = Date.now();
    let timestamps = this.executionRates.get(automationId);

    if (!timestamps) {
      timestamps = [];
      this.executionRates.set(automationId, timestamps);
    }

    // Remove old entries
    const cutoff = now - RATE_WINDOW_MS;
    while (timestamps.length > 0 && timestamps[0] < cutoff) {
      timestamps.shift();
    }

    if (timestamps.length >= MAX_EXECUTIONS_PER_MINUTE) {
      return false;
    }

    timestamps.push(now);
    return true;
  }

  // ============================================================
  // Recalculation (after sleep/wake)
  // ============================================================

  recalculateTimeTriggers(): void {
    this.triggerManager.recalculateTimeTriggers();
  }

  // ============================================================
  // Query
  // ============================================================

  getAutomation(id: string): Automation | undefined {
    return this.automations.get(id);
  }

  getAllAutomations(): Automation[] {
    return Array.from(this.automations.values());
  }

  isRunning(automationId: string): boolean {
    const running = this.runningExecutions.get(automationId);
    return running !== undefined && running.length > 0;
  }

  get isInitialized(): boolean {
    return this.initialized;
  }
}
