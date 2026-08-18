/**
 * TypeScript wrapper for the native HomeKit bridge injected by the Mac app.
 * Provides type-safe access to HomeKit operations through the WebView JS bridge.
 */

// Types for HomeKit data structures
export interface HomeKitHome {
  id: string;
  name: string;
  isPrimary: boolean;
  roomCount: number;
  accessoryCount: number;
  role?: string;
  relayConnected?: boolean;
  /** "connected" | "reconnecting" | "offline" — relayConnected is the
   *  grace-applied boolean (reconnecting counts as connected). */
  relayState?: string;
  relayLastSeenAt?: string | null;
  relayId?: string | null;
  relayOwnerEmail?: string | null;
  isCloudManaged?: boolean;
  roomFingerprint?: string;
  /** Whether the relay's Apple ID can edit this home in Apple Home
   *  ("Add & Edit Accessories"). null/undefined = unknown (older relay). */
  isAdmin?: boolean | null;
}

export interface HomeKitRoom {
  id: string;
  name: string;
  accessoryCount: number;
}

export interface HomeKitZone {
  id: string;
  name: string;
  roomIds: string[];
}

export interface HomeKitServiceGroup {
  id: string;
  name: string;
  serviceIds: string[];
  accessoryIds: string[];
  homeId?: string;
}

export interface HomeKitCharacteristic {
  id: string;
  characteristicType: string;
  value?: unknown;
  isReadable: boolean;
  isWritable: boolean;
  validValues?: number[];
  minValue?: number;
  maxValue?: number;
  stepValue?: number;
}

export interface HomeKitService {
  id: string;
  name: string;
  serviceType: string;
  characteristics: HomeKitCharacteristic[];
}

export interface HomeKitAccessory {
  id: string;
  name: string;
  homeId?: string;
  roomId?: string;
  roomName?: string;
  category: string;
  isReachable: boolean;
  services: HomeKitService[];
}

/** One entry's outcome in a bulk characteristic write. */
export interface BulkWriteChange {
  accessoryId: string;
  characteristicType: string;
  /** The value HomeKit confirmed. Absent when the write did not land. */
  value?: unknown;
  success: boolean;
  error?: string;
}

/**
 * The answer to one `characteristics.set`.
 *
 * `success` is all-or-nothing, so callers that care which accessories moved
 * must read `changes` — which is the whole reason this exists rather than
 * `state.set`, whose failures come back keyed by slug.
 */
export interface BulkWriteResponse {
  success: boolean;
  ok: number;
  total: number;
  changes: BulkWriteChange[];
}

export interface HomeKitScene {
  id: string;
  name: string;
  actionCount: number;
  /** HomeKit action-set type (built-ins can't be deleted). Newer relays only. */
  actionSetType?: string;
  /** Non-null when the scene is an automation's action list — delete the
   *  automation instead of the scene. Newer relays only. */
  automationName?: string | null;
  /** The scene's characteristic writes. Newer relays only (scene.create /
   *  scene.update responses). */
  actions?: AutomationAction[];
}

export interface AutomationAction {
  accessoryId: string;
  accessoryName: string;
  characteristicType: string;
  targetValue: unknown;
}

export interface AutomationEvent {
  type: 'characteristic' | 'characteristicThresholdRange' | 'location' | 'presence' | 'significantTime' | 'calendar' | 'duration' | 'unknown';
  accessoryId?: string;
  accessoryName?: string;
  characteristicType?: string;
  triggerValue?: unknown;
  thresholdMin?: unknown;
  thresholdMax?: unknown;
  significantEvent?: string;
  offsetMinutes?: number;
  latitude?: number;
  longitude?: number;
  radius?: number;
  notifyOnEntry?: boolean;
  notifyOnExit?: boolean;
  presenceType?: string;
  presenceEvent?: string;
  calendarComponents?: Record<string, number>;
  durationSeconds?: number;
}

export interface AutomationCondition {
  type: string;
  accessoryId?: string;
  characteristicType?: string;
  comparisonOperator?: string;
  value?: unknown;
}

