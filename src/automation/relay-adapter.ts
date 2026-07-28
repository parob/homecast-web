// Automation Engine - Relay Adapter
// Bridges the automation engine to the existing relay infrastructure
// Creates HomeKitBridge and SyncTransport adapters

import HomeKit from '../native/homekit-bridge';
import type { HomeKitEvent } from '../native/homekit-bridge';
import type { HomeKitBridge } from './engine/ActionExecutor';
import type { SyncTransport } from './sync/AutomationSyncManager';

/**
 * Tells everyone else about a write the automation engine just made.
 *
 * HomeKit fires no observer for a write the relay itself initiated, and engine
 * actions deliberately bypass the relay's action handler (so an automation
 * cannot feed itself its own output). The consequence was that an
 * automation-driven change was announced to nobody: no event to the cloud, so
 * no broadcast to web/iOS clients and no MQTT publish. Apps only caught up when
 * something else happened to notice — a device independently reporting, or a
 * cache expiring — which is why lights changed by an automation took so long to
 * appear, while the same change made from Apple Home showed up at once.
 */
export interface RelayWritePublisher {
  characteristic(accessoryId: string, characteristicType: string, value: unknown): void;
  serviceGroup(groupId: string, characteristicType: string, value: unknown, homeId?: string): void;
}

/**
 * Creates a HomeKitBridge adapter that wraps the native HomeKit bridge.
 * Used by the ActionExecutor to control devices.
 *
 * `publish` is optional so tests and any caller with nothing to notify can omit
 * it; production should always pass one.
 */
export function createHomeKitBridgeAdapter(publish?: RelayWritePublisher): HomeKitBridge {
  return {
    async setCharacteristic(accessoryId: string, characteristicType: string, value: unknown) {
      await HomeKit.setCharacteristic(accessoryId, characteristicType, value);
      // After the await: only announce what actually landed.
      publish?.characteristic(accessoryId, characteristicType, value);
    },

    async setServiceGroup(groupId: string, characteristicType: string, value: unknown, homeId?: string) {
      await HomeKit.setServiceGroupCharacteristic(groupId, characteristicType, value, homeId);
      publish?.serviceGroup(groupId, characteristicType, value, homeId);
    },

    async executeScene(sceneId: string, _homeId?: string) {
      await HomeKit.executeScene(sceneId);
      // A scene changes an unknown set of accessories, so there is nothing
      // specific to announce; clients pick it up from HomeKit's own events.
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
