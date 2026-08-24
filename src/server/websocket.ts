/**
 * WebSocket client for server communication.
 *
 * In relay mode (Mac app): Connects to server, receives requests, handles them via local HomeKit
 * In browser mode: Connects to server, sends requests (routed to remote relay), receives broadcasts
 */

import { HomeKit, HomeKitEvent, isRelayCapable, isRelayEnabled, withCallReason } from '../native/homekit-bridge';
import { executeHomeKitAction, setAccessoryLimit as setLocalHandlerAccessoryLimit, isAccessoryAllowed } from '../relay/local-handler';
import { invalidateHomeKitCache } from '../hooks/useHomeKitData';
import { logEvent } from '../lib/request-log';
import { preferredWsUrl, rememberAffinityTarget, forgetAffinityTarget } from './affinity-target';
import type { RequestTrace, TraceStep } from '../lib/types/trace';
import { config as appConfig } from '../lib/config';
import { browserLogger } from '../lib/browser-logger';
import { traceRelayRequest } from '../lib/activity-spans';
import { initAutomationEngine, teardownAutomationEngine, getAutomationEngine, HomeKitServiceGroupResolver, NOTIFY_DELIVERY_UNKNOWN } from '../automation';
import type { NotifyDelivery } from '../automation';
import { resolveHomeLocation } from '../automation/location';
import { createHomeKitBridgeAdapter, createSyncTransport, dispatchAutomationMessage, clearAutomationHandlers } from '../automation/relay-adapter';
import { setRelayWritePublisher } from '../relay/relay-write';
import { errorCode } from '../lib/describe-error';
import { canServeLocally, resolveLocalHomeId } from './relay-routing';
import {
  emitLocalRelayActivity, hasLocalActivityListeners, activityNow,
} from './local-activity';

/** Bounded like the socket lane's payloads — a sync_all carries every automation. */
function summariseCloudMessage(message: { payload?: unknown }): unknown {
  const payload = message.payload;
  if (payload === null || payload === undefined) return undefined;
  try {
    const json = JSON.stringify(payload);
    if (json === undefined) return '[unserialisable]';
    if (json.length <= 2000) return payload;
    if (Array.isArray(payload)) return `[${payload.length} items, ${json.length} bytes]`;
    if (typeof payload === 'object') {
      const shape: Record<string, string> = {};
      for (const [k, v] of Object.entries(payload as Record<string, unknown>)) {
        shape[k] = Array.isArray(v) ? `[${v.length} items]` : typeof v;
      }
      return { '…truncated': `${json.length} bytes`, ...shape };
    }
    return `${json.slice(0, 2000)}…`;
  } catch {
    return '[unserialisable]';
  }
}
import { NativeRelayWebSocket, shouldUseNativeRelayWs } from './native-relay-ws';

// Protocol message types
interface ProtocolMessage {
  id: string;
  type: 'request' | 'response' | 'event';
  /** Client-originated trace id, so the server joins this journey. */
  trace_id?: string;
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

/** One line of a relay's live activity stream. See relay-write / handler.py. */
export interface RelayActivityEntry {
  lane: 'socket' | 'homekit' | 'automation' | 'cloud' | 'bridge';
  at: number;
  /** Why this happened, for calls nobody asked for directly. */
  reason?: string;
  /** Correlates a socket entry's `sent` with its outcome, so one request is one row. */
  id?: string;
  /** Where the request came from: this Mac's own UI, or the cloud. */
  origin?: 'local' | 'cloud';
  /** socket */
  phase?: 'sent' | 'ok' | 'failed';
  action?: string;
  ms?: number;
  error?: string;
  traceId?: string;
  /** What was asked for, and what came back. Truncated — see local-handler. */
  request?: unknown;
  response?: unknown;
  /** homekit */
  accessoryId?: string;
  characteristicType?: string;
  value?: unknown;
  homeId?: string;
  /** automation — the stored trace, verbatim */
  automationId?: string;
  name?: string;
  status?: string;
  startedAt?: string;
  finishedAt?: string;
  triggerData?: Record<string, unknown>;
  steps?: Record<string, unknown>[];
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
  /**
   * `silent` marks a transition the user should not be told about — currently
   * the affinity-redirect handoff, which is a deliberate sub-second pod move
   * rather than a connection problem.
   */
  onStateChange?: (state: ConnectionState, opts?: { silent?: boolean }) => void;
  onError?: (error: Error) => void;
  onBroadcast?: (message: BroadcastMessage) => void;
  onConnected?: () => void;
  onRelayStatusChange?: (isActiveRelay: boolean) => void;
  /** Connection quality changed. See ./connection-quality.ts. */
  onQualityChange?: (quality: ConnectionQuality) => void;
}

// Pending request tracking
interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
  /**
   * When this went out. Read by the quality classifier, which judges the
   * connection largely on how long the oldest unanswered request has been
   * waiting — the only signal that still works on a half-open socket, where
   * nothing completes and a completions-only metric goes silent.
   */
  sentAt: number;
}

// Reconnection settings
import {
  INITIAL_RECONNECT_DELAY, nextReconnectDelay, resetsBackoff, jitter,
  isSocketStale,
} from './reconnect-policy';
import {
  type ConnectionQuality, type HysteresisState,
  classifyQuality, applyHysteresis, initialHysteresis, pushRtt,
} from './connection-quality';
const HEARTBEAT_INTERVAL = 30000;
const REQUEST_TIMEOUT = 30000; // 30 second timeout for requests
/**
 * How often connection quality is re-judged while a request is outstanding.
 *
 * Fast enough that the ~2.5s "slow" threshold is reported near the moment it is
 * crossed rather than up to a tick late — this is the cadence that turns "30
 * seconds of silence" into "something said so at two and a half".
 */
const QUALITY_TICK_MS = 500;

/**
 * The idle cadence, once nothing is in flight but the state is still degraded.
 *
 * Nothing needs sub-second resolution here: there is no request whose age is
 * about to cross a threshold. It exists only so a recovery completes on the
 * hysteresis hold (~3s) instead of waiting for the next 30s heartbeat, and a
 * connection that is merely slow should not also cost a wakeup twice a second
 * for as long as it lasts.
 */
const QUALITY_IDLE_TICK_MS = 2_000;
/** How long to wait for the server's first word before assuming the socket is
 *  usable anyway. Generous — it only runs when the server says nothing. */
const READY_FALLBACK_MS = 2000;
/** Grace after the server's greeting, so a redirect that follows it by ~10ms
 *  lands first. See announceReady. */
const READY_GRACE_MS = 250;
// Short by design: a notify action must not stall the rest of the automation
// waiting on a report that is only ever used to annotate the trace.
const NOTIFY_RESULT_TIMEOUT_MS = 8000;

/**
 * Self-reported relay metadata, sent as query params on connect.
 *
 * The native app injects these onto `window` (HomecastApp.swift) — JS has no
 * way to read the host's OS version, hardware model or hostname on its own.
 * Everything is optional: a build that doesn't inject them just sends fewer
 * params and the admin panel shows "not reported".
 */