export interface AutomationTrigger {
  type: 'timer' | 'event' | 'unknown';
  fireDate?: string;
  recurrence?: Record<string, number>;
  timeZone?: string;
  events?: AutomationEvent[];
  endEvents?: AutomationEvent[];
  recurrences?: Array<Record<string, number>>;
  executeOnce?: boolean;
  activationState?: string;
}

export interface HomeKitAutomation {
  id: string;
  name: string;
  isEnabled: boolean;
  trigger: AutomationTrigger;
  actions: AutomationAction[];
  lastFireDate?: string;
  homeId?: string;
}

export interface HomeKitError {
  code: string;
  message: string;
}

export interface HomeKitEvent {
  type: 'characteristic.updated' | 'accessory.reachability' | 'homes.updated';
  accessoryId: string;
  // Context fields provided by native bridge for event routing
  homeId?: string;
  roomId?: string;
  serviceGroupIds?: string[];
  // Event-specific fields
  characteristicType?: string;
  value?: unknown;
  isReachable?: boolean;
}

// Type for the native bridge injected by the Mac app
import {
  emitLocalRelayActivity, hasLocalActivityListeners, activityNow,
} from '../server/local-activity';
import { describeError } from '../lib/describe-error';
import { getAccessoryDisplayName } from '../components/widgets/types';

/**
 * Put the user's name on the accessory, once, at the door.
 *
 * HomeKit hands us the manufacturer's name on `HMAccessory` and the user's on
 * the service they renamed, and everything downstream — tiles, search, scenes,
 * the REST and MCP slugs, MQTT topics, Home Assistant discovery, notification
 * text — reads `accessory.name`. Resolving it at each of those sites is how
 * "Front Door Lock" stayed "Nuki_19F252BD" in most of them; resolving it here
 * means a site cannot forget.
 *
 * Mutates rather than copies: an `accessories.list` for a large home runs to
 * megabytes, the payload is freshly parsed JSON nobody else holds, and the
 * resolver is idempotent, so re-running over a cached list is a no-op.
 */
function withUserNames<T extends { name: string; services?: Array<{ name?: string; serviceType: string }> }>(
  accessories: T[],
): T[] {
  if (!Array.isArray(accessories)) return accessories;
  for (const accessory of accessories) {
    if (!accessory || typeof accessory.name !== 'string') continue;
    accessory.name = getAccessoryDisplayName(accessory);
  }
  return accessories;
}

interface NativeBridge {
  call<T>(method: string, payload?: Record<string, unknown>): Promise<T>;
  onEvent(handler: (event: HomeKitEvent) => void): () => void;
}

// Check if the native bridge is available
export function isRelayCapable(): boolean {
  return (window as Window & { isHomeKitRelayCapable?: boolean }).isHomeKitRelayCapable === true;
}

// Check if the relay is enabled (capable + not manually disabled)
export function isRelayEnabled(): boolean {
  return isRelayCapable() && localStorage.getItem('homecast-relay-disabled') !== 'true';
}

/**
 * Can this device talk to HomeKit itself?
 *
 * Deliberately a different question from `isRelayCapable()`, which means "this
 * device can *be* the relay" and drives relay claiming, relay duties, the relay
 * status badge, the Settings relay pane and the offline-banner suppression.
 * An iPhone can serve its own HomeKit but must never claim relay duty — so it
 * sets this flag and not that one. Every Mac sets both.
 */
export function isLocalCapable(): boolean {
  return (window as Window & { isHomeKitLocalCapable?: boolean }).isHomeKitLocalCapable === true;
}

/** What the native side reports about HomeKit availability on this device. */
export interface HomeKitStatus {
  ready: boolean;
  authorized: boolean;
  restricted: boolean;
  /** HomeKit has finished deciding. False means still asking — wait, don't conclude. */
  determined: boolean;
  homeCount: number;
}

/** Distinguishes native calls started in the same millisecond. */
let nativeCallSeq = 0;

