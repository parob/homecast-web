/**
 * Server connection lifecycle management.
 * Handles connecting/disconnecting to the server based on auth state.
 *
 * Works in two modes:
 * - Relay mode (Mac app): Connects to server and relays HomeKit data
 * - Browser mode: Connects to server to receive updates from remote relay
 */

import { ServerWebSocket, BroadcastMessage, SubscriptionInvalidated, HomecastError } from './websocket';
import type { ConnectionQuality } from './connection-quality';
import { isRelayCapable, isRelayEnabled } from '../native/homekit-bridge';
import { executeHomeKitAction } from '../relay/local-handler';
import { invalidateHomeKitCache } from '../hooks/useHomeKitData';
import { beginRequest, logEvent, type RequestHandle } from '../lib/request-log';
import { browserLogger } from '../lib/browser-logger';
import { describeError } from '../lib/describe-error';
import { traceClientRequest } from '../lib/activity-spans';

type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'reconnecting';

/**
 * Thrown when Local Mode is serving but the request needs the cloud.
 *
 * Distinct from the generic "not active" throw because this one reaches real
 * users during an outage rather than only developers during a mistake, so the
 * UI needs to be able to tell it apart and say something useful.
 */
export class LocalOnlyError extends Error {
  readonly code = 'LOCAL_ONLY';
  constructor(public readonly action: string) {
    super(`"${action}" needs Homecast's servers, and this device can't reach them right now.`);
    this.name = 'LocalOnlyError';
  }
}

/**
 * The Local Mode router, registered at runtime.
 *
 * An indirection rather than a direct import because the controller reaches
 * through to `window` and the native bridge on construction, and this module is
 * loaded by node tests that have neither. Registration also keeps the
 * dependency pointing one way: the controller knows about the connection, not
 * the reverse.
 */
export interface LocalModeRouter {
  isActive(): boolean;
  canServe(action: string, payload: Record<string, unknown>): boolean;
  request<T>(action: string, payload: Record<string, unknown>): Promise<T>;
}

let localModeRouter: LocalModeRouter | null = null;

export function setLocalModeRouter(router: LocalModeRouter | null): void {
  localModeRouter = router;
}

function getLocalModeRouter(): LocalModeRouter | null {
  return localModeRouter;
}

export interface ServerConnectionState {
  isActive: boolean;
  connectionState: ConnectionState;
  error: Error | null;
  relayStatus: boolean | null; // null = not relay-capable, true = active relay, false = standby
  /**
   * How well the connection is working, as opposed to whether it exists.
   *
   * `connectionState` cannot answer this: every one of its four values is
   * about whether a socket is up, and the state users complain about — up,
   * and taking four seconds a request — is `connected` in all of them.
   * See ./connection-quality.ts.
   */
  quality: ConnectionQuality;
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
    deviceId = expectedPrefix + randomUUID();
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
    sessionId = 'sess_' + randomUUID();
    sessionStorage.setItem(STORAGE_KEY, sessionId);
    if (import.meta.env.DEV) console.log(`[ServerConnection] Generated new browser session ID: ${sessionId}`);
  }

  return sessionId;
}

import { config, isCommunity, isClientMode, setActiveRelayOrigin } from '@/lib/config';
import { randomUUID } from '@/lib/uuid';

// Read at call time, not captured: the relay's address can change under a
// running app when the network moves.
const wsUrl = () => config.wsUrl;

const LAST_CONNECTED_AT_KEY = 'homecast-last-connected-at';

// --- Community Mode Cache ---
// Caches HomeKit read operations so home switching is instant after first load.
// Write operations (characteristic.set, state.set) bypass cache and invalidate
// the relevant entries. Cache entries are refreshed in the background.

