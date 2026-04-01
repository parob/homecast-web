/**
 * Community mode: broadcasts HomeKit events to all connected external clients.
 *
 * Subscribes to HomeKit events (characteristic changes, reachability) via the
 * native bridge and sends them to external WebSocket clients through the
 * Swift LocalNetworkBridge.
 *
 * This runs inside the Mac app's WKWebView — NOT in external browsers.
 */

import { HomeKit } from '../native/homekit-bridge';
import { isCommunity, isClientMode } from '../lib/config';

let unsubscribe: (() => void) | null = null;
let observationKeepAlive: ReturnType<typeof setInterval> | null = null;

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
    HomeKit.resetObservationTimeout().catch(() => {});
  }, 60_000);

  unsubscribe = HomeKit.onEvent((event) => {
    const broadcast = w.__localserver_broadcast;
    if (!broadcast) return;

    if (event.type === 'characteristic.updated' && event.characteristicType) {
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
