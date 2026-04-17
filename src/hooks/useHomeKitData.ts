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
}

type CacheListener = () => void;

class DataCache {
  private cache = new Map<string, CacheEntry<unknown>>();
  private keyListeners = new Map<string, Set<CacheListener>>();
  private staleTime = 5 * 60 * 1000; // 5 minutes (matches Apollo's behavior)
  // Track pending requests globally to deduplicate across hook instances
  private pendingRequests = new Map<string, Promise<unknown>>();

  get<T>(key: string): T | null {
    const entry = this.cache.get(key);
    if (!entry) return null;
    return entry.data as T;
  }

  set<T>(key: string, data: T): void {
    this.cache.set(key, { data, timestamp: Date.now() });
    this.notify(key);
  }

  isStale(key: string): boolean {
    const entry = this.cache.get(key);
    if (!entry) return true;
    return Date.now() - entry.timestamp > this.staleTime;
  }

  invalidate(key: string): void {
    this.cache.delete(key);
    this.notify(key);
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

    // If we have fresh cached data and not forcing, skip fetch
    if (hasCachedData && !isStale && !force) return;

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
          console.log(`[DataCache] Fetch failed for ${cacheKey}, scheduling retry ${retryCountRef.current}/${MAX_RETRIES}`);
          retryTimerRef.current = setTimeout(() => {
            if (mountedRef.current) {
              fetchData(true, true);
            }
          }, RETRY_DELAY);
        }
      }
    } finally {
      if (mountedRef.current) {
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

    // Check if we already have cached data for all homes
    const allCached = homeIds.every(id => cache.get<HomeKitAccessory[]>(`accessories:${id}`) !== null);
    if (allCached) {
      setLoading(false);
      return () => {
        mountedRef.current = false;
      };
    }

    setLoading(true);
    setError(null);

    // Fetch accessories for each home
    Promise.all(
      homeIds.map(homeId =>
        serverConnection.request<{ accessories: HomeKitAccessory[] }>('accessories.list', {
          homeId,
          includeValues: true,
        })
        .then(result => {
          const normalized = normalizeAccessories(result.accessories);
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
  }, [homeIdsKey, options.skip]);

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
      serverConnection.request<{ accessories: HomeKitAccessory[] }>('accessories.list', {
        homeId,
        includeValues: true,
      }).then(result => {
        if (mountedRef.current) {
          cache.set(`accessories:${homeId}`, normalizeAccessories(result?.accessories ?? []));
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

  return {
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
  }, [homeIdsKey, options.skip]);

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
 */
export function invalidateHomeKitCache(key?: string, options?: { prefix?: boolean }): void {
  if (key) {
    if (options?.prefix) {
      cache.invalidateByPrefix(key);
    } else {
      cache.invalidate(key);
    }
  } else {
    // Invalidate all
    cache.invalidateByPrefix('homes');
    cache.invalidateByPrefix('rooms');
    cache.invalidateByPrefix('accessories');
    cache.invalidateByPrefix('serviceGroups');
  }
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
    if (acc.id !== accessoryId) return acc;
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

  // Update home-specific cache
  const homeKey = `accessories:${homeId}`;
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
    if (acc.id !== accessoryId) return acc;
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
  const homeUpdated = updateReachabilityInCacheKey(`accessories:${homeId}`, accessoryId, isReachable);
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

  // Get service groups from cache
  const groups = cache.get<HomeKitServiceGroup[]>(`serviceGroups:${homeId}`);
  if (!groups) {
    if (import.meta.env.DEV) console.log(`[DataCache] updateServiceGroup: no groups cached for home ${homeId.slice(0, 8)}`);
    return;
  }

  // Find the group
  const group = groups.find(g => g.id === groupId);
  if (!group) {
    if (import.meta.env.DEV) {
      console.log(`[DataCache] updateServiceGroup: group ${groupId.slice(0, 8)} not found in ${groups.length} groups`);
      console.log(`[DataCache] Looking for: "${groupId}"`);
      console.log(`[DataCache] Available groups: ${groups.map(g => `"${g.id}"`).join(', ')}`);
    }
    return;
  }

  // Update each accessory in the group
  // For power-related characteristics, update both 'on' and 'power_state' since
  // different accessories may use different characteristic types
  const isPowerCharacteristic = characteristicType === 'on' || characteristicType === 'power_state';

  for (const accessoryId of group.accessoryIds) {
    // Pass isServerUpdate=false here since we've already checked at the group level
    // and we want these individual updates to always apply
    updateAccessoryCharacteristicInCache(homeId, accessoryId, characteristicType, value, false);
    // Also update the alternate power characteristic as fallback
    if (isPowerCharacteristic) {
      const altCharType = characteristicType === 'on' ? 'power_state' : 'on';
      updateAccessoryCharacteristicInCache(homeId, accessoryId, altCharType, value, false);
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