function getRelayTelemetry(): Record<string, string | undefined> {
  const win = window as Window & {
    homecastAppVersion?: string;
    homecastAppBuild?: string;
    homecastOSVersion?: string;
    homecastDeviceModel?: string;
    homecastHostName?: string;
    homecastPlatform?: string;
    isHomecastMacApp?: boolean;
  };
  return {
    app_version: win.homecastAppVersion,
    app_build: win.homecastAppBuild,
    os_version: win.homecastOSVersion,
    device_model: win.homecastDeviceModel,
    hostname: win.homecastHostName,
    platform: win.homecastPlatform ?? (win.isHomecastMacApp ? 'macos' : undefined),
  };
}

/**
 * WebSocket client for server communication.
 * Handles the PROTOCOL.md message format for both relay and browser modes.
 */
export class ServerWebSocket {
  private config: ServerConfig;
  private callbacks: ServerWebSocketCallbacks;
  private ws: WebSocket | NativeRelayWebSocket | null = null;
  private state: ConnectionState = 'disconnected';
  /**
   * When `state` last changed. Initialised to construction rather than 0, so a
   * client that has not connected yet reads as "coming up" for the grace
   * period rather than as an instant outage on boot.
   */
  private stateSince = Date.now();
  private reconnectDelay = INITIAL_RECONNECT_DELAY;
  /** Set while an affinity-redirect handoff is in flight — see redirectTo(). */
  private handingOff = false;
  /**
   * When anything last arrived on the socket. The only evidence that the
   * connection is still real — `readyState` reports a half-open socket as OPEN
   * indefinitely.
   */
  private lastInboundAt = 0;

  // ── Connection quality (see ./connection-quality.ts) ──────────────────────
  /**
   * When the outstanding heartbeat ping went out, or null when none is.
   *
   * Only one is ever in flight — pings are 30s apart and a pong arrives long
   * before the next — so the pong needs no id to be matched to its ping, and
   * neither server had to change to make this measurable.
   */
  private lastPingSentAt: number | null = null;
  private rttSamples: number[] = [];
  private lastRttAt = 0;
  /** Reset by any success; two in a row is a condition rather than bad luck. */
  private consecutiveFailures = 0;
  private qualityState: HysteresisState = initialHysteresis('unknown');
  /**
   * Only runs while there is something to watch.
   *
   * Quality depends on the clock — an in-flight request gets worse simply by
   * staying in flight — so it cannot be evaluated on events alone. But a timer
   * ticking forever on an idle relay is exactly the kind of background work
   * this codebase already fights (App Nap, event-loop stalls), so it is armed
   * only while a request is outstanding or the connection is already degraded,
   * and disarmed the moment neither is true.
   */
  private qualityTicker: ReturnType<typeof setInterval> | null = null;
  /** The cadence the live ticker was created with, so a change can restart it. */
  private qualityTickerInterval = 0;
  private reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
  private heartbeatInterval: ReturnType<typeof setInterval> | null = null;
  private heartbeatVisibilityHandler: (() => void) | null = null;
  private eventUnsubscribe: (() => void) | null = null;
  private isManualDisconnect = false;
  private pendingRequests = new Map<string, PendingRequest>();
  /** Whether this socket has been announced usable — see armReadyAnnouncement. */
  private readyAnnounced = false;
  private readyTimer: ReturnType<typeof setTimeout> | null = null;
  private readyGraceTimer: ReturnType<typeof setTimeout> | null = null;
  /** The configured endpoint, before any remembered affinity target. */
  private frontDoorWsUrl = '';
  /** Whether this socket ever produced a server message. */
  private heardFromServer = false;
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
  /**
   * Home ids this relay's own HomeKit has rejected.
   *
   * Ownership and addressability are different questions, and the fast path
   * conflated them. The cloud addresses homes by stable hc_id; HomeKit only
   * knows its live UUIDs. An hc_id for a home this relay genuinely owns passes
   * the ownership check, reaches HomeKit, and fails with HOME_NOT_FOUND —
   * measured live on all three homes of the managed relay.
   *
   * The cloud can resolve those ids and we cannot, so once HomeKit has
   * disowned one we stop claiming it and let the request route out.
   *
   * Deliberately survives reconnects. It used to clear on disconnect "in case
   * the mapping moved", which sounded prudent and was wrong: the relay
   * reconnects every few minutes, so every reconnect paid for three fresh
   * failures and the flood never stopped. A moved mapping shows up in
   * `liveHomeIds` instead, which is refreshed from HomeKit directly.
   */
  private unservableHomeIds = new Set<string>();

  /**
   * The homes HomeKit reports on this Mac. Asked, not inferred — it is the
   * component that has to resolve the id, so it is the only authority on
   * whether the fast path can serve it.
   */
  private liveHomeIds = new Set<string>();
  private liveHomesRefreshedAt = 0;

  /**
   * Stable hc_id -> live HomeKit UUID, as the server last reported it.
   *
   * Rebuilt wholesale from every homes.list rather than merged, so a pair the
   * server has stopped reporting disappears instead of lingering. Never trusted
   * on its own — see resolveLocalHomeId, which only uses a translation HomeKit
   * is currently confirming.
   */
  private hcToLiveHomeId = new Map<string, string>();
  private relayAssignmentTimeout: ReturnType<typeof setTimeout> | null = null;

  // Buffer for automation.* messages received before engine is initialized
  private automationEngineReady = false;
  private automationMessageBuffer: { type: string; payload: Record<string, unknown> }[] = [];
  private serviceGroupResolver: HomeKitServiceGroupResolver | null = null;

  // In-flight notify actions awaiting the server's delivery report, keyed by
  // the notifyId we sent. Only the server knows whether a push was rate
  // limited, suppressed by preference, or had no device to go to.
  private pendingNotifies = new Map<string, (delivery: NotifyDelivery) => void>();

  // Wake/visibility handler for recalculating time triggers after sleep
  private automationWakeHandler: (() => void) | null = null;
  private lastTickAt = Date.now();
  private clockDriftInterval: ReturnType<typeof setInterval> | null = null;
  // Debounce timer for homes.updated events (homeManagerDidUpdateHomes can fire multiple times)
  private homesUpdatedDebounce: ReturnType<typeof setTimeout> | null = null;

  // Accessory→home/room mapping cache (avoids extra accessory.get round-trip on characteristic.set)
  // Per-session, cleared on disconnect/reconnect — no TTL needed
  private accessoryHomeCache = new Map<string, { homeId: string; roomId: string }>();

  // Group→home mapping, remembered from any group announce that carried a
  // homeId. Old cached automations announce group writes without one, and the
  // cloud skips the MQTT publish entirely when the event has no homeId —
  // unlike accessories there is no cheap HomeKit lookup for a group's home.
  private groupHomeCache = new Map<string, string>();

