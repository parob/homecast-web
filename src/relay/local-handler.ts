/**
 * Local HomeKit request handler.
 * Executes HomeKit actions directly via the native bridge.
 * Used by:
 * - ServerWebSocket to handle incoming server requests (relay mode)
 * - Local requests in Mac app mode (bypassing WebSocket)
 */

import { HomeKit } from '../native/homekit-bridge';
import { isHiddenBuiltInScene } from '@/lib/scenes';
import { announceRelayWrite, announceRelayGroupWrite } from './relay-write';
import {
  emitLocalRelayActivity, hasLocalActivityListeners, activityNow,
} from '../server/local-activity';
import { describeError } from '../lib/describe-error';
import { canonicalCharacteristic } from '../lib/characteristic-aliases';

/** Distinguishes requests started within the same millisecond. */
let activitySeq = 0;

/** Standard error codes matching the Cloud Edition */
export const ErrorCode = {
  INVALID_REQUEST: 'INVALID_REQUEST',
  UNKNOWN_ACTION: 'UNKNOWN_ACTION',
  HOME_NOT_FOUND: 'HOME_NOT_FOUND',
  ROOM_NOT_FOUND: 'ROOM_NOT_FOUND',
  ACCESSORY_NOT_FOUND: 'ACCESSORY_NOT_FOUND',
  SCENE_NOT_FOUND: 'SCENE_NOT_FOUND',
  CHARACTERISTIC_NOT_FOUND: 'CHARACTERISTIC_NOT_FOUND',
  CHARACTERISTIC_NOT_WRITABLE: 'CHARACTERISTIC_NOT_WRITABLE',
  ACCESSORY_UNREACHABLE: 'ACCESSORY_UNREACHABLE',
  INVALID_VALUE: 'INVALID_VALUE',
  HOMEKIT_ERROR: 'HOMEKIT_ERROR',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  PERMISSION_DENIED: 'PERMISSION_DENIED',
} as const;

// Accessory limit enforcement state
let allowedAccessoryIds: Set<string> | null = null;
let accessoryLimit: number | null = null;

/**
 * Set the accessory limit and allowed IDs for free account enforcement.
 * Called when config message is received from server or when user saves selection.
 */
export function setAccessoryLimit(limit: number | null): void {
  accessoryLimit = limit;
  if (limit === null) {
    allowedAccessoryIds = null;
  }
}

/**
 * Set the allowed accessory IDs from user settings.
 */
export function setAllowedAccessoryIds(ids: string[] | null): void {
  if (ids && ids.length > 0) {
    allowedAccessoryIds = new Set(ids);
  } else {
    allowedAccessoryIds = null;
  }
}

/**
 * Get the current allowed accessory IDs set.
 */
export function getAllowedAccessoryIds(): Set<string> | null {
  return allowedAccessoryIds;
}

/**
 * Get the current accessory limit.
 */
export function getAccessoryLimit(): number | null {
  return accessoryLimit;
}

export function isAccessoryAllowed(accessoryId: string): boolean {
  if (accessoryLimit === null) return true; // Unlimited (standard)
  if (!allowedAccessoryIds) return false; // No selection yet — block all until user picks
  return allowedAccessoryIds.has(accessoryId);
}

function filterAccessories(accessories: any[]): any[] {
  if (accessoryLimit === null) return accessories;

  if (allowedAccessoryIds && allowedAccessoryIds.size > 0) {
    return accessories.filter((a: any) => allowedAccessoryIds!.has(a.id));
  }

  // No selection saved — return nothing
  return [];
}

// --- Relay probe (end-to-end uptime verification) ---
//
// The cloud server calls relay.probe periodically and uses the result to
// distinguish "we can reach the relay" (WS up, status=connected) from "we
// actually verified the relay → HomeKit → accessory pipeline" (status=
// verified). We pick one accessory in the home, read a characteristic, and
// return whatever HomeKit hands back. The cloud trusts the value itself as
// proof — we don't need to validate the range, the fact that HomeKit
// answered with *anything* means the framework is alive.