const CACHE_TTL = 5 * 60 * 1000; // 5 minutes
const communityCache = new Map<string, {
  data: unknown;
  timestamp: number;
  pending?: Promise<unknown>;
  /** Consecutive background refreshes that have failed since one last succeeded. */
  refreshFailures?: number;
  /** When the most recent background refresh failed. */
  lastRefreshFailureAt?: number;
}>();

/**
 * Bumped by every invalidation, checked before every write-back.
 *
 * Clearing the map is not enough on its own: a read started before the
 * invalidation resolves after it and writes its result in, restoring exactly
 * the entry that was just dropped. The fetch is in flight for the whole of a
 * relay round trip, which is far longer than the gap between "the mutation
 * resolved" and "the UI re-reads" — so this is the common case, not a corner.
 */
let communityCacheGeneration = 0;

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
  'characteristic.set', 'characteristics.set', 'serviceGroup.set', 'state.set',
]);

// Structure-changing writes: may add/remove accessories or change state unpredictably.
// These clear the communityCache so the next read re-fetches from HomeKit.
const CACHE_INVALIDATING_ACTIONS = new Set([
  'scene.execute', 'scene.create', 'scene.update', 'scene.delete', 'accessory.refresh',
  'automation.create', 'automation.update', 'automation.delete',
  'automation.enable', 'automation.disable',
]);

/**
 * Drop every cached HomeKit read.
 *
 * `communityCache` is a module singleton shared by Community mode and Local
 * Mode, so a transition in either direction has to flush it. Miss that and a
 * five-minute-old local answer outlives the relay's return — which presents as
 * a HomeKit fault rather than a caching one, and is miserable to diagnose.
 */
export function clearCommunityCache(): void {
  communityCache.clear();
  communityCacheGeneration++;
}

/**
 * Drop the cached accessory reads, optionally for one home.
 *
 * The structural writes that travel as relay actions clear these entries
 * themselves (see CACHE_INVALIDATING_ACTIONS). Virtual accessories do not:
 * they are created and deleted over GraphQL, so nothing on that path ever
 * reached this map, and a deleted one kept being served from here for the rest
 * of the five minutes — which is why the tile only went away on a reload.
 *
 * Callers above the Local Mode id translation must pass no `homeId` at all.
 * `LocalModeRouter.request` swaps the stable id for this device's live HomeKit
 * id before calling in here, so the keys hold live ids while the dashboard
 * holds stable ones; filtering on the id it has would match nothing and
 * silently invalidate nothing.
 */
export function invalidateCommunityAccessories(homeId?: string): void {
  for (const [key] of communityCache) {
    if (!key.startsWith('accessories.list') && !key.startsWith('serviceGroups.list') &&
        !key.startsWith('accessory.get') && !key.startsWith('automations.list')) continue;
    // If we know which home, only invalidate that home's entries
    if (homeId && !key.includes(`h:${homeId}`)) continue;
    communityCache.delete(key);
  }
  communityCacheGeneration++;
}

function communityCacheKey(action: string, payload: Record<string, unknown>): string {
  // Build a stable key from action + relevant payload fields
  const parts = [action];
  if (payload.homeId) parts.push(`h:${payload.homeId}`);
  if (payload.roomId) parts.push(`r:${payload.roomId}`);
  if (payload.accessoryId) parts.push(`a:${payload.accessoryId}`);
  return parts.join('|');
}

/**
 * A one-line gist of a request payload for the debug log.
 *
 * Ids only, never values: an accessories.list response is megabytes, and the
 * point is to see the shape of what was asked, not to keep a copy of the home.
 */
function summarisePayload(payload: Record<string, unknown>): string | undefined {
  const bits: string[] = [];
  for (const key of ['homeId', 'roomId', 'accessoryId', 'groupId', 'sceneId'] as const) {
    const v = payload[key];
    if (typeof v === 'string') bits.push(`${key.replace(/Id$/, '')}=${v.slice(0, 8)}`);
  }
  if (payload.includeValues === true) bits.push('values');
  return bits.length ? bits.join(' ') : undefined;
}

