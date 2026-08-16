// When this device should answer from its own HomeKit instead of the relay.
//
// Every Homecast client is normally a viewer: control flows client → cloud →
// relay Mac → HomeKit. If the relay drops, that whole chain stops — even on an
// iPhone sitting on the same network, signed into the same Apple ID, with full
// Home access to the very accessories it has just stopped being able to reach.
// Local Mode is the answer to that, and to its mirror image: someone trying the
// app who has no relay set up yet.
//
// Pure by design, like relay-routing.ts: no `window`, no timers, no imports
// from anything stateful. All the clock-watching is expressed as inputs and a
// carried-forward memo, so every rule here is testable without faking a browser.

/** What the user asked for in Settings. `auto` is the default. */
export type LocalModeOverride = 'auto' | 'on' | 'off';

/** Why Local Mode is on, for the badge to explain itself. */
export type LocalModeReason =
  | 'manual'          // switched on in Settings
  | 'no-relay-ever'   // no relay has ever been set up — the "just trying it" case
  | 'relay-offline'   // the relay for this home is not answering
  | 'socket-down';    // the cloud itself is unreachable

export interface LocalModeHome {
  id: string;
  relayState?: string;
  relayConnected?: boolean;
  isCloudManaged?: boolean;
}

export interface LocalModeInputs {
  /** Native HomeKit present, permission granted, and at least one home. */
  bridgeReady: boolean;
  /** This device is currently the active relay. Never serve locally if so. */
  isThisDeviceTheRelay: boolean;
  /** This device *could* be promoted to relay — affects how long we wait. */
  relayCapable: boolean;
  override: LocalModeOverride;
  socketState: 'connected' | 'connecting' | 'reconnecting' | 'disconnected';
  homes: ReadonlyArray<LocalModeHome>;
  /** Whether the account has any relay at all. False = never set one up. */
  anyRelayKnown: boolean;
  /**
   * Whether we have actually *looked* at the account's homes yet.
   *
   * Empty-and-unread is not the same as empty-and-confirmed, and conflating
   * them is what made a fresh cloud login announce "no relay has ever been set
   * up" — instantly, since that case deliberately skips the engage delay — when
   * the truth was only that the homes had not arrived yet.
   */
  homesLoaded: boolean;
  now: number;
}

/** Carried between ticks so the timers survive without living in this module. */
export interface LocalModeMemo {
  active: boolean;
  /** When the current engage-or-disengage candidacy started. */
  pendingSince: number | null;
  /** Why it engaged. Disengage treats one of the reasons differently. */
  reason?: LocalModeReason | null;
}

export interface LocalModeDecision {
  active: boolean;
  reason: LocalModeReason | null;
  memo: LocalModeMemo;
}

export const EMPTY_MEMO: LocalModeMemo = { active: false, pendingSince: null };

/** How much of this device's HomeKit lines up with the account's own layout. */
export type IdentityState = 'mapped' | 'partial' | 'unmapped';

/** What the last topology report matched, whenever it happened. */
export interface IdentityCounts {
  matched: number;
  reported: number;
}

/**
 * Summarise the identity map for the badge and the Settings screen.
 *
 * Deliberately takes the *cached* counts rather than a sync result. The two
 * used to be conflated, and the difference is the whole bug: a sync only
 * succeeds while the cloud is reachable, which is exactly what Local Mode is
 * for the absence of — so a device with a perfectly good map restored from
 * storage reported "not matched yet" for as long as it was needed.
 *
 * `matched: 0` with a non-zero `reported` stays 'unmapped', but keeps its
 * counts: it is a genuinely different situation (this device is looking at
 * another Apple Home) and the copy is allowed to say so.
 */
export function identityFrom(c: IdentityCounts | null): IdentityCounts & { identityState: IdentityState } {
  if (!c || c.matched === 0) {
    return { identityState: 'unmapped', matched: c?.matched ?? 0, reported: c?.reported ?? 0 };
  }
  return {
    identityState: c.matched < c.reported ? 'partial' : 'mapped',
    matched: c.matched,
    reported: c.reported,
  };
}

/**
 * Engage well inside Dashboard's 12s initial grace and far inside its 120s
 * confirmed grace, so Local Mode takes over *before* either offline screen
 * would appear. The user should never see "your relay is offline" on a device
 * that is about to serve them perfectly well.
 */
export const ENGAGE_AFTER_MS = 8_000;

/**
 * A relay-capable Mac waits much longer. The server may promote it to active
 * relay, and being the relay serves *everyone* — Local Mode serves only this
 * one machine. Give the better outcome time to happen first.
 */
export const ENGAGE_AFTER_MS_RELAY_CAPABLE = 30_000;

/**
 * Disengage is deliberately slower than engage. That asymmetry is the whole
 * point: it is what makes this hysteresis rather than a threshold, and it is
 * why a relay flapping every few seconds cannot make the badge blink.
 */
export const DISENGAGE_AFTER_MS = 20_000;

/** A home is served by its relay if that relay is actually answering. */
function relayServesHome(home: LocalModeHome): boolean {
  // relayState is the grace-applied field: 'reconnecting' still counts as
  // connected, because the server has already decided the blip is not an
  // outage. Fall back to the boolean on payloads that predate the field.
  if (home.relayState) return home.relayState === 'connected' || home.relayState === 'reconnecting';
  return home.relayConnected !== false;
}

/**
 * Is there a home this device should be serving itself?
 *
 * Cloud-managed homes are excluded unless their own relay is reported down:
 * they are served by separate infrastructure that is usually fine, and taking
 * them over locally would be a downgrade rather than a rescue.
 */