  constructor(config: ServerConfig, callbacks: ServerWebSocketCallbacks = {}) {
    const frontDoor = config.wsUrl || appConfig.wsUrl;
    this.frontDoorWsUrl = frontDoor;
    this.config = {
      ...config,
      // Start where the server sent us last time, so the affinity handoff does
      // not have to happen again. Falls back to `frontDoor` the moment a
      // connection there fails to get a word out of the server.
      wsUrl: preferredWsUrl(frontDoor),
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
   * Tell the engine what everything is currently set to, before HomeKit does.
   *
   * HomeKit delivers every accessory's value right after the relay subscribes,
   * and each arrives as `undefined -> value`. A trigger naming only `to:` has
   * nothing to reject that with, so every automation whose target matched the
   * current state fired at once: a restart notified for all of them.
   *
   * Seeding first turns that burst into a no-op — the values already match, and
   * the store no longer publishes a non-change. Uses `accessories.list`, which
   * this relay already calls constantly, so it costs one more of a request we
   * were making anyway rather than a new kind of traffic.
   *
   * Never throws: failing to seed costs a noisy restart, not a broken relay.
   */
  private async collectCurrentValues(): Promise<Array<{ accessoryId: string; characteristicType: string; value: unknown }>> {
    const collected: Array<{ accessoryId: string; characteristicType: string; value: unknown }> = [];
    try {
      // Ask HomeKit directly rather than relying on liveHomeIds, which is
      // populated by a refresh that may not have finished yet — the ordering
      // bug this whole change exists to remove.
      const homesResult = await withCallReason('startup seed: list homes',
        () => executeHomeKitAction('homes.list', {})) as { homes?: Array<{ id: string }> };
      const homeIds = (homesResult?.homes ?? []).map((h) => h.id).filter(Boolean);
      if (homeIds.length === 0) return collected;

      for (const homeId of homeIds) {
        const result = await withCallReason('startup seed: current values, so HomeKit\'s burst is not a change',
          () => executeHomeKitAction('accessories.list', {
            homeId, includeValues: true, includeAll: true,
          })) as { accessories?: Array<{ id: string; services?: Array<{ characteristics?: Array<{ characteristicType: string; value: unknown }> }> }> };

        for (const accessory of result?.accessories ?? []) {
          for (const service of accessory.services ?? []) {
            for (const characteristic of service.characteristics ?? []) {
              if (characteristic?.value === undefined) continue;
              collected.push({
                accessoryId: accessory.id,
                characteristicType: characteristic.characteristicType,
                value: characteristic.value,
              });
            }
          }
        }
      }
    } catch (e) {
      console.warn('[ServerWS] Could not read current values — this start may re-fire triggers', e);
    }
    return collected;
  }

  /**
   * Ask HomeKit which homes this Mac actually has.
   *
   * Cheap — it is a local bridge call with no network — and it is what lets the
   * fast path decline an id it could never resolve instead of discovering that
   * by failing. Never throws: if HomeKit will not answer we simply keep the
   * previous set and fall back to ownership, which is the old behaviour.
   */
  private async refreshLiveHomes(): Promise<void> {
    try {
      const result = await withCallReason('relay start: which homes does HomeKit have',
        () => executeHomeKitAction('homes.list', {})) as { homes?: Array<{ id: string }> };
      const ids = (result?.homes ?? []).map((h) => h.id?.toUpperCase()).filter(Boolean) as string[];
      if (ids.length === 0) return;

      this.liveHomeIds = new Set(ids);
      this.liveHomesRefreshedAt = Date.now();
      // An id HomeKit now reports is servable again, whatever happened before —
      // this is how a genuinely moved mapping recovers without a restart.
      for (const id of ids) this.unservableHomeIds.delete(id);
    } catch (e) {
      console.warn('[ServerWS] Could not read live homes from HomeKit', e);
    }
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
   * Move this socket to a different address for the *same* relay.
   *
   * Community's version of a pod handoff: the relay has not changed, only
   * which of its addresses reaches it — the phone left the house, or came
   * back. Deliberately does not remember an affinity target, which is a cloud
   * concept and host-locked besides; the relay store already knows where it
   * got through.
   */
  switchEndpoint(wsUrl: string): void {
    if (!wsUrl || wsUrl === this.config.wsUrl) return;
    console.log(`[ServerWS] Relay address changed, moving socket to ${wsUrl}`);
    this.cleanup();
    this.config.wsUrl = wsUrl;
    // The front door moves with it, or the silence-fallback at the end of
    // connect() would drag the socket back to the address we just left.
    this.frontDoorWsUrl = wsUrl;
    this.reconnectDelay = INITIAL_RECONNECT_DELAY;
    // Same reasoning as a pod handoff: the socket is being moved on purpose
    // and is back in well under a second, so telling the user their connection
    // dropped would describe a fault that did not happen.
    this.handingOff = true;
    this.setState('reconnecting');
    this.establishConnection();
  }

  /**
   * Redirect to a specific server endpoint (GKE pod affinity).
   * Overrides the WebSocket URL and reconnects immediately.
   */
  private redirectTo(target: string): void {
    // Clean up current connection
    this.cleanup();

    // Override the WebSocket URL for this session
    this.config.wsUrl = target;
    // ...and for the next one. The redirect costs a whole second connection —
    // measured at 1.2s and 4.6s on two consecutive iPhone launches — and it
    // fires on every single connect, because the client always starts from the
    // generic endpoint. The server does not redirect a connection that already
    // carries the affinity it would have assigned (its `existing_affinity`
    // guard), so starting from the last known target skips the handoff.
    //
    // Worth doing even though the affinity itself is currently decorative for
    // shared and cloud-managed accounts, where the two sides key off different
    // identifier spaces and never co-locate: the cost of the second connection
    // is real whether or not the co-location it buys is.
    rememberAffinityTarget(target);
    console.log(`[ServerWS] Redirecting to ${target}`);

    // Reset backoff delay for immediate reconnect
    this.reconnectDelay = INITIAL_RECONNECT_DELAY;

    // A pod handoff is not a connection loss. The socket is being moved on
    // purpose and is back in well under a second, so telling the user their
    // connection dropped — and then that it recovered — describes a fault
    // that did not happen. Every session takes one of these, so without this
    // the banner greets people on an ordinary page load.
    this.handingOff = true;

    // Reconnect immediately to the new target
    this.setState('reconnecting');
    this.establishConnection();
  }

  /**
   * Graceful reconnect - close and immediately reconnect without backoff.
   * Used when server requests reconnect (e.g., Cloud Run timeout approaching).
   */
  /**
   * Fail everything in flight, because this socket can no longer answer it.
   *
   * Rejecting rather than replaying: a caller knows whether its request is
   * safe to repeat and we do not, and every read path here already retries.
   * The important part is that it happens *promptly* — a rejection frees
   * DataCache's per-key dedupe immediately, whereas a hung promise blocks
   * every subsequent attempt for the whole request timeout.
   */
  /**
   * Hold "connected" back until the server has said something.
   *
   * A socket being open is not the same as it being usable. On GKE the server
   * answers a connection landing on the wrong pod with a `redirect` and tears
   * it down — measured at ~90ms after open, every launch. Announcing on the raw
   * open meant the app fired its whole opening burst into a socket the server
   * had already decided to discard: six requests, all failing DISCONNECTED,
   * then a retry round. Waiting for the server's first word costs those same
   * ~90ms and skips the doomed round entirely.
   *
   * The fallback matters as much as the wait: a server that never sends a hello
   * (an older build, or one that only speaks when spoken to) must not leave the
   * app permanently "connecting". Same shape as the relay_status fallback below.
   */
  private armReadyAnnouncement(): void {
    this.readyAnnounced = false;
    if (this.readyTimer) clearTimeout(this.readyTimer);
    this.readyTimer = setTimeout(() => {
      console.log('[ServerWS] No greeting from the server — assuming usable');
      this.announceReady();
    }, READY_FALLBACK_MS);
  }

  /**
   * Announce after a short grace, not on the greeting itself.
   *
   * Measured: the server sends its hello and *then* `redirect (home_affinity)`
   * **10ms later**. Announcing on the hello only avoided the doomed request
   * burst because React could not re-render inside 10ms — a race won, not a
   * race closed. The grace lets a redirect overtake the greeting, which is the
   * order the server actually sends them in.
   *
   * Cheap at this scale: the requests it gates take 200ms–5s on this path, and
   * the connection it waits on took over a second to establish.
   */
  private announceReady(): void {
    if (this.readyAnnounced || this.readyGraceTimer) return;
    this.readyGraceTimer = setTimeout(() => {
      this.readyGraceTimer = null;
      this.readyAnnounced = true;
      if (this.readyTimer) {
        clearTimeout(this.readyTimer);
        this.readyTimer = null;
      }
      this.setState('connected');
    }, READY_GRACE_MS);
  }

  private failPendingRequests(reason: string): void {
    if (this.pendingRequests.size === 0) return;
    for (const [, pending] of this.pendingRequests) {
      clearTimeout(pending.timeout);
      pending.reject(new HomecastError('DISCONNECTED', reason));
    }
    this.pendingRequests.clear();
  }

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
  async request<T = unknown>(
    action: string,
    payload: Record<string, unknown> = {},
    traceId?: string,
  ): Promise<T> {
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

    const homeKey = homeId?.toUpperCase();
    // An hc_id names a home this relay serves but HomeKit cannot look up. If we
    // hold a translation HomeKit is currently confirming, use it and stay on the
    // fast path; otherwise this is not ours to answer and it goes to the server.
    const localHomeId = homeKey
      ? resolveLocalHomeId(homeKey, {
          liveHomeIds: this.liveHomeIds,
          hcToLive: this.hcToLiveHomeId,
        })
      : undefined;

    if (localHomeId !== null && canServeLocally(action, localHomeId ?? undefined, {
      isActiveRelay: this.isActiveRelay,
      ownedHomeIds: this.ownedHomeIds,
      liveHomeIds: this.liveHomeIds,
      unservableHomeIds: this.unservableHomeIds,
    })) {
      if (import.meta.env.DEV) console.log(`[ServerWS] Local request: ${action}`, payload);
      try {
        const localPayload = localHomeId && localHomeId !== homeKey
          ? { ...payload, homeId: localHomeId }
          : payload;
        const result = await executeHomeKitAction(action, localPayload);
        if (import.meta.env.DEV) console.log(`[ServerWS] Local response: ${action}`, result);

        // Nothing to publish here: every write path announces itself from
        // relay-write.ts, which is the whole point of that module. This used to
        // be a second, hand-maintained list of write actions, and it is how
        // state.set came to update no client at all.

        return result as T;
      } catch (error) {
        // HomeKit not recognising the home means we were addressed in an id
        // space this relay does not speak — not that the request is bad. The
        // cloud resolves those, so retire the id here and route it out rather
        // than failing something that is perfectly serviceable one hop away.
        if (homeKey && errorCode(error) === 'HOME_NOT_FOUND') {
          this.unservableHomeIds.add(homeKey);
          // The translation we used is disproven, so forget it — keeping it
          // would mean translating to an id HomeKit has just disowned.
          this.hcToLiveHomeId.delete(homeKey);
          // Re-ask rather than assume: if this id failed because the mapping
          // moved, the fresh list restores it. Fire-and-forget.
          void this.refreshLiveHomes();
          console.warn(
            `[ServerWS] HomeKit does not know home ${homeKey} — routing ${action} ` +
            `via the server from now on (stable id vs live HomeKit UUID)`,
          );
          // Deliberately neither returns nor rethrows: falling out of the block
          // hands the request to the outbound path below, which is the one that
          // owns timeouts, correlation and the homes.list cache.
        } else {
          console.error(`[ServerWS] Local request failed: ${action}`, error);
          throw error;
        }
      }
    }

    // Browser mode / server-routed request - send over WebSocket
    if (import.meta.env.DEV) console.log(`[ServerWS] Remote request: ${action}`, payload);

    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      // Fails fast rather than waiting out REQUEST_TIMEOUT, which is right —
      // there is nothing to wait for. But it used to be a bare Error with no
      // `code`, so it slipped past `describeWriteFailure` and a tap made while
      // offline surfaced the raw string "WebSocket not connected" to the user.
      // Every other transport failure names the accessory instead.
      throw new HomecastError('DISCONNECTED', 'WebSocket not connected');
    }

    const id = `req_${Date.now()}_${++this.requestIdCounter}`;

    const sentAt = Date.now();
    const promise = new Promise<T>((resolve, reject) => {
      // Set up timeout
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(id);

        // A request that times out while *nothing at all* has arrived since it
        // was sent is the dead-socket signature. Both sides ping every 30s, so
        // a healthy connection cannot go a whole request timeout in silence —
        // and a merely slow request still sees heartbeats, which is what keeps
        // this from tearing down a working socket.
        //
        // Without it, a half-open socket made every request time out forever:
        // the only cure was the user reloading the app, which is exactly what
        // happened before this existed.
        if (this.lastInboundAt <= sentAt) {
          console.warn(
            `[ServerWS] ${action} timed out with no traffic since it was sent — ` +
            'rebuilding the socket rather than failing every request after it',
          );
          browserLogger.logInfo('ws_timeout_reconnect', { action, silent_ms: Date.now() - sentAt });
          this.gracefulReconnect();
        }

        this.consecutiveFailures++;
        this.evaluateQuality();
        reject(new HomecastError('TIMEOUT', `Request timed out: ${action}`));
      }, REQUEST_TIMEOUT);

      // Store pending request
      this.pendingRequests.set(id, {
        resolve: resolve as (value: unknown) => void,
        reject,
        timeout,
        sentAt,
      });
      // A request going out is itself news: it starts the clock the quality
      // classifier reads, and arms the ticker that watches it age.
      this.evaluateQuality();

      // Send request
      const message: ProtocolMessage = {
        id,
        type: 'request',
        action,
        payload,
      };
      // Carry the client's trace id so the server continues that journey rather
      // than minting its own. Outbound frames used to carry none at all, which
      // is why nothing a client did could ever be joined to what the server
      // then went and did about it.
      if (traceId) message.trace_id = traceId;
      this.send(message);
    });

    // Cache owned home IDs from homes.list response for relay routing decisions
    if (action === 'homes.list') {
      return promise.then((result) => {
        const homes = (result as {
          homes?: Array<{ id: string; role?: string; liveId?: string | null; hcId?: string | null }>;
        })?.homes;
        if (homes) {
          this.ownedHomeIds = new Set(
            homes.filter(h => h.role === 'owner').map(h => h.id.toUpperCase())
          );

          // Rebuilt, not merged: a pair the server has stopped reporting must
          // disappear rather than linger. Only the relay is sent these — every
          // other client stays in stable-id space by design.
          const pairs = new Map<string, string>();
          for (const home of homes) {
            if (!home.hcId || !home.liveId) continue;
            pairs.set(home.hcId.toUpperCase(), home.liveId.toUpperCase());
          }
          if (pairs.size > 0 || this.hcToLiveHomeId.size > 0) {
            this.hcToLiveHomeId = pairs;
          }
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
      this.stateSince = Date.now();
      if (newState === 'connected') {
        this.connectedAt = Date.now();
      } else if (newState === 'disconnected') {
        this.connectedAt = null;
      }
      // A redirect handoff runs reconnecting → connected. Both halves are
      // silent: the drop never happened, so neither should the "recovered"
      // that would follow it. Cleared once we are back up.
      const silent = this.handingOff;
      if (newState === 'connected') this.handingOff = false;
      this.callbacks.onStateChange?.(newState, { silent });

      // A new socket has measured nothing yet, and the old socket's samples
      // describe a connection that no longer exists. Starting from `unknown`
      // is the honest position; the first pong lands within a round trip.
      if (newState !== 'connected') {
        this.rttSamples = [];
        this.lastRttAt = 0;
        this.lastPingSentAt = null;
        this.consecutiveFailures = 0;
      }
      this.evaluateQuality();
    }
  }

  // ── Connection quality ────────────────────────────────────────────────────

  /**
   * Re-judge the connection and tell anyone listening if the answer changed.
   *
   * Cheap and idempotent, so it is safe to call from every event that could
   * possibly matter rather than trying to work out which ones do.
   */
  private evaluateQuality(): void {
    const now = Date.now();

    // The oldest unanswered request. `Math.min` over the map rather than a
    // separately-maintained pointer: the map is small (a launch burst is
    // single digits) and a derived value cannot drift out of sync with it.
    let oldestInFlightSentAt: number | null = null;
    for (const pending of this.pendingRequests.values()) {
      if (oldestInFlightSentAt === null || pending.sentAt < oldestInFlightSentAt) {
        oldestInFlightSentAt = pending.sentAt;
      }
    }

    const raw = classifyQuality({
      socketState: this.state,
      socketStateSince: this.stateSince,
      rttSamples: this.rttSamples,
      lastRttAt: this.lastRttAt,
      oldestInFlightSentAt,
      consecutiveFailures: this.consecutiveFailures,
    }, now);

    const before = this.qualityState.shown;
    this.qualityState = applyHysteresis(this.qualityState, raw, now);
    if (this.qualityState.shown !== before) {
      logEvent('quality', `${before} → ${this.qualityState.shown}`);
      this.callbacks.onQualityChange?.(this.qualityState.shown);
    }

    this.syncQualityTicker(oldestInFlightSentAt !== null);
  }

  /**
   * Arm the ticker only while it has something to say.
   *
   * It stays armed while the shown state is not `good`, because recovering
   * needs a tick too: nothing else fires once the requests have drained.
   */
  private syncQualityTicker(hasInFlight: boolean): void {
    const wanted = hasInFlight
      || this.qualityState.shown !== 'good'
      || this.qualityState.improvingSince !== null;
    const interval = hasInFlight ? QUALITY_TICK_MS : QUALITY_IDLE_TICK_MS;

    if (!wanted) {
      if (this.qualityTicker) {
        clearInterval(this.qualityTicker);
        this.qualityTicker = null;
      }
      this.qualityTickerInterval = 0;
      return;
    }

    // Restart when the cadence should change — a request going out has to take
    // it from the idle rate to the watching rate, or the threshold it exists to
    // catch would be reported up to two seconds late.
    if (this.qualityTicker && this.qualityTickerInterval !== interval) {
      clearInterval(this.qualityTicker);
      this.qualityTicker = null;
    }
    if (!this.qualityTicker) {
      this.qualityTickerInterval = interval;
      this.qualityTicker = setInterval(() => this.evaluateQuality(), interval);
    }
  }

  /** What we currently believe about this connection. */
  getConnectionQuality(): ConnectionQuality {
    return this.qualityState.shown;
  }

  /** Most recent round-trip time in ms, or null when nothing is measured. */
  getLastRttMs(): number | null {
    return this.rttSamples.length ? this.rttSamples[this.rttSamples.length - 1] : null;
  }

  /** When the most recent round trip was measured. 0 when never. */
  getLastRttAt(): number {
    return this.lastRttAt;
  }

  /**
   * Forget what we measured and say so.
   *
   * Called when the evidence stops being evidence — returning from a hidden
   * tab, where the heartbeat was suspended and the samples describe a
   * connection from before the app was put away. Reporting a confident "42ms"
   * from those would reproduce, inside the indicator built to fix it, the
   * exact bug this work exists to remove.
   */
  private invalidateQualitySamples(): void {
    this.rttSamples = [];
    this.lastRttAt = 0;
    this.lastPingSentAt = null;
    this.evaluateQuality();
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
    // Liveness, separate from the per-minute counters below: any inbound frame
    // is proof the peer is still there, which readyState cannot give us.
    this.lastInboundAt = Date.now();

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
        // Tell the cloud what's actually running this relay. Without it a relay
        // is anonymous beyond its device_id, so the admin panel can't tell a
        // stale build from a current one. All optional — the server stores
        // whatever arrives and leaves the rest NULL.
        for (const [param, value] of Object.entries(getRelayTelemetry())) {
          if (value) url.searchParams.set(param, value);
        }
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
      if (shouldUseNativeRelayWs()) {
        console.log('[ServerWS] Using native relay WebSocket transport');
        this.ws = new NativeRelayWebSocket(url.toString());
      } else {
        this.ws = new WebSocket(url.toString());
      }

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
    // Deliberately NOT announced yet — see armReadyAnnouncement. The socket is
    // open, but the server has not said whether it intends to keep it.
    this.armReadyAnnouncement();
    this.connectionOpenedAt = Date.now();
    // Start the liveness clock now: a socket that has just opened is alive,
    // and would otherwise inherit the previous connection's last timestamp.
    this.lastInboundAt = Date.now();
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

    void this.refreshLiveHomes();
    this.subscribeToHomeKitEvents();

    // Service-group triggers are skipped entirely unless a resolver is injected.
    const serviceGroupResolver = new HomeKitServiceGroupResolver();
    serviceGroupResolver.start();
    this.serviceGroupResolver = serviceGroupResolver;

    // Initialize automation engine
    // Register how this relay reaches everyone that isn't the engine, before
    // anything can write. Every write path fans out through relay-write.ts.
    setRelayWritePublisher({
      characteristic: (change) => {
        void this.publishCharacteristicWrite(
          change.accessoryId, change.characteristicType, change.value, change.homeId,
        );
      },
      serviceGroup: (groupId, characteristicType, value, homeId, affectedCount) => {
        this.publishServiceGroupWrite(groupId, characteristicType, value, homeId, affectedCount);
      },
    });

    initAutomationEngine({
      serviceGroupResolver,
      // Applied before the engine subscribes — see InitOptions.seedState.
      seedState: () => this.collectCurrentValues(),
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
        // requestFn: not currently used (server pushes configs proactively)
        (action, payload) => this.request(action, payload),
      ),
      subscribeToHomeKit: (handler) => HomeKit.onEvent(handler),
      onNotify: (message, title, data, automationId) => {
        // The automation's home scopes both the member fan-out and per-device
        // home mutes on the server. Without it the server guesses from
        // relay_homes, which picks an arbitrary home on a multi-home relay.
        const homeId = automationId
          ? getAutomationEngine()?.getAutomation(automationId)?.homeId
          : undefined;

        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
          // sendEvent silently drops on a closed socket, which used to mean
          // the notification vanished entirely. The household fan-out really
          // is unreachable with the cloud link down, but the Mac running the
          // automation can still banner locally.
          void HomeKit.showNotification(title, message, data).catch((err) => {
            console.warn('[ServerWS] Local notification fallback failed:', err);
          });
          return Promise.resolve({ delivered: true, channels: ['local'] });
        }

        // Send to cloud server for APNs/FCM delivery to all devices.
        // The server reports back what it managed to deliver so the execution
        // trace can say so; a server too old to answer, or one that never gets
        // round to it, leaves the step recorded as unknown rather than as sent.
        const notifyId = `ntf_${Date.now()}_${this.requestIdCounter++}`;
        this.sendEvent({
          id: `evt_${Date.now()}_notify`,
          type: 'automation',
          action: 'automation.notify',
          payload: { message, title, data, automationId, notifyId, homeId },
        });
        return this.awaitNotifyResult(notifyId);
      },
    }).then((engine) => {
      // Engine is ready — flush any buffered automation messages
      this.automationEngineReady = true;
      for (const msg of this.automationMessageBuffer) {
        dispatchAutomationMessage(msg.type, msg.payload);
      }
      this.automationMessageBuffer = [];

      // Resolved after startup so a slow/denied geolocation prompt can't hold up
      // relay duties. setLocation reschedules sun triggers already registered.
      void resolveHomeLocation().then((location) => {
        if (location) engine.setLocation(location.latitude, location.longitude);
      });
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

    // Recalculate time triggers on wake/visibility — setTimeout dies during sleep
    this.automationWakeHandler = () => {
      if (typeof document === 'undefined' || document.visibilityState === 'visible') {
        const engine = getAutomationEngine();
        if (engine) {
          console.log('[ServerWS] Recalculating time triggers (wake/visibility)');
          engine.recalculateTimeTriggers();
        }
      }
    };
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', this.automationWakeHandler);
    }

    // Detect clock drift (sleep/suspend) — if the last tick is way in the past, the system slept
    this.lastTickAt = Date.now();
    this.clockDriftInterval = setInterval(() => {
      const now = Date.now();
      const expectedDelta = 30000;
      const actualDelta = now - this.lastTickAt;
      this.lastTickAt = now;
      // If we're more than 60s behind expected, the system slept — recalculate
      if (actualDelta > expectedDelta + 60000) {
        const engine = getAutomationEngine();
        if (engine) {
          console.log(`[ServerWS] Clock drift detected (${Math.round(actualDelta / 1000)}s) — recalculating time triggers`);
          engine.recalculateTimeTriggers();
        }
      }
    }, 30000);
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
    setRelayWritePublisher(null);
    this.automationEngineReady = false;
    this.automationMessageBuffer = [];
    // Release anything still waiting on a delivery report — the result can no
    // longer arrive, and leaving these to time out holds the map past teardown.
    for (const resolve of this.pendingNotifies.values()) resolve(NOTIFY_DELIVERY_UNKNOWN);
    this.pendingNotifies.clear();
    this.serviceGroupResolver?.stop();
    this.serviceGroupResolver = null;
    teardownAutomationEngine();
    clearAutomationHandlers();

    // Tear down wake/drift handlers
    if (this.automationWakeHandler && typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', this.automationWakeHandler);
      this.automationWakeHandler = null;
    }
    if (this.clockDriftInterval) {
      clearInterval(this.clockDriftInterval);
      this.clockDriftInterval = null;
    }

    HomeKit.stopObserving().catch(() => {});
  }

  private handleMessage(event: MessageEvent): void {
    this.recordActivity();
    try {
      const message = JSON.parse(event.data);

      // The server's first word is what makes this socket usable. A redirect is
      // the one word that means the opposite, so it alone does not announce.
      this.heardFromServer = true;
      if (message.type !== 'redirect') this.announceReady();

      // Everything the cloud sends, including what is not a request:
      // relay_status, subscriber counts, automation pushes, broadcasts. None of
      // it is visible anywhere today, and "is the cloud still talking to me?"
      // is the first question about a relay that has gone quiet — its own
      // requests stopping and the cloud never speaking are different faults.
      if (hasLocalActivityListeners() && message.type !== 'ping' && message.type !== 'pong') {
        emitLocalRelayActivity({
          lane: 'cloud', at: activityNow(),
          action: message.action ? `${message.type}:${message.action}` : message.type,
          request: summariseCloudMessage(message),
        });
      }
      browserLogger.logWsReceive(
        `${message.type}${message.action ? ':' + message.action : ''}`,
        // Broadcasts have no id — for relay status show the payload instead so
        // the diagnostics timeline captures which home went online/offline.
        message.type === 'relay_status_update'
          ? `connected=${message.connected} home=${message.homeId ?? (Array.isArray(message.home_ids) ? message.home_ids.join(',') : '')}`
          : message.id
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
        // Logged so the request panel shows where the server's hello lands
        // relative to the app's opening burst — see the redirect note below.
        logEvent('server', `hello ${String(message.serverInstanceId ?? '').slice(-6)}`);
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
        // The round trip, which used to be thrown away here. Both servers
        // already reply to our ping with a bare pong — the cloud handler and
        // local-server.ts alike — so measuring this needed no protocol change
        // and no server release; the number was simply never read.
        //
        // Only one ping is ever outstanding (they are 30s apart and a pong
        // arrives long before the next), so it needs no id to be matched.
        if (this.lastPingSentAt !== null) {
          const rtt = Date.now() - this.lastPingSentAt;
          this.lastPingSentAt = null;
          this.rttSamples = pushRtt(this.rttSamples, rtt);
          this.lastRttAt = Date.now();
          this.evaluateQuality();
        }
      } else if (message.type === 'redirect') {
        // Server requesting redirect to a specific pod (GKE consistent hashing)
        const target = message.target as string;
        const reason = message.reason as string || 'unknown';
        console.log(`[ServerWS] Server requested redirect to ${target} (reason: ${reason})`);
        // The affinity redirect arrives ~90ms after connect and tears the
        // socket down under whatever the app has already sent. In the log it is
        // the thing that explains a whole round of DISCONNECTED requests.
        logEvent('server', `redirect (${reason})`);
        this.redirectTo(target);
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
      } else if (message.type === 'automation.notify_result') {
        // Never buffered: a notify is only in flight while the engine is running,
        // and the action waiting on it must not be held up behind the buffer.
        const payload = message.payload as (NotifyDelivery & { notifyId?: string }) | undefined;
        if (payload?.notifyId) {
          this.pendingNotifies.get(payload.notifyId)?.({
            delivered: !!payload.delivered,
            channels: Array.isArray(payload.channels) ? payload.channels : [],
            rateLimited: payload.rateLimited,
            reason: payload.reason,
          });
        }
      } else if (message.type?.startsWith('automation.')) {
        // Automation engine sync messages from server
        const payload = message.payload as Record<string, unknown> | undefined;
        if (payload) {
          if (this.automationEngineReady) {
            dispatchAutomationMessage(message.type, payload);
          } else {
            // Buffer until engine is initialized (avoids race with relay_status → initAutomationEngine)
            this.automationMessageBuffer.push({ type: message.type, payload });
          }
        }
      }
    } catch (error) {
      console.error('[ServerWS] Failed to parse message:', error);
    }
  }

  /**
   * Announce a characteristic change this relay made, to the cloud and to the
   * local UI.
   *
   * Shared by client-initiated writes and by the automation engine. HomeKit
   * fires no observer for either — they are our own writes — so if this is not
   * called the change reaches no app at all until something else notices.
   */
  private async publishCharacteristicWrite(
    accessoryId: string,
    characteristicType: string,
    value: unknown,
    knownHomeId?: string,
  ): Promise<void> {
    let homeId = knownHomeId;
    let roomId: string | undefined;
    const cached = accessoryId ? this.accessoryHomeCache.get(accessoryId) : undefined;
    if (cached) {
      homeId = homeId || cached.homeId;
      roomId = cached.roomId;
    } else if (!homeId) {
      // Only when the home is genuinely unknown. This branch is a HomeKit read,
      // and a group write fans out to every member — twelve lights meant twelve
      // reads competing with the write that triggered them, and the write timed
      // out. The caller already knows the home in that case; roomId is
      // presentation detail and not worth a round trip to HomeKit for.
      try {
        const { accessory } = await executeHomeKitAction('accessory.get', { accessoryId }) as any;
        homeId = homeId || accessory?.homeId;
        roomId = accessory?.roomId;
        if (accessoryId && accessory?.homeId) {
          this.accessoryHomeCache.set(accessoryId, { homeId: accessory.homeId, roomId: accessory.roomId });
        }
      } catch { /* use whatever context we have */ }
    }

    this.sendEvent({
      id: `evt_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`,
      type: 'event',
      action: 'characteristic.updated',
      payload: {
        accessoryId,
        characteristicType,
        value,
        ...(homeId && { homeId }),
        ...(roomId && { roomId }),
      },
    });
    this.callbacks.onBroadcast?.({
      type: 'characteristic_update',
      accessoryId,
      homeId: homeId ?? null,
      characteristicType,
      value,
    });
  }

  /** As above, for a whole service group. */
  private publishServiceGroupWrite(
    groupId: string,
    characteristicType: string,
    value: unknown,
    homeId?: string,
    affectedCount = 0,
  ): void {
    if (homeId) {
      this.groupHomeCache.set(groupId, homeId);
    } else {
      homeId = this.groupHomeCache.get(groupId);
    }
    this.sendEvent({
      id: `evt_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`,
      type: 'event',
      action: 'serviceGroup.updated',
      payload: {
        groupId,
        characteristicType,
        value,
        affectedCount,
        ...(homeId && { homeId }),
      },
    });
    this.callbacks.onBroadcast?.({
      type: 'service_group_update',
      groupId,
      homeId: homeId ?? null,
      characteristicType,
      value,
      affectedCount,
    });
  }

  /**
   * Wait for the server's report on one notification.
   *
   * Bounded, and never rejects: a notification that was probably delivered is
   * not worth failing an automation over, so a silent server downgrades the
   * trace to "unknown" and the remaining actions still run.
   */
  private awaitNotifyResult(notifyId: string): Promise<NotifyDelivery> {
    return new Promise((resolve) => {
      const done = (delivery: NotifyDelivery) => {
        clearTimeout(timer);
        this.pendingNotifies.delete(notifyId);
        resolve(delivery);
      };
      const timer = setTimeout(() => done(NOTIFY_DELIVERY_UNKNOWN), NOTIFY_RESULT_TIMEOUT_MS);
      this.pendingNotifies.set(notifyId, done);
    });
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
      // NO_DEVICE just means the home's relay is offline/asleep — an expected
      // condition (e.g. per-tile accessory.refresh on an offline home), not a
      // server bug. Keep it out of error reporting (browserLogger ships
      // console.error to Cloud Logging); genuine failures still log loudly.
      if (message.error.code === 'NO_DEVICE') {
        if (import.meta.env.DEV) console.debug(`[ServerWS] Request skipped (relay offline): ${message.action}`);
      } else {
        console.error(`[ServerWS] Request failed: ${message.action}`, message.error);
      }
      // NO_DEVICE is a statement about the relay, not about this connection —
      // the server answered us perfectly well to say so. Counting it as a
      // connection failure would paint every tile refresh on an offline home
      // as a bad network.
      if (message.error.code !== 'NO_DEVICE') this.consecutiveFailures++;
      pending.reject(new HomecastError(message.error.code, message.error.message, message._trace));
    } else {
      if (import.meta.env.DEV) console.log(`[ServerWS] Response received: ${message.action}`, message.payload);
      this.consecutiveFailures = 0;
      pending.resolve(message.payload);
    }
    this.evaluateQuality();
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

    // Ship the close code to the server. The server can only observe THAT a
    // socket ended, never why — its own logs show it force-closes almost
    // nothing, so the reason exists solely on this side. Clients have been
    // dropping on a hard ~40s boundary (p25=40s across browsers AND the Home
    // Assistant client) with no matching server-side close, and without the
    // code there is no way to tell a proxy idle-timeout (1006) from a clean
    // server close (1000/1001) or a policy close (1008/1011). INFO, not warn:
    // a close is normal, we want the distribution rather than an alert.
    try {
      browserLogger.logInfo(`ws_close code=${event.code}`, {
        close_code: event.code,
        close_reason: (event.reason || '').slice(0, 120),
        was_clean: event.wasClean,
        session_ms: this.lastConnectionDuration ?? null,
        visibility: typeof document !== 'undefined' ? document.visibilityState : 'n/a',
        online: typeof navigator !== 'undefined' ? navigator.onLine : null,
        manual: this.isManualDisconnect,
      });
    } catch {
      // telemetry must never break reconnect
    }

    // A remembered affinity target that never said a word is a retired pod, or
    // an endpoint that no longer routes. Abandon it after ONE such attempt
    // rather than retrying into the same silence every launch.
    if (!this.heardFromServer && this.config.wsUrl !== this.frontDoorWsUrl) {
      console.log('[ServerWS] Remembered endpoint said nothing — falling back');
      forgetAffinityTarget();
      this.config.wsUrl = this.frontDoorWsUrl;
    }

    this.failPendingRequests('WebSocket connection closed');

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
      // A pod going away closes with 1012/1001. That is the unsolicited twin
      // of the server's `reconnect` message, which already resets backoff —
      // so treat it the same way instead of serving a 30s penalty for the
      // server's own routine restart.
      if (resetsBackoff(event.code)) {
        this.reconnectDelay = INITIAL_RECONNECT_DELAY;
      }
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

    // The server has always sent trace_id on every request and the relay has
    // never read it. Reading it is what lets the relay's own spans join the
    // journey instead of forming an unattached island — this is the only part
    // of the system that knows what HomeKit itself cost.
    const span = traceRelayRequest(message.action, message.trace_id);

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

      span.dispatched();
      const result = await executeHomeKitAction(message.action, message.payload || {}, 'cloud');
      span.done({ success: true });

      // Update trace with completed homekit_call timing
      if (trace) {
        const homekitStep = trace.steps[trace.steps.length - 1];
        if (homekitStep && homekitStep.name === 'homekit_call') {
          homekitStep.ms = trace.totalMs + (Date.now() - t0);
        }
      }

      this.sendResponse(message.id, message.action, result, trace);

      // No per-action broadcast here: executeHomeKitAction announces every
      // successful write through relay-write.ts, whose registered publisher
      // (publishCharacteristicWrite / publishServiceGroupWrite) sends the
      // characteristic.updated / serviceGroup.updated events and the local
      // onBroadcast. A hand-maintained copy of that fan-out lived here and
      // double-announced every cloud-routed write — the same duplicate list
      // was already removed from the local request path when relay-write.ts
      // was introduced (see the comment on routeLocalActions).
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

      span.done({ success: false, error: `${code}: ${errorMessage}` });
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
      // The HomeKit lane, at the observer itself — before any filtering,
      // debouncing or forwarding, so the stream shows what HomeKit actually
      // told this relay rather than what survived the handling of it.
      if (hasLocalActivityListeners()) {
        emitLocalRelayActivity({
          lane: 'homekit', at: activityNow(),
          accessoryId: event.accessoryId,
          characteristicType: event.characteristicType ?? event.type,
          value: event.type === 'characteristic.updated' ? event.value : event.type,
          homeId: event.homeId,
        });
      }

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
        // A half-open socket still reports OPEN, so readyState proves nothing.
        // If our pings have gone unanswered for long enough that the peer
        // cannot be there, stop believing the socket and rebuild it.
        if (isSocketStale(this.lastInboundAt, Date.now())) {
          console.warn(
            `[ServerWS] No traffic for ${Math.round((Date.now() - this.lastInboundAt) / 1000)}s ` +
            '— treating socket as dead and reconnecting',
          );
          browserLogger.logInfo('ws_stale_reconnect', {
            silent_ms: Date.now() - this.lastInboundAt,
          });
          this.gracefulReconnect();
          return;
        }
        // A ping still outstanding when the next one falls due means the last
        // round trip has already exceeded a whole heartbeat interval. That is
        // evidence in its own right, and discarding it is part of why a
        // degrading connection stayed invisible until `isSocketStale` finally
        // gave up at 75s. Recorded as the interval itself — a lower bound on
        // the truth rather than a guess at it.
        if (this.lastPingSentAt !== null) {
          this.rttSamples = pushRtt(this.rttSamples, Date.now() - this.lastPingSentAt);
          this.lastRttAt = Date.now();
        }
        this.lastPingSentAt = Date.now();
        this.ws.send(JSON.stringify({ type: 'ping' }));
        this.evaluateQuality();
        if (isRelayCapable()) {
          // Native observation self-stops after 90s without this, so it rides
          // the 30s heartbeat: two chances to miss before HomeKit goes quiet.
          withCallReason('heartbeat: keep HomeKit observation alive',
            () => HomeKit.resetObservationTimeout().catch(() => {}));
        }
      }
    };

