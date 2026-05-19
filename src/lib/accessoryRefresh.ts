/**
 * Per-tile auto-refresh for stale accessories.
 *
 * HomeKit's `HMCharacteristic.value` can be nil at the moment we serialise an
 * accessories.list response (the framework hasn't read the value yet). Apple's
 * own Home app dodges this by reading on-demand per visible tile. We do the
 * same — but with strict gates so a 50-tile dashboard doesn't fire 50 reads:
 *   - per-accessory cooldown (skip if refreshed in the last 30s)
 *   - global concurrency cap (max 4 in flight; rest queue and dedupe)
 *   - we only get here when the accessory is already considered stale by the
 *     caller, so healthy tiles never trigger this path
 */

import { serverConnection } from '../server/connection';

const COOLDOWN_MS = 30_000;
const MAX_CONCURRENT = 4;

const lastRefreshAt = new Map<string, number>();
const queued = new Set<string>();
let inFlight = 0;

async function runOne(accessoryId: string): Promise<void> {
  inFlight++;
  try {
    await serverConnection.request('accessory.refresh', { accessoryId });
  } catch (err) {
    if (import.meta.env.DEV) {
      console.warn(`[accessoryRefresh] ${accessoryId.slice(0, 8)} failed`, err);
    }
  } finally {
    lastRefreshAt.set(accessoryId, Date.now());
    inFlight--;
    drain();
  }
}

function drain(): void {
  while (inFlight < MAX_CONCURRENT && queued.size > 0) {
    const next = queued.values().next().value as string;
    queued.delete(next);
    void runOne(next);
  }
}

/** Request a refresh; respects cooldown + concurrency cap. No-op if already pending. */
export function requestAccessoryRefresh(accessoryId: string): void {
  const last = lastRefreshAt.get(accessoryId);
  if (last !== undefined && Date.now() - last < COOLDOWN_MS) return;
  if (queued.has(accessoryId)) return;

  if (inFlight < MAX_CONCURRENT) {
    void runOne(accessoryId);
  } else {
    queued.add(accessoryId);
  }
}