/**
 * Wrap the native bridge so every call into HomeKit is timed and reported.
 *
 * A relay action and the HomeKit work it causes are different things, and
 * conflating them hid the question that mattered: when `characteristic.set`
 * took 30 seconds, was HomeKit slow, or was the time spent elsewhere? One row
 * covering both could not say. Now the action and the native call it makes are
 * separate entries, each with its own duration, and the difference between them
 * is time the relay spent on its own account.
 *
 * Wrapped once here rather than at each call site so reads are covered too, and
 * so a new HomeKit method cannot be added without its timing.
 */
/**
 * Why the call happening right now is happening.
 *
 * The stream shows *what* the relay asked HomeKit and how long it took, and
 * that was enough to answer "is it slow". It cannot answer "why is this being
 * asked ninety times an hour", which is the question a repeating call actually
 * raises — an `accessories.list` looks identical whether a user opened the
 * dashboard or something is re-reading the world on a timer.
 *
 * Set synchronously around the call and read when the entry is emitted, which
 * also happens synchronously. Deliberately not restored to a previous value:
 * nesting would mean a reason outliving its call, and a wrong reason is worse
 * than none.
 */
let callReason: string | undefined;

/** Tag every bridge call made inside `fn` with a reason. */
export function withCallReason<T>(reason: string, fn: () => T): T {
  callReason = reason;
  try {
    return fn();
  } finally {
    callReason = undefined;
  }
}

/**
 * Ceiling for a single native bridge call.
 *
 * A native call has no timeout of its own: `window.homekit.call()` settles when
 * Swift answers, and if Swift never answers the promise never settles. That is
 * not hypothetical — the relay has sat with its socket up and JavaScript running
 * normally while every HomeKit-backed action hung, because the calls underneath
 * them never came back. Pure-JS actions answered in 32ms throughout, so from the
 * outside it looked like a healthy relay that had stopped doing its job.
 *
 * Bounding the wait does not un-wedge the bridge. What it buys is a failure that
 * names itself: BRIDGE_TIMEOUT against a known method, instead of the cloud
 * reporting a bare timeout with nothing to say about where the time went. That
 * only happens if the relay gives up *first*, which is why the number matters.
 *
 * Reads and writes need different ceilings, because they are boxed in from
 * different sides:
 *
 * - **Reads** are unbounded natively — `characteristic.get` is what the bridge
 *   was wedged on when the watchdog caught it. Nothing else will stop them, and
 *   the cloud gives up at 10s (`route_request`), so the ceiling has to be under
 *   that to be the one that reports.
 *
 * - **Writes** are already bounded at 10s inside Swift, which returns a real
 *   per-device result ("this bulb did not confirm"). Cutting a write off sooner
 *   would throw that away and replace it with something less informative, so the
 *   ceiling sits above it and exists only to stop the promise hanging forever.
 *
 * Keep READ under `route_request`'s timeout and WRITE above Swift's write bound.
 * If either of those moves, these move with them.
 */
const BRIDGE_READ_TIMEOUT_MS = 8_000;
const BRIDGE_WRITE_TIMEOUT_MS = 12_000;

/**
 * Bulk writes get their own ceiling, between the other two.
 *
 * A batch answers once for every accessory in it, and Swift bounds each write
 * inside it at `bulkWriteTimeoutSeconds` (7s) precisely so the answer beats
 * `route_request`'s 10s. This sits above that bound and below the cloud's, so
 * when something does go wrong the relay is still the one that names it.
 */
const BRIDGE_BULK_WRITE_TIMEOUT_MS = 9_000;

/** Writes that carry many accessories in one call. */
const BRIDGE_BULK_WRITE_METHODS = new Set(['characteristics.set']);

/**
 * Methods that change something, and so are bounded by Swift's own write
 * ceiling rather than by ours. Everything not listed is treated as a read —
 * the stricter default, so a newly added method is bounded tightly by omission
 * rather than loosely by oversight.
 */