function anyHomeNeedsLocal(homes: ReadonlyArray<LocalModeHome>): boolean {
  if (homes.length === 0) return true;
  return homes.some((h) => !relayServesHome(h));
}

/**
 * Decide whether Local Mode should be active right now.
 *
 * The ordering of the guards matters and is asserted in the tests: the
 * relay-Mac exclusion has to come before any timer, because everything the
 * controller does on engage (registering a write publisher, starting
 * observation) would fight the relay's own duties for the same globals.
 */
export function decideLocalMode(i: LocalModeInputs, prev: LocalModeMemo): LocalModeDecision {
  const off = (): LocalModeDecision => ({ active: false, reason: null, memo: EMPTY_MEMO });

  // 1. An explicit "off" wins over everything.
  if (i.override === 'off') return off();

  // 2. Nothing to serve from.
  if (!i.bridgeReady) return off();

  // 2b. We have not looked yet. Knowing nothing is not evidence of anything —
  //     and the "no relay ever" branch below engages with no delay at all, so
  //     without this a first login flips into Local Mode before the homes have
  //     had a chance to arrive. A dead socket is exempt: that is evidence.
  if (!i.homesLoaded && i.socketState !== 'disconnected') return off();

  // 3. The relay never serves itself locally. This device already answers for
  //    every client; a second, private path would only duplicate its writes.
  if (i.isThisDeviceTheRelay) return off();

  // 4. An explicit "on" skips the waiting.
  if (i.override === 'on') {
    return { active: true, reason: 'manual', memo: { active: true, pendingSince: null } };
  }

  const cloudDown = i.socketState === 'disconnected';
  const wants = !i.anyRelayKnown || cloudDown || anyHomeNeedsLocal(i.homes);

  const reason: LocalModeReason | null = !wants
    ? null
    : !i.anyRelayKnown ? 'no-relay-ever'
    : cloudDown ? 'socket-down'
    : 'relay-offline';

  // Nothing to set up yet means nothing to wait for — the trial case should
  // feel instant, not like an eight-second stall on first launch.
  const engageDelay = !i.anyRelayKnown
    ? 0
    : i.relayCapable ? ENGAGE_AFTER_MS_RELAY_CAPABLE : ENGAGE_AFTER_MS;

  if (prev.active) {
    if (wants) return { active: true, reason, memo: { active: true, pendingSince: null, reason } };
    // The slow disengage is anti-flap: it stops a relay dropping in and out
    // from making the badge blink. But a relay *appearing* where we thought
    // there was none is not a flap, it is the answer arriving — so stand down
    // at once rather than sitting in a state we now know to be wrong.
    if (prev.reason === 'no-relay-ever') return off();
    const since = prev.pendingSince ?? i.now;
    if (i.now - since >= DISENGAGE_AFTER_MS) return off();
    return { active: true, reason: null, memo: { active: true, pendingSince: since, reason: prev.reason } };
  }

  if (!wants) return off();
  const since = prev.pendingSince ?? i.now;
  if (i.now - since >= engageDelay) {
    return { active: true, reason, memo: { active: true, pendingSince: null, reason } };
  }
  return { active: false, reason: null, memo: { active: false, pendingSince: since } };
}

/**
 * Actions this device must never answer itself, whatever else is true.
 *
 * Deliberately NOT relay-routing.ts's SERVER_ONLY_ACTIONS. That set also
 * excludes `homes.list`, because the cloud deduplicates cloud-managed homes
 * across relays and a relay's local answer would omit them. That reasoning
 * holds while the cloud is reachable — and while it is, Local Mode keeps
 * sending homes.list to the cloud. It stops holding when the cloud is *not*
 * reachable, because then the alternative to a slightly incomplete list is no
 * list at all, and no list means no app.
 */
const NEVER_LOCAL = new Set([
  'subscribe',
  'unsubscribe',
  'subscriptions.list',
  'relay.probe',
  'app.reload',
]);

/** Answered locally only when the cloud cannot answer at all. See above. */
const CLOUD_PREFERRED = new Set(['homes.list']);

export interface LocalServeState {
  active: boolean;
  cloudReachable: boolean;
  /** Homes this device's own HomeKit is currently reporting, uppercased. */
  liveHomeIds: ReadonlySet<string>;
  /** Stable hc_id → live UUID, from this device's own identity report. */
  hcToLive: ReadonlyMap<string, string>;
}

/**
 * Which live HomeKit id, if any, this device should use for a request.
 *
 * Same shape and same guarantee as relay-routing's `resolveLocalHomeId`: a
 * translation is only ever used when HomeKit is reporting that id *now*, so a
 * stale mapping resolves to null and the request goes to the cloud rather than
 * being answered wrongly. The cache is either right or absent; there is no
 * state in which it is confidently wrong.
 */
export function resolveLocalId(
  homeId: string,
  s: Pick<LocalServeState, 'liveHomeIds' | 'hcToLive'>,
): string | null {
  const key = homeId.toUpperCase();
  if (s.liveHomeIds.has(key)) return key;
  const live = s.hcToLive.get(key);
  return live && s.liveHomeIds.has(live) ? live : null;
}

/** Can Local Mode answer this request from this device's HomeKit? */
export function localModeCanServe(
  action: string,
  homeId: string | undefined,
  s: LocalServeState,
): boolean {
  if (!s.active) return false;
  if (NEVER_LOCAL.has(action)) return false;
  if (CLOUD_PREFERRED.has(action)) return !s.cloudReachable;
  // Not scoped to a home — nothing to resolve.
  if (!homeId) return true;
  return resolveLocalId(homeId, s) !== null;
}
