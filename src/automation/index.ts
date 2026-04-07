// Homecast Automation Engine - Entry Point
// Initializes the engine when the relay becomes active

import { AutomationEngine } from './engine/AutomationEngine';
import { AutomationSyncManager } from './sync/AutomationSyncManager';
import type { HomeKitBridge } from './engine/ActionExecutor';
import type { SyncTransport } from './sync/AutomationSyncManager';
import type { HomeKitEvent } from '../native/homekit-bridge';

export type { HomeKitBridge } from './engine/ActionExecutor';
export type { SyncTransport } from './sync/AutomationSyncManager';
export { AutomationEngine } from './engine/AutomationEngine';
export { AutomationSyncManager } from './sync/AutomationSyncManager';

export { ExpressionEngine } from './expression/ExpressionEngine';
export { ScriptRunner } from './engine/ScriptRunner';

// Re-export types
export type { Automation, Trigger, Condition, Action, Script, HelperDefinition, Blueprint } from './types/automation';
export type { ExecutionTrace, TraceStep, ExecutionStatus } from './types/execution';
export type { ExpressionContext } from './expression/ExpressionEngine';

let engineInstance: AutomationEngine | null = null;
let syncInstance: AutomationSyncManager | null = null;

export interface InitOptions {
  bridge: HomeKitBridge;
  transport: SyncTransport;
  subscribeToHomeKit: (handler: (event: HomeKitEvent) => void) => () => void;
  onNotify: (message: string, title?: string, data?: Record<string, unknown>, automationId?: string) => Promise<void>;
}

/**
 * Initialize the automation engine. Call when the relay becomes active.
 * Returns the engine instance for querying state.
 */
export async function initAutomationEngine(options: InitOptions): Promise<AutomationEngine> {
  // Teardown existing instance if re-initializing
  if (engineInstance) {
    teardownAutomationEngine();
  }

  engineInstance = new AutomationEngine({
    bridge: options.bridge,
    onTraceComplete: (trace) => {
      syncInstance?.pushTrace(trace);
    },
    onNotify: options.onNotify,
  });

  syncInstance = new AutomationSyncManager(engineInstance, options.transport);

  // Initialize engine (subscribe to HomeKit events)
  engineInstance.initialize(options.subscribeToHomeKit);

  // Start sync (fetch configs from server, register message handlers)
  await syncInstance.initialize();

  console.log('[Automation] Engine started');
  return engineInstance;
}

/**
 * Teardown the automation engine. Call when the relay becomes inactive.
 */
export function teardownAutomationEngine(): void {
  if (syncInstance) {
    syncInstance.teardown();
    syncInstance = null;
  }
  if (engineInstance) {
    engineInstance.teardown();
    engineInstance = null;
  }
  console.log('[Automation] Engine stopped');
}

/**
 * Get the current engine instance (or null if not initialized).
 */
export function getAutomationEngine(): AutomationEngine | null {
  return engineInstance;
}
