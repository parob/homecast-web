/**
 * Community mode: broadcasts HomeKit events to all connected external clients.
 *
 * Subscribes to HomeKit events (characteristic changes, reachability) via the
 * native bridge and sends them to external WebSocket clients through the
 * Swift LocalNetworkBridge.
 *
 * This runs inside the Mac app's WKWebView — NOT in external browsers.
 */

import { withCallReason, HomeKit } from '../native/homekit-bridge';
import { isCommunity, isClientMode } from '../lib/config';

let unsubscribe: (() => void) | null = null;
let observationKeepAlive: ReturnType<typeof setInterval> | null = null;

/**
 * Deduplication: track recently-broadcast characteristic updates to avoid double-broadcasting
 * when communityRequest broadcasts a change AND HomeKit fires an observation event for the same change.
 * Key: "accessoryId:characteristicType", Value: timestamp of last broadcast.
 */
const recentBroadcasts = new Map<string, number>();
const DEDUP_WINDOW_MS = 500; // Ignore observation events within 500ms of a request-driven broadcast

/** Mark a characteristic as recently broadcast (called from connection.ts). */
export function markRecentBroadcast(accessoryId: string, characteristicType: string): void {
  recentBroadcasts.set(`${accessoryId}:${characteristicType}`, Date.now());
}

/** Check if this characteristic was recently broadcast and should be deduplicated. */
function isDuplicate(accessoryId: string, characteristicType: string): boolean {
  const key = `${accessoryId}:${characteristicType}`;
  const lastBroadcast = recentBroadcasts.get(key);
  if (lastBroadcast && (Date.now() - lastBroadcast) < DEDUP_WINDOW_MS) {
    recentBroadcasts.delete(key); // One-shot dedup
    return true;
  }
  return false;
}

/**
 * Start broadcasting HomeKit events to external clients.
 * Called once when the web app starts in Community mode on the relay Mac.
 */
export function initLocalBroadcast(): void {
  if (!isCommunity || isClientMode()) return;

  const w = window as Window & {
    isHomeKitRelayCapable?: boolean;
    __localserver_broadcast?: (message: unknown) => void;
  };

  if (!w.isHomeKitRelayCapable) return;

  console.log('[LocalBroadcast] Initializing event broadcasting');

  // Start HomeKit observation — in cloud mode this is done by ServerWebSocket.startRelayDuties(),
  // but in Community mode there's no server WebSocket, so we start it here.
  HomeKit.startObserving().catch((err) => {
    console.error('[LocalBroadcast] Failed to start HomeKit observation:', err);
  });

  // Native observation auto-stops after 90s without a reset (HomeKitManager.swift:61).
  // In cloud mode, the heartbeat ping resets it (websocket.ts:1106).
  // In Community mode, we run our own keep-alive interval.
  observationKeepAlive = setInterval(() => {
    withCallReason('keepalive: native observation self-stops after 90s', () =>
      HomeKit.resetObservationTimeout()).catch((err) => {
      console.warn('[LocalBroadcast] Observation keepalive failed — external changes may not propagate:', err);
    });
  }, 30_000);

  unsubscribe = HomeKit.onEvent((event) => {
    const broadcast = w.__localserver_broadcast;
    if (!broadcast) return;

    if (event.type === 'characteristic.updated' && event.characteristicType) {
      // Deduplicate: skip if this was recently broadcast by communityRequest (B3 fix)
      if (isDuplicate(event.accessoryId, event.characteristicType)) {
        return;
      }
      broadcast({
        type: 'characteristic_update',
        accessoryId: event.accessoryId,
        homeId: event.homeId ?? null,
        characteristicType: event.characteristicType,
        value: event.value,
      });
    } else if (event.type === 'accessory.reachability') {
      broadcast({
        type: 'reachability_update',
        accessoryId: event.accessoryId,
        isReachable: event.isReachable ?? true,
      });
    }
    // No serviceGroup branch: the native bridge never emits a
    // 'serviceGroup.updated' observation event (groups are a Homecast concept,
    // not a HomeKit one). Group changes reach LAN clients through
    // broadcastRelayGroupWrite via the relay-write publisher instead.
  });
}

/**
 * Announce a write the relay itself made, to LAN clients.
 *
 * HomeKit fires no observer for our own writes, so a change made by the
 * automation engine reached no client until something else noticed it. The
 * dedupe marker stops a device that *does* report back producing a second
 * broadcast for the same change.
 */
export function broadcastRelayWrite(
  accessoryId: string,
  characteristicType: string,
  value: unknown,
  homeId?: string,
): void {
  const broadcast = (window as Window & { __localserver_broadcast?: (m: unknown) => void }).__localserver_broadcast;
  if (!broadcast) return;
  markRecentBroadcast(accessoryId, characteristicType);
  broadcast({
    type: 'characteristic_update',
    accessoryId,
    homeId: homeId ?? null,
    characteristicType,
    value,
  });
}

/** As above, for a whole service group. */
export function broadcastRelayGroupWrite(
  groupId: string,
  characteristicType: string,
  value: unknown,
  homeId?: string,
  affectedCount = 0,
): void {
  const broadcast = (window as Window & { __localserver_broadcast?: (m: unknown) => void }).__localserver_broadcast;
  if (!broadcast) return;
  broadcast({
    type: 'service_group_update',
    groupId,
    homeId: homeId ?? null,
    characteristicType,
    value,
    affectedCount,
  });
}

/**
 * Stop broadcasting events.
 */
export function teardownLocalBroadcast(): void {
  if (unsubscribe) {
    unsubscribe();
    unsubscribe = null;
  }
  if (observationKeepAlive) {
    clearInterval(observationKeepAlive);
    observationKeepAlive = null;
  }
}
