/**
 * Server connection lifecycle management.
 * Handles connecting/disconnecting to the server based on auth state.
 *
 * Works in two modes:
 * - Relay mode (Mac app): Connects to server and relays HomeKit data
 * - Browser mode: Connects to server to receive updates from remote relay
 */

import { ServerWebSocket, BroadcastMessage, SubscriptionInvalidated } from './websocket';
import { isRelayCapable } from '../native/homekit-bridge';
import { executeHomeKitAction } from '../relay/local-handler';
import { invalidateHomeKitCache } from '../hooks/useHomeKitData';

type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'reconnecting';

export interface ServerConnectionState {
  isActive: boolean;
  connectionState: ConnectionState;
  error: Error | null;
  relayStatus: boolean | null; // null = not relay-capable, true = active relay, false = standby
}

type StateListener = (state: ServerConnectionState) => void;
type BroadcastListener = (message: BroadcastMessage) => void;

// Generate a persistent device ID (stored in localStorage)
// Mac apps use 'mac_' prefix, browsers use 'web_' prefix
// This identifies the browser/device across all tabs
export function getDeviceId(): string {
  const STORAGE_KEY = 'homecast-device-id';
  const isMacApp = isRelayCapable();
  const expectedPrefix = isMacApp ? 'mac_' : 'web_';

  let deviceId = localStorage.getItem(STORAGE_KEY);
  const oldDeviceId = deviceId;

  // Generate new ID if none exists, or if prefix doesn't match current mode
  // (handles migration from old web_ prefix for Mac apps)
  if (!deviceId || !deviceId.startsWith(expectedPrefix)) {
    deviceId = expectedPrefix + crypto.randomUUID();
    localStorage.setItem(STORAGE_KEY, deviceId);
    if (import.meta.env.DEV) console.log(`[ServerConnection] Generated new device ID: ${deviceId} (was: ${oldDeviceId}, isRelayCapable: ${isMacApp})`);
  } else {
    if (import.meta.env.DEV) console.log(`[ServerConnection] Using existing device ID: ${deviceId} (isRelayCapable: ${isMacApp})`);
  }

  return deviceId;
}

// Generate a per-tab session ID (stored in sessionStorage)
// This identifies each browser tab uniquely so multiple tabs appear as separate sessions
export function getBrowserSessionId(): string | undefined {
  // Only needed for web clients - Mac apps use device_id for everything
  if (isRelayCapable()) {
    return undefined;
  }

  const STORAGE_KEY = 'homecast-browser-session-id';
  let sessionId = sessionStorage.getItem(STORAGE_KEY);

  if (!sessionId) {
    sessionId = 'sess_' + crypto.randomUUID();
    sessionStorage.setItem(STORAGE_KEY, sessionId);
    if (import.meta.env.DEV) console.log(`[ServerConnection] Generated new browser session ID: ${sessionId}`);
  }

  return sessionId;
}

import { config, isCommunity, isClientMode } from '@/lib/config';

const WS_URL = config.wsUrl;

// --- Community Mode Cache ---
// Caches HomeKit read operations so home switching is instant after first load.
// Write operations (characteristic.set, state.set) bypass cache and invalidate
// the relevant entries. Cache entries are refreshed in the background.

const CACHE_TTL = 5 * 60 * 1000; // 5 minutes
const communityCache = new Map<string, { data: unknown; timestamp: number; pending?: Promise<unknown> }>();

// Actions that are safe to cache (read-only)
const CACHEABLE_ACTIONS = new Set([
  'homes.list', 'rooms.list', 'zones.list', 'accessories.list',
  'accessory.get', 'serviceGroups.list', 'scenes.list',
  'automations.list', 'automation.get',
]);

// Value-only writes: change characteristic values but not the accessories list structure.
// Execute + broadcast, but do NOT clear the communityCache — the DataCache handles
// real-time value updates via broadcasts, and the communityCache serves the list structure.
const VALUE_WRITE_ACTIONS = new Set([
  'characteristic.set', 'serviceGroup.set', 'state.set',
]);

