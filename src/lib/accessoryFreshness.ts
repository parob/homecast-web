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

/**
 * Periodic tick so tiles correctly age into `no_response` once their
 * `lastValueAt` exits the fresh window, without needing an unrelated
 * broadcast to trigger a re-render. Fires only while something is
 * subscribed, so idle tabs don't churn.
 */
const TICK_INTERVAL_MS = 30 * 1000;
let tickHandle: ReturnType<typeof setInterval> | null = null;
function ensureTicker(): void {
  if (tickHandle !== null) return;
  if (typeof window === 'undefined') return; // skip in SSR / tests
  tickHandle = setInterval(() => {
    if (listeners.size > 0) notify();
    else if (tickHandle !== null) {
      clearInterval(tickHandle);
      tickHandle = null;
    }
  }, TICK_INTERVAL_MS);
}

/** Internal subscription hook — re-renders caller when any entry changes. */
function useFreshnessSubscription(): void {
  const [, tick] = useState(0);
  useEffect(() => {
    const listener = () => tick((n) => n + 1);
    listeners.add(listener);
    ensureTicker();
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