export async function communityRequest<T>(action: string, payload: Record<string, unknown>): Promise<T> {
  recordCommunityActivity();

  // Value-only writes: execute, preserving the cache. No broadcast here —
  // local-handler announces every successful write through relay-write.ts,
  // and the CE publisher registered by community-automation fans it out to
  // LAN clients AND this Mac's own dashboard (with the confirmed value and
  // the observation-event dedupe marker). A hand-maintained copy of that
  // fan-out lived here and double-announced every UI write.
  if (VALUE_WRITE_ACTIONS.has(action)) {
    return await executeHomeKitAction(action, payload) as T;
  }

  // Structure-changing writes: execute and clear affected cache entries so next read re-fetches.
  // Scoped invalidation: only clear entries for the affected home (B10 fix — avoids full cache nuke).
  if (CACHE_INVALIDATING_ACTIONS.has(action)) {
    const result = await executeHomeKitAction(action, payload);
    // Scoped to the affected home when we know it (B10 fix — avoids a full
    // cache nuke). This call site sits below the Local Mode id translation, so
    // the id it holds is already in the same space as the keys.
    invalidateCommunityAccessories(payload.homeId as string | undefined);
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
      const gen = communityCacheGeneration;
      cached.pending = executeHomeKitAction(action, payload).then(result => {
        // Anything invalidated while this was in flight was invalidated
        // *because* the answer we are holding is out of date. Writing it back
        // would undo the invalidation with the very data it was aimed at.
        if (communityCacheGeneration === gen) {
          // A fresh answer resets the failure record along with the data.
          communityCache.set(key, { data: result, timestamp: Date.now() });
        }
        return result;
      }).catch((error: unknown) => {
        // A rejected refresh used to fall straight through this chain. Two
        // consequences, both bad and neither visible:
        //
        //  1. Nothing handled the rejection. `cached.pending` is never awaited
        //     — the caller already has its stale answer and returned — so the
        //     rejection surfaced as an unhandled promise rejection instead of
        //     as anything actionable.
        //  2. The stale entry stayed exactly as it was, so the next read
        //     re-served the same out-of-date data and launched another doomed
        //     refresh. On a weak link that is a dashboard built entirely from
        //     minutes-old state, with no error and no staleness anywhere.
        //
        // The entry is deliberately NOT dropped: stale data still beats an
        // empty screen, and the timestamp is what makes its age reportable.
        // Recording the failure is what turns "silently stale" into "known
        // stale", which is the whole point.
        const entry = communityCache.get(key);
        if (entry) {
          entry.refreshFailures = (entry.refreshFailures ?? 0) + 1;
          entry.lastRefreshFailureAt = Date.now();
        }
        try {
          browserLogger.logInfo('community_cache_refresh_failed', {
            action,
            age_ms: Date.now() - (entry?.timestamp ?? Date.now()),
            consecutive_failures: entry?.refreshFailures ?? 1,
            error: describeError(error),
          });
        } catch { /* logging must never replace the original failure */ }
        // Swallowed on purpose: the caller was handed the stale value and has
        // already returned. Rethrowing here reaches nobody.
        return undefined;
      }).finally(() => {
        const entry = communityCache.get(key);
        if (entry) delete entry.pending;
      });
    }
    return cached.data as T;
  }

  // No cache: fetch and cache
  const gen = communityCacheGeneration;
  const result = await executeHomeKitAction(action, payload);
  if (communityCacheGeneration === gen) {
    communityCache.set(key, { data: result, timestamp: now });
  }
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
  // Bounded, because the bridge either turns up while the app is starting or
  // it is not coming. Rescheduling unconditionally meant a 20Hz poll for the
  // life of the process on any relay whose HomeKit never initialised — and in
  // a test it outlived the environment it was polling, which is how it was
  // found: an unhandled error after teardown, in whichever file happened to
  // import this module.
  const GIVE_UP_AFTER_MS = 30_000;
  const deadline = Date.now() + GIVE_UP_AFTER_MS;

  const checkBridge = () => {
    try {
      if (isRelayCapable()) {
        communityRelayConfirmed = true;
        communityStartedAt = Date.now();
        return;
      }
    } catch {
      // The window this was asking about has gone. Nothing left to wait for.
      return;
    }
    if (Date.now() >= deadline) return;
    const handle = setTimeout(checkBridge, 50);
    // Node only: never hold the process — or a test environment — open just to
    // keep asking a question whose answer stopped mattering.
    (handle as unknown as { unref?: () => void }).unref?.();
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
    // Only claim to be a relay if we're actually going to register as one.
    // This used to say "Mac (Relay)" for every Mac build, so a Mac with the
    // relay switched off still appeared as a relay in the sessions list while
    // connecting as a plain web client — which made "No relay device
    // connected" impossible to square with what the UI was showing.
    return isRelayEnabled() ? 'Mac (Relay)' : 'Mac';
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
    quality: 'unknown',
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
   * Move the open socket to a different address for the same relay.
   *
   * No-op when nothing is connected: the next connect will read the new URL
   * from config anyway, so there is nothing to move.
   */
  switchWebSocketEndpoint(url: string): void {
    this.websocket?.switchEndpoint(url);
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
   * The most recent measured round trip, in ms, or null when there is none.
   *
   * Null rather than 0 on purpose, so the UI says "checking" instead of
   * rendering a confident "0ms" — which would be the same lie, one layer up.
   */
  getLastRttMs(): number | null {
    return this.websocket?.getLastRttMs() ?? null;
  }

  /** When that round trip was measured. 0 when never. */
  getLastRttAt(): number {
    return this.websocket?.getLastRttAt() ?? 0;
  }

  /**
   * Get the timestamp of the most recent successful connection — persists across
   * disconnects via localStorage so the UI can show "last online X ago" while
   * the relay (this browser's WS) is down.
   */
  getLastConnectedAt(): number | null {
    try {
      const raw = localStorage.getItem(LAST_CONNECTED_AT_KEY);
      if (!raw) return null;
      const n = Number(raw);
      return Number.isFinite(n) && n > 0 ? n : null;
    } catch {
      return null;
    }
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

    if (import.meta.env.DEV) console.log(`[ServerConnection] Activating... (${wsUrl()})`);

    try {
      const deviceId = getDeviceId();
      const deviceName = getDeviceName();
      const browserSessionId = getBrowserSessionId();

      this.websocket = new ServerWebSocket(
        { token, deviceId, deviceName, browserSessionId, wsUrl: wsUrl() },
        {
          onStateChange: (connectionState, opts) => {
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
            if (connectionState === 'connected') {
              try { localStorage.setItem(LAST_CONNECTED_AT_KEY, String(Date.now())); } catch { /* noop */ }
            }
            // Emit the structured log for every transition, including a
            // redirect handoff — that is exactly the kind of thing worth being
            // able to see in Cloud Logging afterwards.
            //
            // The user-facing half of this used to be a toast here. It now
            // lives in the header badge (components/layout/StatusBadge),
            // because a toast is the wrong instrument for a condition: it
            // fires once and dismisses after four seconds, while a connection
            // problem lasts minutes. `opts.silent` is no longer consulted for
            // that reason — the badge debounces itself through
            // CONNECTING_AFTER_MS, which covers the redirect handoff without
            // needing to be told about it.
            const prev = this.state.connectionState;
            if (prev !== connectionState) {
              try {
                browserLogger.logConnection(
                  connectionState,
                  opts?.silent ? `prev=${prev} handoff` : `prev=${prev}`,
                );
              } catch { /* noop */ }
            }
            this.updateState(updates);
          },
          onQualityChange: (quality) => {
            this.updateState({ quality });
          },
          onError: (error) => {
            console.error('[ServerConnection] Error:', error);
            this.updateState({ error });
            try { browserLogger.logError(`ServerConnection error: ${error}`, { source: 'server_connection' }); } catch { /* noop */ }
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
      quality: 'unknown',
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
    // Every HomeKit action funnels through here, which is why the log is taken
    // here rather than at any call site — including the ones that swallow their
    // own errors, which are exactly the ones worth seeing.
    const log = beginRequest(action, summarisePayload(payload));
    const via = { transport: 'ws' };

    // Same reasoning for the trace span: this is the one funnel, so the client
    // half of the journey is measured once, here. Off unless the device has
    // opted in — see lib/activity-logging.ts — and the id is threaded onto the
    // wire so the server's spans join these rather than starting afresh.
    const span = traceClientRequest(action);

    try {
      const result = await this.routeRequest<T>(action, payload, via, span.traceId);
      log.ok(via.transport);
      span.done({ success: true, transport: via.transport });
      return result;
    } catch (err) {
      log.fail(err);
      span.done({
        success: false,
        transport: via.transport,
        error: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }
  }

  private async routeRequest<T>(
    action: string,
    payload: Record<string, unknown>,
    via: { transport: string },
    traceId?: string,
  ): Promise<T> {
    // Community mode on relay Mac: execute HomeKit actions directly, with cache
    if (isCommunity && communityRelayConfirmed) {
      via.transport = 'community';
      return communityRequest<T>(action, payload);
    }

    // Local Mode: this device answers from its own HomeKit because the relay
    // cannot. Ids arrive here in the cloud's stable space and leave in it too —
    // the live UUIDs this device's HomeKit uses never escape the controller.
    // Imported lazily so this module stays loadable in node tests, which have
    // no `window` for the controller to read.
    const local = getLocalModeRouter();
    if (local?.canServe(action, payload)) {
      via.transport = 'local-mode';
      return local.request<T>(action, payload);
    }

    if (!this.websocket) {
      // In Local Mode this is reachable by ordinary use rather than by a
      // programming error — the cloud is simply gone — so it needs a message
      // a person could act on, and a code the UI can recognise.
      if (local?.isActive()) {
        throw new LocalOnlyError(action);
      }
      // Reachable by ordinary use too, not only by a programming error: a hook
      // can mount before `activate()` has finished, and a signed-out session
      // never activates at all. So it carries a code and reads like the rest.
      throw new HomecastError('DISCONNECTED', 'Not connected to Homecast');
    }
    return this.websocket.request<T>(action, payload, traceId);
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
    // The socket's timeline is what makes the request log readable at launch:
    // a fetch that failed is only explicable next to the moment the transport
    // actually became usable.
    if (updates.connectionState && updates.connectionState !== this.state.connectionState) {
      logEvent('socket', updates.connectionState);
    }
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

/**
 * The relay is now reachable at a different one of its addresses.
 *
 * Called by the native shell when the phone changes network and the address
 * race picks a different winner. Everything here is deliberately in-place: the
 * shell used to recreate the whole WebView, which blanked the screen and lost
 * the user's position for what is, from their point of view, nothing more than
 * a change of route.
 *
 * Returns false when the address was already the one in use, so the caller can
 * skip announcing a change that did not happen.
 */
export function relayAddressChanged(origin: string): boolean {
  if (!setActiveRelayOrigin(origin)) return false;
  // HTTP follows the getter on its own; the socket is already open on the old
  // address and has to be moved.
  serverConnection.switchWebSocketEndpoint(config.wsUrl);
  window.dispatchEvent(new CustomEvent('homecast:relay-address-changed', { detail: { origin } }));
  return true;
}

// The shell has no module graph, so this is how it reaches the function above.
(window as unknown as { __homecastRelayMoved?: (o: string) => boolean }).__homecastRelayMoved =
  relayAddressChanged;

export default serverConnection;
