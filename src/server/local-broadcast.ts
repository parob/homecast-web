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
import { isCommunity } from '../lib/config';

let unsubscribe: (() => void) | null = null;

/**
 * Start broadcasting HomeKit events to external clients.
 * Called once when the web app starts in Community mode on the relay Mac.
 */
export function initLocalBroadcast(): void {
  if (!isCommunity) return;

  const w = window as Window & {
    isHomeKitRelayCapable?: boolean;
    __localserver_broadcast?: (message: unknown) => void;
  };

  if (!w.isHomeKitRelayCapable) return;

  console.log('[LocalBroadcast] Initializing event broadcasting');

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
}
