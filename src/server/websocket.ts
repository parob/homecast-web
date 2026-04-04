/**
 * WebSocket client for server communication.
 *
 * In relay mode (Mac app): Connects to server, receives requests, handles them via local HomeKit
 * In browser mode: Connects to server, sends requests (routed to remote relay), receives broadcasts
 */

import { HomeKit, HomeKitEvent, isRelayCapable, isRelayEnabled } from '../native/homekit-bridge';
import { executeHomeKitAction, setAccessoryLimit as setLocalHandlerAccessoryLimit, isAccessoryAllowed } from '../relay/local-handler';
import { invalidateHomeKitCache } from '../hooks/useHomeKitData';
import type { RequestTrace, TraceStep } from '../lib/types/trace';
import { config as appConfig } from '../lib/config';
import { browserLogger } from '../lib/browser-logger';
import { initAutomationEngine, teardownAutomationEngine } from '../automation';
import { createHomeKitBridgeAdapter, createSyncTransport, dispatchAutomationMessage, clearAutomationHandlers } from '../automation/relay-adapter';

// Protocol message types
interface ProtocolMessage {
  id: string;
  type: 'request' | 'response' | 'event';
  action: string;
  payload?: Record<string, unknown>;
  error?: {
    code: string;
    message: string;
  };
  _trace?: RequestTrace;
}

/**
 * Error class that preserves the error code and request trace from the server.
 * Thrown by serverConnection.request() on failure.
 */
export class HomecastError extends Error {
  code: string;
  trace: RequestTrace | null;

  constructor(code: string, message: string, trace?: RequestTrace | null) {
    super(message);
    this.name = 'HomecastError';
    this.code = code;
    this.trace = trace ?? null;
  }
}

interface ServerConfig {
  token: string;
  deviceId: string;
  deviceName: string;
  browserSessionId?: string; // Per-tab session ID for web clients
  wsUrl?: string;
}

type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'reconnecting';

// Broadcast message types from server
export interface CharacteristicUpdate {
  type: 'characteristic_update';
  accessoryId: string;
  homeId?: string | null;
  characteristicType: string;
  value: unknown;
}

export interface ReachabilityUpdate {
  type: 'reachability_update';
  accessoryId: string;
  isReachable: boolean;
}

export interface ServiceGroupUpdate {
  type: 'service_group_update';
  groupId: string;
  homeId: string | null;
  characteristicType: string;
  value: unknown;
  affectedCount: number;
}

export interface SubscriptionInvalidated {
  type: 'subscription_invalidated';
  scope: { type: string; id: string };
  reason: string;
}

export interface RelayStatusUpdate {
  type: 'relay_status_update';
  homeId: string;
  connected: boolean;
}

export interface SettingsUpdated {
  type: 'settings_updated';
}

export interface EnrollmentCancelled {
  type: 'enrollment_cancelled';
  homeName: string;
}

export type BroadcastMessage =
  | CharacteristicUpdate
  | ReachabilityUpdate
  | ServiceGroupUpdate
  | SubscriptionInvalidated
  | RelayStatusUpdate
  | SettingsUpdated
  | EnrollmentCancelled;

interface ServerWebSocketCallbacks {
  onStateChange?: (state: ConnectionState) => void;
  onError?: (error: Error) => void;
  onBroadcast?: (message: BroadcastMessage) => void;
  onConnected?: () => void;
  onRelayStatusChange?: (isActiveRelay: boolean) => void;
}

// Pending request tracking
interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
}

// Reconnection settings
const INITIAL_RECONNECT_DELAY = 1000;
const MAX_RECONNECT_DELAY = 30000;
const RECONNECT_MULTIPLIER = 1.5;
const HEARTBEAT_INTERVAL = 30000;
const REQUEST_TIMEOUT = 30000; // 30 second timeout for requests

/**
 * WebSocket client for server communication.
 * Handles the PROTOCOL.md message format for both relay and browser modes.
 */
export class ServerWebSocket {
  private config: ServerConfig;
  private callbacks: ServerWebSocketCallbacks;
  private ws: WebSocket | null = null;
  private state: ConnectionState = 'disconnected';
  private reconnectDelay = INITIAL_RECONNECT_DELAY;
  private reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
  private heartbeatInterval: ReturnType<typeof setInterval> | null = null;
  private heartbeatVisibilityHandler: (() => void) | null = null;
  private eventUnsubscribe: (() => void) | null = null;
  private isManualDisconnect = false;
  private pendingRequests = new Map<string, PendingRequest>();
  private requestIdCounter = 0;
  private connectionOpenedAt: number | null = null;
  private lastConnectionDuration: number | null = null;

  // Activity tracking — rolling 60-minute window, one bucket per minute
  private activityBuckets: number[] = new Array(60).fill(0);
  private activityBucketMinute = -1; // Unix minute of the latest bucket

  // Subscriber tracking - relay only sends events if there are subscribers
  private webClientsListening = false;
  private webhooksActive = false;
  private webClientCount = 0;
  private webhookCount = 0;
  private subscriptionCount = 0;

  // Account limits - null means unlimited (standard), number means limit (free)
  private accessoryLimit: number | null = null;

  // Connection uptime tracking
  private connectedAt: number | null = null;

