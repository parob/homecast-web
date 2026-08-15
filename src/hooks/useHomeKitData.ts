/**
 * Hook for fetching HomeKit data with caching.
 * Uses server connection which automatically routes:
 * - Relay mode (Mac app): local loopback via native bridge
 * - Browser mode: WebSocket to server, routed to relay
 */

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { serverConnection } from '../server/connection';
import type { HomeKitHome, HomeKitRoom, HomeKitAccessory, HomeKitServiceGroup } from '../native/homekit-bridge';
import { isAccessoryResponsive } from '../lib/accessoryFreshness';
import { sameAccessoryId, resolveAccessoriesCacheKey } from './accessoryCacheKeys';

/**
 * Derive `isReachable` from value presence + the framework flag before the
 * accessory lands in the cache. Every widget reads `accessory.isReachable`
 * downstream; normalising here means they all pick up the Apple-Home-style
 * rule (values present → responsive, even if HMAccessory.isReachable lies)
 * without each widget having to know about it.
 */
function withDerivedReachability(a: HomeKitAccessory): HomeKitAccessory {
  const derived = isAccessoryResponsive(a, a.isReachable);
  return a.isReachable === derived ? a : { ...a, isReachable: derived };
}
export function normalizeAccessories(list: HomeKitAccessory[]): HomeKitAccessory[] {
  return list.map(withDerivedReachability);
}

// ============================================================================
// Simple cache implementation (similar to Apollo's cache-first policy)
// ============================================================================

interface CacheEntry<T> {
  data: T;
  timestamp: number;
  /**
   * The revalidation epoch this entry was written at. Absent means "restored
   * from disk", which always counts as needing a re-check — see needsRevalidate.
   * Deliberately not persisted.
   */
  epoch?: number;
}

type CacheListener = () => void;

/**
 * How long a rehydrated entry may be before we refuse to paint it.
 *
 * The cache is revalidated on every load, so this is not about correctness of
 * the eventual state — it is about how wrong the *first frame* is allowed to
 * be. A light that was on an hour ago is a plausible guess; one from last week
 * is a fabrication. Beyond this, start empty and wait for the relay.
 */
const PERSIST_MAX_AGE = 24 * 60 * 60 * 1000; // 24 hours
const PERSIST_KEY = 'homecast-homekit-cache';
/** Only these prefixes are worth persisting — the ones the first screen needs. */
const PERSIST_PREFIXES = ['homes', 'rooms:', 'accessories:', 'serviceGroups:'];

class DataCache {
  private cache = new Map<string, CacheEntry<unknown>>();
  private keyListeners = new Map<string, Set<CacheListener>>();
  private staleTime = 5 * 60 * 1000; // 5 minutes (matches Apollo's behavior)
  // Track pending requests globally to deduplicate across hook instances
  private pendingRequests = new Map<string, Promise<unknown>>();
  private persistTimer: ReturnType<typeof setTimeout> | null = null;
  /** Did this session start with usable data on disk? Reported in boot timing. */
  private hydratedCount = 0;
  /** Bumped to ask for a re-check of everything. See revalidateAll. */
  private revalidateEpoch = 0;
  private epochListeners = new Set<CacheListener>();

  constructor() {
    this.hydrate();
  }

  get wasHydrated(): boolean {
    return this.hydratedCount > 0;
  }

  get<T>(key: string): T | null {
    const entry = this.cache.get(key);
    if (!entry) return null;
    return entry.data as T;
  }

  set<T>(key: string, data: T): void {
    this.cache.set(key, { data, timestamp: Date.now(), epoch: this.revalidateEpoch });
    this.notify(key);
    this.schedulePersist();
  }

