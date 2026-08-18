/**
 * Local HomeKit request handler.
 * Executes HomeKit actions directly via the native bridge.
 * Used by:
 * - ServerWebSocket to handle incoming server requests (relay mode)
 * - Local requests in Mac app mode (bypassing WebSocket)
 */

import { HomeKit } from '../native/homekit-bridge';
import { isHiddenBuiltInScene } from '@/lib/scenes';
import { announceRelayWrite, announceRelayGroupWrite, type RelayWriteChange } from './relay-write';
import {
  emitLocalRelayActivity, hasLocalActivityListeners, activityNow,
} from '../server/local-activity';
import { describeError } from '../lib/describe-error';
import { canonicalCharacteristic } from '../lib/characteristic-aliases';
import { bumpTelemetry } from '../server/local-telemetry';

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
  // Same funnel, same reasoning: counted here rather than in the switch so a
  // new write action cannot be added without being counted. Counts only — the
  // accessory, the value and the scene never leave this line.
  if (action === 'characteristic.set' || action === 'state.set' || action === 'characteristics.set') {
    bumpTelemetry('characteristicWrites');
  } else if (action === 'scene.execute') {
    bumpTelemetry('sceneRuns');
  }

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
      // Both HomeKit reads are issued together. They are independent, and
      // awaiting the room list after the accessory list made every
      // accessories.list two serialized bridge round trips — N homes on a cold
      // load paid that 2N times.
      const accessoriesPromise = HomeKit.listAccessories({ homeId, roomId, includeValues });
      const roomsPromise = homeId
        ? HomeKit.listRooms(homeId).catch(() => null)  // naming is cosmetic
        : Promise.resolve(null);
      const result = await accessoriesPromise;
      const roomsForNames = await roomsPromise;
      const { listVirtualAccessories } = await import('./virtual-accessories');
      // Helper accessories are published here, not alongside here. Everything
      // downstream — the dashboard, sharing, collections, search, REST, MQTT,
      // MCP — reads this one list, so this is the only place that has to know
      // they exist. They are deliberately NOT run through filterAccessories:
      // that enforces the plan's HomeKit accessory limit, and a value the
      // engine owns is not a device anyone is being sold.
      // Room names, so a helper accessory groups by room like everything else.
      const roomNames: Map<string, string> | undefined = roomsForNames
        ? new Map(roomsForNames.map(r => [r.id, r.name] as [string, string]))
        : undefined;
      const helpers = listVirtualAccessories({ homeId, roomId, roomNames });
      const accessories = includeAll ? result : filterAccessories(result);
      return { accessories: [...accessories, ...helpers] };
    }

    case 'accessory.get': {
      const { accessoryId } = payload as { accessoryId: string };
      const { getVirtualAccessoryDefinition, toVirtualAccessory, readVirtualValue } = await import('./virtual-accessories');
      const helperForGet = getVirtualAccessoryDefinition(accessoryId);
      if (helperForGet) {
        // The countdown has to come too. `accessories.list` passes it and this
        // did not, so a timer fetched singly reported only that it was running
        // — which is the exact shape of the one question a caller asks about a
        // running timer.
        const { getAutomationEngine } = await import('../automation');
        return {
          accessory: toVirtualAccessory(
            helperForGet,
            readVirtualValue(accessoryId)?.value,
            getAutomationEngine()?.virtualManager.getTimerInfo(accessoryId),
          ),
        };
      }
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
      const { readVirtualValue } = await import('./virtual-accessories');
      const helperRead = readVirtualValue(accessoryId);
      if (helperRead) return { accessoryId, characteristicType, value: helperRead.value };
      if (!isAccessoryAllowed(accessoryId)) {
        throw Object.assign(new Error('Accessory not included in your plan'), { code: ErrorCode.ACCESSORY_NOT_FOUND });
      }
      return await HomeKit.getCharacteristic(accessoryId, characteristicType);
    }

    case 'characteristic.set': {
      const { accessoryId, characteristicType: requested, value, homeId } = payload as {
        accessoryId: string;
        characteristicType: string;
        value: unknown;
        homeId?: string;
      };
      if (!isAccessoryAllowed(accessoryId)) {
        throw Object.assign(new Error('Accessory not included in your plan'), { code: ErrorCode.ACCESSORY_NOT_FOUND });
      }
      // Canonicalised at the door. The bridge accepts `on` and `power_state`
      // but only ever reports `power_state`, so a write named `on` would be
      // echoed to clients, MQTT and the engine under a name nothing else uses.
      const characteristicType = canonicalCharacteristic(requested);

      // A helper accessory's write is serviced by the engine rather than by
      // HomeKit — which is the ONLY thing about it that differs from any other
      // accessory. It arrives here as an ordinary characteristic write, it is
      // announced like one, and every client, script and integration that can
      // set a characteristic can set this. Nothing upstream needs to know.
      const { applyVirtualWrite } = await import('./virtual-accessories');
      const helperWrite = applyVirtualWrite(accessoryId, value);
      if (helperWrite) {
        announceRelayWrite([{ accessoryId, characteristicType, value: helperWrite.value, homeId }], 'client');
        return { success: true, accessoryId, characteristicType, value: helperWrite.value };
      }

      const setResult = await HomeKit.setCharacteristic(accessoryId, characteristicType, value);
      // Announce the CONFIRMED value when the bridge reports one — HomeKit may
      // cap a requested value (brightness clamps etc.), and every client would
      // otherwise display the value we asked for, not the one that stuck.
      const confirmed = (setResult as { value?: unknown } | undefined)?.value ?? value;
      announceRelayWrite([{ accessoryId, characteristicType, value: confirmed, homeId }], 'client');
      return setResult;
    }

    case 'characteristics.set': {
      const { writes, homeId } = payload as {
        writes: Array<{ accessoryId: string; characteristicType: string; value: unknown }>;
        homeId?: string;
      };
      if (!Array.isArray(writes) || writes.length === 0) {
        return { success: true, ok: 0, total: 0, changes: [] };
      }

      // Canonicalised at the door, for the same reason as characteristic.set:
      // the bridge accepts `on` and `power_state` but only ever reports
      // `power_state`, and a write announced under a name nothing else uses is
      // a write nothing else sees.
      const requested = writes.map(w => ({
        accessoryId: w.accessoryId,
        characteristicType: canonicalCharacteristic(w.characteristicType),
        value: w.value,
      }));

      // Helper accessories are serviced by the engine rather than by HomeKit.
      // They are peeled off here rather than inside the batch because they are
      // not HomeKit writes at all — the same split state.set makes.
      const { applyVirtualWrite } = await import('./virtual-accessories');
      const changes: Array<{ accessoryId: string; characteristicType: string; value?: unknown; success: boolean; error?: string }> = [];
      const announce: RelayWriteChange[] = [];
      const forHomeKit: typeof requested = [];

      for (const write of requested) {
        if (!isAccessoryAllowed(write.accessoryId)) {
          changes.push({ ...write, success: false, error: 'Accessory not included in your plan' });
          continue;
        }
        const helperWrite = applyVirtualWrite(write.accessoryId, write.value);
        if (helperWrite) {
          changes.push({ ...write, value: helperWrite.value, success: true });
          announce.push({ ...write, value: helperWrite.value, homeId });
          continue;
        }
        forHomeKit.push(write);
      }

      if (forHomeKit.length > 0) {
        const result = await HomeKit.setCharacteristics(forHomeKit);
        for (const change of result.changes) {
          changes.push(change);
          // Announce only what landed. Telling every client a light came on
          // when it did not leaves the whole house displaying a state it is
          // not in, and nothing later corrects it.
          if (change.success) {
            announce.push({
              accessoryId: change.accessoryId,
              characteristicType: change.characteristicType,
              value: change.value,
              homeId,
            });
          }
        }
      }

      // One announcement for the batch. relay-write.ts has always taken an
      // array; this is the shape it was built for.
      announceRelayWrite(announce, 'client');

      const ok = changes.filter(c => c.success).length;
      return { success: ok === changes.length, ok, total: changes.length, changes };
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
      const { automationId, homeId } = payload as { automationId: string; homeId?: string };
      // The bridge has no automation.get — list and filter, scoped to the
      // caller's home when given, otherwise across all homes. (The previous
      // code called a getNativeBridge() that never existed, so this action
      // threw at runtime since the day it shipped.)
      const homeIds = homeId
        ? [homeId]
        : ((await HomeKit.listHomes()) as Array<{ id: string }>).map((h) => h.id);
      for (const hid of homeIds) {
        const automations = await HomeKit.listAutomations(hid);
        const found = automations.find((a) => (a as { id?: string })?.id === automationId);
        if (found) return { automation: found };
      }
      throw Object.assign(new Error('Automation not found'), { code: ErrorCode.INVALID_REQUEST });
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
      const { automations, virtualAccessories } = payload as {
        automations?: unknown[]; virtualAccessories?: unknown[];
      };
      const virtuals = virtualAccessories;
      const { getAutomationEngine } = await import('../automation');
      const engine = getAutomationEngine();
      if (!engine) {
        throw Object.assign(new Error('Automation engine not running'), { code: ErrorCode.UNKNOWN_ACTION });
      }
      // Helpers first: an automation's trigger or condition may reference one,
      // and registering the automation against a helper the store doesn't know
      // yet reads as "no such value" rather than as an error.
      //
      // `helpers` is optional so an older server that only sends automations
      // still works — but absent is NOT the same as empty. Treating a missing
      // key as "delete every helper" would let one old pod wipe them all.
      let syncedHelpers: number | undefined;
      if (Array.isArray(virtuals)) {
        // `currentState` is the value, not part of the definition, so it is
        // split off here: leaving it on would make every value change look
        // like a definition change and rebuild the helper — cancelling its
        // timers — each time it was set.
        const raw = virtuals as Array<Record<string, unknown>>;
        const persistedStates: Record<string, unknown> = {};
        const list = raw.map(({ currentState, ...definition }) => {
          if (currentState !== undefined && typeof definition.id === 'string') {
            persistedStates[definition.id] = currentState;
          }
          return definition;
        }) as unknown as Parameters<typeof engine.syncVirtualAccessories>[0];
        engine.syncVirtualAccessories(list, persistedStates);
        syncedHelpers = list.length;
      }
      const list = (automations ?? []) as Parameters<typeof engine.loadAutomations>[0];
      engine.loadAutomations(list);
      return { loaded: list.length, helpers: syncedHelpers };
    }

    case 'automation.virtual_sync': {
      const { virtualAccessory } = payload as { virtualAccessory?: { id?: string } };
      const { getAutomationEngine } = await import('../automation');
      const engine = getAutomationEngine();
      if (!engine) {
        throw Object.assign(new Error('Automation engine not running'), { code: ErrorCode.UNKNOWN_ACTION });
      }
      if (!virtualAccessory?.id) {
        throw Object.assign(new Error('virtualAccessory.id required'), { code: ErrorCode.INVALID_REQUEST });
      }
      engine.upsertVirtualAccessory(virtualAccessory as Parameters<typeof engine.upsertVirtualAccessory>[0]);
      return { synced: virtualAccessory.id };
    }

    // Current value of every helper the engine has registered.
    //
    // Read from the engine, not from the database, deliberately: the database
    // holds definitions and a persisted copy of past values, while the engine
    // holds what is true right now. A Helpers list fed from storage would show
    // a mode that an automation changed a second ago as still being the old
    // one, and the manual control beside it would then act on a stale reading.
    case 'automation.virtual_states': {
      const { getAutomationEngine } = await import('../automation');
      const engine = getAutomationEngine();
      if (!engine) {
        throw Object.assign(new Error('Automation engine not running'), { code: ErrorCode.UNKNOWN_ACTION });
      }
      // Timer info travels with the values, because it changes at the same
      // moments and for the same reasons. It is accessory-level rather than a
      // characteristic, so it does NOT ride the value channel — a tile polling
      // states alone saw a timer go idle and had nothing to say when it ran
      // out, which reads as though it never ran.
      const timers: Record<string, unknown> = {};
      for (const helper of engine.virtualManager.getAllVirtualAccessories()) {
        if (helper.type !== 'timer') continue;
        const info = engine.virtualManager.getTimerInfo(helper.id);
        if (info) timers[helper.id] = info;
      }
      return { states: engine.getVirtualStates(), timers };
    }

    // A person operating a helper by hand. Same vocabulary as the `helper`
    // automation action, and the same dispatch underneath.
    case 'automation.virtual_operate': {
      const { accessoryId, operation, value, step, duration } = payload as {
        accessoryId?: string; operation?: string; value?: unknown; step?: number;
        duration?: { hours?: number; minutes?: number; seconds?: number };
      };
      const { getAutomationEngine } = await import('../automation');
      const engine = getAutomationEngine();
      if (!engine) {
        throw Object.assign(new Error('Automation engine not running'), { code: ErrorCode.UNKNOWN_ACTION });
      }
      if (!accessoryId || !operation) {
        throw Object.assign(new Error('accessoryId and operation required'), { code: ErrorCode.INVALID_REQUEST });
      }
      if (!engine.getVirtualAccessory(accessoryId)) {
        throw Object.assign(new Error(`No such helper: ${accessoryId}`), { code: ErrorCode.INVALID_REQUEST });
      }
      try {
        engine.operateVirtualAccessory(
          accessoryId,
          operation as Parameters<typeof engine.operateVirtualAccessory>[1],
          { value, step, duration },
        );
      } catch (e) {
        throw Object.assign(new Error(e instanceof Error ? e.message : String(e)), { code: ErrorCode.INVALID_REQUEST });
      }
      return { accessoryId, operation, state: engine.getVirtualStates()[accessoryId] };
    }

    // Named to match automation.unload: the row is already gone from the
    // database, this only unloads it from the running engine.
    case 'automation.virtual_unload': {
      const { accessoryId } = payload as { accessoryId?: string };
      const { getAutomationEngine } = await import('../automation');
      const engine = getAutomationEngine();
      if (!engine) {
        throw Object.assign(new Error('Automation engine not running'), { code: ErrorCode.UNKNOWN_ACTION });
      }
      if (!accessoryId) {
        throw Object.assign(new Error('accessoryId required'), { code: ErrorCode.INVALID_REQUEST });
      }
      engine.removeVirtualAccessory(accessoryId);
      return { deleted: accessoryId };
    }

    case 'automation.sync': {
      const { automation } = payload as { automation?: { id?: string } };
      const { getAutomationEngine } = await import('../automation');
      const engine = getAutomationEngine();
      if (!engine) {
        throw Object.assign(new Error('Automation engine not running'), { code: ErrorCode.UNKNOWN_ACTION });
      }
      if (!automation?.id) {
        throw Object.assign(new Error('automation.id required'), { code: ErrorCode.INVALID_REQUEST });
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
        throw Object.assign(new Error('automationId required'), { code: ErrorCode.INVALID_REQUEST });
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
      // Helper accessories are serviced by the engine; the native side resolves
      // keys against HomeKit and has never heard of them, so a write to one
      // arriving here used to vanish — while `_settable` advertised it. Peel
      // them off, then let native have the rest.
      const { applyVirtualStateWrites } = await import('./virtual-accessories');
      const virtualWrites = applyVirtualStateWrites(state, homeId);
      const hasHomeKitWork = Object.keys(virtualWrites.remaining).length > 0;
      const result = hasHomeKitWork
        ? await HomeKit.setState(virtualWrites.remaining, homeId)
        : { ok: 0, failed: [] as string[], changes: [] as Array<{ accessoryId: string; characteristicType: string; value: unknown }> };
      console.log('[state.set] result:', JSON.stringify(result));
      const changes = [...(result.changes ?? []), ...virtualWrites.changes];
      // As for characteristic.set: HomeKit stays silent about writes we made
      // ourselves. This is the path REST, MCP and Home Assistant all take, so
      // without it a device changed by an assistant or a script never triggered
      // a Homecast automation. Native resolves the slug keys and expands
      // service groups to their members, so these are ready to feed straight in.
      announceRelayWrite(
        changes.map((c) => ({ ...c, homeId })),
        'client',
      );
      return {
        ...result,
        ok: (result.ok ?? 0) + virtualWrites.changes.length,
        failed: [...(result.failed ?? []), ...virtualWrites.failed],
        changes,
      };
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
