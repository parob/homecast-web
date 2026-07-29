// Homecast Automation Engine - Entry Point
// Initializes the engine when the relay becomes active

import { AutomationEngine } from './engine/AutomationEngine';
import { AutomationSyncManager } from './sync/AutomationSyncManager';
import type { HomeKitBridge } from './engine/ActionExecutor';
import type { SyncTransport } from './sync/AutomationSyncManager';
import type { ServiceGroupResolver } from './engine/TriggerManager';
import type { ExecutionTrace } from './types/execution';
import type { NotifyDelivery } from './types/notify';
import type { HomeKitEvent } from '../native/homekit-bridge';
import { valuesMatch } from './state/valueMatch';
import { canonicalCharacteristic } from '../lib/characteristic-aliases';
import {
  emitLocalRelayActivity, hasLocalActivityListeners, activityNow,
} from '../server/local-activity';

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
export type { NotifyDelivery } from './types/notify';
export { NOTIFY_DELIVERY_UNKNOWN } from './types/notify';
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
  onNotify: (message: string, title?: string, data?: Record<string, unknown>, automationId?: string) => Promise<NotifyDelivery | void>;
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
      // Single tap for both editions: cloud pushes the trace, Community
      // persists it, and both want it on the local activity stream.
      if (hasLocalActivityListeners()) {
        emitLocalRelayActivity({
          lane: 'automation', at: activityNow(),
          automationId: trace.automationId, name: trace.automationName,
          status: trace.status, startedAt: trace.startedAt,
          finishedAt: trace.finishedAt,
          triggerData: trace.triggerData as unknown as Record<string, unknown>,
          steps: trace.steps as unknown as Record<string, unknown>[],
        });
      }
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

  // The bridge answers to several names per characteristic but reports only
  // one, so a write and the observer event for that same write arrive under
  // different names: a client turning a light on announces `on`, HomeKit's
  // observer says `power_state`. Everything downstream — the store, the
  // triggers — is keyed on what the observer says, so a write has to be
  // renamed to match or it lands in a slot nothing is watching. That is why
  // automations fired from Apple Home and did nothing from Homecast.
  const canonical = canonicalCharacteristic(characteristicType);

  // Skip when the store already holds this value: the write was a no-op, or
  // HomeKit did fire its observer for this accessory and got here first.
  // StateStore notifies listeners on every call, so without this a device that
  // reports its own changes would trigger the automation twice.
  //
  // Compared with valuesMatch, not ===, for the same reason every other
  // comparison in the engine is: HomeKit reports booleans where the write used
  // 1/0, so `true === 1` was false and a no-op write looked like a change,
  // firing the automation a second time.
  if (valuesMatch(engine.stateStore.getState(accessoryId, canonical), value)) return;

  engine.stateStore.handleHomeKitEvent({
    type: 'characteristic.updated',
    accessoryId,
    characteristicType: canonical,
    value,
  });
}

/**
 * As above, expanded across a service group's members.
 *
 * Triggers are evaluated per accessory, so a group write has to be fanned out
 * to the members before the engine can match it. If that expansion produces
 * nothing the write reaches no trigger at all — and it used to do so in
 * silence, behind `?? []`, which is the same shape as every other bug on this
 * path: a lookup that fails to an empty result and looks like a quiet day.
 */
export function notifyRelayGroupWrite(
  groupId: string,
  characteristicType: string,
  value: unknown,
): void {
  const engine = engineInstance;
  if (!engine) return;

  const resolver = engine.serviceGroupResolver;
  const members = resolver?.getMembers?.(groupId) ?? [];

  if (members.length === 0) {
    // Say which of the two it is. A missing resolver is a wiring fault and
    // disables every service-group trigger; an unknown group is a stale index,
    // which recovers on the next refresh. Recorded on the activity stream, not
    // just the console, so it survives in the fault ring long enough to read.
    const reason = !resolver
      ? 'no service-group resolver — service-group triggers are disabled'
      : 'group not in the membership index (stale or unknown group)';
    console.warn(`[Automation] Group write for ${groupId} reached no triggers: ${reason}`);
    if (hasLocalActivityListeners()) {
      emitLocalRelayActivity({
        lane: 'automation', at: activityNow(),
        name: `Group write not delivered: ${groupId}`,
        status: 'error', error: reason,
      });
    }
    return;
  }

  for (const accessoryId of members) {
    notifyRelayWrite(accessoryId, characteristicType, value);
  }
}