    // Ping at once rather than waiting out the first interval.
    //
    // The heartbeat pong is the only source of round-trip samples, so without
    // this there are none for the first 30 seconds of every connection — and
    // `classifyQuality` correctly, uselessly answers `unknown` for all of it.
    // The badge then read "Checking connection" on a link that was working
    // perfectly, which is the same crime as a confidently stale reading, just
    // in the other direction.
    //
    // Safe here because `startHeartbeat` is only ever called from
    // `handleOpen`, i.e. with the socket already OPEN; `tick` re-checks
    // `readyState` regardless. This is the same immediate-tick pattern the
    // visibility handler below already uses on resume.
    tick();

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
            // The samples describe a connection from before the tab was put
            // away — the heartbeat was suspended for the whole of it, so they
            // are not evidence about now. Drop them first, so the indicator
            // reads "checking" for one round trip instead of confidently
            // reporting a round-trip time it measured minutes ago.
            this.invalidateQualitySamples();
            tick();
            this.heartbeatInterval = setInterval(tick, HEARTBEAT_INTERVAL);
          }
        }
      };
      document.addEventListener('visibilitychange', this.heartbeatVisibilityHandler);
    }
  }

  private stopHeartbeat(): void {
    this.lastPingSentAt = null;
    if (this.qualityTicker) {
      clearInterval(this.qualityTicker);
      this.qualityTicker = null;
      this.qualityTickerInterval = 0;
    }
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

    const delay = jitter(this.reconnectDelay);
    console.log(`[ServerWS] Reconnecting in ${Math.round(delay)}ms...`);
    this.reconnectTimeout = setTimeout(() => {
      this.establishConnection();
      // The relay's ceiling is far lower than a browser's: every second asleep
      // is a second the home does not answer.
      this.reconnectDelay = nextReconnectDelay(this.reconnectDelay, isRelayEnabled());
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

    // Clear per-session caches
    this.accessoryHomeCache.clear();
    this.groupHomeCache.clear();
    // NOT cleared: the relay reconnects every few minutes, and clearing here
    // meant every reconnect re-paid for the same failures. `liveHomeIds`,
    // refreshed from HomeKit on relay start, is what recovers a moved mapping.

    this.eventUnsubscribe?.();
    this.eventUnsubscribe = null;

    // Nothing in flight can be answered once this socket is gone, and this is
    // the last moment anyone knows that. `handleClose` rejects them too, but it
    // is unsubscribed three lines below — so on every path that tears the
    // socket down deliberately (gracefulReconnect, the affinity redirect,
    // disconnect) it never runs, and the requests simply hung.
    //
    // They then sat for the full 30s REQUEST_TIMEOUT while DataCache.getOrFetch
    // handed the same dead promise to every retry, so nothing could recover
    // until they expired. Measured on an iPhone launch: the server issues its
    // affinity redirect ~280ms after connect, the app fires its opening burst
    // at ~600ms, and the dashboard then showed stale data for 33 seconds.
    if (this.readyTimer) {
      clearTimeout(this.readyTimer);
      this.readyTimer = null;
    }
    if (this.readyGraceTimer) {
      clearTimeout(this.readyGraceTimer);
      this.readyGraceTimer = null;
    }
    this.readyAnnounced = false;
    this.heardFromServer = false;

    this.failPendingRequests('Connection replaced before the response arrived');

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
