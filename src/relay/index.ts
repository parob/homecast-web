/**
 * Relay module exports.
 *
 * This module contains relay-specific functionality for the Mac app:
 * - HomeKit native bridge access
 * - isRelayCapable() check
 * - Local HomeKit action handler
 *
 * For server connection (used by both relay and browser modes),
 * import from '@/server' instead.
 */

// Relay-specific exports (Mac app only)
export { HomeKit, isRelayCapable } from '../native/homekit-bridge';
export type {
  HomeKitHome,
  HomeKitRoom,
  HomeKitZone,
  HomeKitServiceGroup,
  HomeKitAccessory,
  HomeKitService,
  HomeKitCharacteristic,
  HomeKitScene,
  HomeKitEvent,
  HomeKitError,
} from '../native/homekit-bridge';

// Re-export from server for backwards compatibility
// TODO: Update imports to use '@/server' directly
export { serverConnection as relayManager } from '../server/connection';
export { ServerWebSocket as RelayWebSocket } from '../server/websocket';
export type { BroadcastMessage, CharacteristicUpdate, ReachabilityUpdate, ServiceGroupUpdate } from '../server/websocket';