// Structure-changing writes: may add/remove accessories or change state unpredictably.
// These clear the communityCache so the next read re-fetches from HomeKit.
const CACHE_INVALIDATING_ACTIONS = new Set([
  'scene.execute', 'accessory.refresh',
  'automation.create', 'automation.update', 'automation.delete',
  'automation.enable', 'automation.disable',
]);

function communityCacheKey(action: string, payload: Record<string, unknown>): string {
  // Build a stable key from action + relevant payload fields
  const parts = [action];
  if (payload.homeId) parts.push(`h:${payload.homeId}`);
  if (payload.roomId) parts.push(`r:${payload.roomId}`);
  if (payload.accessoryId) parts.push(`a:${payload.accessoryId}`);
  return parts.join('|');
}

/**
 * Broadcast an update to external WebSocket clients via the Swift bridge.
 */
function broadcastToExternalClients(message: Record<string, unknown>): void {
  const broadcast = (window as Window & { __localserver_broadcast?: (msg: unknown) => void }).__localserver_broadcast;
  if (broadcast) broadcast(message);
}

export async function communityRequest<T>(action: string, payload: Record<string, unknown>): Promise<T> {
  recordCommunityActivity();

  // Value-only writes: execute + broadcast, but preserve the cache.
  // These change characteristic values without altering the accessories list structure.
  if (VALUE_WRITE_ACTIONS.has(action)) {
    const result = await executeHomeKitAction(action, payload);

    // Broadcast write results to all clients (mirrors websocket.ts:280-336 in cloud mode)
    // HomeKit doesn't fire events back to the app that made the change, so we do it manually.
    if (action === 'characteristic.set') {
      const msg: BroadcastMessage = {
        type: 'characteristic_update',
        accessoryId: payload.accessoryId as string,
        homeId: (payload.homeId as string) ?? null,
        characteristicType: payload.characteristicType as string,
        value: payload.value,
      };
      broadcastToExternalClients(msg);
      serverConnection.emitBroadcast(msg);
    } else if (action === 'serviceGroup.set') {
      const resultObj = result as { affectedCount?: number; successCount?: number } | undefined;
      const affectedCount = resultObj?.affectedCount ?? resultObj?.successCount ?? 0;
      const msg: BroadcastMessage = {
        type: 'service_group_update',
        groupId: payload.groupId as string,
        homeId: (payload.homeId as string) ?? null,
        characteristicType: payload.characteristicType as string,
        value: payload.value,
        affectedCount,
      };
      broadcastToExternalClients(msg);
      serverConnection.emitBroadcast(msg);
    } else if (action === 'state.set') {
      // Use resolved UUIDs from the Swift result (not slug keys from payload)
      const changes = (result as any)?.changes as Array<{ accessoryId: string; characteristicType: string; value: unknown }> | undefined;
      if (changes) {
        for (const change of changes) {
          const msg: BroadcastMessage = {
            type: 'characteristic_update',
            accessoryId: change.accessoryId,
            homeId: (payload.homeId as string) ?? null,
            characteristicType: change.characteristicType,
            value: change.value,
          };
          broadcastToExternalClients(msg);
          serverConnection.emitBroadcast(msg);
        }
      }
    }

    return result as T;
  }

  // Structure-changing writes: execute and clear the cache so next read re-fetches.
  if (CACHE_INVALIDATING_ACTIONS.has(action)) {
    const result = await executeHomeKitAction(action, payload);
    for (const [key] of communityCache) {
      if (key.startsWith('accessories.list') || key.startsWith('serviceGroups.list') ||
          key.startsWith('accessory.get') || key.startsWith('automations.list')) {
        communityCache.delete(key);
      }
    }
    return result as T;
  }

  // Non-cacheable actions: execute directly
  if (!CACHEABLE_ACTIONS.has(action)) {
    return executeHomeKitAction(action, payload) as Promise<T>;
  }

  const key = communityCacheKey(action, payload);
  const cached = communityCache.get(key);
  const now = Date.now();

  // Fresh cache hit: return immediately
  if (cached && (now - cached.timestamp) < CACHE_TTL) {
    return cached.data as T;
  }

  // Stale cache hit: return stale data AND refresh in background
  if (cached) {
    if (!cached.pending) {
      cached.pending = executeHomeKitAction(action, payload).then(result => {
        communityCache.set(key, { data: result, timestamp: Date.now() });
        return result;
      }).finally(() => {
        const entry = communityCache.get(key);
        if (entry) delete entry.pending;
      });
    }
    return cached.data as T;
  }

  // No cache: fetch and cache
  const result = await executeHomeKitAction(action, payload);
  communityCache.set(key, { data: result, timestamp: now });
  return result as T;
}

