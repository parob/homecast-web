/**
 * One fact per home: who may serve it right now, as this device sees it.
 *
 * Design: homecast-cloud `docs/internal/design-home-serving.md`. Server half:
 * homecast-cloud#104. The short form:
 *
 * Every surface that said something about whether a home could be reached used
 * to answer for itself — the badge from socket quality plus a refusal, the
 * chain from the same, Reliability from the server's session probe, Relay
 * Status from `homeRoles`, Local Mode from a cached `relayState` — and they
 * disagreed, because they were reading different things. #99 was five minutes
 * of a green dot over a home that refused every write.
 *
 * This module is the one thing they all read instead. It is fed by exactly two
 * sources and nothing else writes to it:
 *
 *   1. the `serving` field on every `homes.list` answer;
 *   2. the `home_serving` broadcast, on every transition.
 *
 * Two facts, one composition. The server owns `HomeServing` — which relay may
 * serve the home, for everyone. This device owns `DeviceServing` — whether it is
 * serving the home from its own HomeKit (Local Mode), which the server must not
 * own because it exists precisely when the server is unreachable. Every display
 * surface reads `effectiveServing`, the composition, never the server fact
 * directly. "Local Mode outranks everything" becomes data instead of three
 * separate orderings.
 *
 * `NO_DEVICE` is a trigger, not a belief. A refusal for a home this store says
 * is `served` means the store is stale; it asks for a refetch and changes
 * nothing. The refusal never becomes a state of its own.
 *
 * Pure where it can be (`parseServing`, `synthesiseServing`, `composeServing`),
 * so the rules are tested rather than eyeballed against a throttled browser.
 */

import type { HomeKitHome } from '@/native/homekit-bridge';

export type ServingState = 'served' | 'waiting' | 'reconnecting' | 'offline';

/** `cloud` and `self_hosted` are the server's words; `local` is only ever this device's. */
export type ServingKind = 'cloud' | 'self_hosted' | 'local';

export interface HomeServing {
  state: ServingState;
  /** The relay serving it, when `served`. */
  by: string | null;
  kind: ServingKind | null;
  /** When this state began. ISO-8601, or null when unknown. */
  since: string | null;
  /** For `waiting`: when a standby takes over. */
  graceEndsAt: string | null;
}

const STATES: ReadonlySet<string> = new Set(['served', 'waiting', 'reconnecting', 'offline']);
const KINDS: ReadonlySet<string> = new Set(['cloud', 'self_hosted', 'local']);

/** The `serving` object off the wire, or null if it is not one. */
export function parseServing(raw: unknown): HomeServing | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.state !== 'string' || !STATES.has(r.state)) return null;
  const str = (v: unknown) => (typeof v === 'string' && v ? v : null);
  const kind = str(r.kind);
  return {
    state: r.state as ServingState,
    by: str(r.by),
    kind: kind && KINDS.has(kind) ? (kind as ServingKind) : null,
    since: str(r.since),
    graceEndsAt: str(r.graceEndsAt),
  };
}

/**
 * What an older server's fields imply. Used only when `serving` is absent.
 *
 * The one thing this cannot express is `waiting`: an older server reports a
 * takeover grace as `connected`, which is the lie the fact exists to end. So a
 * client on an old server is exactly as well off as before — no worse — and
 * gets the truth the moment the server is upgraded, with no client change.
 * Returns null when the answer carries neither field, so a bare homes.list
 * (Local Mode's locally-answered one) leaves the store alone.
 */
export function synthesiseServing(
  home: Pick<HomeKitHome, 'relayState' | 'relayConnected' | 'relayId' | 'isCloudManaged'>,
): HomeServing | null {
  const state = home.relayState;
  if (state === 'connected' || (state === undefined && home.relayConnected === true)) {
    return {
      state: 'served',
      by: home.relayId ?? null,
      kind: home.isCloudManaged ? 'cloud' : 'self_hosted',
      since: null,
      graceEndsAt: null,
    };
  }
  if (state === 'reconnecting') return { state: 'reconnecting', by: null, kind: null, since: null, graceEndsAt: null };
  if (state === 'offline' || home.relayConnected === false) {
    return { state: 'offline', by: null, kind: null, since: null, graceEndsAt: null };
  }
  return null;
}

/**
 * The composition every display surface reads.
 *
 * This device serving the home from its own HomeKit is `served, by: me,
 * kind: 'local'` — a value the server never emits, and the rule "Local Mode
 * outranks everything" stated once as data. Otherwise the server's fact, or
 * null when the store has never heard of the home.
 */