  /**
   * Restore the last session's homes/rooms/accessories so the first paint has
   * real content instead of a spinner.
   *
   * Entries keep their original timestamps, so everything rehydrated is already
   * past staleTime and useCachedData revalidates it immediately — but via the
   * stale path at :343, which does NOT flip `loading`. That is the whole point:
   * content on screen, refresh running quietly behind it.
   */
  private hydrate(): void {
    try {
      const raw = localStorage.getItem(PERSIST_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as Record<string, CacheEntry<unknown>>;
      const now = Date.now();
      for (const [key, entry] of Object.entries(parsed)) {
        if (!entry || typeof entry.timestamp !== 'number') continue;
        if (now - entry.timestamp > PERSIST_MAX_AGE) continue;
        // Rebuilt without any epoch, deliberately: restored data has never been
        // checked by THIS session, and its age was accumulated while the app
        // was not running to hear about changes.
        this.cache.set(key, { data: entry.data, timestamp: entry.timestamp });
        this.hydratedCount++;
      }
    } catch {
      // Corrupt or unavailable storage is not worth failing a boot over.
      try { localStorage.removeItem(PERSIST_KEY); } catch { /* ignore */ }
    }
  }

  /**
   * Coalesced write-back. Accessory updates arrive in bursts (one per
   * characteristic change), and serializing the whole cache on each would put
   * a JSON.stringify of every accessory on the hot path.
   */
  private schedulePersist(): void {
    if (this.persistTimer) return;
    this.persistTimer = setTimeout(() => {
      this.persistTimer = null;
      this.persist();
    }, 2000);
  }

  private persist(): void {
    try {
      const out: Record<string, CacheEntry<unknown>> = {};
      for (const [key, entry] of this.cache.entries()) {
        if (!PERSIST_PREFIXES.some(p => key.startsWith(p))) continue;
        out[key] = entry as CacheEntry<unknown>;
      }
      localStorage.setItem(PERSIST_KEY, JSON.stringify(out));
    } catch {
      // Quota exceeded (a large home can be sizeable) — drop the persisted
      // copy rather than retrying forever. Next session just starts cold.
      try { localStorage.removeItem(PERSIST_KEY); } catch { /* ignore */ }
    }
  }

  /** Forget the persisted copy — used on sign-out. */
  clearPersisted(): void {
    if (this.persistTimer) { clearTimeout(this.persistTimer); this.persistTimer = null; }
    try { localStorage.removeItem(PERSIST_KEY); } catch { /* ignore */ }
  }

  isStale(key: string): boolean {
    const entry = this.cache.get(key);
    if (!entry) return true;
    return Date.now() - entry.timestamp > this.staleTime;
  }

  /**
   * Ask for every cached read to be re-checked, without dropping any of it.
   *
   * Deliberately NOT invalidate(): that deletes, which empties the screen and
   * flashes a loading state, and doing it on every reconnect is the footgun
   * invalidateHomeKitCache's doc warns about. This is the stale-while-
   * revalidate half — the cached data stays on screen and is quietly replaced
   * by the truth.
   *
   * A counter as well as a notification, because notifying alone loses the
   * signal. On an app launch the socket frequently connects BEFORE the
   * dashboard has mounted, so there is nothing subscribed to hear it; the hooks
   * then mount, see a cache that still looks fresh, and skip. The epoch makes
   * the request durable — a hook that mounts afterwards compares and fetches.
   *
   * Also why timestamps are not simply backdated instead: a rewritten timestamp
   * gets persisted, and an entry written as "old" is dropped by the
   * PERSIST_MAX_AGE check on the next launch — which would cost the instant
   * paint this cache exists to provide.
   */
  revalidateAll(): void {
    this.revalidateEpoch++;
    this.epochListeners.forEach(l => l());
  }

  /**
   * Has this entry been fetched since the last revalidation request?
   *
   * Entries restored from disk have no epoch at all and always answer true:
   * their timestamp measured a period when the app was not running and no
   * update could reach it, so elapsed time says nothing about freshness.
   */
  needsRevalidate(key: string): boolean {
    return (this.cache.get(key)?.epoch ?? -1) < this.revalidateEpoch;
  }

  subscribeRevalidate(fn: CacheListener): () => void {
    this.epochListeners.add(fn);
    return () => this.epochListeners.delete(fn);
  }

  invalidate(key: string): void {
    this.cache.delete(key);
    this.notify(key);
    this.schedulePersist();
  }

  invalidateByPrefix(prefix: string): void {
    const cacheKeys = new Set(
      Array.from(this.cache.keys()).filter(k => k.startsWith(prefix))
    );
    for (const key of cacheKeys) {
      this.cache.delete(key);
      this.notify(key);
    }
    // Also notify listeners for keys that match prefix but have no cache entry
    // (hooks stuck in error state after failed fetches need to be told to retry)
    for (const key of this.keyListeners.keys()) {
      if (key.startsWith(prefix) && !cacheKeys.has(key)) {
        this.notify(key);
      }
    }
    this.schedulePersist();
  }

  subscribe(listener: CacheListener, key?: string): () => void {
    if (key) {
      let set = this.keyListeners.get(key);
      if (!set) {
        set = new Set();
        this.keyListeners.set(key, set);
      }
      set.add(listener);
      return () => {
        set!.delete(listener);
        if (set!.size === 0) this.keyListeners.delete(key);
      };
    }
    // No key = subscribe to all changes (used by useAccessoriesForHomes)
    const ALL = '__all__';
    let set = this.keyListeners.get(ALL);
    if (!set) {
      set = new Set();
      this.keyListeners.set(ALL, set);
    }
    set.add(listener);
    return () => {
      set!.delete(listener);
      if (set!.size === 0) this.keyListeners.delete(ALL);
    };
  }

  private notify(key: string): void {
    this.keyListeners.get(key)?.forEach(l => l());
    this.keyListeners.get('__all__')?.forEach(l => l());
  }

  listenerCount(): number {
    let count = 0;
    this.keyListeners.forEach(set => count += set.size);
    return count;
  }

  getSnapshot(): Map<string, CacheEntry<unknown>> {
    return this.cache;
  }

  /**
   * Check if there's already a pending request for this key
   */
  hasPendingRequest(key: string): boolean {
    return this.pendingRequests.has(key);
  }

  /**
   * Get or create a pending request. Returns existing promise if one exists,
   * otherwise creates a new one using the fetcher.
   */
  async getOrFetch<T>(key: string, fetcher: () => Promise<T>): Promise<T> {
    // If there's already a pending request, return it
    const existing = this.pendingRequests.get(key);
    if (existing) {
      return existing as Promise<T>;
    }

    // Create new request and track it
    const promise = fetcher().finally(() => {
      this.pendingRequests.delete(key);
    });
    this.pendingRequests.set(key, promise);
    return promise;
  }
}

const cache = new DataCache();

// ============================================================================
// Pending updates tracker - prevents stale server updates from overwriting
// optimistic updates during rapid toggling
// ============================================================================

interface PendingUpdate {
  value: unknown;
  timestamp: number;
}

class PendingUpdatesTracker {
  private pending = new Map<string, PendingUpdate>();
  private pendingGroups = new Map<string, PendingUpdate>();
  // Window during which stale server updates are ignored (ms).
  // Extended to 5s (from 2s) to account for slow HomeKit responses (B8 fix).
  private ignoreWindow = 5000;

  private makeKey(accessoryId: string, characteristicType: string): string {
    return `${accessoryId}:${characteristicType}`;
  }

  private makeGroupKey(groupId: string, characteristicType: string): string {
    return `group:${groupId}:${characteristicType}`;
  }

  /**
   * Mark a characteristic as having a pending optimistic update
   */
  setPending(accessoryId: string, characteristicType: string, value: unknown): void {
    const key = this.makeKey(accessoryId, characteristicType);
    this.pending.set(key, { value, timestamp: Date.now() });
  }

  /**
   * Mark a service group as having a pending optimistic update
   */
  setGroupPending(groupId: string, characteristicType: string, value: unknown): void {
    const key = this.makeGroupKey(groupId, characteristicType);
    this.pendingGroups.set(key, { value, timestamp: Date.now() });
  }

  /**
   * Clear pending status for a characteristic
   */
  clearPending(accessoryId: string, characteristicType: string): void {
    const key = this.makeKey(accessoryId, characteristicType);
    this.pending.delete(key);
  }