// Stable relay detection for Community mode — set once, stays true forever
// Avoids the race condition where isRelayCapable() returns false during bridge init
// In client mode (connecting to a remote relay), never confirm — use WebSocket path instead
let communityRelayConfirmed = false;

// Community relay stats (no WebSocket to cloud, so we track locally)
let communityStartedAt: number | null = null;
let communityConnectedClientCount = 0;
const communityActivityBuckets = new Array<number>(60).fill(0);
let communityActivityBucketMinute = -1;

/** Update the connected client count (called by local-server.ts to avoid circular import). */
export function setCommunityClientCount(count: number): void {
  communityConnectedClientCount = count;
}

if (isCommunity && !isClientMode()) {
  const checkBridge = () => {
    if (isRelayCapable()) {
      communityRelayConfirmed = true;
      communityStartedAt = Date.now();
    } else {
      setTimeout(checkBridge, 50);
    }
  };
  checkBridge();
}

/** Record a community relay activity tick (rolling 60-minute window). */
export function recordCommunityActivity(): void {
  const now = Math.floor(Date.now() / 60000);
  if (communityActivityBucketMinute === -1) {
    communityActivityBucketMinute = now;
    communityActivityBuckets[59] = 1;
    return;
  }
  const elapsed = now - communityActivityBucketMinute;
  if (elapsed === 0) {
    communityActivityBuckets[59]++;
  } else if (elapsed > 0) {
    const shift = Math.min(elapsed, 60);
    if (shift >= 60) {
      communityActivityBuckets.fill(0);
    } else {
      communityActivityBuckets.copyWithin(0, shift);
      communityActivityBuckets.fill(0, 60 - shift);
    }
    communityActivityBucketMinute = now;
    communityActivityBuckets[59] = 1;
  }
}

// Get device name (hostname or generic name)
function getDeviceName(): string {
  // Check if we're in the Mac app and can get hostname
  const win = window as Window & {
    isHomecastMacApp?: boolean;
    ProcessInfo?: { hostName?: string };
  };

  if (win.isHomecastMacApp) {
    // Mac app - use a generic name since we can't easily get hostname from JS
    return 'Mac (Relay)';
  }

  // Fallback for browser
  return 'Web Browser';
}

// Subscription scope type
export interface SubscriptionScope {
  type: string;
  id: string;
}

// Subscription renewal settings
const SUBSCRIPTION_TTL = 300; // 5 minutes
const SUBSCRIPTION_RENEWAL_CHECK_INTERVAL = 60000; // Check every minute
const SUBSCRIPTION_RENEWAL_THRESHOLD = 150000; // Renew when <150s remaining

class ServerConnection {
  private websocket: ServerWebSocket | null = null;
  private listeners: Set<StateListener> = new Set();
  private broadcastListeners: Set<BroadcastListener> = new Set();
  private state: ServerConnectionState = {
    isActive: false,
    connectionState: 'disconnected',
    error: null,
    relayStatus: null,
  };

  // Subscription management
  private activeSubscriptions: Map<string, { scope: SubscriptionScope; expiresAt: number }> = new Map();
  private subscriptionRenewalTimer: ReturnType<typeof setInterval> | null = null;
  private pendingResubscription: SubscriptionScope[] = [];

