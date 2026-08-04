/**
 * Community mode: run the Homecast automation engine locally.
 *
 * In cloud mode the engine is started by ServerWebSocket.startRelayDuties() and
 * fed automations by a server-pushed `automation.sync_all`. Community mode has
 * no ServerWebSocket (connection.shouldActivate() returns false on the relay
 * Mac), so none of that ran: HC automations were stored and editable but never
 * executed, and `automation.test` always threw "engine not running".
 *
 * This is the local equivalent — automations come from IndexedDB instead of the
 * cloud, traces are persisted locally instead of pushed, and notifications go
 * to the Mac's notification centre.
 */

import {
  initAutomationEngine,
  teardownAutomationEngine,
  getAutomationEngine,
  HomeKitServiceGroupResolver,
} from '../automation';
import { createHomeKitBridgeAdapter } from '../automation/relay-adapter';
import { setRelayWritePublisher } from '../relay/relay-write';
import { resolveHomeLocation } from '../automation/location';
import type { Automation, VirtualAccessoryDefinition } from '../automation/types/automation';
import type { ExecutionTrace } from '../automation/types/execution';
import { HomeKit } from '../native/homekit-bridge';
import * as db from './local-db';

let resolver: HomeKitServiceGroupResolver | null = null;
let starting: Promise<void> | null = null;

/** Read every stored HC automation, tolerating individual corrupt rows. */
async function loadStoredAutomations(): Promise<Automation[]> {
  const rows = await db.getHcAutomations();
  const automations: Automation[] = [];
  for (const row of rows) {
    try {
      automations.push(JSON.parse(row.data) as Automation);
    } catch {
      console.warn(`[CommunityAutomation] Skipping unparseable automation ${row.id}`);
    }
  }
  return automations;
}

/** Read every stored helper definition, tolerating individual corrupt rows. */
async function loadStoredVirtualAccessories(): Promise<VirtualAccessoryDefinition[]> {
  const rows = await db.getVirtualAccessories();
  const helpers: VirtualAccessoryDefinition[] = [];
  for (const row of rows) {
    try {
      helpers.push(JSON.parse(row.data) as VirtualAccessoryDefinition);
    } catch {
      console.warn(`[CommunityAutomation] Skipping unparseable helper ${row.id}`);
    }
  }
  return helpers;
}

/**
 * Persist a completed run so the execution-history panel has something to read.
 * Cloud mode pushes traces over the WebSocket instead.
 */
async function persistTrace(trace: ExecutionTrace): Promise<void> {
  try {
    const started = Date.parse(trace.startedAt);
    const finished = trace.finishedAt ? Date.parse(trace.finishedAt) : NaN;
    await db.saveExecutionTrace({
      id: trace.id,
      automationId: trace.automationId,
      automationName: trace.automationName,
      status: trace.status,
      startedAt: trace.startedAt,
      finishedAt: trace.finishedAt,
      durationMs: Number.isNaN(finished) || Number.isNaN(started) ? undefined : finished - started,
      // The trigger step's summary already says what fired ("Device changed:
      // power_state 0 → 1"); the bare triggerType is the fallback for traces
      // recorded before trigger steps existed.
      triggerSummary: trace.steps?.[0]?.type === 'trigger'
        ? trace.steps[0].nodeSummary
        : (trace.triggerData?.triggerType ?? 'manual'),
      traceJson: JSON.stringify(trace),
    });
  } catch (e) {
    console.warn('[CommunityAutomation] Failed to persist trace', e);
  }
}

/**
 * Start the engine. Safe to call more than once — concurrent calls share the
 * same startup promise.
 */