  /**
   * Clear pending status for a service group
   */
  clearGroupPending(groupId: string, characteristicType: string): void {
    const key = this.makeGroupKey(groupId, characteristicType);
    this.pendingGroups.delete(key);
  }

  /**
   * Check if a server update should be ignored because there's a recent pending update
   * Returns true if the server value matches the pending value (update completed)
   * or if the pending update is still within the ignore window
   */
  shouldIgnoreServerUpdate(accessoryId: string, characteristicType: string, serverValue: unknown): boolean {
    const key = this.makeKey(accessoryId, characteristicType);
    const pending = this.pending.get(key);

    if (!pending) return false;

    const age = Date.now() - pending.timestamp;

    // If the server value matches our pending value, the update completed - clear pending
    if (JSON.stringify(serverValue) === JSON.stringify(pending.value)) {
      this.pending.delete(key);
      return false; // Allow this update through (it confirms our optimistic update)
    }

    // If within ignore window, ignore stale server updates
    if (age < this.ignoreWindow) {
      if (import.meta.env.DEV) console.log(`[PendingUpdates] Ignoring stale server update for ${accessoryId.slice(0, 8)}:${characteristicType}, pending=${JSON.stringify(pending.value)}, server=${JSON.stringify(serverValue)}, age=${age}ms`);
      return true;
    }

    // Expired - clear and allow update
    this.pending.delete(key);
    return false;
  }

