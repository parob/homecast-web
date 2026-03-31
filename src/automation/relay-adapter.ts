// Automation Engine - Relay Adapter
// Bridges the automation engine to the existing relay infrastructure
// Creates HomeKitBridge and SyncTransport adapters

import HomeKit from '../native/homekit-bridge';
import type { HomeKitEvent } from '../native/homekit-bridge';
import type { HomeKitBridge } from './engine/ActionExecutor';
import type { SyncTransport } from './sync/AutomationSyncManager';

/**
 * Creates a HomeKitBridge adapter that wraps the native HomeKit bridge.
 * Used by the ActionExecutor to control devices.
 */
export function createHomeKitBridgeAdapter(): HomeKitBridge {
  return {
    async setCharacteristic(accessoryId: string, characteristicType: string, value: unknown) {
      await HomeKit.setCharacteristic(accessoryId, characteristicType, value);
    },

    async setServiceGroup(groupId: string, characteristicType: string, value: unknown, homeId?: string) {
      await HomeKit.setServiceGroupCharacteristic(groupId, characteristicType, value, homeId);
    },

    async executeScene(sceneId: string, _homeId?: string) {
      await HomeKit.executeScene(sceneId);
    },
  };
}

// Handler registry for incoming automation messages from server
type MessageHandler = (payload: Record<string, unknown>) => void;
const automationHandlers = new Map<string, Set<MessageHandler>>();

/**
 * Creates a SyncTransport adapter that wraps the ServerWebSocket.
 * Used by AutomationSyncManager for bidirectional sync.
 *
 * @param sendFn - function to send messages to the server (wraps sendEvent)
 * @param requestFn - function to make request/response calls to the server
 */
export function createSyncTransport(
  sendFn: (type: string, payload: Record<string, unknown>) => void,
  requestFn: (action: string, payload?: Record<string, unknown>) => Promise<unknown>,
): SyncTransport {
  return {
    sendMessage(type: string, payload: Record<string, unknown>): void {
      sendFn(type, payload);
    },

    onMessage(type: string, handler: (payload: Record<string, unknown>) => void): () => void {
      let handlers = automationHandlers.get(type);
      if (!handlers) {
        handlers = new Set();
        automationHandlers.set(type, handlers);
      }
      handlers.add(handler);
      return () => {
        handlers!.delete(handler);
        if (handlers!.size === 0) automationHandlers.delete(type);
      };
    },

    request: requestFn,
  };
}

/**
 * Dispatch an incoming automation message from the server to registered handlers.
 * Called from the WebSocket message handler.
 */
export function dispatchAutomationMessage(type: string, payload: Record<string, unknown>): void {
  const handlers = automationHandlers.get(type);
  if (handlers) {
    for (const handler of handlers) {
      try {
        handler(payload);
      } catch (e) {
        console.error(`[RelayAdapter] Handler error for ${type}:`, e);
      }
    }
  }
}

/**
 * Clear all registered automation message handlers.
 * Called on engine teardown.
 */
export function clearAutomationHandlers(): void {
  automationHandlers.clear();
}