export function composeServing(
  home: HomeServing | null,
  local: { active: boolean; since?: string | null },
  thisDevice: string | null,
): HomeServing | null {
  if (local.active) {
    return { state: 'served', by: thisDevice, kind: 'local', since: local.since ?? null, graceEndsAt: null };
  }
  return home;
}

/** Is `serving` this device's own relay? Replaces three `isActiveRelay`-shaped derivations. */
export function servedByThisDevice(serving: HomeServing | null, thisDevice: string | null): boolean {
  return !!serving && serving.state === 'served' && !!thisDevice && serving.by === thisDevice;
}

// ---------------------------------------------------------------------------
// The store.
// ---------------------------------------------------------------------------

type Listener = (homeId: string, serving: HomeServing | null) => void;

const facts = new Map<string, HomeServing>();
const listeners = new Set<Listener>();
let thisDevice: string | null = null;
let deviceServing: (homeId: string) => { active: boolean; since?: string | null } = () => ({ active: false });
let refetch: (homeId: string) => void = () => {};
/** Homes a refusal has already asked a refetch for, cleared when an answer lands. */
const staleAsked = new Set<string>();

const key = (homeId: string) => homeId.toUpperCase();

function same(a: HomeServing | null, b: HomeServing | null): boolean {
  if (!a || !b) return a === b;
  return a.state === b.state && a.by === b.by && a.kind === b.kind
    && a.since === b.since && a.graceEndsAt === b.graceEndsAt;
}

function set(homeId: string, serving: HomeServing): void {
  const k = key(homeId);
  const prev = facts.get(k) ?? null;
  facts.set(k, serving);
  staleAsked.delete(k);
  if (!same(prev, serving)) for (const fn of listeners) fn(k, serving);
}

/** Every `homes.list` answer passes through here. */
export function ingestHomesList(
  homes: ReadonlyArray<HomeKitHome & { serving?: unknown }>,
  opts: { community?: boolean } = {},
): void {
  for (const home of homes) {
    if (!home?.id) continue;
    if (opts.community) {
      // No cloud, no relay but this Mac: the fact is a constant and this is
      // the only place it is ever written. The same path that copes with an
      // older server copes with no server.
      set(home.id, { state: 'served', by: thisDevice, kind: 'self_hosted', since: null, graceEndsAt: null });
      continue;
    }
    const parsed = parseServing(home.serving) ?? synthesiseServing(home);
    if (parsed) set(home.id, parsed);
  }
}

/** Every `home_serving` broadcast passes through here. */
export function ingestHomeServingPush(message: { homeId?: unknown; serving?: unknown }): void {
  if (typeof message.homeId !== 'string' || !message.homeId) return;
  const parsed = parseServing(message.serving);
  if (parsed) set(message.homeId, parsed);
}

/** The server's fact for a home, as last heard. Surfaces should not read this — see `effectiveServing`. */
export function getHomeServing(homeId: string): HomeServing | null {
  return facts.get(key(homeId)) ?? null;
}

/** What this device should believe about a home: its own serving, else the server's. */
export function effectiveServing(homeId: string): HomeServing | null {
  return composeServing(getHomeServing(homeId), deviceServing(homeId), thisDevice);
}

/**
 * The cloud refused a request for this home with `NO_DEVICE`.
 *
 * If the store thought the home was served, it is stale: ask for a refetch,
 * once, and change nothing. If it already knew the home was not served, the
 * refusal is expected and nothing happens. The refusal is never stored.
 */
export function noteRefused(homeId: string): void {
  const k = key(homeId);
  const current = facts.get(k);
  if (!current || current.state !== 'served') return;
  if (staleAsked.has(k)) return;
  staleAsked.add(k);
  refetch(k);
}

export function subscribeHomeServing(fn: Listener): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

// -- wiring, set once at startup by the modules that own each fact -----------

/** This device's id, for `servedByThisDevice` and the Community seed. */
export function setThisDevice(id: string | null): void { thisDevice = id; }
export function getThisDevice(): string | null { return thisDevice; }

/** Registered by the Local Mode controller: does this device serve `homeId` itself right now? */
export function setDeviceServing(fn: typeof deviceServing): void { deviceServing = fn; }

/** Registered by the data layer: how to re-ask the server about a home. */
export function setRefetch(fn: typeof refetch): void { refetch = fn; }

/** Test seam. */
export function resetHomeServing(): void {
  facts.clear();
  listeners.clear();
  staleAsked.clear();
  thisDevice = null;
  deviceServing = () => ({ active: false });
  refetch = () => {};
}
