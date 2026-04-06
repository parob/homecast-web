// Homecast Automation Engine - Main Orchestrator
// Lifecycle: initialize → load → register → execute → teardown

import { StateStore } from '../state/StateStore';
import { TriggerManager, type ServiceGroupResolver } from './TriggerManager';
import { ConditionEvaluator } from './ConditionEvaluator';
import { ActionExecutor, StopExecutionError } from './ActionExecutor';
import type { HomeKitBridge, EngineCallbacks } from './ActionExecutor';
import { ScriptRunner } from './ScriptRunner';
import { ExecutionContext } from './ExecutionContext';
import type { Automation, Trigger, TriggerData, AutomationMode } from '../types/automation';
import type { ExecutionTrace, ExecutionStatus } from '../types/execution';
import type { HomeKitEvent } from '../../native/homekit-bridge';

// Rate limiting
const MAX_EXECUTIONS_PER_MINUTE = 10;
const RATE_WINDOW_MS = 60_000;

export interface AutomationEngineConfig {
  bridge: HomeKitBridge;
  serviceGroupResolver?: ServiceGroupResolver;
  onTraceComplete: (trace: ExecutionTrace) => void;
  onNotify: (message: string, title?: string, data?: Record<string, unknown>) => Promise<void>;
}

/**
 * Main automation engine orchestrator.
 * Runs on the relay only (when isActiveRelay === true).
 */
export class AutomationEngine {
  readonly stateStore: StateStore;
  private triggerManager: TriggerManager;
  private conditionEvaluator: ConditionEvaluator;
  private actionExecutor: ActionExecutor;
  readonly scriptRunner: ScriptRunner;

  private automations = new Map<string, Automation>();
  private runningExecutions = new Map<string, ExecutionContext[]>();
  private executionRates = new Map<string, number[]>(); // automationId -> timestamps
  private temporaryTriggerCounter = 0;

  private config: AutomationEngineConfig;
  private homeKitUnsubscribe?: () => void;
  private initialized = false;

  constructor(config: AutomationEngineConfig) {
    this.config = config;
    this.stateStore = new StateStore();
    this.triggerManager = new TriggerManager(this.stateStore, config.serviceGroupResolver);
    this.conditionEvaluator = new ConditionEvaluator(this.stateStore);

    const callbacks: EngineCallbacks = {
      fireEvent: (type, data) => this.fireEvent(type, data),
      sendNotification: (msg, title, data) => this.config.onNotify(msg, title, data),
      setAutomationEnabled: (id, enabled) => this.setEnabled(id, enabled),
      triggerAutomation: (id) => this.manualTrigger(id).then(() => {}),
      executeScript: (id, vars) => this.scriptRunner.execute(id, vars),
      registerTemporaryTrigger: (triggers, callback) => this.registerTemporaryTrigger(triggers, callback),
    };

    this.actionExecutor = new ActionExecutor(
      this.stateStore,
      this.conditionEvaluator,
      config.bridge,
      callbacks,
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

    console.log(`[AutomationEngine] Loaded ${automations.length} automations (${automations.filter(a => a.enabled).length} enabled)`);
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

    // Teardown trigger manager and script runner
    this.triggerManager.teardown();
    this.scriptRunner.teardown();

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

    // Rate limiting
    if (!this.checkRateLimit(automationId)) {
      console.warn(`[AutomationEngine] Rate limit exceeded for ${automation.name}`);
      return;
    }

    // Mode handling
    const running = this.runningExecutions.get(automationId) ?? [];

    switch (automation.mode) {
      case 'single':
        if (running.length > 0) return; // Silently ignore
        break;
      case 'restart':
        // Cancel all running instances
        for (const ctx of running) ctx.cancel();
        this.runningExecutions.set(automationId, []);
        break;
      case 'queued':
        // Wait for all running to finish (simplified: just check max)
        if (running.length >= (automation.maxRunning ?? 10)) return;
        break;
      case 'parallel':
        if (running.length >= (automation.maxRunning ?? 10)) return;
        break;
    }

    await this.executeAutomation(automation, triggerData);
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
    );

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
      // Evaluate conditions
      const conditionStepIdx = ctx.beginStep('condition', 'conditions', 'condition_block',
        'Evaluate conditions');

      const conditionsPassed = this.conditionEvaluator.evaluate(
        automation.conditions,
        triggerData,
        ctx.variables,
      );

      ctx.endStep(conditionStepIdx, conditionsPassed ? 'passed' : 'failed');

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
        error = String(e);
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

      // Build and emit trace
      const trace = ctx.buildTrace(status, error);
      this.config.onTraceComplete(trace);
    }
  }

  /**
   * Manually trigger an automation (for testing).
   * Bypasses triggers, evaluates conditions and runs actions.
   */
  async manualTrigger(automationId: string): Promise<ExecutionTrace | null> {
    const automation = this.automations.get(automationId);
    if (!automation) return null;

    const triggerData: TriggerData = {
      triggerId: '__manual__',
      triggerType: 'event',
      eventType: 'manual_trigger',
      timestamp: Date.now(),
    };

    const ctx = new ExecutionContext(
      automation.id,
      automation.name,
      triggerData,
      automation.variables,
    );

    let status: ExecutionStatus = 'success';
    let error: string | undefined;

    try {
      await this.actionExecutor.executeSequence(automation.actions, ctx);
    } catch (e) {
      if (e instanceof StopExecutionError) {
        status = e.isError ? 'error' : 'stopped';
        error = e.reason;
      } else {
        status = 'error';
        error = String(e);
      }
    }

    return ctx.buildTrace(status, error);
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
