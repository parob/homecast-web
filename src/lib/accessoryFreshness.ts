/**
 * Per-accessory responsiveness tracking.
 *
 * `HMAccessory.isReachable` on macOS is famously sticky — it can report false
 * even while reads and value updates succeed. Apple's Home app mirrors
 * accessory state from behaviour (successful reads, recent events) rather
 * than trusting the flag alone. This module does the same for Homecast:
 * if we've seen fresh values for an accessory, we treat it as responsive
 * regardless of `isReachable`; only mark it "no response" when the flag is
 * false AND we have no recent value, OR when a control attempt just failed
 * with a reachability-class error.
 *
 * The store is a global singleton; React components subscribe via
 * `useAccessoryStatus(accessoryId, isReachable)`.
 */

import { useEffect, useState } from 'react';

type Entry = { lastValueAt: number; lastNoResponseAt: number };

/** Treat `isReachable=false` as "actually unreachable" after values go this stale. */
const FRESH_WINDOW_MS = 10 * 60 * 1000;
/** A just-failed write/read sticks the tile in no_response for this long, unless a value comes in. */
const NO_RESPONSE_STICKY_MS = 15 * 1000;

const store = new Map<string, Entry>();
const listeners = new Set<() => void>();

function getEntry(id: string): Entry {
  return store.get(id) || { lastValueAt: 0, lastNoResponseAt: 0 };
}

function notify(): void {
  for (const l of listeners) l();
}

export function markValueSeen(accessoryId: string): void {
  const prev = getEntry(accessoryId);
  store.set(accessoryId, { ...prev, lastValueAt: Date.now() });
  notify();
}

export function markNoResponse(accessoryId: string): void {
  const prev = getEntry(accessoryId);
  store.set(accessoryId, { ...prev, lastNoResponseAt: Date.now() });
  notify();
}

/**
 * Seed last-value timestamps when a batch of accessories arrives with real values
 * (e.g. after `accessories.list`). Without this, a just-mounted tile with cached
 * values + stale `isReachable=false` would render as "no response" until the next
 * broadcast arrives.
 */
export function seedFreshnessFromAccessories(
  accessories: Array<{
    id?: string;
    services?: Array<{ characteristics?: Array<{ value?: unknown }> }>;
  }>,
): void {
  const now = Date.now();
  let changed = false;
  for (const a of accessories) {
    if (!a.id) continue;
    const hasAnyValue = a.services?.some((s) =>
      s.characteristics?.some((c) => c.value !== null && c.value !== undefined),
    );
    if (!hasAnyValue) continue;
    const prev = store.get(a.id);
    if (!prev || prev.lastValueAt < now - 1000) {
      store.set(a.id, { lastValueAt: now, lastNoResponseAt: prev?.lastNoResponseAt ?? 0 });
      changed = true;
    }
  }
  if (changed) notify();
}

export type AccessoryStatus = 'responsive' | 'no_response';

export function computeAccessoryStatus(
  isReachable: boolean | undefined,
  entry: Entry,
  now: number = Date.now(),
): AccessoryStatus {
  // Recent explicit failure wins — unless a value arrived *after* the failure.
  if (entry.lastNoResponseAt > 0 && now - entry.lastNoResponseAt < NO_RESPONSE_STICKY_MS) {
    if (entry.lastValueAt > entry.lastNoResponseAt) return 'responsive';
    return 'no_response';
  }
  // Trust positive reachability.
  if (isReachable === true) return 'responsive';
  // Override stale `isReachable=false` when we have fresh values.
  if (entry.lastValueAt > 0 && now - entry.lastValueAt < FRESH_WINDOW_MS) {
    return 'responsive';
  }
  return 'no_response';
}

/** Internal subscription hook — re-renders caller when any entry changes. */
function useFreshnessSubscription(): void {
  const [, tick] = useState(0);
  useEffect(() => {
    const listener = () => tick((n) => n + 1);
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);
}

/**
 * React hook. Returns 'responsive' | 'no_response' for the given accessory.
 * Subscribes to store changes so the UI updates on value arrival or explicit failure.
 */
export function useAccessoryStatus(
  accessoryId: string | undefined,
  isReachable: boolean | undefined,
): AccessoryStatus {
  useFreshnessSubscription();
  if (!accessoryId) return isReachable === false ? 'no_response' : 'responsive';
  return computeAccessoryStatus(isReachable, getEntry(accessoryId));
}

/**
 * React hook for callers that need to compute statuses for many accessories
 * synchronously during render (e.g. a service-group widget iterating members).
 * Subscribes once; returns a synchronous lookup.
 */
export function useAccessoryStatusLookup(): (
  accessoryId: string,
  isReachable: boolean | undefined,
) => AccessoryStatus {
  useFreshnessSubscription();
  return (accessoryId, isReachable) =>
    computeAccessoryStatus(isReachable, getEntry(accessoryId));
}
