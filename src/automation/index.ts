// Homecast Automation Engine - Entry Point
// Initializes the engine when the relay becomes active

import { AutomationEngine } from './engine/AutomationEngine';
import { AutomationSyncManager } from './sync/AutomationSyncManager';
import type { HomeKitBridge } from './engine/ActionExecutor';
import type { SyncTransport } from './sync/AutomationSyncManager';
import type { ServiceGroupResolver } from './engine/TriggerManager';
import type { ExecutionTrace } from './types/execution';
import type { HomeKitEvent } from '../native/homekit-bridge';

export type { HomeKitBridge } from './engine/ActionExecutor';
export type { SyncTransport } from './sync/AutomationSyncManager';
export type { ServiceGroupResolver } from './engine/TriggerManager';
export { AutomationEngine } from './engine/AutomationEngine';
export { AutomationSyncManager } from './sync/AutomationSyncManager';
export { HomeKitServiceGroupResolver } from './service-group-resolver';

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
  /**
   * Cloud only. When omitted (Community mode) no sync manager is created and
   * the caller is responsible for loading automations into the engine.
   */
  transport?: SyncTransport;
  subscribeToHomeKit: (handler: (event: HomeKitEvent) => void) => () => void;
  onNotify: (message: string, title?: string, data?: Record<string, unknown>, automationId?: string) => Promise<void>;
  /** Required for service-group triggers to fire at all. */
  serviceGroupResolver?: ServiceGroupResolver;
  /** Required for sun triggers/conditions to resolve against the real location. */
  location?: { latitude: number; longitude: number };
  /** Called for every completed trace, in addition to the cloud push. */
  onTraceComplete?: (trace: ExecutionTrace) => void;
  /** Called whenever a helper value changes, so it can be persisted. */
  onHelperStateChange?: (helperId: string, state: unknown) => void;
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
    serviceGroupResolver: options.serviceGroupResolver,
    onTraceComplete: (trace) => {
      options.onTraceComplete?.(trace);
      syncInstance?.pushTrace(trace);
    },
    onHelperStateChange: (helperId, state) => {
      options.onHelperStateChange?.(helperId, state);
      syncInstance?.pushHelperState(helperId, state);
    },
    onNotify: options.onNotify,
  });

  if (options.location) {
    engineInstance.setLocation(options.location.latitude, options.location.longitude);
  }

  if (options.transport) {
    syncInstance = new AutomationSyncManager(engineInstance, options.transport);
  }

  // Initialize engine (subscribe to HomeKit events)
  engineInstance.initialize(options.subscribeToHomeKit);

  // Start sync (fetch configs from server, register message handlers)
  await syncInstance?.initialize();

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

/**
 * Feed a write this relay just performed into the automation engine.
 *
 * HomeKit does not fire its accessory observer for writes the relay itself
 * initiated. The engine only ever hears about state via that observer, so
 * turning a light on *from Homecast* produced no state change for it and
 * automations ran only for changes made in the Apple Home app — the same gap
 * the cloud works around by optimistically echoing writes to its WS and MQTT
 * subscribers, which never reached the engine running beside it.
 *
 * This cannot feed an automation its own output: engine actions go straight to
 * the native bridge (see relay-adapter) and never pass through the relay action
 * handler that calls this.
 */
export function notifyRelayWrite(
  accessoryId: string,
  characteristicType: string,
  value: unknown,
): void {
  const engine = engineInstance;
  if (!engine || !accessoryId || !characteristicType) return;

  // Skip when the store already holds this value: the write was a no-op, or
  // HomeKit did fire its observer for this accessory and got here first.
  // StateStore notifies listeners on every call, so without this a device that
  // reports its own changes would trigger the automation twice.
  if (engine.stateStore.getState(accessoryId, characteristicType) === value) return;

  engine.stateStore.handleHomeKitEvent({
    type: 'characteristic.updated',
    accessoryId,
    characteristicType,
    value,
  });
}

/** As above, expanded across a service group's members. */
export function notifyRelayGroupWrite(
  groupId: string,
  characteristicType: string,
  value: unknown,
): void {
  const members = engineInstance?.serviceGroupResolver?.getMembers?.(groupId) ?? [];
  for (const accessoryId of members) {
    notifyRelayWrite(accessoryId, characteristicType, value);
  }
}
