// The stateful half of Local Mode: watches, decides, and does the wiring.
//
// `local-mode.ts` holds the rules and is pure. This file is everything the
// rules cannot be — a clock, the native bridge, localStorage, and the two
// global slots (the relay write publisher and HomeKit observation) that have to
// be claimed on engage and released on disengage.

import {
  decideLocalMode, localModeCanServe, resolveLocalId,
  EMPTY_MEMO,
  type LocalModeInputs, type LocalModeMemo, type LocalModeOverride, type LocalModeReason,
} from './local-mode';
import { HomeKit, isLocalCapable, isRelayCapable, withCallReason } from '../native/homekit-bridge';
import { executeHomeKitAction } from '../relay/local-handler';
import {
  serverConnection, communityRequest, clearCommunityCache, setLocalModeRouter,
  type LocalModeRouter,
} from './connection';
import { setRelayWritePublisher, getRelayWritePublisher } from '../relay/relay-write';
import { localIdentity } from './local-identity';

const OVERRIDE_KEY = 'homecast-local-mode';
const TICK_MS = 1_000;
const KEEPALIVE_MS = 30_000;
/** How often to re-attempt warming the identity map when it is not yet mapped. */
const WARM_RETRY_MS = 10 * 60_000;

export interface LocalModeState {
  active: boolean;
  reason: LocalModeReason | null;
  /** Whether this device's HomeKit ids are mapped to the cloud's stable ids. */
  identityState: 'mapped' | 'partial' | 'unmapped';
  matched: number;
  reported: number;
}

export function getLocalModeOverride(): LocalModeOverride {
  const v = localStorage.getItem(OVERRIDE_KEY);
  return v === 'on' || v === 'off' ? v : 'auto';
}

export function setLocalModeOverride(v: LocalModeOverride): void {
  if (v === 'auto') localStorage.removeItem(OVERRIDE_KEY);
  else localStorage.setItem(OVERRIDE_KEY, v);
  controller.refresh();
}

type Listener = (s: LocalModeState) => void;

class LocalModeController implements LocalModeRouter {
  private memo: LocalModeMemo = EMPTY_MEMO;
  private state: LocalModeState = {
    active: false, reason: null, identityState: 'unmapped', matched: 0, reported: 0,
  };
  private listeners = new Set<Listener>();
  private tick: ReturnType<typeof setInterval> | null = null;
  private keepAlive: ReturnType<typeof setInterval> | null = null;
  private bridgeReady = false;
  private liveHomeIds = new Set<string>();
  private started = false;
  private lastWarmAttempt = 0;