  /**
   * Check if connection should be activated.
   * In Community mode:
   * - Relay Mac (isRelayCapable): HomeKit data flows locally, no WS needed
   * - External browser clients: connect to local WS for HomeKit data
   * In cloud mode: requires auth token
   */
  shouldActivate(): boolean {
    if (isCommunity) {
      // Relay Mac handles HomeKit directly — no WS needed
      if (communityRelayConfirmed) return false;
      // External browser client — connect to local WS (no token required)
      return true;
    }
    return this.hasToken();
  }

  /**
   * Check if auth token exists
   */
  private hasToken(): boolean {
    return !!localStorage.getItem('homecast-token');
  }

  /**
   * Get current state
   */
  getState(): ServerConnectionState {
    return { ...this.state };
  }

  /**
   * Get subscriber status (for debugging relay behavior).
   * Shows whether server has notified us of active web clients or webhooks.
   */
  getSubscriberStatus(): { webClientsListening: boolean; webhooksActive: boolean; webClientCount: number; webhookCount: number; subscriptionCount: number } | null {
    if (communityRelayConfirmed) {
      const clientCount = communityConnectedClientCount;
      return {
        webClientsListening: clientCount > 0,
        webhooksActive: false,
        webClientCount: clientCount,
        webhookCount: 0,
        subscriptionCount: 0,
      };
    }
    if (!this.websocket) {
      return null;
    }
    return this.websocket.getSubscriberStatus();
  }

  /**
   * Get the timestamp when the WebSocket connection was established.
   */
  getConnectedAt(): number | null {
    if (communityRelayConfirmed) {
      return communityStartedAt;
    }
    if (!this.websocket) {
      return null;
    }
    return this.websocket.getConnectedAt();
  }

  /**
   * Get per-minute WebSocket activity counts for the last 60 minutes.
   */
  getActivityHistory(): number[] {
    if (communityRelayConfirmed) {
      // Advance buckets to current time so idle gaps show as zeros
      if (communityActivityBucketMinute !== -1) {
        const now = Math.floor(Date.now() / 60000);
        const elapsed = now - communityActivityBucketMinute;
        if (elapsed > 0) {
          const shift = Math.min(elapsed, 60);
          if (shift >= 60) {
            communityActivityBuckets.fill(0);
          } else {
            communityActivityBuckets.copyWithin(0, shift);
            communityActivityBuckets.fill(0, 60 - shift);
          }
          communityActivityBucketMinute = now;
        }
      }
      return [...communityActivityBuckets];
    }
    return this.websocket?.getActivityHistory() ?? new Array(60).fill(0);
  }

  /**
   * Get relay status: true = active relay, false = standby, null = not relay-capable
   */
  getRelayStatus(): boolean | null {
    return this.state.relayStatus;
  }

  /**
   * Request to become the active relay (standby → active). Demotes the current active relay.
   */
  claimRelay(): void {
    this.websocket?.claimRelay();
  }