// Round-robin cursor per home so consecutive probes exercise different
// accessories. Reset on process restart (acceptable).
const _probeCursors = new Map<string, number>();

// How many DISTINCT accessories a single probe will try before giving up. A
// single unreachable accessory (e.g. a powered-off bulb HomeKit still lists as
// reachable) must not fail the whole probe and make a healthy home look
// "not fully verified" — we fall through to the next accessory until one reads.
const PROBE_MAX_ATTEMPTS = 5;

// Characteristics we prefer to read: sensor-like, frequently updated by the
// underlying framework, and effectively always present where they apply. If
// none match, we fall back to any readable characteristic.
const PREFERRED_CHARS = [
  'CurrentTemperature',
  'CurrentRelativeHumidity',
  'CurrentAmbientLightLevel',
  'CurrentLightLevel',
  'BatteryLevel',
  'CurrentPosition',
  'On',
  'CurrentDoorState',
  'LockCurrentState',
  'CurrentHeatingCoolingState',
  'AirQuality',
  'Name',
];

interface ProbeCandidate {
  accessoryId: string;
  accessoryName: string;
  characteristicType: string;
  priority: number; // lower = preferred
}

function collectProbeCandidates(accessories: any[]): ProbeCandidate[] {
  const out: ProbeCandidate[] = [];
  for (const acc of accessories) {
    if (!acc || acc.isReachable === false) continue;
    const services = Array.isArray(acc.services) ? acc.services : [];
    for (const svc of services) {
      const chars = Array.isArray(svc.characteristics) ? svc.characteristics : [];
      for (const ch of chars) {
        if (!ch?.isReadable) continue;
        const idx = PREFERRED_CHARS.indexOf(ch.characteristicType);
        const priority = idx >= 0 ? idx : PREFERRED_CHARS.length;
        out.push({
          accessoryId: acc.id,
          accessoryName: acc.name,
          characteristicType: ch.characteristicType,
          priority,
        });
      }
    }
  }
  out.sort((a, b) => a.priority - b.priority);
  return out;
}

async function runRelayProbe(homeId: string): Promise<Record<string, unknown>> {
  let accessories: any[];
  try {
    accessories = await HomeKit.listAccessories({ homeId, includeValues: false }) as any[];
  } catch (err: any) {
    // HomeKit framework didn't answer — explicit signal the cloud uses to
    // record a connected-but-not-verified sample, not a probe-target-missing
    // sample. The error code travels back so we can surface it.
    return {
      error: 'homekit_error',
      message: err?.message ? String(err.message).slice(0, 200) : String(err),
    };
  }

  const candidates = collectProbeCandidates(accessories);
  if (candidates.length === 0) {
    return { noProbeTarget: true, reason: 'no_readable_accessory' };
  }

  // Round-robin within the highest-priority tier so we exercise different
  // accessories over time but always prefer sensors over Name reads. The cursor
  // sets the STARTING point; we then try up to PROBE_MAX_ATTEMPTS distinct
  // accessories from there so one dead device doesn't fail the whole probe.
  const topPriority = candidates[0].priority;
  const topTier = candidates.filter((c) => c.priority === topPriority);
  const cursor = _probeCursors.get(homeId) ?? 0;
  _probeCursors.set(homeId, cursor + 1);

  // Attempt order: one characteristic per accessory (so each try exercises a
  // different physical device), starting at the cursor.
  const attempts: ProbeCandidate[] = [];
  const seenAccessories = new Set<string>();
  for (let i = 0; i < topTier.length && attempts.length < PROBE_MAX_ATTEMPTS; i++) {
    const c = topTier[(cursor + i) % topTier.length];
    if (seenAccessories.has(c.accessoryId)) continue;
    seenAccessories.add(c.accessoryId);
    attempts.push(c);
  }

  // Try each in turn; return on the FIRST successful read. Only if every
  // attempt fails do we report the (last) error as connected-not-verified.
  let lastError: Record<string, unknown> | null = null;
  for (const pick of attempts) {
    const readAt = new Date().toISOString();
    try {
      const result = await HomeKit.getCharacteristic(pick.accessoryId, pick.characteristicType);
      return {
        accessoryId: pick.accessoryId,
        accessoryName: pick.accessoryName,
        characteristicType: pick.characteristicType,
        value: result?.value ?? null,
        readAt,
        source: 'homekit',
      };
    } catch (err: any) {
      // Distinguish "accessory unreachable" (HomeKit responded; this accessory
      // is offline) from "HomeKit hung" (the cloud sees a timeout and treats it
      // differently — that path doesn't hit this handler). Keep the latest
      // failure and fall through to the next accessory.
      const code = err?.code ?? '';
      const message = err?.message ? String(err.message).slice(0, 200) : 'unknown';
      lastError = {
        accessoryId: pick.accessoryId,
        accessoryName: pick.accessoryName,
        characteristicType: pick.characteristicType,
        error: code === 'ACCESSORY_UNREACHABLE' ? 'unreachable' : 'read_error',
        message,
        readAt,
      };
    }
  }
  // Every attempted accessory failed to read — genuinely connected-not-verified.
  return lastError ?? { error: 'read_error', message: 'no accessory could be read' };
}

