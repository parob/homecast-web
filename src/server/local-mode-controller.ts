// The stateful half of Local Mode: watches, decides, and does the wiring.
//
// `local-mode.ts` holds the rules and is pure. This file is everything the
// rules cannot be — a clock, the native bridge, localStorage, and the two
// global slots (the relay write publisher and HomeKit observation) that have to
// be claimed on engage and released on disengage.

import {
  decideLocalMode, localModeCanServe, resolveLocalId, identityFrom,
  EMPTY_MEMO,
  type IdentityState,
  type LocalModeInputs, type LocalModeMemo, type LocalModeOverride, type LocalModeReason,
} from './local-mode';
import {
  HomeKit, isLocalCapable, isRelayCapable, withCallReason, type HomeKitStatus,
} from '../native/homekit-bridge';
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
/** How often to re-report the topology once the cloud has answered once. */
const WARM_RETRY_MS = 10 * 60_000;
/** ...and how often to keep asking until it has, since nothing else will. */
const UNMAPPED_RETRY_MS = 60_000;
/** Re-probe HomeKit capability this often while it is not yet usable... */
const UNREADY_REPROBE_MS = 2_000;
/** ...and this often once it is, to notice revoked access or a new home. */
const READY_REPROBE_MS = 30_000;

export interface LocalModeState {
  active: boolean;
  reason: LocalModeReason | null;
  /** Whether this device's HomeKit ids are mapped to the cloud's stable ids. */
  identityState: IdentityState;
  matched: number;
  reported: number;
  /** This device can serve HomeKit at all — permission granted and homes present. */
  bridgeReady: boolean;
  /**
   * Why Local Mode cannot run here, when it can't. Distinct from `reason`,
   * which explains why it *is* running. Without this the Settings screen fell
   * back to "your relay is handling this home", which is not the reason and
   * left the user with a selected "Always on" that visibly did nothing.
   */
  blocked: 'no-permission' | 'restricted' | 'no-homes' | 'loading' | 'is-relay' | 'off' | null;
  status: HomeKitStatus | null;
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
    bridgeReady: false, blocked: 'loading', status: null,
  };
  private listeners = new Set<Listener>();
  private tick: ReturnType<typeof setInterval> | null = null;
  private keepAlive: ReturnType<typeof setInterval> | null = null;
  private bridgeReady = false;
  private liveHomeIds = new Set<string>();
  private started = false;
  private lastWarmAttempt = 0;
  private lastProbe = 0;
  private status: HomeKitStatus | null = null;

  start(): void {
    if (this.started) return;
    // A device with no HomeKit of its own can never serve locally, so there is
    // nothing here worth a timer. This is every browser.
    if (!isLocalCapable()) return;
    this.started = true;

    // Before auth, and possibly instead of it: `AuthContext` only calls
    // `load()` once `getMe()` has answered, which it cannot do offline — the
    // very case this whole feature exists for.
    localIdentity.loadLast();

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
      this.status = null;
      return;
    }
    this.status = status;
    // Homes are the real signal. HomeKit takes seconds to load on a cold start
    // and reports neither authorization nor homes until it has, so anything
    // stricter than this reads a slow launch as a refusal.
    this.bridgeReady = status.authorized && status.homeCount > 0;
    this.lastProbe = Date.now();
  }

  /** What the native side last said about HomeKit, for the Settings screen. */
  getStatus(): HomeKitStatus | null { return this.status; }

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
    // Re-probe rather than trusting the startup answer. HomeKit is not loaded
    // when the app opens, so the first probe almost always says "no homes" —
    // and without this the answer never changed, which showed as Local Mode
    // sitting in Standby with a permission warning on a device that had
    // permission all along. Keep checking while unready, and slowly afterwards
    // so revoked access or a newly added home is still noticed.
    const probeAfter = this.bridgeReady ? READY_REPROBE_MS : UNREADY_REPROBE_MS;
    if (Date.now() - this.lastProbe > probeAfter) {
      this.lastProbe = Date.now();
      void this.probeBridge().then(() => this.emit({ ...this.state }));
    }

    const conn = serverConnection.getState();
    const cachedHomes = readCachedHomes();
    const homes = cachedHomes ?? [];

    const inputs: LocalModeInputs = {
      bridgeReady: this.bridgeReady,
      isThisDeviceTheRelay: conn.relayStatus === true,
      relayCapable: isRelayCapable(),
      override: getLocalModeOverride(),
      socketState: conn.connectionState,
      homes,
      anyRelayKnown: homes.length > 0,
      homesLoaded: cachedHomes !== null,
      now: Date.now(),
    };

    const d = decideLocalMode(inputs, this.memo);
    this.memo = d.memo;

    // Warm the identity map while the cloud is still reachable, rather than
    // discovering we need it at the moment the relay dies. `sync()` throttles
    // itself per topology hash, but building the report costs a handful of
    // HomeKit calls, so the attempt is gated here too — this runs on a 1s tick.
    //
    // Deliberately not gated on `!d.active`: Local Mode very often engages
    // *before* the first successful report (a relay that was already offline at
    // launch, or a manual pin), and gating it there meant the one code path that
    // could ever mint the map stopped running the moment it was needed. Nothing
    // is lost by trying while active — the cloud being reachable is the real
    // precondition, and it is checked here.
    if (this.bridgeReady && localIdentity.hasUser()
        && conn.connectionState === 'connected'
        && Date.now() - this.lastWarmAttempt > this.retryDelay()) {
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

    this.emit({
      ...this.state,
      ...identityFrom(localIdentity.counts()),
      active: d.active,
      reason: d.reason ?? this.state.reason,
      bridgeReady: this.bridgeReady,
      status: this.status,
      blocked: d.active ? null : this.describeBlocker(inputs),
    });
  }

  /**
   * Try often until there is an answer at all, rarely once there is one.
   *
   * Keyed on having *any* report rather than on having a non-empty map: a
   * report that matched nothing is still an answer, and re-asking every minute
   * would rebuild the topology — a handful of HomeKit calls per home — forever
   * on a device that is simply looking at a different Apple Home.
   */
  private retryDelay(): number {
    return localIdentity.counts() ? WARM_RETRY_MS : UNMAPPED_RETRY_MS;
  }

  /**
   * Why Local Mode is not running, in the user's terms.
   *
   * Ordered the same way `decideLocalMode` applies its guards, so the reason
   * shown is the one actually stopping it rather than the first plausible one.
   */
  private describeBlocker(i: LocalModeInputs): LocalModeState['blocked'] {
    if (i.override === 'off') return 'off';
    if (i.isThisDeviceTheRelay) return 'is-relay';
    if (!this.bridgeReady) {
      const s = this.status;
      if (!s) return 'loading';
      if (s.restricted) return 'restricted';
      if (!s.authorized) return s.determined ? 'no-permission' : 'loading';
      if (s.homeCount === 0) return 'no-homes';
      return 'loading';
    }
    return null;
  }

  private emit(next: LocalModeState): void {
    const changed = next.active !== this.state.active
      || next.reason !== this.state.reason
      || next.identityState !== this.state.identityState
      || next.matched !== this.state.matched
      || next.reported !== this.state.reported
      || next.blocked !== this.state.blocked
      || next.bridgeReady !== this.state.bridgeReady;
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
    await localIdentity.sync(force);
    // Read the counts back rather than trusting the return: a failed sync
    // returns null while a perfectly good cached map is still loaded, and the
    // status the user sees should describe the map they actually have.
    this.emit({ ...this.state, ...identityFrom(localIdentity.counts()) });
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
/**
 * The account's homes as last cached, or `null` if we have never seen an answer.
 *
 * The distinction is the whole point: returning `[]` for "no cache yet" made a
 * fresh login indistinguishable from an account with no homes, and the policy
 * reads the latter as "no relay has ever been set up".
 */
function readCachedHomes(): Array<{ id: string; relayState?: string; relayConnected?: boolean; isCloudManaged?: boolean }> | null {
  try {
    const raw = localStorage.getItem('homecast-homekit-cache');
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Record<string, { data?: unknown }>;
    const homes = parsed?.homes?.data;
    return Array.isArray(homes) ? homes : null;
  } catch {
    return null;
  }
}

export const controller = new LocalModeController();
export const localMode = controller;