  /**
   * Subscribe to state changes
   */
  subscribe(listener: StateListener): () => void {
    this.listeners.add(listener);
    // Immediately notify with current state
    listener(this.getState());
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * Subscribe to broadcast messages (characteristic updates, reachability, etc.)
   */
  subscribeToBroadcasts(listener: BroadcastListener): () => void {
    this.broadcastListeners.add(listener);
    return () => {
      this.broadcastListeners.delete(listener);
    };
  }

  /**
   * Emit a broadcast message to all listeners (used by communityRequest for write broadcasts).
   */
  emitBroadcast(message: BroadcastMessage): void {
    this.notifyBroadcastListeners(message);
  }

  private notifyBroadcastListeners(message: BroadcastMessage): void {
    this.broadcastListeners.forEach((listener) => {
      try {
        listener(message);
      } catch (error) {
        console.error('[ServerConnection] Broadcast listener error:', error);
      }
    });
  }

  /**
   * Activate the server connection
   */
  async activate(): Promise<void> {
    if (this.state.isActive) {
      if (import.meta.env.DEV) console.log('[ServerConnection] Already active');
      return;
    }

    if (!this.shouldActivate()) {
      if (import.meta.env.DEV) console.log('[ServerConnection] Cannot activate - no token');
      return;
    }

    const token = isCommunity ? 'community' : localStorage.getItem('homecast-token');
    if (!token) {
      if (import.meta.env.DEV) console.log('[ServerConnection] No token available');
      return;
    }

    if (import.meta.env.DEV) console.log(`[ServerConnection] Activating... (${WS_URL})`);

    try {
      const deviceId = getDeviceId();
      const deviceName = getDeviceName();
      const browserSessionId = getBrowserSessionId();

      this.websocket = new ServerWebSocket(
        { token, deviceId, deviceName, browserSessionId, wsUrl: WS_URL },
        {
          onStateChange: (connectionState) => {
            // In community mode, authenticate with the relay as soon as connected
            if (isCommunity && connectionState === 'connected' && this.websocket) {
              const token = localStorage.getItem('homecast-token');
              if (token && token !== 'community') {
                this.websocket.request('authenticate', { token }).catch(() => {});
              }
            }
            const updates: Partial<ServerConnectionState> = { connectionState };
            // Clear local subscription tracking on disconnect - server has already cleared them
            if (connectionState === 'disconnected' || connectionState === 'reconnecting') {
              // Reset relay status — will be reassigned by server on reconnect
              updates.relayStatus = null;
              this.activeSubscriptions.clear();
              this.stopSubscriptionRenewal();
            }
            this.updateState(updates);
          },
          onError: (error) => {
            console.error('[ServerConnection] Error:', error);
            this.updateState({ error });
          },
          onBroadcast: (message) => {
            // Handle subscription_invalidated specially
            if (message.type === 'subscription_invalidated') {
              const invalidated = message as SubscriptionInvalidated;
              const key = `${invalidated.scope.type}:${invalidated.scope.id}`;
              this.activeSubscriptions.delete(key);
              // Also remove from pending resubscription
              this.pendingResubscription = this.pendingResubscription.filter(
                s => !(s.type === invalidated.scope.type && s.id === invalidated.scope.id)
              );
              if (import.meta.env.DEV) console.log(`[ServerConnection] Subscription invalidated: ${key}, reason: ${invalidated.reason}`);
            }
            this.notifyBroadcastListeners(message);
          },
          onConnected: () => {
            // Re-subscribe to previous scopes on reconnect
            if (this.pendingResubscription.length > 0) {
              if (import.meta.env.DEV) console.log(`[ServerConnection] Reconnected - re-subscribing to ${this.pendingResubscription.length} scope(s)`);
              this.subscribeToScopes([...this.pendingResubscription]);
            }
          },
          onRelayStatusChange: (isActive) => {
            this.updateState({ relayStatus: isActive });
          },
        }
      );

      this.websocket.connect();
      this.updateState({ isActive: true, error: null });
    } catch (error) {
      console.error('[ServerConnection] Failed to activate:', error);
      this.updateState({
        isActive: false,
        error: error instanceof Error ? error : new Error(String(error)),
      });
    }
  }

  /**
   * Deactivate the server connection
   */
  deactivate(): void {
    if (!this.state.isActive) {
      return;
    }

    if (import.meta.env.DEV) console.log('[ServerConnection] Deactivating...');

    // Stop subscription renewal and clear subscriptions
    this.stopSubscriptionRenewal();
    this.activeSubscriptions.clear();
    this.pendingResubscription = [];

    if (this.websocket) {
      this.websocket.disconnect();
      this.websocket = null;
    }

    this.updateState({
      isActive: false,
      connectionState: 'disconnected',
      error: null,
      relayStatus: null,
    });
  }

  /**
   * Reconnect to the server (useful after network recovery)
   */
  reconnect(): void {
    if (!this.state.isActive || !this.websocket) {
      return;
    }

    if (import.meta.env.DEV) console.log('[ServerConnection] Reconnecting...');
    this.websocket.disconnect();
    this.websocket.connect();
  }

  /**
   * Make a request to the server (or locally in relay mode).
   * In relay mode: handled locally via native HomeKit bridge
   * In browser mode: sent to server, routed to remote relay
   * In Community mode on relay: handled directly via local-handler.ts
   */
  async request<T = unknown>(action: string, payload: Record<string, unknown> = {}): Promise<T> {
    // Community mode on relay Mac: execute HomeKit actions directly, with cache
    if (isCommunity && communityRelayConfirmed) {
      return communityRequest<T>(action, payload);
    }
    if (!this.websocket) {
      throw new Error('[ServerConnection] Not active - cannot make request');
    }
    return this.websocket.request<T>(action, payload);
  }

  /**
   * Subscribe to updates for specific scopes (e.g., home, room, accessory).
   * Only used in browser mode - relay mode is the source of events.
   */
  async subscribeToScopes(scopes: SubscriptionScope[]): Promise<void> {
    // Only subscribe if actually connected
    if (!this.websocket || this.state.connectionState !== 'connected') {
      // Still track for re-subscription on reconnect
      for (const scope of scopes) {
        if (!this.pendingResubscription.some(s => s.type === scope.type && s.id === scope.id)) {
          this.pendingResubscription.push(scope);
        }
      }
      if (import.meta.env.DEV) console.log(`[ServerConnection] Not connected - queued ${scopes.length} scope(s) for subscription on reconnect`);
      return;
    }

    // Filter out scopes that are already actively subscribed (not expired)
    const now = Date.now();
    const newScopes = scopes.filter(scope => {
      const key = `${scope.type}:${scope.id}`;
      const existing = this.activeSubscriptions.get(key);
      // Only subscribe if not already subscribed or subscription is expiring soon
      return !existing || existing.expiresAt - now < SUBSCRIPTION_RENEWAL_THRESHOLD;
    });

    if (newScopes.length === 0) {
      // All scopes already subscribed - just ensure they're tracked for reconnect
      for (const scope of scopes) {
        if (!this.pendingResubscription.some(s => s.type === scope.type && s.id === scope.id)) {
          this.pendingResubscription.push(scope);
        }
      }
      return;
    }

    try {
      const result = await this.websocket.subscribe(newScopes, SUBSCRIPTION_TTL);

      // Track subscriptions using new response format
      for (const sub of result.subscriptions) {
        const key = `${sub.type}:${sub.id}`;
        this.activeSubscriptions.set(key, {
          scope: { type: sub.type, id: sub.id },
          expiresAt: sub.expiresAt ?? Date.now() + SUBSCRIPTION_TTL * 1000,
        });
      }

      // Also track for re-subscription on reconnect
      for (const scope of scopes) {
        const key = `${scope.type}:${scope.id}`;
        if (!this.pendingResubscription.some(s => s.type === scope.type && s.id === scope.id)) {
          this.pendingResubscription.push(scope);
        }
      }

      // Start renewal timer if not already running
      this.startSubscriptionRenewal();

      const firstExpiry = result.subscriptions[0]?.expiresAt;
      if (firstExpiry) {
        if (import.meta.env.DEV) console.log(`[ServerConnection] Subscribed to ${newScopes.length} scope(s), expires at ${new Date(firstExpiry).toISOString()}`);
      } else {
        if (import.meta.env.DEV) console.log(`[ServerConnection] Subscribed to ${newScopes.length} scope(s)`);
      }
    } catch (error) {
      console.error('[ServerConnection] Subscribe to scopes failed:', error);
    }
  }

  /**
   * Unsubscribe from updates for specific scopes.
   */
  async unsubscribeFromScopes(scopes: SubscriptionScope[]): Promise<void> {
    // Only try to unsubscribe if we're actually connected
    // When disconnected/reconnecting, server has already cleared subscriptions
    if (!this.websocket || this.state.connectionState !== 'connected') {
      // Still clean up local tracking
      for (const scope of scopes) {
        const key = `${scope.type}:${scope.id}`;
        this.activeSubscriptions.delete(key);
        this.pendingResubscription = this.pendingResubscription.filter(
          s => !(s.type === scope.type && s.id === scope.id)
        );
      }
      return;
    }

    try {
      await this.websocket.unsubscribe(scopes);

      // Remove from tracking
      for (const scope of scopes) {
        const key = `${scope.type}:${scope.id}`;
        this.activeSubscriptions.delete(key);
        // Also remove from pending resubscription
        this.pendingResubscription = this.pendingResubscription.filter(
          s => !(s.type === scope.type && s.id === scope.id)
        );
      }

      // Stop renewal timer if no active subscriptions
      if (this.activeSubscriptions.size === 0) {
        this.stopSubscriptionRenewal();
      }

      if (import.meta.env.DEV) console.log(`[ServerConnection] Unsubscribed from ${scopes.length} scope(s)`);
    } catch (error) {
      console.error('[ServerConnection] Unsubscribe from scopes failed:', error);
    }
  }

  /**
   * List all active subscriptions from the server.
   * Useful for verifying subscription state after reconnect.
   */
  async listSubscriptions(): Promise<Array<{ type: string; id: string; expiresAt: number | null }>> {
    if (!this.websocket) {
      console.warn('[ServerConnection] Cannot list subscriptions - not active');
      return [];
    }

    try {
      const result = await this.websocket.request<{
        subscriptions: Array<{ type: string; id: string; expiresAt: number | null }>
      }>('subscriptions.list', {});
      return result.subscriptions;
    } catch (error) {
      console.error('[ServerConnection] List subscriptions failed:', error);
      return [];
    }
  }

  /**
   * Get the earliest subscription expiry timestamp across all active subscriptions.
   * Returns null if no subscriptions are active.
   */
  getEarliestSubscriptionExpiry(): number | null {
    if (this.activeSubscriptions.size === 0) return null;
    let earliest: number | null = null;
    for (const [, sub] of this.activeSubscriptions) {
      if (earliest === null || sub.expiresAt < earliest) {
        earliest = sub.expiresAt;
      }
    }
    return earliest;
  }

  private startSubscriptionRenewal(): void {
    if (this.subscriptionRenewalTimer) return; // Already running

    this.subscriptionRenewalTimer = setInterval(() => {
      this.renewExpiringSubscriptions();
    }, SUBSCRIPTION_RENEWAL_CHECK_INTERVAL);
  }

  private stopSubscriptionRenewal(): void {
    if (this.subscriptionRenewalTimer) {
      clearInterval(this.subscriptionRenewalTimer);
      this.subscriptionRenewalTimer = null;
    }
  }

  private async renewExpiringSubscriptions(): Promise<void> {
    const now = Date.now();
    const toRenew: SubscriptionScope[] = [];

    for (const [, sub] of this.activeSubscriptions) {
      const remaining = sub.expiresAt - now;
      if (remaining < SUBSCRIPTION_RENEWAL_THRESHOLD) {
        toRenew.push(sub.scope);
      }
    }

    if (toRenew.length > 0 && this.websocket) {
      try {
        const result = await this.websocket.subscribe(toRenew, SUBSCRIPTION_TTL);

        // Update expiration times using new response format
        for (const sub of result.subscriptions) {
          const key = `${sub.type}:${sub.id}`;
          const existing = this.activeSubscriptions.get(key);
          if (existing && sub.expiresAt) {
            existing.expiresAt = sub.expiresAt;
          }
        }

        if (import.meta.env.DEV) console.log(`[ServerConnection] Renewed ${toRenew.length} subscription(s)`);
      } catch (error) {
        console.error('[ServerConnection] Subscription renewal failed:', error);
      }
    }
  }

  private updateState(updates: Partial<ServerConnectionState>): void {
    this.state = { ...this.state, ...updates };
    this.notifyListeners();
  }

  private notifyListeners(): void {
    const state = this.getState();
    this.listeners.forEach((listener) => {
      try {
        listener(state);
      } catch (error) {
        console.error('[ServerConnection] Listener error:', error);
      }
    });
  }
}

// Export singleton instance
export const serverConnection = new ServerConnection();

export default serverConnection;
