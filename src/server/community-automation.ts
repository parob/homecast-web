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
import { resolveHomeLocation } from '../automation/location';
import type { Automation, HelperDefinition } from '../automation/types/automation';
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
async function loadStoredHelpers(): Promise<HelperDefinition[]> {
  const rows = await db.getHcHelpers();
  const helpers: HelperDefinition[] = [];
  for (const row of rows) {
    try {
      helpers.push(JSON.parse(row.data) as HelperDefinition);
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
      triggerSummary: trace.triggerData?.triggerType ?? 'manual',
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

  starting = (async () => {
    resolver = new HomeKitServiceGroupResolver();
    resolver.start();

    const engine = await initAutomationEngine({
      // Announce the engine's own writes to LAN clients; HomeKit will not.
      // Imported at write time rather than at module load: local-broadcast
      // reaches through lib/config to `window`, which does not exist when this
      // module is pulled into a node-environment test.
      bridge: createHomeKitBridgeAdapter({
        characteristic: (accessoryId, characteristicType, value) => {
          void import('./local-broadcast').then((m) =>
            m.broadcastRelayWrite(accessoryId, characteristicType, value));
        },
        serviceGroup: (groupId, characteristicType, value, homeId) => {
          void import('./local-broadcast').then((m) =>
            m.broadcastRelayGroupWrite(groupId, characteristicType, value, homeId));
        },
      }),
      subscribeToHomeKit: (handler) => HomeKit.onEvent(handler),
      onNotify: async (message, title, data) => {
        // Community has one channel and no rate limit: the local alert on this
        // Mac. Reaching here means it was shown.
        await HomeKit.showNotification(title, message, data);
        return { delivered: true, channels: ['local'] };
      },
      serviceGroupResolver: resolver,
      onTraceComplete: (trace) => { void persistTrace(trace); },
      onHelperStateChange: (helperId, state) => {
        void db.saveHcHelperState(helperId, state).catch(() => {});
      },
    });

    // Helpers first — automations may reference them in triggers or conditions.
    engine.loadHelpers(await loadStoredHelpers(), await db.getHcHelperStates());
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

export function teardownCommunityAutomationEngine(): void {
  resolver?.stop();
  resolver = null;
  starting = null;
  teardownAutomationEngine();
}