  // Relay status — server-controlled runtime state (not the same as isRelayCapable())
  private isActiveRelay = false;
  // Owned home IDs — cached from homes.list response for routing decisions
  private ownedHomeIds = new Set<string>();
  private relayAssignmentTimeout: ReturnType<typeof setTimeout> | null = null;
  // Debounce timer for homes.updated events (homeManagerDidUpdateHomes can fire multiple times)
  private homesUpdatedDebounce: ReturnType<typeof setTimeout> | null = null;

  constructor(config: ServerConfig, callbacks: ServerWebSocketCallbacks = {}) {
    this.config = {
      ...config,
      wsUrl: config.wsUrl || appConfig.wsUrl,
    };
    this.callbacks = callbacks;
  }

  /**
   * Get current connection state
   */
  getState(): ConnectionState {
    return this.state;
  }

  /**
   * Whether this device is currently the active relay (server-controlled).
   */
  isCurrentlyActiveRelay(): boolean {
    return this.isActiveRelay;
  }

  /**
   * Connect to the WebSocket server
   */
  connect(): void {
    if (this.ws && (this.state === 'connected' || this.state === 'connecting')) {
      console.log('[ServerWS] Already connected or connecting');
      return;
    }

    this.isManualDisconnect = false;
    this.setState('connecting');
    this.establishConnection();
  }

  /**
   * Disconnect from the WebSocket server
   */
  disconnect(): void {
    this.isManualDisconnect = true;
    this.cleanup();
    this.setState('disconnected');
  }

  /**
   * Request to become the active relay (only valid for standby relay-capable devices).
   */
  claimRelay(): void {
    if (!isRelayCapable() || this.isActiveRelay) return;

    this.sendEvent({
      id: `evt_${Date.now()}_relay_claim`,
      type: 'event',
      action: 'relay.claim',
      payload: {},
    });
  }

  /**
   * Graceful reconnect - close and immediately reconnect without backoff.
   * Used when server requests reconnect (e.g., Cloud Run timeout approaching).
   */
  private gracefulReconnect(): void {
    // Clean up current connection
    this.cleanup();

    // Reset backoff delay for immediate reconnect
    this.reconnectDelay = INITIAL_RECONNECT_DELAY;

    // Reconnect immediately
    this.setState('reconnecting');
    this.establishConnection();
  }

  /**
   * Make a request - either locally (relay mode) or over WebSocket (browser mode).
   * In relay mode: loopback path, handled locally via native bridge.
   * In browser mode: sent over WebSocket to server, which routes to connected relay.
   */
  async request<T = unknown>(action: string, payload: Record<string, unknown> = {}): Promise<T> {
    // Check if we are the active relay — handle locally via native bridge
    // Standby relay-capable devices send requests over WebSocket like browsers
    // homes.list always goes through the server for cloud-managed home deduplication
    // Non-owned homes (shared/cloud-managed) must route through server to reach the correct relay
    const homeId = payload.homeId as string | undefined;

    // For relay-capable devices, wait for relay assignment before deciding routing.
    // Without this, requests sent before relay_status arrives go through the server,
    // which can cause a self-routing deadlock (server blocks reading relay's response).
    if (!this.isActiveRelay && isRelayEnabled() && action !== 'homes.list' && this.relayAssignmentTimeout !== null) {
      await this.waitForRelayAssignment(5000);
    }

    const isOwnedHome = !homeId || this.ownedHomeIds.has(homeId.toUpperCase());
    if (this.isActiveRelay && action !== 'homes.list' && isOwnedHome) {
      if (import.meta.env.DEV) console.log(`[ServerWS] Local request: ${action}`, payload);
      try {
        const result = await executeHomeKitAction(action, payload);
        if (import.meta.env.DEV) console.log(`[ServerWS] Local response: ${action}`, result);

        // After successful write operations, send event to server and update local UI
        // Same logic as handleIncomingRequest for consistency
        if (action === 'characteristic.set') {
          // Look up accessory context for subscription filtering
          let homeId = payload.homeId as string | undefined;
          let roomId: string | undefined;
          try {
            const { accessory } = await executeHomeKitAction('accessory.get', { accessoryId: payload.accessoryId }) as any;
            homeId = homeId || accessory?.homeId;
            roomId = accessory?.roomId;
          } catch { /* use whatever context we have */ }
          // Send event to server for broadcasting to web clients
          this.sendEvent({
            id: `evt_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`,
            type: 'event',
            action: 'characteristic.updated',
            payload: {
              accessoryId: payload.accessoryId,
              characteristicType: payload.characteristicType,
              value: payload.value,
              ...(homeId && { homeId }),
              ...(roomId && { roomId }),
            },
          });
          // Also update local UI
          this.callbacks.onBroadcast?.({
            type: 'characteristic_update',
            accessoryId: payload.accessoryId as string,
            homeId: homeId ?? null,
            characteristicType: payload.characteristicType as string,
            value: payload.value,
          });
        } else if (action === 'serviceGroup.set') {
          const resultObj = result as { affectedCount?: number } | undefined;
          const affectedCount = resultObj?.affectedCount ?? 0;
          // Send event to server for broadcasting to web clients
          // Include homeId for proper subscription filtering
          this.sendEvent({
            id: `evt_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`,
            type: 'event',
            action: 'serviceGroup.updated',
            payload: {
              groupId: payload.groupId,
              characteristicType: payload.characteristicType,
              value: payload.value,
              affectedCount,
              ...(payload.homeId && { homeId: payload.homeId }),
            },
          });
          // Also update local UI
          this.callbacks.onBroadcast?.({
            type: 'service_group_update',
            groupId: payload.groupId as string,
            homeId: (payload.homeId as string) ?? null,
            characteristicType: payload.characteristicType as string,
            value: payload.value,
            affectedCount,
          });
        } else if (action === 'state.set') {
          // Broadcast each successful change using resolved UUIDs from the result
          const changes = (result as any)?.changes as Array<{ accessoryId: string; characteristicType: string; value: unknown }> | undefined;
          if (changes) {
            for (const change of changes) {
              this.sendEvent({
                id: `evt_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`,
                type: 'event',
                action: 'characteristic.updated',
                payload: {
                  accessoryId: change.accessoryId,
                  characteristicType: change.characteristicType,
                  value: change.value,
                  ...(homeId && { homeId }),
                },
              });
              this.callbacks.onBroadcast?.({
                type: 'characteristic_update',
                accessoryId: change.accessoryId,
                homeId: homeId ?? null,
                characteristicType: change.characteristicType,
                value: change.value,
              });
            }
          }
        }

        return result as T;
      } catch (error) {
        console.error(`[ServerWS] Local request failed: ${action}`, error);
        throw error;
      }
    }

    // Browser mode / server-routed request - send over WebSocket
    if (import.meta.env.DEV) console.log(`[ServerWS] Remote request: ${action}`, payload);

    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error('WebSocket not connected');
    }