export async function initCommunityAutomationEngine(): Promise<void> {
  if (starting) return starting;

  // Community mode's relay-write publisher — the CE counterpart of the one
  // startRelayDuties registers in cloud mode. Every write path (UI, LAN WS
  // clients, REST/MCP, the engine itself) fans out through relay-write.ts,
  // and without a registered publisher those announcements reached nobody:
  // an automation turning on a light updated no connected UI. Registered
  // synchronously, before anything can write.
  //
  // Both targets are imported at write time rather than at module load:
  // local-broadcast and connection reach through lib/config to `window`,
  // which does not exist when this module is pulled into a node test.
  setRelayWritePublisher({
    characteristic: (change) => {
      // LAN WS clients (+ the dedupe marker for the observation event)
      void import('./local-broadcast').then((m) =>
        m.broadcastRelayWrite(change.accessoryId, change.characteristicType, change.value, change.homeId));
      // This Mac's own dashboard (DataCache subscribers)
      void import('./connection').then((m) =>
        m.serverConnection.emitBroadcast({
          type: 'characteristic_update',
          accessoryId: change.accessoryId,
          homeId: change.homeId ?? null,
          characteristicType: change.characteristicType,
          value: change.value,
        }));
    },
    serviceGroup: (groupId, characteristicType, value, homeId, affectedCount = 0) => {
      void import('./local-broadcast').then((m) =>
        m.broadcastRelayGroupWrite(groupId, characteristicType, value, homeId, affectedCount));
      void import('./connection').then((m) =>
        m.serverConnection.emitBroadcast({
          type: 'service_group_update',
          groupId,
          homeId: homeId ?? null,
          characteristicType,
          value,
          affectedCount,
        }));
    },
  });

  starting = (async () => {
    resolver = new HomeKitServiceGroupResolver();
    resolver.start();

    const engine = await initAutomationEngine({
      bridge: createHomeKitBridgeAdapter(),
      subscribeToHomeKit: (handler) => HomeKit.onEvent(handler),
      onNotify: async (message, title, data) => {
        // Community has one channel and no rate limit: the local alert on this
        // Mac. Reaching here means it was shown.
        await HomeKit.showNotification(title, message, data);
        return { delivered: true, channels: ['local'] };
      },
      serviceGroupResolver: resolver,
      onTraceComplete: (trace) => { void persistTrace(trace); },
      onVirtualStateChange: (accessoryId, state) => {
        void db.saveVirtualAccessoryState(accessoryId, state).catch(() => {});
      },
    });

    // Helpers first — automations may reference them in triggers or conditions.
    engine.loadVirtualAccessories(await loadStoredVirtualAccessories(), await db.getVirtualAccessoryStates());
    engine.loadAutomations(await loadStoredAutomations());

    // Resolved after startup so a slow/denied geolocation prompt can't hold up
    // the engine. setLocation reschedules any sun triggers already registered.
    void resolveHomeLocation(db).then((location) => {
      if (location) engine.setLocation(location.latitude, location.longitude);
    });
  })();

  try {
    await starting;
  } catch (e) {
    console.error('[CommunityAutomation] Failed to start engine', e);
    starting = null;
  }
}

/**
 * Re-read automations from IndexedDB into the running engine. Call after any
 * write — in cloud mode the server pushes `automation.sync`, but locally the
 * resolver has to tell the engine itself.
 */
export async function reloadCommunityAutomations(): Promise<void> {
  const engine = getAutomationEngine();
  if (!engine) return;
  try {
    engine.loadAutomations(await loadStoredAutomations());
  } catch (e) {
    console.warn('[CommunityAutomation] Reload failed', e);
  }
}

/**
 * Re-read helpers from IndexedDB into the running engine. Cloud mode gets an
 * `automation.virtual_sync` push; locally the resolver has to do it itself.
 *
 * Uses `syncVirtualAccessories`, not `loadVirtualAccessories`: this runs after a delete too, and
 * loading only adds — a deleted helper would keep answering `helper()` and keep
 * its triggers registered until the next restart.
 */
export async function reloadCommunityVirtualAccessories(): Promise<void> {
  const engine = getAutomationEngine();
  if (!engine) return;
  try {
    engine.syncVirtualAccessories(await loadStoredVirtualAccessories());
  } catch (e) {
    console.warn('[CommunityAutomation] Helper reload failed', e);
  }
}

export function teardownCommunityAutomationEngine(): void {
  setRelayWritePublisher(null);
  resolver?.stop();
  resolver = null;
  starting = null;
  teardownAutomationEngine();
}