  start(): void {
    if (this.started) return;
    // A device with no HomeKit of its own can never serve locally, so there is
    // nothing here worth a timer. This is every browser.
    if (!isLocalCapable()) return;
    this.started = true;

    setLocalModeRouter(this);
    void this.probeBridge();
    this.tick = setInterval(() => this.evaluate(), TICK_MS);

    // iOS suspends a backgrounded WebView, which stops the keep-alive below and
    // lets native observation lapse — so on return we re-arm rather than
    // assuming the last 90 seconds behaved. This failure mode does not exist on
    // the Mac and is invisible until someone pockets their phone.
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState !== 'visible' || !this.state.active) return;
      clearCommunityCache();
      void this.startObservation();
    });
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    fn(this.state);
    return () => this.listeners.delete(fn);
  }

  getState(): LocalModeState { return this.state; }
  isActive(): boolean { return this.state.active; }

  /** Re-decide immediately rather than waiting for the next tick. */
  refresh(): void {
    void this.probeBridge().then(() => this.evaluate());
  }

  // ── capability ────────────────────────────────────────────────────────────

  private async probeBridge(): Promise<void> {
    const status = await HomeKit.getStatus();
    if (!status) {
      // An older native shell with no status method. Fall back to "the bridge
      // object exists", which is what every pre-Local-Mode build could tell us.
      this.bridgeReady = HomeKit.isAvailable();
      return;
    }
    // `determined` false means HomeKit has not finished deciding — treat that
    // as not-ready rather than as a refusal, or a slow first launch would look
    // like a denied permission.
    this.bridgeReady = status.determined && status.authorized && status.homeCount > 0;
  }

  private async refreshLiveHomes(): Promise<void> {
    try {
      const res = await withCallReason('local mode: which homes does this device have',
        () => executeHomeKitAction('homes.list', {})) as { homes?: Array<{ id: string }> };
      const ids = (res?.homes ?? []).map((h) => h.id?.toUpperCase()).filter(Boolean) as string[];
      if (ids.length > 0) this.liveHomeIds = new Set(ids);
    } catch {
      // Keep the previous set: an empty one would refuse every request.
    }
  }

  // ── the decision ──────────────────────────────────────────────────────────

  private evaluate(): void {
    const conn = serverConnection.getState();
    const homes = readCachedHomes();

    const inputs: LocalModeInputs = {
      bridgeReady: this.bridgeReady,
      isThisDeviceTheRelay: conn.relayStatus === true,
      relayCapable: isRelayCapable(),
      override: getLocalModeOverride(),
      socketState: conn.connectionState,
      homes,
      anyRelayKnown: homes.length > 0,
      now: Date.now(),
    };

    const d = decideLocalMode(inputs, this.memo);
    this.memo = d.memo;

    // Warm the identity map while the cloud is still reachable, rather than
    // discovering we need it at the moment the relay dies. `sync()` throttles
    // itself per topology hash, but building the report costs a handful of
    // HomeKit calls, so the attempt is gated here too — this runs on a 1s tick.
    if (!d.active && this.bridgeReady && conn.connectionState === 'connected'
        && Date.now() - this.lastWarmAttempt > WARM_RETRY_MS) {
      this.lastWarmAttempt = Date.now();
      void this.syncIdentity();
    }

    if (d.active !== this.state.active) {
      if (d.active) this.engage(); else this.disengage();
    } else if (d.active) {
      // Self-healing. `stopRelayDuties` nulls the publisher unconditionally, so
      // a socket drop on a relay-capable Mac can clear ours out from under us.
      // Re-claiming it every tick is cheaper than coordinating ownership.
      if (getRelayWritePublisher() === null) this.installPublisher();
    }

    this.emit({ ...this.state, active: d.active, reason: d.reason ?? this.state.reason });
  }

  private emit(next: LocalModeState): void {
    const changed = next.active !== this.state.active
      || next.reason !== this.state.reason
      || next.identityState !== this.state.identityState;
    this.state = next;
    if (changed) for (const fn of this.listeners) fn(next);
  }

  // ── engage / disengage ────────────────────────────────────────────────────

  private engage(): void {
    console.log('[LocalMode] Engaging — serving HomeKit from this device');
    clearCommunityCache();
    this.installPublisher();
    void this.startObservation();
    void this.refreshLiveHomes();
    void this.syncIdentity();
  }

  private disengage(): void {
    console.log('[LocalMode] Disengaging — the relay is serving again');
    clearCommunityCache();
    setRelayWritePublisher(null);
    if (this.keepAlive) { clearInterval(this.keepAlive); this.keepAlive = null; }
    // Only stop observation if this device is not also the relay. Stopping the
    // relay's own observation would silence every client it serves.
    if (!isRelayCapable()) void HomeKit.stopObserving().catch(() => {});
    this.memo = EMPTY_MEMO;
  }

  /**
   * Announce this device's own writes to its own UI.
   *
   * HomeKit fires no observer for a write the app itself initiated, so without
   * this the user taps a light, the light turns on, and the tile does not move.
   *
   * Deliberately narrower than the Community publisher: no LAN broadcast (a
   * phone serves no LAN clients) and no history recording (history is
   * cloud-side, and a local series would never reconcile with it).
   */
  private installPublisher(): void {
    setRelayWritePublisher({
      characteristic: (c) => {
        serverConnection.emitBroadcast({
          type: 'characteristic_update',
          accessoryId: localIdentity.toStable(c.accessoryId),
          homeId: c.homeId ? localIdentity.toStable(c.homeId) : null,
          characteristicType: c.characteristicType,
          value: c.value,
        });
      },
      serviceGroup: (groupId, characteristicType, value, homeId, affectedCount = 0) => {
        serverConnection.emitBroadcast({
          type: 'service_group_update',
          groupId: localIdentity.toStable(groupId),
          homeId: homeId ? localIdentity.toStable(homeId) : null,
          characteristicType,
          value,
          affectedCount,
        });
      },
    });
  }

  private async startObservation(): Promise<void> {
    try {
      await HomeKit.startObserving();
    } catch (err) {
      console.error('[LocalMode] Could not start HomeKit observation:', err);
    }
    if (this.keepAlive) clearInterval(this.keepAlive);
    // Native observation self-stops after 90s without a reset. In cloud mode
    // the relay's heartbeat does this; nothing does it for us.
    this.keepAlive = setInterval(() => {
      withCallReason('local mode keepalive: native observation self-stops after 90s',
        () => HomeKit.resetObservationTimeout()).catch(() => {});
    }, KEEPALIVE_MS);
  }

  /** Re-report the topology now, ignoring the once-a-day throttle. */
  async resyncIdentity(): Promise<void> {
    await this.syncIdentity(true);
  }

  private async syncIdentity(force = false): Promise<void> {
    const r = await localIdentity.sync(force);
    if (!r) return;
    this.emit({
      ...this.state,
      identityState: r.matched === 0 ? 'unmapped' : r.matched < r.reported ? 'partial' : 'mapped',
      matched: r.matched,
      reported: r.reported,
    });
  }

  // ── routing ───────────────────────────────────────────────────────────────

  canServe(action: string, payload: Record<string, unknown>): boolean {
    return localModeCanServe(action, payload.homeId as string | undefined, {
      active: this.state.active,
      cloudReachable: serverConnection.getState().connectionState === 'connected',
      liveHomeIds: this.liveHomeIds,
      hcToLive: localIdentity.stableToLive(),
    });
  }

  /**
   * Serve a request from this device's HomeKit.
   *
   * Ids go in stable (cloud) space and come back in it. The translation happens
   * only here, at the boundary — the same discipline the server applies in
   * `route_request`, and for the same reason: every translation incident to
   * date came from doing it at individual call sites instead.
   */
  async request<T>(action: string, payload: Record<string, unknown>): Promise<T> {
    const local = { ...payload };
    if (typeof local.homeId === 'string') {
      const resolved = resolveLocalId(local.homeId, {
        liveHomeIds: this.liveHomeIds,
        hcToLive: localIdentity.stableToLive(),
      });
      if (resolved) local.homeId = resolved;
    }
    const translated = localIdentity.toLivePayload(local);
    const result = await communityRequest<T>(action, translated);
    return localIdentity.toStablePayload(result) as T;
  }
}

/** Homes the app already knows about, for deciding whether any relay exists. */
function readCachedHomes(): Array<{ id: string; relayState?: string; relayConnected?: boolean; isCloudManaged?: boolean }> {
  try {
    const raw = localStorage.getItem('homecast-homekit-cache');
    if (!raw) return [];
    const parsed = JSON.parse(raw) as Record<string, { data?: unknown }>;
    const homes = parsed?.homes?.data;
    return Array.isArray(homes) ? homes : [];
  } catch {
    return [];
  }
}

export const controller = new LocalModeController();
export const localMode = controller;