export async function executeHomeKitAction(
  action: string,
  payload: Record<string, unknown> = {},
  /**
   * Who asked. Defaults to local because most callers are this Mac's own UI;
   * the cloud path says so explicitly. Without it a command pushed from the
   * server and one from the dashboard next to you look identical, and "is
   * anything reaching me from the cloud?" is exactly the question worth asking
   * of a relay that has gone quiet.
   */
  origin: 'local' | 'cloud' = 'local',
): Promise<unknown> {
  // Every relay action funnels through here, so this is the one place the
  // socket lane needs tapping. Wrapped rather than sprinkled through the switch:
  // a new action gets its timing for free, and cannot be added without it.
  if (!hasLocalActivityListeners()) {
    return executeHomeKitActionInner(action, payload);
  }

  const startedAt = activityNow();
  // One request is one row: the outcome carries the same id and replaces the
  // pending entry, so a row still reading "waiting" is genuinely outstanding
  // rather than the residue of a request that finished long ago.
  const id = `${startedAt}-${++activitySeq}`;
  emitLocalRelayActivity({
    lane: 'socket', phase: 'sent', action, at: startedAt, id, origin,
    request: payload,
  });
  try {
    const result = await executeHomeKitActionInner(action, payload);
    emitLocalRelayActivity({
      lane: 'socket', phase: 'ok', action, id, at: startedAt, origin,
      ms: Math.round((activityNow() - startedAt) * 1000),
      request: payload,
      response: result,
    });
    return result;
  } catch (e) {
    emitLocalRelayActivity({
      lane: 'socket', phase: 'failed', action, id, at: startedAt, origin,
      ms: Math.round((activityNow() - startedAt) * 1000),
      error: describeError(e),
    });
    throw e;
  }
}