const BRIDGE_WRITE_METHODS = new Set([
  'characteristic.set',
  'serviceGroup.set',
  'state.set',
  'scene.execute',
  'scene.create',
  'scene.update',
  'scene.delete',
  'room.create',
  'room.delete',
  'automation.create',
  'automation.update',
  'automation.delete',
  'automation.enable',
  'automation.disable',
  'settings.setLaunchAtLogin',
  'file.save',
]);

/**
 * Methods exempt from any ceiling because they block on a person, not a device.
 * `notification.requestPermission` sits on the system permission prompt until
 * it is answered, and taking a while to click it is not a fault.
 */
const UNBOUNDED_BRIDGE_METHODS = new Set(['notification.requestPermission']);

/** The ceiling that applies to `method`, in milliseconds. */
function bridgeTimeoutFor(method: string): number {
  if (BRIDGE_BULK_WRITE_METHODS.has(method)) return BRIDGE_BULK_WRITE_TIMEOUT_MS;
  return BRIDGE_WRITE_METHODS.has(method) ? BRIDGE_WRITE_TIMEOUT_MS : BRIDGE_READ_TIMEOUT_MS;
}

/**
 * Reject if the native side has not answered within the ceiling.
 *
 * The underlying call is deliberately left in flight — it cannot be cancelled,
 * and it may still land. Bounding the *wait* is the point.
 */
