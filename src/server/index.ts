/**
 * Server module exports.
 *
 * This module handles the WebSocket connection to the Homecast server.
 * Works in two modes:
 * - Relay mode (Mac app): Relays HomeKit data to/from the server
 * - Browser mode: Receives updates from server (sourced from remote relay)
 */

export { serverConnection } from './connection';
export type { ServerConnectionState, SubscriptionScope } from './connection';
export { ServerWebSocket } from './websocket';
export type {
  BroadcastMessage,
  CharacteristicUpdate,
  ReachabilityUpdate,
  ServiceGroupUpdate,
  SubscriptionInvalidated,
} from './websocket';