    const id = `req_${Date.now()}_${++this.requestIdCounter}`;

    const promise = new Promise<T>((resolve, reject) => {
      // Set up timeout
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new HomecastError('TIMEOUT', `Request timed out: ${action}`));
      }, REQUEST_TIMEOUT);

      // Store pending request
      this.pendingRequests.set(id, {
        resolve: resolve as (value: unknown) => void,
        reject,
        timeout,
      });

      // Send request
      const message: ProtocolMessage = {
        id,
        type: 'request',
        action,
        payload,
      };
      this.send(message);
    });

    // Cache owned home IDs from homes.list response for relay routing decisions
    if (action === 'homes.list') {
      return promise.then((result) => {
        const homes = (result as { homes?: Array<{ id: string; role?: string }> })?.homes;
        if (homes) {
          this.ownedHomeIds = new Set(
            homes.filter(h => h.role === 'owner').map(h => h.id.toUpperCase())
          );
        }
        return result;
      });
    }

    return promise;
  }

  private setState(newState: ConnectionState): void {
    if (this.state !== newState) {
      console.log(`[ServerWS] State: ${this.state} -> ${newState}`);
      this.state = newState;
      if (newState === 'connected') {
        this.connectedAt = Date.now();
      } else if (newState === 'disconnected') {
        this.connectedAt = null;
      }
      this.callbacks.onStateChange?.(newState);
    }
  }

  /**
   * Get the timestamp when the connection was established.
   */
  getConnectedAt(): number | null {
    return this.connectedAt;
  }

  /**
   * Record one unit of WebSocket activity in the current minute bucket.
   */
  private recordActivity(): void {
    const now = Math.floor(Date.now() / 60000); // current Unix minute
    if (this.activityBucketMinute === -1) {
      // First activity ever — initialise
      this.activityBucketMinute = now;
      this.activityBuckets[59] = 1;
      return;
    }
    const elapsed = now - this.activityBucketMinute;
    if (elapsed === 0) {
      // Same minute — just increment
      this.activityBuckets[59]++;
    } else if (elapsed > 0) {
      // Time has advanced — shift left, zero-fill new slots
      const shift = Math.min(elapsed, 60);
      if (shift >= 60) {
        this.activityBuckets.fill(0);
      } else {
        this.activityBuckets.copyWithin(0, shift);
        this.activityBuckets.fill(0, 60 - shift);
      }
      this.activityBucketMinute = now;
      this.activityBuckets[59] = 1;
    }
  }

  /**
   * Get per-minute message counts for the last 60 minutes.
   * Index 0 = 59 minutes ago, index 59 = current minute.
   */
  getActivityHistory(): number[] {
    // Advance buckets to current time so idle gaps show as zeros
    if (this.activityBucketMinute !== -1) {
      const now = Math.floor(Date.now() / 60000);
      const elapsed = now - this.activityBucketMinute;
      if (elapsed > 0) {
        const shift = Math.min(elapsed, 60);
        if (shift >= 60) {
          this.activityBuckets.fill(0);
        } else {
          this.activityBuckets.copyWithin(0, shift);
          this.activityBuckets.fill(0, 60 - shift);
        }
        this.activityBucketMinute = now;
      }
    }
    return [...this.activityBuckets];
  }

  private establishConnection(): void {
    try {
      const url = new URL(this.config.wsUrl!);
      // Add auth token as query parameter (server expects this)
      url.searchParams.set('token', this.config.token);
      url.searchParams.set('device_id', this.config.deviceId);
      url.searchParams.set('device_name', this.config.deviceName);
      // Register as 'device' if we can relay HomeKit and relay is enabled, otherwise 'web' client
      url.searchParams.set('client_type', isRelayEnabled() ? 'device' : 'web');
      // Explicitly identify as a HomeKit relay
      if (isRelayEnabled()) {
        url.searchParams.set('relay', 'true');
      }
      // Add browser session ID for web clients (allows multiple tabs as separate sessions)
      if (this.config.browserSessionId) {
        url.searchParams.set('browser_session_id', this.config.browserSessionId);
      }

      console.log(`[ServerWS] Connecting to ${url.host}...`);
      console.log(`[ServerWS] Token: ${this.config.token ? this.config.token.substring(0, 20) + '...' : 'MISSING'}`);
      console.log(`[ServerWS] Device ID: ${this.config.deviceId}`);
      if (this.config.browserSessionId) {
        console.log(`[ServerWS] Browser Session ID: ${this.config.browserSessionId}`);
      }
      console.log(`[ServerWS] Client type: ${isRelayEnabled() ? 'device (relay)' : 'web (browser)'}`);
      this.ws = new WebSocket(url.toString());

      this.ws.onopen = this.handleOpen.bind(this);
      this.ws.onmessage = this.handleMessage.bind(this);
      this.ws.onerror = this.handleError.bind(this);
      this.ws.onclose = this.handleClose.bind(this);
    } catch (error) {
      console.error('[ServerWS] Connection error:', error);
      this.callbacks.onError?.(error instanceof Error ? error : new Error(String(error)));
      this.scheduleReconnect();
    }
  }

  private handleOpen(): void {
    console.log('[ServerWS] Connected');
    this.setState('connected');
    this.connectionOpenedAt = Date.now();
    // Only reset backoff if previous connection was stable (lasted > 5s)
    // This prevents rapid reconnect loops when the server crashes immediately after connecting
    if (this.lastConnectionDuration === null || this.lastConnectionDuration > 5000) {
      this.reconnectDelay = INITIAL_RECONNECT_DELAY;
    }

    // Start heartbeat
    this.startHeartbeat();

    // For relay-enabled devices: wait for server's relay_status message before starting relay duties.
    // Fallback: if server doesn't send relay_status within 3s, assume active relay (backward compat).
    if (isRelayEnabled()) {
      this.relayAssignmentTimeout = setTimeout(() => {
        if (!this.isActiveRelay && this.state === 'connected') {
          console.log('[ServerWS] No relay_status received, assuming active relay (legacy server)');
          this.isActiveRelay = true;
          this.startRelayDuties();
          this.callbacks.onRelayStatusChange?.(true);
        }
      }, 3000);
    }
  }

  /**
   * Start relay duties — subscribe to HomeKit events, start observation, declare homes.
   */
  private startRelayDuties(): void {
    if (!isRelayEnabled()) return;

    this.subscribeToHomeKitEvents();

    // Initialize automation engine
    initAutomationEngine({
      bridge: createHomeKitBridgeAdapter(),
      transport: createSyncTransport(
        // sendFn: sends automation messages to server
        (type, payload) => {
          this.sendEvent({
            id: `evt_${Date.now()}_auto`,
            type: 'automation',
            action: type,
            payload,
          });
        },
        // requestFn: makes request/response calls to server
        (action, payload) => this.request(action, payload),
      ),
      subscribeToHomeKit: (handler) => HomeKit.onEvent(handler),
      onNotify: async (message, title, data) => {
        this.sendEvent({
          id: `evt_${Date.now()}_notify`,
          type: 'automation',
          action: 'automation.notify',
          payload: { message, title, data },
        });
      },
    }).catch((err) => {
      console.error('[ServerWS] Failed to init automation engine:', err);
    });

    HomeKit.startObserving().catch((err) => {
      console.error('[ServerWS] Failed to start HomeKit observation:', err);
    });

    HomeKit.listHomes().then((homes) => {
      this.sendEvent({
        id: `evt_${Date.now()}_relay_homes`,
        type: 'event',
        action: 'relay.homes',
        payload: { homes },
      });
      console.log(`[ServerWS] Declared ${homes.length} relay homes to server`);
    }).catch((err) => {
      console.error('[ServerWS] Failed to declare relay homes:', err);
    });
  }

  /**
   * Stop relay duties — unsubscribe from HomeKit events, stop observation.
   */
  private stopRelayDuties(): void {
    if (!isRelayCapable()) return;

    this.eventUnsubscribe?.();
    this.eventUnsubscribe = null;

    if (this.homesUpdatedDebounce) {
      clearTimeout(this.homesUpdatedDebounce);
      this.homesUpdatedDebounce = null;
    }

    // Teardown automation engine
    teardownAutomationEngine();
    clearAutomationHandlers();

    HomeKit.stopObserving().catch(() => {});
  }

  private handleMessage(event: MessageEvent): void {
    this.recordActivity();
    try {
      const message = JSON.parse(event.data);
      browserLogger.logWsReceive(
        `${message.type}${message.action ? ':' + message.action : ''}`,
        message.id
      );

      if (message.type === 'request') {
        // Incoming request from server (only in relay mode)
        this.handleIncomingRequest(message as ProtocolMessage);
      } else if (message.type === 'response') {
        // Response to our outgoing request
        this.handleResponse(message as ProtocolMessage);
      } else if (message.type === 'characteristic_update' ||
                 message.type === 'reachability_update' ||
                 message.type === 'service_group_update' ||
                 message.type === 'relay_status_update' ||
                 message.type === 'settings_updated' ||
                 message.type === 'enrollment_cancelled' ||
                 message.type === 'auth_required') {
        // Broadcast messages from server - forward to callback
        this.callbacks.onBroadcast?.(message as BroadcastMessage);
      } else if (message.type === 'subscription_invalidated') {
        // Subscription was invalidated by server - forward to callback
        this.callbacks.onBroadcast?.(message as BroadcastMessage);
      } else if (message.type === 'connected') {
        // Server connection info - connection is now fully established
        console.log(`[ServerWS] Server info: instance=${message.serverInstanceId}, pubsub=${message.pubsubEnabled}`);
        this.callbacks.onConnected?.();
      } else if (message.type === 'ping') {
        // Server ping - respond with pong
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
          this.ws.send(JSON.stringify({ type: 'pong' }));
        }
        // Server includes listener status in ping payload for relay devices
        const pingPayload = message.payload as { webClientsListening?: boolean; webClientCount?: number } | undefined;
        if (pingPayload?.webClientsListening !== undefined) {
          this.webClientsListening = pingPayload.webClientsListening;
        }
        if (pingPayload?.webClientCount !== undefined) {
          this.webClientCount = pingPayload.webClientCount;
        }
      } else if (message.type === 'pong') {
        // Response to our ping - connection is alive
      } else if (message.type === 'reconnect') {
        // Server requesting graceful reconnect (Cloud Run timeout approaching)
        console.log('[ServerWS] Server requested reconnect, refreshing connection...');
        this.gracefulReconnect();
      } else if (message.type === 'config') {
        // Server config update - track subscriber status and account limits
        const payload = message.payload as { webClientsListening?: boolean; webhooksActive?: boolean; webClientCount?: number; webhookCount?: number; subscriptionCount?: number; accessoryLimit?: number | null } | undefined;
        if (payload?.webClientsListening !== undefined) {
          this.webClientsListening = payload.webClientsListening;
        }
        if (payload?.webhooksActive !== undefined) {
          this.webhooksActive = payload.webhooksActive;
        }
        if (payload?.webClientCount !== undefined) {
          this.webClientCount = payload.webClientCount;
        }
        if (payload?.webhookCount !== undefined) {
          this.webhookCount = payload.webhookCount;
        }
        if (payload?.subscriptionCount !== undefined) {
          this.subscriptionCount = payload.subscriptionCount;
        }
        if (payload?.accessoryLimit !== undefined) {
          this.accessoryLimit = payload.accessoryLimit;
          // Push to local-handler immediately so filtering is active before first fetch
          if (isRelayCapable()) {
            setLocalHandlerAccessoryLimit(payload.accessoryLimit);
            invalidateHomeKitCache('accessories', { prefix: true });
          }
        }
        if (import.meta.env.DEV) console.log(`[ServerWS] Subscribers: clients=${this.webClientCount}, webhooks=${this.webhookCount}, subs=${this.subscriptionCount}, accessoryLimit=${this.accessoryLimit}`);
      } else if (message.type === 'relay_status') {
        // Server telling us our relay status (active or standby)
        const payload = message.payload as { isActiveRelay: boolean } | undefined;
        if (payload?.isActiveRelay !== undefined) {
          const wasActive = this.isActiveRelay;
          this.isActiveRelay = payload.isActiveRelay;

          // Clear the fallback timeout since we got a real assignment
          if (this.relayAssignmentTimeout) {
            clearTimeout(this.relayAssignmentTimeout);
            this.relayAssignmentTimeout = null;
          }

          console.log(`[ServerWS] Relay status: isActiveRelay=${this.isActiveRelay}`);

          if (this.isActiveRelay && !wasActive) {
            this.startRelayDuties();
          } else if (!this.isActiveRelay && wasActive) {
            this.stopRelayDuties();
          }

          this.callbacks.onRelayStatusChange?.(this.isActiveRelay);
        }
      } else if (message.type?.startsWith('automation.')) {
        // Automation engine sync messages from server
        const payload = message.payload as Record<string, unknown> | undefined;
        if (payload) {
          dispatchAutomationMessage(message.type, payload);
        }
      }
    } catch (error) {
      console.error('[ServerWS] Failed to parse message:', error);
    }
  }

  private handleResponse(message: ProtocolMessage): void {
    const pending = this.pendingRequests.get(message.id);
    if (!pending) {
      console.log(`[ServerWS] Received response for unknown request: ${message.id}`);
      return;
    }

    // Clear timeout and remove from pending
    clearTimeout(pending.timeout);
    this.pendingRequests.delete(message.id);

    if (message.error) {
      console.error(`[ServerWS] Request failed: ${message.action}`, message.error);
      pending.reject(new HomecastError(message.error.code, message.error.message, message._trace));
    } else {
      if (import.meta.env.DEV) console.log(`[ServerWS] Response received: ${message.action}`, message.payload);
      pending.resolve(message.payload);
    }
  }

  private handleError(event: Event): void {
    console.error('[ServerWS] WebSocket error:', event);
    this.callbacks.onError?.(new Error('WebSocket connection error'));
  }

  private handleClose(event: CloseEvent): void {
    console.log(`[ServerWS] Connection closed: ${event.code} ${event.reason}`);
    // Track how long the connection lasted (for backoff stability detection)
    if (this.connectionOpenedAt) {
      this.lastConnectionDuration = Date.now() - this.connectionOpenedAt;
      this.connectionOpenedAt = null;
    }

    // Reject all pending requests
    for (const [, pending] of this.pendingRequests) {
      clearTimeout(pending.timeout);
      pending.reject(new HomecastError('DISCONNECTED', 'WebSocket connection closed'));
    }
    this.pendingRequests.clear();

    this.cleanup();

    if (this.isManualDisconnect) {
      this.setState('disconnected');
      return;
    }

    // 4001: Auth failed — attempt token refresh before giving up
    if (event.code === 4001) {
      this.attemptTokenRefresh();
      return;
    }

    // Don't reconnect if:
    // - 4002: Replaced by new connection (another tab/instance took over, or HMR reload)
    // - 4003: Session expired
    const noReconnectCodes = [4002, 4003];
    if (noReconnectCodes.includes(event.code)) {
      if (event.code === 4002) {
        console.log('[ServerWS] Connection replaced - not reconnecting');
      }
      this.setState('disconnected');
    } else {
      this.setState('reconnecting');
      this.scheduleReconnect();
    }
  }

  /**
   * Attempt to refresh an expired JWT token via the server's /auth/refresh endpoint.
   * If successful, updates the stored token and reconnects.
   * If failed, transitions to disconnected state.
   */
  private async attemptTokenRefresh(): Promise<void> {
    console.log('[ServerWS] Token expired, attempting refresh...');
    this.setState('reconnecting');

    try {
      const response = await fetch(`${appConfig.apiUrl}/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: this.config.token }),
      });

      if (!response.ok) {
        console.log('[ServerWS] Token refresh failed, auth required');
        this.setState('disconnected');
        return;
      }

      const data = await response.json();
      if (!data.token) {
        console.log('[ServerWS] Token refresh returned no token');
        this.setState('disconnected');
        return;
      }

      console.log('[ServerWS] Token refreshed successfully');
      // Update the connection config with the new token
      this.config.token = data.token;
      // Persist to localStorage so it survives page reloads
      localStorage.setItem('homecast-token', data.token);
      // Notify Mac app via bridge so Keychain stays in sync
      const win = window as Window & { webkit?: { messageHandlers?: { homecast?: { postMessage: (msg: { action: string; token?: string }) => void } } } };
      if (win.webkit?.messageHandlers?.homecast) {
        win.webkit.messageHandlers.homecast.postMessage({ action: 'login', token: data.token });
      }
      // Reconnect with the fresh token
      this.reconnectDelay = INITIAL_RECONNECT_DELAY;
      this.establishConnection();
    } catch (error) {
      console.error('[ServerWS] Token refresh error:', error);
      // Network error — schedule a retry (the server might be down)
      this.scheduleReconnect();
    }
  }

  private async handleIncomingRequest(message: ProtocolMessage): Promise<void> {
    // During the brief window between WebSocket open and relay_status message,
    // the server may route requests to us before we know we're the active relay.
    // If we're relay-capable and still waiting for assignment, wait briefly.
    if (!this.isActiveRelay) {
      if (isRelayCapable() && this.relayAssignmentTimeout !== null) {
        const assigned = await this.waitForRelayAssignment(5000);
        if (!assigned) {
          this.sendErrorResponse(message.id, message.action, 'NOT_ACTIVE_RELAY', 'This device is not the active relay');
          return;
        }
      } else {
        this.sendErrorResponse(message.id, message.action, 'NOT_ACTIVE_RELAY', 'This device is not the active relay');
        return;
      }
    }
    if (import.meta.env.DEV) console.log(`[ServerWS] Handling incoming request: ${message.action} (${message.id})`);

    // Extract _trace from incoming message for relay-side enrichment
    const trace = message._trace;
    const t0 = Date.now();

    try {
      // Add HomeKit call step to trace
      if (trace) {
        const elapsed = Date.now() - t0;
        trace.steps.push({
          name: 'homekit_call',
          status: 'ok',
          ms: trace.totalMs + elapsed,
          detail: message.action,
        });
      }

      const result = await executeHomeKitAction(message.action, message.payload || {});

      // Update trace with completed homekit_call timing
      if (trace) {
        const homekitStep = trace.steps[trace.steps.length - 1];
        if (homekitStep && homekitStep.name === 'homekit_call') {
          homekitStep.ms = trace.totalMs + (Date.now() - t0);
        }
      }

      this.sendResponse(message.id, message.action, result, trace);

      // After successful write operations, send an event so the server broadcasts to web clients
      // HomeKit doesn't fire events back to the app that made the change, so we do it manually
      // Also trigger local onBroadcast so the Mac relay's own UI updates
      if (message.action === 'characteristic.set') {
        const payload = message.payload || {};
        // Look up accessory context for subscription filtering
        let homeId = payload.homeId as string | undefined;
        let roomId: string | undefined;
        try {
          const { accessory } = await executeHomeKitAction('accessory.get', { accessoryId: payload.accessoryId }) as any;
          homeId = homeId || accessory?.homeId;
          roomId = accessory?.roomId;
        } catch { /* use whatever context we have */ }
        // Send event to server for broadcasting to web clients
        this.sendEvent({
          id: `evt_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`,
          type: 'event',
          action: 'characteristic.updated',
          payload: {
            accessoryId: payload.accessoryId,
            characteristicType: payload.characteristicType,
            value: payload.value,
            ...(homeId && { homeId }),
            ...(roomId && { roomId }),
          },
        });
        // Also update local UI (Mac relay)
        this.callbacks.onBroadcast?.({
          type: 'characteristic_update',
          accessoryId: payload.accessoryId as string,
          homeId: homeId ?? null,
          characteristicType: payload.characteristicType as string,
          value: payload.value,
        });
      } else if (message.action === 'serviceGroup.set') {
        const payload = message.payload || {};
        const resultObj = result as { affectedCount?: number } | undefined;
        const affectedCount = resultObj?.affectedCount ?? 0;
        // Send event to server for broadcasting to web clients
        // Include homeId for proper subscription filtering
        this.sendEvent({
          id: `evt_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`,
          type: 'event',
          action: 'serviceGroup.updated',
          payload: {
            groupId: payload.groupId,
            characteristicType: payload.characteristicType,
            value: payload.value,
            affectedCount,
            ...(payload.homeId && { homeId: payload.homeId }),
          },
        });
        // Also update local UI (Mac relay)
        this.callbacks.onBroadcast?.({
          type: 'service_group_update',
          groupId: payload.groupId as string,
          homeId: (payload.homeId as string) ?? null,
          characteristicType: payload.characteristicType as string,
          value: payload.value,
          affectedCount,
        });
      } else if (message.action === 'state.set') {
        // Broadcast each successful change using resolved UUIDs from the result
        const payload = message.payload || {};
        const homeId = payload.homeId as string | undefined;
        const changes = (result as any)?.changes as Array<{ accessoryId: string; characteristicType: string; value: unknown }> | undefined;
        if (changes) {
          for (const change of changes) {
            this.sendEvent({
              id: `evt_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`,
              type: 'event',
              action: 'characteristic.updated',
              payload: {
                accessoryId: change.accessoryId,
                characteristicType: change.characteristicType,
                value: change.value,
                ...(homeId && { homeId }),
              },
            });
            this.callbacks.onBroadcast?.({
              type: 'characteristic_update',
              accessoryId: change.accessoryId,
              homeId: homeId ?? null,
              characteristicType: change.characteristicType,
              value: change.value,
            });
          }
        }
        // Also invalidate the DataCache so group widgets and list views refresh
        invalidateHomeKitCache();
      }
    } catch (error) {
      // Swift bridge rejects with plain {code, message} objects, not Error instances.
      // Handle both cases to avoid "[object Object]" in error messages.
      let code: string;
      let errorMessage: string;
      if (error instanceof Error) {
        code = (error as { code?: string }).code || 'HOMEKIT_ERROR';
        errorMessage = error.message;
      } else if (error && typeof error === 'object' && 'code' in error) {
        const errObj = error as { code?: string; message?: string };
        code = errObj.code || 'HOMEKIT_ERROR';
        errorMessage = errObj.message || 'Unknown error';
      } else {
        code = 'HOMEKIT_ERROR';
        errorMessage = String(error);
      }

      // Update trace with failed homekit_call
      if (trace) {
        const homekitStep = trace.steps[trace.steps.length - 1];
        if (homekitStep && homekitStep.name === 'homekit_call') {
          homekitStep.status = 'fail';
          homekitStep.detail = `${code}: ${errorMessage}`;
          homekitStep.ms = trace.totalMs + (Date.now() - t0);
        }
      }

      this.sendErrorResponse(message.id, message.action, code, errorMessage, trace);
    }
  }

  private sendResponse(id: string, action: string, payload: unknown, trace?: RequestTrace | null): void {
    const response: ProtocolMessage = {
      id,
      type: 'response',
      action,
      payload: payload as Record<string, unknown>,
    };
    if (trace) {
      response._trace = trace;
    }
    this.send(response);
  }

  private sendErrorResponse(id: string, action: string, code: string, message: string, trace?: RequestTrace | null): void {
    const response: ProtocolMessage = {
      id,
      type: 'response',
      action,
      error: { code, message },
    };
    if (trace) {
      response._trace = trace;
    }
    this.send(response);
  }

  private send(message: ProtocolMessage): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.recordActivity();
      this.ws.send(JSON.stringify(message));
      browserLogger.logWsSend(
        `${message.type}${message.action ? ':' + message.action : ''}`,
        message.id
      );
    } else {
      console.warn('[ServerWS] Cannot send message - not connected');
    }
  }

  private subscribeToHomeKitEvents(): void {
    // Unsubscribe from previous if any
    this.eventUnsubscribe?.();

    this.eventUnsubscribe = HomeKit.onEvent((event: HomeKitEvent) => {
      // homes.updated: HomeKit added/removed a home. Re-declare homes to server.
      if (event.type === 'homes.updated') {
        if (this.homesUpdatedDebounce) clearTimeout(this.homesUpdatedDebounce);
        this.homesUpdatedDebounce = setTimeout(() => {
          this.homesUpdatedDebounce = null;
          HomeKit.listHomes().then((homes) => {
            this.sendEvent({
              id: `evt_${Date.now()}_relay_homes`,
              type: 'event',
              action: 'relay.homes',
              payload: { homes },
            });
            console.log(`[ServerWS] Re-declared ${homes.length} relay homes (homes.updated)`);
          }).catch((err) => {
            console.error('[ServerWS] Failed to re-declare relay homes:', err);
          });
        }, 2000);
        return;
      }

      // Don't send events for accessories not in the user's plan
      if (event.accessoryId && !isAccessoryAllowed(event.accessoryId)) {
        return;
      }

      // Send event to server with type: 'event' per protocol.md
      const message: ProtocolMessage = {
        id: `event_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`,
        type: 'event',
        action: event.type,
        payload: {
          accessoryId: event.accessoryId,
          // Context fields provided by native bridge
          ...(event.homeId && { homeId: event.homeId }),
          ...(event.roomId && { roomId: event.roomId }),
          ...(event.serviceGroupIds && { serviceGroupIds: event.serviceGroupIds }),
          // Event-specific fields
          ...(event.characteristicType && { characteristicType: event.characteristicType }),
          ...(event.value !== undefined && { value: event.value }),
          ...(event.isReachable !== undefined && { isReachable: event.isReachable }),
        },
      };
      this.sendEvent(message);
    });
  }

  /**
   * Check if there are any subscribers (web clients or webhooks).
   * If no subscribers, events are not sent to reduce traffic.
   */
  private hasSubscribers(): boolean {
    return this.webClientsListening || this.webhooksActive;
  }

  /**
   * Get current subscriber status (for debugging).
   */
  getSubscriberStatus(): { webClientsListening: boolean; webhooksActive: boolean; webClientCount: number; webhookCount: number; subscriptionCount: number } {
    return {
      webClientsListening: this.webClientsListening,
      webhooksActive: this.webhooksActive,
      webClientCount: this.webClientCount,
      webhookCount: this.webhookCount,
      subscriptionCount: this.subscriptionCount,
    };
  }

  /**
   * Get the accessory limit for the current account.
   * Returns null for unlimited (standard plan), or the limit number for free accounts.
   */
  getAccessoryLimit(): number | null {
    return this.accessoryLimit;
  }

  private sendEvent(message: ProtocolMessage): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.recordActivity();
      this.ws.send(JSON.stringify(message));
    }
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();

    const tick = () => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ type: 'ping' }));
        if (isRelayCapable()) {
          HomeKit.resetObservationTimeout().catch(() => {});
        }
      }
    };

    this.heartbeatInterval = setInterval(tick, HEARTBEAT_INTERVAL);

    // Browser clients: pause heartbeat when tab is hidden to save resources
    if (!isRelayCapable()) {
      this.heartbeatVisibilityHandler = () => {
        if (document.visibilityState === 'hidden') {
          if (this.heartbeatInterval) {
            clearInterval(this.heartbeatInterval);
            this.heartbeatInterval = null;
          }
        } else {
          if (!this.heartbeatInterval) {
            tick();
            this.heartbeatInterval = setInterval(tick, HEARTBEAT_INTERVAL);
          }
        }
      };
      document.addEventListener('visibilitychange', this.heartbeatVisibilityHandler);
    }
  }

  private stopHeartbeat(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
    if (this.heartbeatVisibilityHandler) {
      document.removeEventListener('visibilitychange', this.heartbeatVisibilityHandler);
      this.heartbeatVisibilityHandler = null;
    }
  }

  private scheduleReconnect(): void {
    if (this.isManualDisconnect) return;

    // Add jitter (±20%) to prevent thundering herd on server restart
    const jitter = this.reconnectDelay * 0.2 * (Math.random() * 2 - 1);
    const delay = Math.max(0, this.reconnectDelay + jitter);
    console.log(`[ServerWS] Reconnecting in ${Math.round(delay)}ms...`);
    this.reconnectTimeout = setTimeout(() => {
      this.establishConnection();
      // Increase delay for next attempt (exponential backoff)
      this.reconnectDelay = Math.min(
        this.reconnectDelay * RECONNECT_MULTIPLIER,
        MAX_RECONNECT_DELAY
      );
    }, delay);
  }

  /**
   * Subscribe to updates for specific scopes.
   * Only used in browser mode - relay mode is the source of events.
   * @param scopes Array of { type: 'home' | 'room' | 'accessory' | 'serviceGroup', id: string }
   * @param ttl Time-to-live in seconds (default 300 = 5 minutes)
   * @returns The subscriptions with their expiration timestamps
   */
  async subscribe(
    scopes: Array<{ type: string; id: string }>,
    ttl = 300
  ): Promise<{ subscriptions: Array<{ type: string; id: string; expiresAt: number | null }> }> {
    return this.request<{ subscriptions: Array<{ type: string; id: string; expiresAt: number | null }> }>('subscribe', { scopes, ttl });
  }

  /**
   * Unsubscribe from updates for specific scopes.
   */
  async unsubscribe(scopes: Array<{ type: string; id: string }>): Promise<void> {
    await this.request('unsubscribe', { scopes });
  }

  /**
   * Wait for relay assignment (relay_status message from server).
   * Returns true if this device became the active relay within the timeout.
   */
  private waitForRelayAssignment(timeoutMs: number): Promise<boolean> {
    if (this.isActiveRelay) return Promise.resolve(true);

    return new Promise<boolean>((resolve) => {
      const checkInterval = 50;
      let elapsed = 0;

      const timer = setInterval(() => {
        elapsed += checkInterval;
        if (this.isActiveRelay) {
          clearInterval(timer);
          resolve(true);
        } else if (elapsed >= timeoutMs || this.relayAssignmentTimeout === null) {
          clearInterval(timer);
          resolve(this.isActiveRelay);
        }
      }, checkInterval);
    });
  }

  private cleanup(): void {
    this.stopHeartbeat();

    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }

    if (this.relayAssignmentTimeout) {
      clearTimeout(this.relayAssignmentTimeout);
      this.relayAssignmentTimeout = null;
    }

    // Reset relay state — will be reassigned by server on reconnect
    this.isActiveRelay = false;

    this.eventUnsubscribe?.();
    this.eventUnsubscribe = null;

    if (this.ws) {
      this.ws.onopen = null;
      this.ws.onmessage = null;
      this.ws.onerror = null;
      this.ws.onclose = null;

      if (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING) {
        this.ws.close();
      }
      this.ws = null;
    }

    // Stop HomeKit observation (only in relay mode)
    if (isRelayCapable()) {
      HomeKit.stopObserving().catch(() => {
        // Ignore errors during cleanup
      });
    }
  }
}

export default ServerWebSocket;
// build 1775298364