function callWithTimeout<T>(
  bridge: NativeBridge,
  method: string,
  payload?: Record<string, unknown>,
): Promise<T> {
  if (UNBOUNDED_BRIDGE_METHODS.has(method)) return bridge.call<T>(method, payload);

  const ceilingMs = bridgeTimeoutFor(method);

  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(Object.assign(
        new Error(`HomeKit bridge did not answer ${method} within ${ceilingMs / 1000}s`),
        { code: 'BRIDGE_TIMEOUT', method },
      ));
    }, ceilingMs);

    bridge.call<T>(method, payload).then(
      (result) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(result);
      },
      (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

function instrument(bridge: NativeBridge): NativeBridge {
  return {
    onEvent: (handler) => bridge.onEvent(handler),
    call<T>(method: string, payload?: Record<string, unknown>): Promise<T> {
      const call = callWithTimeout<T>(bridge, method, payload);
      if (!hasLocalActivityListeners()) return call;

      const startedAt = activityNow();
      const id = `native-${startedAt}-${++nativeCallSeq}`;
      // Captured now: the call is about to go async, and by the time it settles
      // some other call will have set its own reason.
      const reason = callReason;
      emitLocalRelayActivity({
        lane: 'bridge', phase: 'sent', action: method, at: startedAt, id,
        request: payload, reason,
      });

      return call.then(
        (result) => {
          emitLocalRelayActivity({
            lane: 'bridge', phase: 'ok', action: method, id, at: startedAt,
            ms: Math.round((activityNow() - startedAt) * 1000),
            request: payload, response: result, reason,
          });
          return result;
        },
        (error) => {
          emitLocalRelayActivity({
            lane: 'bridge', phase: 'failed', action: method, id, at: startedAt,
            ms: Math.round((activityNow() - startedAt) * 1000),
            request: payload, error: describeError(error), reason,
          });
          throw error;
        },
      );
    },
  };
}

// Get the native bridge instance
function getNativeBridge(): NativeBridge | null {
  const win = window as Window & { homekit?: NativeBridge };
  if (win.homekit) {
    return instrument(win.homekit);
  }
  return null;
}

/**
 * HomeKit bridge API for the web app.
 * Wraps the native bridge with type-safe methods.
 */
export const HomeKit = {
  /**
   * Check if the bridge is available (running in Mac app WebView)
   */
  isAvailable(): boolean {
    return getNativeBridge() !== null;
  },

  /**
   * Whether HomeKit is usable on this device, and if not, why.
   *
   * Answers without waiting for HomeKit to load, because it is the call that
   * decides whether Local Mode is offerable at all — a probe that blocks on
   * the thing it is probing is no use when permission has been refused.
   *
   * Returns null on a build whose native side predates the method, which is
   * how a newer web bundle stays safe inside an older app shell.
   */
  async getStatus(): Promise<HomeKitStatus | null> {
    const bridge = getNativeBridge();
    if (!bridge) return null;
    try {
      return await bridge.call<HomeKitStatus>('homekit.status');
    } catch {
      return null;
    }
  },

  /**
   * List all homes
   */
  async listHomes(): Promise<HomeKitHome[]> {
    const bridge = getNativeBridge();
    if (!bridge) throw new Error('HomeKit bridge not available');
    return bridge.call<HomeKitHome[]>('homes.list');
  },

  /**
   * List rooms in a home
   */
  async listRooms(homeId: string): Promise<HomeKitRoom[]> {
    const bridge = getNativeBridge();
    if (!bridge) throw new Error('HomeKit bridge not available');
    return bridge.call<HomeKitRoom[]>('rooms.list', { homeId });
  },

  /** Create a room (no accessory needed) — used for the enrollment code
   *  challenge. Requires the 1.1.4+ native build. */
  async createRoom(homeId: string, name: string): Promise<{ id: string; name: string }> {
    const bridge = getNativeBridge();
    if (!bridge) throw new Error('HomeKit bridge not available');
    return bridge.call('room.create', { homeId, name });
  },

  async deleteRoom(homeId: string, roomId: string): Promise<{ success: boolean }> {
    const bridge = getNativeBridge();
    if (!bridge) throw new Error('HomeKit bridge not available');
    return bridge.call('room.delete', { homeId, roomId });
  },

  /**
   * List zones in a home
   */
  async listZones(homeId: string): Promise<HomeKitZone[]> {
    const bridge = getNativeBridge();
    if (!bridge) throw new Error('HomeKit bridge not available');
    return bridge.call<HomeKitZone[]>('zones.list', { homeId });
  },

  /**
   * List service groups in a home
   */
  async listServiceGroups(homeId: string): Promise<HomeKitServiceGroup[]> {
    const bridge = getNativeBridge();
    if (!bridge) throw new Error('HomeKit bridge not available');
    return bridge.call<HomeKitServiceGroup[]>('serviceGroups.list', { homeId });
  },

  /**
   * Set a characteristic on all services in a group
   */
  async setServiceGroupCharacteristic(
    groupId: string,
    characteristicType: string,
    value: unknown,
    homeId?: string
  ): Promise<{ success: boolean; groupId: string; successCount: number }> {
    const bridge = getNativeBridge();
    if (!bridge) throw new Error('HomeKit bridge not available');
    return bridge.call('serviceGroup.set', {
      groupId,
      characteristicType,
      value,
      ...(homeId && { homeId }),
    });
  },

  /**
   * List accessories, optionally filtered by home or room
   */
  async listAccessories(options?: {
    homeId?: string;
    roomId?: string;
    includeValues?: boolean;
  }): Promise<HomeKitAccessory[]> {
    const bridge = getNativeBridge();
    if (!bridge) throw new Error('HomeKit bridge not available');
    return withUserNames(await bridge.call<HomeKitAccessory[]>('accessories.list', options || {}));
  },

  /**
   * Get a single accessory with full details
   */
  async getAccessory(accessoryId: string): Promise<HomeKitAccessory> {
    const bridge = getNativeBridge();
    if (!bridge) throw new Error('HomeKit bridge not available');
    return withUserNames([await bridge.call<HomeKitAccessory>('accessory.get', { accessoryId })])[0];
  },

  /**
   * Refresh an accessory's cached values
   */
  async refreshAccessory(accessoryId: string): Promise<{ success: boolean; accessoryId: string }> {
    const bridge = getNativeBridge();
    if (!bridge) throw new Error('HomeKit bridge not available');
    return bridge.call('accessory.refresh', { accessoryId });
  },

  /**
   * Read a characteristic value
   */
  async getCharacteristic(
    accessoryId: string,
    characteristicType: string
  ): Promise<{ accessoryId: string; characteristicType: string; value: unknown }> {
    const bridge = getNativeBridge();
    if (!bridge) throw new Error('HomeKit bridge not available');
    return bridge.call('characteristic.get', { accessoryId, characteristicType });
  },

  /**
   * Set a characteristic value
   */
  async setCharacteristic(
    accessoryId: string,
    characteristicType: string,
    value: unknown,
    homeId?: string,
  ): Promise<{ success: boolean; accessoryId: string; characteristicType: string; value: string }> {
    const bridge = getNativeBridge();
    if (!bridge) throw new Error('HomeKit bridge not available');
    return bridge.call('characteristic.set', { accessoryId, characteristicType, value, ...(homeId && { homeId }) });
  },

  /**
   * Set many characteristics as one operation.
   *
   * Addressed by accessory id, so — unlike the bulk `state.set` — it can reach
   * an accessory with no room. Native resolves the whole batch in one pass and
   * dispatches it as one unbounded TaskGroup, which is what lets HomeKit's own
   * daemon coalesce the writes that share an accessory server.
   *
   * Reports per entry rather than throwing: the caller needs to know which
   * accessories moved, not merely that something did not.
   */
  async setCharacteristics(
    writes: Array<{ accessoryId: string; characteristicType: string; value: unknown }>,
  ): Promise<BulkWriteResponse> {
    const bridge = getNativeBridge();
    if (!bridge) throw new Error('HomeKit bridge not available');
    return bridge.call<BulkWriteResponse>('characteristics.set', { writes });
  },

  /**
   * List scenes in a home
   */
  async listScenes(homeId: string): Promise<HomeKitScene[]> {
    const bridge = getNativeBridge();
    if (!bridge) throw new Error('HomeKit bridge not available');
    return bridge.call<HomeKitScene[]>('scenes.list', { homeId });
  },

  /**
   * Execute a scene
   */
  async executeScene(sceneId: string): Promise<{ success: boolean; sceneId: string }> {
    const bridge = getNativeBridge();
    if (!bridge) throw new Error('HomeKit bridge not available');
    return bridge.call('scene.execute', { sceneId });
  },

  /**
   * Delete a scene (blocked natively for built-ins and automation-owned scenes)
   */
  async deleteScene(sceneId: string): Promise<{ success: boolean; sceneId: string }> {
    const bridge = getNativeBridge();
    if (!bridge) throw new Error('HomeKit bridge not available');
    return bridge.call('scene.delete', { sceneId });
  },

  /**
   * Create a scene (named snapshot of device states)
   */
  async createScene(homeId: string, name: string, actions: Array<{ accessoryId: string; characteristicType: string; targetValue: unknown }>): Promise<HomeKitScene> {
    const bridge = getNativeBridge();
    if (!bridge) throw new Error('HomeKit bridge not available');
    return bridge.call<HomeKitScene>('scene.create', { homeId, name, actions });
  },

  /**
   * Update a scene (rename and/or replace its actions; blocked natively for
   * built-ins and automation-owned scenes)
   */
  async updateScene(sceneId: string, params: { name?: string; actions?: Array<{ accessoryId: string; characteristicType: string; targetValue: unknown }> }): Promise<HomeKitScene> {
    const bridge = getNativeBridge();
    if (!bridge) throw new Error('HomeKit bridge not available');
    return bridge.call<HomeKitScene>('scene.update', { sceneId, ...params });
  },

  /**
   * List automations in a home
   */
  async listAutomations(homeId: string): Promise<HomeKitAutomation[]> {
    const bridge = getNativeBridge();
    if (!bridge) throw new Error('HomeKit bridge not available');
    const result = await bridge.call<{ automations: HomeKitAutomation[] }>('automations.list', { homeId });
    return result.automations;
  },

  /**
   * Create a new automation
   */
  async createAutomation(homeId: string, name: string, trigger: AutomationTrigger, actions: Array<{ accessoryId: string; characteristicType: string; targetValue: unknown }>): Promise<HomeKitAutomation> {
    const bridge = getNativeBridge();
    if (!bridge) throw new Error('HomeKit bridge not available');
    return bridge.call<HomeKitAutomation>('automation.create', { homeId, name, trigger, actions });
  },

  /**
   * Update an existing automation
   */
  async updateAutomation(automationId: string, params: { name?: string; trigger?: AutomationTrigger; actions?: Array<{ accessoryId: string; characteristicType: string; targetValue: unknown }>; enabled?: boolean }): Promise<HomeKitAutomation> {
    const bridge = getNativeBridge();
    if (!bridge) throw new Error('HomeKit bridge not available');
    return bridge.call<HomeKitAutomation>('automation.update', { automationId, ...params });
  },

  /**
   * Delete an automation
   */
  async deleteAutomation(automationId: string): Promise<{ success: boolean; automationId: string }> {
    const bridge = getNativeBridge();
    if (!bridge) throw new Error('HomeKit bridge not available');
    return bridge.call('automation.delete', { automationId });
  },

  /**
   * Enable or disable an automation
   */
  async setAutomationEnabled(automationId: string, enabled: boolean): Promise<HomeKitAutomation> {
    const bridge = getNativeBridge();
    if (!bridge) throw new Error('HomeKit bridge not available');
    const action = enabled ? 'automation.enable' : 'automation.disable';
    return bridge.call<HomeKitAutomation>(action, { automationId });
  },

  /**
   * Set state using simplified format: {room: {accessory: {prop: value}}}
   */
  async setState(
    state: Record<string, Record<string, Record<string, unknown>>>,
    homeId?: string
  ): Promise<{
    success: boolean;
    ok: number;
    failed: string[];
    /**
     * Every write that succeeded, with slugs resolved to UUIDs and service
     * groups expanded to the group plus each member. Native has always
     * returned this; it is what lets the automation engine hear about a bulk
     * write, which HomeKit itself will not report back.
     */
    changes?: { accessoryId: string; characteristicType: string; value: unknown }[];
  }> {
    const bridge = getNativeBridge();
    if (!bridge) throw new Error('HomeKit bridge not available');
    return bridge.call('state.set', { state, ...(homeId && { homeId }) });
  },

  /**
   * Start observing characteristic changes
   */
  async startObserving(): Promise<{ success: boolean; observing: boolean }> {
    const bridge = getNativeBridge();
    if (!bridge) throw new Error('HomeKit bridge not available');
    return bridge.call('observe.start');
  },

  /**
   * Stop observing characteristic changes
   */
  async stopObserving(): Promise<{ success: boolean; observing: boolean }> {
    const bridge = getNativeBridge();
    if (!bridge) throw new Error('HomeKit bridge not available');
    return bridge.call('observe.stop');
  },

  /**
   * Reset the observation timeout (called when server confirms listeners exist)
   */
  async resetObservationTimeout(): Promise<{ success: boolean }> {
    const bridge = getNativeBridge();
    if (!bridge) throw new Error('HomeKit bridge not available');
    return bridge.call('observe.reset');
  },

  /**
   * Subscribe to HomeKit events (characteristic updates, reachability changes)
   * Returns an unsubscribe function.
   */
  onEvent(handler: (event: HomeKitEvent) => void): () => void {
    const bridge = getNativeBridge();
    if (!bridge) {
      console.warn('[HomeKit] Bridge not available, event subscription ignored');
      return () => {};
    }
    return bridge.onEvent(handler);
  },

  // Debug methods
  /**
   * Get relay logs from the native bridge
   */
  async getRelayLogs(): Promise<RelayLogEntry[]> {
    const bridge = getNativeBridge();
    if (!bridge) throw new Error('HomeKit bridge not available');
    return bridge.call<RelayLogEntry[]>('debug.getRelayLogs');
  },

  /**
   * Get webview console logs from the native bridge
   */
  async getWebViewLogs(): Promise<WebViewLogEntry[]> {
    const bridge = getNativeBridge();
    if (!bridge) throw new Error('HomeKit bridge not available');
    return bridge.call<WebViewLogEntry[]>('debug.getWebViewLogs');
  },

  /**
   * Get HomeKit stats from the native bridge
   */
  async getStats(): Promise<HomeKitStats> {
    const bridge = getNativeBridge();
    if (!bridge) throw new Error('HomeKit bridge not available');
    return bridge.call<HomeKitStats>('debug.getStats');
  },

  /**
   * Clear relay logs
   */
  async clearRelayLogs(): Promise<{ success: boolean }> {
    const bridge = getNativeBridge();
    if (!bridge) throw new Error('HomeKit bridge not available');
    return bridge.call('debug.clearRelayLogs');
  },

  /**
   * Clear webview logs
   */
  async clearWebViewLogs(): Promise<{ success: boolean }> {
    const bridge = getNativeBridge();
    if (!bridge) throw new Error('HomeKit bridge not available');
    return bridge.call('debug.clearWebViewLogs');
  },

  /**
   * Get launch at login status (Mac app only, requires updated app)
   */
  async getLaunchAtLogin(): Promise<{ launchAtLogin: boolean }> {
    const bridge = getNativeBridge();
    if (!bridge) throw new Error('HomeKit bridge not available');
    return bridge.call('settings.getLaunchAtLogin');
  },

  /**
   * Set launch at login (Mac app only, requires updated app)
   */
  async setLaunchAtLogin(enabled: boolean): Promise<{ success: boolean; launchAtLogin: boolean }> {
    const bridge = getNativeBridge();
    if (!bridge) throw new Error('HomeKit bridge not available');
    return bridge.call('settings.setLaunchAtLogin', { enabled });
  },

  // ---- Notifications ----

  /**
   * Show a local notification on macOS
   */
  async showNotification(title: string | undefined, message: string, data?: Record<string, unknown>): Promise<{ success: boolean }> {
    const bridge = getNativeBridge();
    if (!bridge) throw new Error('HomeKit bridge not available');
    return bridge.call('notification.show', { title, message, data });
  },

  /**
   * Request notification permission
   */
  async requestNotificationPermission(): Promise<{ granted: boolean }> {
    const bridge = getNativeBridge();
    if (!bridge) throw new Error('HomeKit bridge not available');
    return bridge.call('notification.requestPermission');
  },

  // ---- Files ----

  /**
   * Whether the running app build can save a file natively. Older builds
   * answer with an error, which is the honest "no" — callers fall back.
   */
  async canSaveFile(): Promise<boolean> {
    const bridge = getNativeBridge();
    if (!bridge) return false;
    try {
      const result = await bridge.call('file.canSave') as { canSave?: boolean } | undefined;
      return Boolean(result?.canSave);
    } catch {
      return false;
    }
  },

  /** Save text through the native export sheet. */
  async saveFile(filename: string, contents: string, mimeType: string): Promise<{ success: boolean }> {
    const bridge = getNativeBridge();
    if (!bridge) throw new Error('HomeKit bridge not available');
    return bridge.call('file.save', { filename, contents, mimeType });
  },

  /**
   * Get the APNs device token (null if not registered)
   */
  async getAPNsToken(): Promise<{ token: string | null }> {
    const bridge = getNativeBridge();
    if (!bridge) throw new Error('HomeKit bridge not available');
    return bridge.call('notification.getAPNsToken');
  },
};

// Debug types
export interface RelayLogEntry {
  id: string;
  timestamp: string;
  method: string;
  direction: 'REQ' | 'RESP' | 'EVENT';
  payload?: string;
  result?: string;
  error?: string;
  durationMs?: number;
}

export interface WebViewLogEntry {
  id: string;
  timestamp: string;
  message: string;
  level: 'log' | 'info' | 'warn' | 'error' | 'debug';
  source?: string;
}

export interface HomeKitStats {
  homes: number;
  accessories: number;
  accessoriesOnline: number;
  accessoriesOffline: number;
  rooms: number;
  zones: number;
  scenes: number;
  serviceGroups: number;
}

export default HomeKit;
