// Per-series read cache for Home Analytics.
//
// The wire already answers per series — one HistorySeriesData for every
// (accessoryId, characteristicType) ref — and every room/house rollup happens
// in the browser (history/aggregate.ts). So a room is a SUBSET of the house's
// refs, and caching ONE SERIES AT A TIME is what lets the house view reuse
// what the room view just fetched. Caching whole responses would not: refs are
// re-chunked six at a time and the batches never line up twice.
//
// Everything here is in memory and lives for five minutes. There is no
// persistence, no interval bookkeeping and no partial top-up: a request either
// asks exactly what an earlier one asked, or it goes to the network. That only
// works because the window end is quantised — see analyticsWindowEnd.

import type { HistorySeriesData } from '@/lib/graphql/types';

export const ANALYTICS_TTL_MS = 5 * 60 * 1000;

/**
 * Beyond this the map is trimmed oldest-first. A whole house in view is ~700
 * series, so this holds several homes and ranges before anything is dropped.
 */
const MAX_ENTRIES = 4000;

interface CacheEntry {
  data: HistorySeriesData;
  fetchedAt: number;
}

const cache = new Map<string, CacheEntry>();
const pending = new Map<string, Promise<unknown>>();
const fetchListeners = new Set<() => void>();

/**
 * Bumped by clearSeriesCache. A write carries the generation it started under
 * and is dropped if that no longer matches.
 *
 * Emptying the map is not enough on its own: a fetch already in flight when
 * the cache is cleared resolves AFTERWARDS and writes its entry straight back,
 * restoring exactly what was just dropped. The fetch is outstanding for a
 * whole relay round trip, which is far longer than the gap between "Refresh
 * was pressed" and "the views re-read" — so this is the common case, not a
 * corner. Same reasoning, same fix as communityCacheGeneration in
 * server/connection.ts.
 */
let generation = 0;

export function seriesCacheGeneration(): number {
  return generation;
}

/**
 * The window end, rounded down to the TTL grid.
 *
 * Without this the cache could never hit. Each Analytics view used to mint its
 * own Date.now(), so the room asked for [T0-24h, T0] and the house asked for
 * [T1-24h, T1] a few seconds later — two different questions about almost
 * exactly the same data. Quantising makes the same question recur, at the cost
 * of a right edge that can trail reality by up to one grid step. The Refresh
 * button in ScopeHeader is the way past that; it mints an exact instant.
 *
 * No rangeMs argument: fromTs is toTs - rangeMs, so it is quantised for free.
 */
export function analyticsWindowEnd(now: number = Date.now()): number {
  return Math.floor(now / ANALYTICS_TTL_MS) * ANALYTICS_TTL_MS;
}

/**
 * `ns` is the home id, or `share:${hash}` on a share link — a public share
 * re-verifies its scope on every call and must never read an entry a signed-in
 * view put there.
 *
 * The accessory id is uppercased because UUIDs are case-insensitive (RFC 4122)
 * and our sources disagree about which case they use; accessory UUIDs are
 * globally unique, so the key stays right across homes.
 */
export function seriesCacheKey(
  ns: string,
  accessoryId: string,
  characteristicType: string,
  fromTs: number,
  toTs: number,
  maxPoints: number,
): string {
  return [ns, accessoryId.toUpperCase(), characteristicType, fromTs, toTs, maxPoints].join('|');
}

export function getCachedSeries(
  key: string,
  now: number = Date.now(),
): HistorySeriesData | undefined {
  const entry = cache.get(key);
  if (!entry) return undefined;
  if (now - entry.fetchedAt >= ANALYTICS_TTL_MS) {
    cache.delete(key);
    return undefined;
  }
  return entry.data;
}

export function setCachedSeries(
  key: string,
  data: HistorySeriesData,
  gen: number,
  now: number = Date.now(),
): void {
  if (gen !== generation) return;
  cache.set(key, { data, fetchedAt: now });
  if (cache.size > MAX_ENTRIES) trim(now);
}

/**
 * Drop what has expired; if that was not enough, drop oldest-first. Insertion
 * order is close enough to age order to sort by — every entry is written once,
 * at fetch time, and never touched again.
 */
function trim(now: number): void {
  for (const [key, entry] of cache) {
    if (now - entry.fetchedAt >= ANALYTICS_TTL_MS) cache.delete(key);
  }
  if (cache.size <= MAX_ENTRIES) return;
  const excess = cache.size - MAX_ENTRIES;
  let dropped = 0;
  for (const key of cache.keys()) {
    cache.delete(key);
    if (++dropped >= excess) break;
  }
}

export function clearSeriesCache(): void {
  generation++;
  cache.clear();
}

/**
 * Collapse concurrent identical queries into one.
 *
 * Keyed on the whole chunk, not a series: a query carries up to six refs, and
 * the callers that race here (a re-render, a StrictMode double-effect, a
 * dialog over the page) build the identical chunk rather than an overlapping
 * one.
 *
 * A rejection is deliberately not held — the entry is removed in `finally`, so
 * the next caller retries rather than inheriting a failure. See
 * reference_reconnect_orphans_requests: a stored promise that could never
 * settle once served itself to every retry for thirty seconds. Safe here
 * regardless, because apollo.ts aborts every request at 15s.
 */
export function inflight<T>(key: string, fetcher: () => Promise<T>): Promise<T> {
  const existing = pending.get(key);
  if (existing) return existing as Promise<T>;

  const promise = fetcher().finally(() => {
    pending.delete(key);
    notifyFetching();
  });
  pending.set(key, promise);
  notifyFetching();
  return promise;
}

/** How many Analytics queries are outstanding — drives the Refresh spinner. */
export function analyticsFetchCount(): number {
  return pending.size;
}

export function subscribeAnalyticsFetching(fn: () => void): () => void {
  fetchListeners.add(fn);
  return () => {
    fetchListeners.delete(fn);
  };
}

function notifyFetching(): void {
  fetchListeners.forEach(fn => fn());
}

/** Test seam — the module-level maps outlive a single test otherwise. */
export function __resetSeriesCacheForTests(): void {
  cache.clear();
  pending.clear();
  fetchListeners.clear();
  generation = 0;
}