async function executeHomeKitActionInner(
  action: string,
  payload: Record<string, unknown> = {}
): Promise<unknown> {
  switch (action) {
    case 'homes.list':
      return { homes: await HomeKit.listHomes() };

    case 'rooms.list': {
      const { homeId } = payload as { homeId: string };
      return { homeId, rooms: await HomeKit.listRooms(homeId) };
    }

    case 'room.create': {
      const { homeId, name } = payload as { homeId: string; name: string };
      return await HomeKit.createRoom(homeId, name);
    }

    case 'room.delete': {
      const { homeId, roomId } = payload as { homeId: string; roomId: string };
      return await HomeKit.deleteRoom(homeId, roomId);
    }

    case 'zones.list': {
      const { homeId } = payload as { homeId: string };
      return { homeId, zones: await HomeKit.listZones(homeId) };
    }

    case 'serviceGroups.list': {
      const { homeId } = payload as { homeId: string };
      return { homeId, serviceGroups: await HomeKit.listServiceGroups(homeId) };
    }

    case 'serviceGroup.set': {
      const { groupId, characteristicType: requestedGroupChar, value, homeId } = payload as {
        groupId: string;
        characteristicType: string;
        value: unknown;
        homeId?: string;
      };
      // Same reason as characteristic.set: one name past this point.
      const characteristicType = canonicalCharacteristic(requestedGroupChar);
      const groupResult = await HomeKit.setServiceGroupCharacteristic(groupId, characteristicType, value, homeId);
      announceRelayGroupWrite(
        groupId, characteristicType, value, 'client', homeId,
        (groupResult as { affectedCount?: number } | undefined)?.affectedCount ?? 0,
      );
      return groupResult;
    }

    case 'accessories.list': {
      const { homeId, roomId, includeValues, includeAll } = payload as {
        homeId?: string;
        roomId?: string;
        includeValues?: boolean;
        includeAll?: boolean;
      };
      const result = await HomeKit.listAccessories({ homeId, roomId, includeValues });
      return { accessories: includeAll ? result : filterAccessories(result) };
    }

    case 'accessory.get': {
      const { accessoryId } = payload as { accessoryId: string };
      if (!isAccessoryAllowed(accessoryId)) {
        throw Object.assign(new Error('Accessory not included in your plan'), { code: ErrorCode.ACCESSORY_NOT_FOUND });
      }
      return { accessory: await HomeKit.getAccessory(accessoryId) };
    }

    case 'accessory.refresh': {
      const { accessoryId } = payload as { accessoryId: string };
      if (!isAccessoryAllowed(accessoryId)) {
        throw Object.assign(new Error('Accessory not included in your plan'), { code: ErrorCode.ACCESSORY_NOT_FOUND });
      }
      return await HomeKit.refreshAccessory(accessoryId);
    }

    case 'characteristic.get': {
      const { accessoryId, characteristicType } = payload as {
        accessoryId: string;
        characteristicType: string;
      };
      if (!isAccessoryAllowed(accessoryId)) {
        throw Object.assign(new Error('Accessory not included in your plan'), { code: ErrorCode.ACCESSORY_NOT_FOUND });
      }
      return await HomeKit.getCharacteristic(accessoryId, characteristicType);
    }

    case 'characteristic.set': {
      const { accessoryId, characteristicType: requested, value } = payload as {
        accessoryId: string;
        characteristicType: string;
        value: unknown;
      };
      if (!isAccessoryAllowed(accessoryId)) {
        throw Object.assign(new Error('Accessory not included in your plan'), { code: ErrorCode.ACCESSORY_NOT_FOUND });
      }
      // Canonicalised at the door. The bridge accepts `on` and `power_state`
      // but only ever reports `power_state`, so a write named `on` would be
      // echoed to clients, MQTT and the engine under a name nothing else uses.
      const characteristicType = canonicalCharacteristic(requested);
      const setResult = await HomeKit.setCharacteristic(accessoryId, characteristicType, value);
      announceRelayWrite([{ accessoryId, characteristicType, value }], 'client');
      return setResult;
    }

    case 'scenes.list': {
      const { homeId } = payload as { homeId: string };
      const scenes = await HomeKit.listScenes(homeId);
      // Apple Home hides never-configured built-in scenes (Good Morning, …)
      return { homeId, scenes: scenes.filter(s => !isHiddenBuiltInScene(s)) };
    }

    case 'scene.execute': {
      const { sceneId } = payload as { sceneId: string };
      // ANNOUNCE-EXEMPT: native executeScene returns only {success, sceneId} —
      // it does not report which accessories the scene changed, and this side
      // cannot know. Announcing would mean guessing. Closing this needs the
      // Swift bridge to return the applied changes the way setState already
      // does, which needs an App Store release. Listed in relay-write.test.ts
      // so the gap stays deliberate rather than becoming another silent one.
      return await HomeKit.executeScene(sceneId);
    }

    case 'scene.delete': {
      const { sceneId } = payload as { sceneId: string };
      return await HomeKit.deleteScene(sceneId);
    }

    case 'scene.create': {
      const { homeId, name, actions } = payload as {
        homeId: string;
        name: string;
        actions: Array<{ accessoryId: string; characteristicType: string; targetValue: unknown }>;
      };
      return await HomeKit.createScene(homeId, name, actions);
    }

    case 'scene.update': {
      const { sceneId, ...rest } = payload as { sceneId: string; [key: string]: unknown };
      return await HomeKit.updateScene(sceneId, rest as Parameters<typeof HomeKit.updateScene>[1]);
    }

    case 'automations.list': {
      const { homeId } = payload as { homeId: string };
      return { automations: await HomeKit.listAutomations(homeId) };
    }

    case 'automation.get': {
      const { automationId } = payload as { automationId: string };
      // getAutomation not available via bridge, use listAutomations and filter
      const bridge = (await import('@/native/homekit-bridge')).getNativeBridge();
      if (!bridge) throw new Error('HomeKit bridge not available');
      return bridge.call('automation.get', { automationId });
    }

    case 'automation.create': {
      const { homeId, name, trigger, actions } = payload as { homeId: string; name: string; trigger: unknown; actions: unknown[] };
      return await HomeKit.createAutomation(homeId, name, trigger as Parameters<typeof HomeKit.createAutomation>[2], actions as Parameters<typeof HomeKit.createAutomation>[3]);
    }

    case 'automation.update': {
      const { automationId, ...rest } = payload as { automationId: string; [key: string]: unknown };
      return await HomeKit.updateAutomation(automationId, rest as Parameters<typeof HomeKit.updateAutomation>[1]);
    }

    case 'automation.delete': {
      const { automationId } = payload as { automationId: string };
      return await HomeKit.deleteAutomation(automationId);
    }

    case 'automation.enable': {
      const { automationId } = payload as { automationId: string };
      return await HomeKit.setAutomationEnabled(automationId, true);
    }

    case 'automation.disable': {
      const { automationId } = payload as { automationId: string };
      return await HomeKit.setAutomationEnabled(automationId, false);
    }

    case 'automation.test': {
      const { automationId, triggerData, skipConditions } = payload as { automationId: string; triggerData?: Record<string, unknown>; skipConditions?: boolean };
      const { getAutomationEngine } = await import('../automation');
      const engine = getAutomationEngine();
      if (!engine) {
        throw Object.assign(new Error('Automation engine not running'), { code: ErrorCode.UNKNOWN_ACTION });
      }
      const trace = await engine.manualTrigger(automationId, {
        triggerData: triggerData as any,
        skipConditions,
      });
      if (!trace) {
        throw Object.assign(new Error('Automation not found'), { code: ErrorCode.UNKNOWN_ACTION });
      }
      return { trace };
    }

    // Automation config sync.
    //
    // These are requests rather than fire-and-forget events so they travel the
    // same DirectRouter path as every other relay action — which means they
    // cross pods, and the server learns whether the relay actually applied the
    // change instead of assuming it. The event-based path is kept on the sync
    // manager for older servers.
    case 'automation.sync_all': {
      const { automations } = payload as { automations?: unknown[] };
      const { getAutomationEngine } = await import('../automation');
      const engine = getAutomationEngine();
      if (!engine) {
        throw Object.assign(new Error('Automation engine not running'), { code: ErrorCode.UNKNOWN_ACTION });
      }
      const list = (automations ?? []) as Parameters<typeof engine.loadAutomations>[0];
      engine.loadAutomations(list);
      return { loaded: list.length };
    }

    case 'automation.sync': {
      const { automation } = payload as { automation?: { id?: string } };
      const { getAutomationEngine } = await import('../automation');
      const engine = getAutomationEngine();
      if (!engine) {
        throw Object.assign(new Error('Automation engine not running'), { code: ErrorCode.UNKNOWN_ACTION });
      }
      if (!automation?.id) {
        throw Object.assign(new Error('automation.id required'), { code: ErrorCode.INVALID_PARAMS });
      }
      engine.updateAutomation(automation as Parameters<typeof engine.updateAutomation>[0]);
      return { synced: automation.id };
    }

    // Deliberately NOT 'automation.delete' — that name is already taken by the
    // HomeKit-native automation delete above, and a duplicate case would be
    // silently shadowed by it. This one only unloads a Homecast automation from
    // the running engine; the row is already gone from the database.
    case 'automation.unload': {
      const { automationId } = payload as { automationId?: string };
      const { getAutomationEngine } = await import('../automation');
      const engine = getAutomationEngine();
      if (!engine) {
        throw Object.assign(new Error('Automation engine not running'), { code: ErrorCode.UNKNOWN_ACTION });
      }
      if (!automationId) {
        throw Object.assign(new Error('automationId required'), { code: ErrorCode.INVALID_PARAMS });
      }
      engine.removeAutomation(automationId);
      return { deleted: automationId };
    }

    case 'state.set': {
      const { state, homeId } = payload as {
        state: Record<string, Record<string, Record<string, unknown>>>;
        homeId?: string;
      };
      // Note: free-tier filtering is NOT applied here because state.set uses
      // slug keys (room/accessory), not HomeKit UUIDs. The Swift setState()
      // resolves slug keys internally. Limit enforcement happens at the
      // characteristic.set level for individual accessory control.
      console.log('[state.set] state:', JSON.stringify(state), 'homeId:', homeId);
      const result = await HomeKit.setState(state, homeId);
      console.log('[state.set] result:', JSON.stringify(result));
      // As for characteristic.set: HomeKit stays silent about writes we made
      // ourselves. This is the path REST, MCP and Home Assistant all take, so
      // without it a device changed by an assistant or a script never triggered
      // a Homecast automation. Native resolves the slug keys and expands
      // service groups to their members, so these are ready to feed straight in.
      announceRelayWrite(
        (result.changes ?? []).map((c) => ({ ...c, homeId })),
        'client',
      );
      return result;
    }

    case 'observe.start':
      return await HomeKit.startObserving();

    case 'observe.stop':
      return await HomeKit.stopObserving();

    case 'observe.reset':
      return await HomeKit.resetObservationTimeout();

    case 'ping':
      return { pong: true, timestamp: Date.now() };

    /**
     * Reload the relay's web bundle.
     *
     * In cloud mode the relay runs JavaScript fetched from homecast.cloud at
     * startup and never refetches it, so a deployed relay-side fix stays
     * inert until someone physically restarts the Mac app. For a managed
     * relay the operator doesn't have hands on, that makes "deployed" and
     * "live" different states with no way to reconcile them remotely.
     *
     * Deliberately JS-only: no Swift change, so it needs no App Store
     * release. The reload is deferred a moment so this response reaches the
     * server before the WebSocket goes down with the page — otherwise every
     * reload looks like a failed request.
     */
    case 'app.reload': {
      const { delayMs } = payload as { delayMs?: number };
      const wait = Math.min(Math.max(delayMs ?? 500, 100), 10_000);
      setTimeout(() => {
        try {
          window.location.reload();
        } catch (e) {
          console.error('[Relay] Reload failed', e);
        }
      }, wait);
      return { reloading: true, inMs: wait };
    }

    case 'debug.getActivity': {
      // Remote read of the relay's own activity buffer. The stream is
      // in-process by design, which makes it invisible from the outside — this
      // is the seam that lets it be inspected without the relay having to push
      // anything, and without the panel being open.
      const { limit, before, lane, faultsOnly } = payload as {
        limit?: number; before?: number; faultsOnly?: boolean;
        lane?: 'socket' | 'bridge' | 'homekit' | 'automation' | 'cloud';
      };
      const { getActivityDump } = await import('../server/local-activity');
      return getActivityDump({ limit, before, lane, faultsOnly });
    }

    case 'relay.probe': {
      const { homeId } = payload as { homeId: string };
      return await runRelayProbe(homeId);
    }

    default:
      throw Object.assign(new Error(`Unknown action: ${action}`), { code: ErrorCode.UNKNOWN_ACTION });
  }
}