  /**
   * Check if a service group server update should be ignored
   */
  shouldIgnoreGroupServerUpdate(groupId: string, characteristicType: string, serverValue: unknown): boolean {
    const key = this.makeGroupKey(groupId, characteristicType);
    const pending = this.pendingGroups.get(key);

    if (!pending) return false;

    const age = Date.now() - pending.timestamp;

    // If the server value matches our pending value, the update completed - clear pending
    if (JSON.stringify(serverValue) === JSON.stringify(pending.value)) {
      this.pendingGroups.delete(key);
      return false; // Allow this update through (it confirms our optimistic update)
    }

    // If within ignore window, ignore stale server updates
    if (age < this.ignoreWindow) {
      if (import.meta.env.DEV) console.log(`[PendingUpdates] Ignoring stale service group update for ${groupId.slice(0, 8)}:${characteristicType}, pending=${JSON.stringify(pending.value)}, server=${JSON.stringify(serverValue)}, age=${age}ms`);
      return true;
    }

    // Expired - clear and allow update
    this.pendingGroups.delete(key);
    return false;
  }
}

const pendingUpdates = new PendingUpdatesTracker();

// ============================================================================
// Hook interfaces
// ============================================================================

interface UseHomeKitDataOptions {
  skip?: boolean;
}

interface UseHomeKitDataResult<T> {
  data: T | null;
  loading: boolean;
  error: Error | null;
  refetch: () => Promise<void>;
  /**
   * How much of a multi-request fan-out has landed. Only the per-home hooks
   * populate this — it exists so a loading placeholder can report a fact
   * ("3 of 5 homes") rather than a percentage invented from a timer.
   */
  progress?: { done: number; total: number };
}

// ============================================================================
// Generic cached fetch hook
// ============================================================================

const MAX_RETRIES = 2;
const RETRY_DELAY = 3000; // 3 seconds

function useCachedData<T>(
  cacheKey: string,
  fetcher: () => Promise<T>,
  skip: boolean
): UseHomeKitDataResult<T> {
  // Force re-render when cache changes by tracking update count
  const [, forceUpdate] = useState(0);

  const [loading, setLoading] = useState(() => {
    // Only show loading if no cached data and not skipped
    return !skip && !cache.get<T>(cacheKey);
  });
  const [error, setError] = useState<Error | null>(null);
  const mountedRef = useRef(true);
  const retryCountRef = useRef(0);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchData = useCallback(async (force = false, _isRetry = false) => {
    if (skip) return;

    // Reset retry state on forced refetch (e.g., cache invalidation, manual refresh)
    // But NOT on retries — let the counter accumulate so retries actually stop at MAX_RETRIES
    if (force) {
      if (!_isRetry) {
        retryCountRef.current = 0;
      }
      if (retryTimerRef.current) {
        clearTimeout(retryTimerRef.current);
        retryTimerRef.current = null;
      }
    }

    const hasCachedData = cache.get<T>(cacheKey) !== null;
    const isStale = cache.isStale(cacheKey);

    // If we have fresh cached data and not forcing, skip fetch.
    //
    // `needsRevalidate` is what stops "fresh" from meaning "correct". An entry
    // restored from disk, or one predating a revalidation request that arrived
    // before this hook mounted, still looks fresh by timestamp — staleTime is a
    // timer, and it kept running while the app was closed and nothing could
    // reach it. That is the bug behind "reopen the app and it shows the old
    // state until you pull to refresh".
    if (hasCachedData && !isStale && !force && !cache.needsRevalidate(cacheKey)) return;

    // If there's already a pending request (from another hook instance), don't start another
    // unless we're forcing a refetch
    if (!force && cache.hasPendingRequest(cacheKey)) {
      return;
    }

    // Only show loading spinner and clear error on first attempt.
    // During retries, keep the error visible so the UI doesn't flash.
    if (retryCountRef.current === 0) {
      if (!hasCachedData) {
        setLoading(true);
      }
      setError(null);
    }

    let willRetry = false;
    try {
      // Use getOrFetch to deduplicate requests across hook instances
      const result = await cache.getOrFetch(cacheKey, fetcher);
      if (mountedRef.current) {
        cache.set(cacheKey, result);
        setError(null); // Clear error on successful retry
        retryCountRef.current = 0; // Reset on success
      }
    } catch (err) {
      if (mountedRef.current) {
        setError(err instanceof Error ? err : new Error(String(err)));
        // Retry on failure if we haven't exceeded max retries
        if (retryCountRef.current < MAX_RETRIES) {
          retryCountRef.current++;
          willRetry = true;
          console.log(`[DataCache] Fetch failed for ${cacheKey}, scheduling retry ${retryCountRef.current}/${MAX_RETRIES}`);
          retryTimerRef.current = setTimeout(() => {
            if (mountedRef.current) {
              fetchData(true, true);
            }
          }, RETRY_DELAY);
        }
      }
    } finally {
      // Keep the loading state while a retry is pending so a transient
      // first-load failure (slow big-home, relay reconnecting) shows the
      // loading spinner instead of flashing "Unable to load…". The error only
      // surfaces once retries are exhausted (or when stale data is shown).
      if (mountedRef.current && !willRetry) {
        setLoading(false);
      }
    }
  }, [cacheKey, fetcher, skip]);

  // Subscribe to cache changes for this specific key only
  // Also refetch if the cache entry was invalidated (deleted)
  const fetchDataRef = useRef(fetchData);
  fetchDataRef.current = fetchData;
  useEffect(() => {
    const unsubscribe = cache.subscribe(() => {
      if (mountedRef.current) {
        forceUpdate(n => n + 1);
        // If cache entry was deleted (invalidated), trigger a refetch
        if (!cache.get(cacheKey)) {
          fetchDataRef.current(true);
        }
      }
    }, cacheKey);
    return unsubscribe;
  }, [cacheKey]);

  // Re-check when the transport becomes usable again.
  //
  // The mount fetch below runs the moment the cache paints from disk, which is
  // now before the WebSocket exists — serverConnection.request() throws
  // 'Not active', and the two 3s retries can expire before a cold-start socket
  // finishes authenticating and waiting for its relay assignment. Nothing
  // retried after that, so the app sat on hydrated data with no refresh
  // pending, indefinitely, until someone pulled to refresh.
  useEffect(() => {
    return cache.subscribeRevalidate(() => {
      if (mountedRef.current) fetchDataRef.current(true);
    });
  }, []);

  // Fetch on mount or when dependencies change
  useEffect(() => {
    mountedRef.current = true;
    retryCountRef.current = 0; // Reset retries on new fetch cycle
    fetchData();
    return () => {
      mountedRef.current = false;
      if (retryTimerRef.current) {
        clearTimeout(retryTimerRef.current);
        retryTimerRef.current = null;
      }
    };
  }, [fetchData]);

  // Get data from cache, falling back to previous data during invalidation/refetch
  const previousDataRef = useRef<{ key: string; data: T | null }>({ key: '', data: null });
  const data = cache.get<T>(cacheKey);
  if (data !== null) {
    previousDataRef.current = { key: cacheKey, data };
  }
  const staleData = previousDataRef.current.key === cacheKey ? previousDataRef.current.data : null;

  return {
    data: data ?? staleData,
    loading,
    error,
    refetch: () => fetchData(true), // Force refetch
  };
}

// ============================================================================
// Hooks
// ============================================================================

/**
 * Hook for fetching homes
 */
export function useHomes(options: UseHomeKitDataOptions = {}): UseHomeKitDataResult<HomeKitHome[]> {
  const fetcher = useCallback(async () => {
    const result = await serverConnection.request<{ homes: HomeKitHome[] }>('homes.list');
    return result?.homes ?? [];
  }, []);

  return useCachedData<HomeKitHome[]>('homes', fetcher, options.skip ?? false);
}

/**
 * Hook for fetching rooms
 */
export function useRooms(homeId: string | null, options: UseHomeKitDataOptions = {}): UseHomeKitDataResult<HomeKitRoom[]> {
  const fetcher = useCallback(async () => {
    const result = await serverConnection.request<{ rooms: HomeKitRoom[] }>('rooms.list', { homeId });
    return result?.rooms ?? [];
  }, [homeId]);

  const skip = (options.skip ?? false) || !homeId;

  return useCachedData<HomeKitRoom[]>(`rooms:${homeId}`, fetcher, skip);
}

/**
 * Which of these cache keys still need fetching.
 *
 * The multi-home hooks below used to ask only "is anything missing", and
 * hydration answers that with "no" every single time — so after a launch they
 * returned without fetching anything at all, and the dashboard showed whatever
 * the previous session had left on disk until something else happened to write
 * those keys. `useCachedData` has always asked the fuller question; these two
 * are hand-rolled because they fan out across homes, and the check did not get
 * copied across with the rest.
 */
function homesNeedingFetch(prefix: string, homeIds: string[]): string[] {
  return homeIds.filter((id) => {
    const key = `${prefix}:${id}`;
    return cache.get(key) === null || cache.isStale(key) || cache.needsRevalidate(key);
  });
}

/** Re-run a fan-out effect when a revalidation is requested. */
function useRevalidateTick(): number {
  const [tick, setTick] = useState(0);
  useEffect(() => cache.subscribeRevalidate(() => setTick(n => n + 1)), []);
  return tick;
}

/**
 * Hook for fetching accessories for a specific home
 */
export function useAccessories(
  homeId: string | null,
  options: UseHomeKitDataOptions = {}
): UseHomeKitDataResult<HomeKitAccessory[]> {
  const fetcher = useCallback(async () => {
    const result = await serverConnection.request<{ accessories: HomeKitAccessory[] }>('accessories.list', {
      homeId,
      includeValues: true,
    });
    return normalizeAccessories(result?.accessories ?? []);
  }, [homeId]);

  const skip = (options.skip ?? false) || !homeId;

  return useCachedData<HomeKitAccessory[]>(`accessories:${homeId}`, fetcher, skip);
}

/**
 * Hook for fetching ALL accessories across all homes (for pickers/selectors)
 */
export function useAllAccessories(
  options: UseHomeKitDataOptions = {}
): UseHomeKitDataResult<HomeKitAccessory[]> {
  const fetcher = useCallback(async () => {
    const result = await serverConnection.request<{ accessories: HomeKitAccessory[] }>('accessories.list', {
      includeValues: true,
    });
    return normalizeAccessories(result?.accessories ?? []);
  }, []);

  return useCachedData<HomeKitAccessory[]>('accessories:all', fetcher, options.skip ?? false);
}

/**
 * Hook for fetching accessories for specific homes only (used by collections).
 * Stores data in per-home cache so real-time updates propagate correctly.
 */
export function useAccessoriesForHomes(
  homeIds: string[],
  options: UseHomeKitDataOptions = {}
): UseHomeKitDataResult<HomeKitAccessory[]> {
  // Force re-render when cache changes - use counter value, not setter
  const [cacheVersion, setCacheVersion] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const mountedRef = useRef(true);

  // Create stable key for home IDs
  const homeIdsKey = homeIds.slice().sort().join(',');
  // Re-runs the fan-out below when a revalidation is requested (socket
  // connected, app foregrounded). Without it these hooks only ever
  // reconsidered on a home-list change.
  const revalidateTick = useRevalidateTick();

  // Subscribe to cache changes for OUR home keys only (not all changes).
  // Subscribing to all changes caused the Dashboard to re-render on every HomeKit
  // observation event (motion sensors, temperatures, etc.), killing performance.
  useEffect(() => {
    const unsubs = homeIds.map(id =>
      cache.subscribe(() => {
        if (mountedRef.current) setCacheVersion(n => n + 1);
      }, `accessories:${id}`)
    );
    return () => unsubs.forEach(u => u());
  }, [homeIdsKey]);

  // Fetch accessories for each home and store in cache
  useEffect(() => {
    mountedRef.current = true;

    if (options.skip || homeIds.length === 0) {
      setLoading(false);
      return () => {
        mountedRef.current = false;
      };
    }

    // Which homes actually need a request — missing, stale, or restored from
    // disk and therefore never checked by this session.
    const toFetch = homesNeedingFetch('accessories', homeIds);
    if (toFetch.length === 0) {
      setLoading(false);
      return () => {
        mountedRef.current = false;
      };
    }

    // Only a loading state when there is nothing to keep on screen. Refreshing
    // over hydrated data has to be silent, or every launch flashes a skeleton
    // over content that was already there.
    const missing = homeIds.filter(id => cache.get<HomeKitAccessory[]>(`accessories:${id}`) === null);
    setLoading(missing.length > 0);
    setError(null);

    // Fetch accessories for each home.
    //
    // Routed through cache.getOrFetch so this dedupes against useAccessories()
    // for the selected home, which uses the same `accessories:<id>` key. Calling
    // serverConnection.request directly here meant the selected home's list —
    // the expensive includeValues:true one — was fetched twice concurrently on
    // every cold load. useAllServiceGroups below already does it this way.
    Promise.all(
      toFetch.map(homeId =>
        cache.getOrFetch(`accessories:${homeId}`, () =>
          serverConnection.request<{ accessories: HomeKitAccessory[] }>('accessories.list', {
            homeId,
            includeValues: true,
          })
          .then(result => normalizeAccessories(result.accessories))
        )
        .then(normalized => {
          // Store in per-home cache so updates work
          if (mountedRef.current) {
            cache.set(`accessories:${homeId}`, normalized);
          }
          return normalized;
        })
        .catch(() => [] as HomeKitAccessory[])
      )
    ).then(() => {
      if (mountedRef.current) {
        setLoading(false);
      }
    }).catch(err => {
      if (mountedRef.current) {
        setError(err instanceof Error ? err : new Error(String(err)));
        setLoading(false);
      }
    });

    return () => {
      mountedRef.current = false;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [homeIdsKey, options.skip, revalidateTick]);

  // Retry un-cached homes when cache updates (e.g. after relay connects)
  const retryCountRef = useRef(0);
  useEffect(() => {
    retryCountRef.current = 0;
  }, [homeIdsKey]);
  useEffect(() => {
    if (options.skip || homeIds.length === 0) return;
    const uncached = homeIds.filter(id => cache.get<HomeKitAccessory[]>(`accessories:${id}`) === null);
    if (uncached.length === 0 || retryCountRef.current >= 3) return;
    retryCountRef.current++;
    for (const homeId of uncached) {
      // Through getOrFetch, like the initial fan-out above: this retry fires on
      // every cacheVersion bump, so issuing it raw could stack a second live
      // accessories.list on top of one already in flight for the same home.
      cache.getOrFetch(`accessories:${homeId}`, () =>
        serverConnection.request<{ accessories: HomeKitAccessory[] }>('accessories.list', {
          homeId,
          includeValues: true,
        }).then(result => normalizeAccessories(result?.accessories ?? []))
      ).then(normalized => {
        if (mountedRef.current) {
          cache.set(`accessories:${homeId}`, normalized);
        }
      }).catch(() => {});
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cacheVersion, homeIdsKey, options.skip]);

  // Combine accessories from all home caches - recalculates when cacheVersion changes
  const data = useMemo(() => {
    if (homeIds.length === 0) return null;
    const combined: HomeKitAccessory[] = [];
    for (const homeId of homeIds) {
      const homeAccessories = cache.get<HomeKitAccessory[]>(`accessories:${homeId}`);
      if (homeAccessories) {
        combined.push(...homeAccessories.map(a => ({ ...a, homeId })));
      }
    }
    return combined.length > 0 ? combined : null;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [homeIdsKey, cacheVersion]);

  // One request per home, so "done" is simply how many have a cache entry.
  const progress = useMemo(() => ({
    done: homeIds.filter(id => cache.get<HomeKitAccessory[]>(`accessories:${id}`) !== null).length,
    total: homeIds.length,
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [homeIdsKey, cacheVersion]);

  return {
    progress,
    data: data as HomeKitAccessory[] | null,
    loading,
    error,
    refetch: async () => {
      // Force refetch all homes
      setLoading(true);
      await Promise.all(
        homeIds.map(homeId =>
          serverConnection.request<{ accessories: HomeKitAccessory[] }>('accessories.list', {
            homeId,
            includeValues: true,
          })
          .then(result => {
            cache.set(`accessories:${homeId}`, normalizeAccessories(result.accessories));
          })
          .catch(() => {})
        )
      );
      setLoading(false);
    },
  };
}

/**
 * Hook for fetching service groups
 */
export function useServiceGroups(
  homeId: string | null,
  options: UseHomeKitDataOptions = {}
): UseHomeKitDataResult<HomeKitServiceGroup[]> {
  const fetcher = useCallback(async () => {
    const result = await serverConnection.request<{ serviceGroups: HomeKitServiceGroup[] }>('serviceGroups.list', {
      homeId,
    });
    return result?.serviceGroups ?? [];
  }, [homeId]);

  const skip = (options.skip ?? false) || !homeId;

  return useCachedData<HomeKitServiceGroup[]>(`serviceGroups:${homeId}`, fetcher, skip);
}

/**
 * Hook for fetching service groups across ALL homes (used by search).
 * Fetches per-home (relay requires homeId), stores in per-home cache,
 * returns combined array with homeId annotated on each group.
 */
export function useAllServiceGroups(
  homeIds: string[],
  options: UseHomeKitDataOptions = {}
): UseHomeKitDataResult<HomeKitServiceGroup[]> {
  const [cacheVersion, setCacheVersion] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const mountedRef = useRef(true);

  const homeIdsKey = homeIds.slice().sort().join(',');
  // Re-runs the fan-out below when a revalidation is requested (socket
  // connected, app foregrounded). Without it these hooks only ever
  // reconsidered on a home-list change.
  const revalidateTick = useRevalidateTick();

  // Subscribe to cache changes for OUR service group keys only (not all changes).
  useEffect(() => {
    const unsubs = homeIds.map(id =>
      cache.subscribe(() => {
        if (mountedRef.current) setCacheVersion(n => n + 1);
      }, `serviceGroups:${id}`)
    );
    return () => unsubs.forEach(u => u());
  }, [homeIdsKey]);

  useEffect(() => {
    mountedRef.current = true;

    if (options.skip || homeIds.length === 0) {
      setLoading(false);
      return () => { mountedRef.current = false; };
    }

    const allCached = homeIds.every(id => cache.get<HomeKitServiceGroup[]>(`serviceGroups:${id}`) !== null);
    if (allCached) {
      setLoading(false);
      return () => { mountedRef.current = false; };
    }

    setLoading(true);
    setError(null);

    Promise.all(
      homeIds.map(homeId =>
        cache.getOrFetch(`serviceGroups:${homeId}`, () =>
          serverConnection.request<{ serviceGroups: HomeKitServiceGroup[] }>('serviceGroups.list', { homeId })
            .then(result => result?.serviceGroups ?? [])
        ).then(groups => {
          if (mountedRef.current) {
            cache.set(`serviceGroups:${homeId}`, groups);
          }
        }).catch(() => {})
      )
    ).then(() => {
      if (mountedRef.current) setLoading(false);
    }).catch(err => {
      if (mountedRef.current) {
        setError(err instanceof Error ? err : new Error(String(err)));
        setLoading(false);
      }
    });

    return () => { mountedRef.current = false; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [homeIdsKey, options.skip, revalidateTick]);

  // Retry un-cached homes when cache updates
  const retryCountRef = useRef(0);
  useEffect(() => {
    retryCountRef.current = 0;
  }, [homeIdsKey]);
  useEffect(() => {
    if (options.skip || homeIds.length === 0) return;
    const uncached = homeIds.filter(id => cache.get<HomeKitServiceGroup[]>(`serviceGroups:${id}`) === null);
    if (uncached.length === 0 || retryCountRef.current >= 3) return;
    retryCountRef.current++;
    for (const homeId of uncached) {
      serverConnection.request<{ serviceGroups: HomeKitServiceGroup[] }>('serviceGroups.list', { homeId })
        .then(result => {
          if (mountedRef.current) {
            cache.set(`serviceGroups:${homeId}`, result?.serviceGroups ?? []);
          }
        }).catch(() => {});
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cacheVersion, homeIdsKey, options.skip]);

  const data = useMemo(() => {
    if (homeIds.length === 0) return null;
    const combined: HomeKitServiceGroup[] = [];
    for (const homeId of homeIds) {
      const homeGroups = cache.get<HomeKitServiceGroup[]>(`serviceGroups:${homeId}`);
      if (homeGroups) {
        combined.push(...homeGroups.map(g => ({ ...g, homeId })));
      }
    }
    return combined.length > 0 ? combined : null;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [homeIdsKey, cacheVersion]);

  return {
    data: data as HomeKitServiceGroup[] | null,
    loading,
    error,
    refetch: async () => {
      setLoading(true);
      await Promise.all(
        homeIds.map(homeId =>
          serverConnection.request<{ serviceGroups: HomeKitServiceGroup[] }>('serviceGroups.list', { homeId })
            .then(result => { cache.set(`serviceGroups:${homeId}`, result.serviceGroups); })
            .catch(() => {})
        )
      );
      setLoading(false);
    },
  };
}

/**
 * Invalidate cached data (useful after mutations).
 * Pass a key for exact match, or use prefix: true for prefix-based invalidation.
 *
 * Dropping EVERY cache requires the explicit key 'all' — the old no-arg form
 * was a footgun: it ran on every relay_status_update, so a single home's relay
 * flapping made every client refetch every home's data.
 */
export function invalidateHomeKitCache(key: 'all' | (string & {}), options?: { prefix?: boolean }): void {
  // Runtime tolerance for untyped callers: no key means the old "nuke all".
  if (key && key !== 'all') {
    if (options?.prefix) {
      cache.invalidateByPrefix(key);
    } else {
      cache.invalidate(key);
    }
  } else {
    cache.invalidateByPrefix('homes');
    cache.invalidateByPrefix('rooms');
    cache.invalidateByPrefix('accessories');
    cache.invalidateByPrefix('serviceGroups');
  }
}

/**
 * Re-check every cached HomeKit read against the relay, keeping what is on
 * screen until an answer arrives.
 *
 * Called when the connection becomes usable and when the app comes back from
 * being hidden — the two moments where our picture may have gone stale with
 * nobody to tell us. Cheap by construction: no data is dropped, so there is no
 * loading state and no layout shift, and it costs the same handful of requests
 * that pulling to refresh already does.
 */
export function revalidateHomeKitCache(): void {
  cache.revalidateAll();
}

/**
 * Did this session boot with usable data already on disk? A warm start paints
 * from cache and should be near-instant; a cold one is bounded by the relay.
 * Boot timing reports the two separately — averaged together they hide both.
 */
export function wasHydratedFromStorage(): boolean {
  return cache.wasHydrated;
}

/**
 * Length of a cached list, or null if we've never seen it.
 *
 * Used to shape loading placeholders: with the last known counts a skeleton can
 * render the right number of rooms and tiles, so the real content lands into
 * the same layout instead of shoving it around.
 */
export function getCachedListLength(key: string): number | null {
  const entry = cache.get<unknown[]>(key);
  return Array.isArray(entry) ? entry.length : null;
}

/**
 * Drop both the in-memory cache and its persisted copy.
 *
 * Must be called on sign-out: the persisted copy survives a reload by design,
 * and one account's homes and accessories must never paint for the next person
 * to sign in on this device.
 */
export function clearPersistedHomeKitCache(): void {
  invalidateHomeKitCache('all');
  cache.clearPersisted();
}

/**
 * Invalidate just one home's accessories.
 *
 * The broad `invalidateHomeKitCache('accessories', { prefix: true })` drops
 * every home's entry and starts an N-home refetch wave. That is far too much
 * for the common case — changing rooms — where the only thing that went stale
 * is the home you are already looking at.
 *
 * Same UUID-case tolerance as invalidateHomeCaches: the relay and the cache
 * don't always agree on casing, and a miss here is a silently stale tile.
 */
export function invalidateAccessoriesForHome(homeId: string): void {
  for (const id of new Set([homeId, homeId.toUpperCase(), homeId.toLowerCase()])) {
    cache.invalidate(`accessories:${id}`);
  }
}

/**
 * Invalidate one home's cached data (rooms, accessories, service groups) plus
 * the homes list itself. Tolerates UUID case differences between the id in a
 * server message and the id the cache was keyed under.
 */
export function invalidateHomeCaches(homeId: string): void {
  cache.invalidateByPrefix('homes');
  for (const id of new Set([homeId, homeId.toUpperCase(), homeId.toLowerCase()])) {
    cache.invalidate(`rooms:${id}`);
    cache.invalidate(`accessories:${id}`);
    cache.invalidate(`serviceGroups:${id}`);
  }
}

/**
 * When the cache entry for a key was last written, or null if absent.
 * Used by diagnostics to report how fresh the data behind a UI state was.
 */
export function getCacheTimestamp(key: string): number | null {
  const entry = cache.getSnapshot().get(key);
  return entry ? entry.timestamp : null;
}

/**
 * Set service groups in the cache for a specific home.
 * Used by CollectionDetail which fetches service groups directly.
 */
export function setServiceGroupsInCache(homeId: string, serviceGroups: HomeKitServiceGroup[]): void {
  cache.set(`serviceGroups:${homeId}`, serviceGroups);
}

/**
 * Helper to update a characteristic in a specific cache key.
 * Returns true if the update was applied.
 */
function updateCharacteristicInCacheKey(
  cacheKey: string,
  accessoryId: string,
  characteristicType: string,
  jsonEncodedValue: string
): boolean {
  const accessories = cache.get<HomeKitAccessory[]>(cacheKey);
  if (!accessories) return false;

  let updated = false;
  const newAccessories = accessories.map(acc => {
    // Case-insensitive ID match — see sameAccessoryId. A case-sensitive compare
    // here silently dropped MQTT-initiated single-accessory updates.
    if (!sameAccessoryId(acc.id, accessoryId)) return acc;
    const withValue = {
      ...acc,
      services: acc.services.map(service => ({
        ...service,
        characteristics: service.characteristics.map(char => {
          if (char.characteristicType !== characteristicType) return char;
          updated = true;
          return { ...char, value: jsonEncodedValue };
        })
      }))
    };
    // Re-derive reachability: a value arriving is proof of responsiveness.
    return withDerivedReachability(withValue);
  });

  if (updated) {
    cache.set(cacheKey, newAccessories);
  }
  return updated;
}

/**
 * Update a characteristic value in the local cache.
 * This is called when we receive real-time updates from HomeKit or WebSocket.
 * Updates both home-specific cache and the "all accessories" cache used by collections.
 *
 * @param isServerUpdate - If true, this is an update from the server (WebSocket/real-time)
 *                         and should be checked against pending optimistic updates.
 *                         If false, this is a local optimistic update and should always apply.
 */
export function updateAccessoryCharacteristicInCache(
  homeId: string,
  accessoryId: string,
  characteristicType: string,
  value: unknown,
  isServerUpdate = true
): void {
  // Check if we should ignore this server update due to pending optimistic update
  if (isServerUpdate && pendingUpdates.shouldIgnoreServerUpdate(accessoryId, characteristicType, value)) {
    return;
  }

  // JSON-stringify the value to match the format from HomeKit
  const jsonEncodedValue = JSON.stringify(value);

  // Update home-specific cache, resolving the key case-insensitively so a
  // lowercase-homeId echo still lands (see resolveAccessoriesCacheKey).
  const homeKey = resolveAccessoriesCacheKey(homeId, k => !!cache.get<HomeKitAccessory[]>(k));
  const homeUpdated = updateCharacteristicInCacheKey(homeKey, accessoryId, characteristicType, jsonEncodedValue);

  // Also update the "all accessories" cache used by collections
  const allKey = 'accessories:all';
  const allUpdated = updateCharacteristicInCacheKey(allKey, accessoryId, characteristicType, jsonEncodedValue);

  if (import.meta.env.DEV) console.log(`[DataCache] updateCharacteristic: ${accessoryId.slice(0, 8)}:${characteristicType}=${value}, home=${homeUpdated}, all=${allUpdated}${isServerUpdate ? ' (server)' : ' (optimistic)'}`);
}

/**
 * Helper to update reachability in a specific cache key.
 * Returns true if the update was applied.
 */
function updateReachabilityInCacheKey(
  cacheKey: string,
  accessoryId: string,
  isReachable: boolean
): boolean {
  const accessories = cache.get<HomeKitAccessory[]>(cacheKey);
  if (!accessories) return false;

  let updated = false;
  const newAccessories = accessories.map(acc => {
    // Case-insensitive ID match (see sameAccessoryId).
    if (!sameAccessoryId(acc.id, accessoryId)) return acc;
    // Apply the incoming flag, then re-derive so a stuck `false` doesn't
    // drown out the values we still have cached.
    const derived = withDerivedReachability({ ...acc, isReachable });
    if (acc.isReachable === derived.isReachable) return acc;
    updated = true;
    return derived;
  });

  if (updated) {
    cache.set(cacheKey, newAccessories);
  }
  return updated;
}

/**
 * Update accessory reachability in the local cache.
 * Updates both home-specific cache and the "all accessories" cache.
 */
export function updateAccessoryReachabilityInCache(
  homeId: string,
  accessoryId: string,
  isReachable: boolean
): void {
  // Resolve the home key case-insensitively (see resolveAccessoriesCacheKey).
  const homeKey = resolveAccessoriesCacheKey(homeId, k => !!cache.get<HomeKitAccessory[]>(k));
  const homeUpdated = updateReachabilityInCacheKey(homeKey, accessoryId, isReachable);
  const allUpdated = updateReachabilityInCacheKey('accessories:all', accessoryId, isReachable);

  if (homeUpdated || allUpdated) {
    if (import.meta.env.DEV) console.log(`[DataCache] updateReachability: ${accessoryId.slice(0, 8)}=${isReachable}, home=${homeUpdated}, all=${allUpdated}`);
  }
}

/**
 * Update all accessories in a service group.
 * Resolves the group to its member accessories and updates each one.
 *
 * @param isServerUpdate - If true, this is an update from the server (WebSocket/real-time)
 *                         and should be checked against pending optimistic updates.
 *                         If false, this is a local optimistic update and should always apply.
 */
export function updateServiceGroupCharacteristicInCache(
  homeId: string,
  groupId: string,
  characteristicType: string,
  value: unknown,
  isServerUpdate = true
): void {
  // Check if we should ignore this server update due to pending optimistic update
  if (isServerUpdate && pendingUpdates.shouldIgnoreGroupServerUpdate(groupId, characteristicType, value)) {
    return;
  }

  // Get service groups from cache. UUIDs are case-insensitive (RFC 4122) but
  // sources disagree on case: the relay/HomeKit (and thus this cache) use
  // UPPERCASE, while the cloud MQTT bridge relays serviceGroup.set with a
  // LOWERCASE homeId. A case-sensitive lookup here silently missed the cache
  // and left the group + its members stale on MQTT-initiated changes (single
  // accessories dodged it because the relay re-derives homeId via accessory.get).
  let effectiveHomeId = homeId;
  let groups = cache.get<HomeKitServiceGroup[]>(`serviceGroups:${homeId}`);
  if (!groups) {
    for (const k of [homeId.toUpperCase(), homeId.toLowerCase()]) {
      const g = cache.get<HomeKitServiceGroup[]>(`serviceGroups:${k}`);
      if (g) { groups = g; effectiveHomeId = k; break; }
    }
  }
  if (!groups) {
    if (import.meta.env.DEV) console.log(`[DataCache] updateServiceGroup: no groups cached for home ${homeId.slice(0, 8)}`);
    return;
  }

  // Find the group (case-insensitive — see UUID note above)
  const group = groups.find(g => g.id === groupId)
    || groups.find(g => g.id.toUpperCase() === groupId.toUpperCase());
  if (!group) {
    if (import.meta.env.DEV) {
      console.log(`[DataCache] updateServiceGroup: group ${groupId.slice(0, 8)} not found in ${groups.length} groups`);
    }
    return;
  }

  // Update each accessory in the group
  // For power-related characteristics, update both 'on' and 'power_state' since
  // different accessories may use different characteristic types
  const isPowerCharacteristic = characteristicType === 'on' || characteristicType === 'power_state';

  for (const accessoryId of group.accessoryIds) {
    // Pass isServerUpdate=false here since we've already checked at the group level
    // and we want these individual updates to always apply. Use effectiveHomeId
    // (the case that actually hit the cache) so the accessories cache matches too.
    updateAccessoryCharacteristicInCache(effectiveHomeId, accessoryId, characteristicType, value, false);
    // Also update the alternate power characteristic as fallback
    if (isPowerCharacteristic) {
      const altCharType = characteristicType === 'on' ? 'power_state' : 'on';
      updateAccessoryCharacteristicInCache(effectiveHomeId, accessoryId, altCharType, value, false);
    }
  }

  if (import.meta.env.DEV) console.log(`[DataCache] updateServiceGroup: ${group.name} (${group.accessoryIds.length} accessories) → ${characteristicType}=${JSON.stringify(value)}${isServerUpdate ? ' (server)' : ' (optimistic)'}`);
}

/**
 * Mark a characteristic as having a pending optimistic update.
 * This prevents stale server updates from overwriting the optimistic value
 * during rapid toggling.
 */
export function markPendingUpdate(
  accessoryId: string,
  characteristicType: string,
  value: unknown
): void {
  pendingUpdates.setPending(accessoryId, characteristicType, value);
}

/**
 * Clear pending update status for a characteristic.
 * Call this when the server confirms the update or after a timeout.
 */
export function clearPendingUpdate(
  accessoryId: string,
  characteristicType: string
): void {
  pendingUpdates.clearPending(accessoryId, characteristicType);
}

/**
 * Mark a service group as having a pending optimistic update.
 * This prevents stale server updates from overwriting the optimistic value
 * during rapid toggling.
 */
export function markGroupPendingUpdate(
  groupId: string,
  characteristicType: string,
  value: unknown
): void {
  pendingUpdates.setGroupPending(groupId, characteristicType, value);
}

/**
 * Clear pending update status for a service group.
 */
export function clearGroupPendingUpdate(
  groupId: string,
  characteristicType: string
): void {
  pendingUpdates.clearGroupPending(groupId, characteristicType);
}
