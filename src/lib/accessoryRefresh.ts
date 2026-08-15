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
 *
 * Two bugs made this whole file inert in cloud mode, found 2026-08-15 by
 * querying production logs: **zero** accessory.refresh calls had succeeded in
 * 5.5 hours, and none had ever reached a relay. Both are fixed below and both
 * are worth remembering, because each on its own is enough to kill the feature
 * silently — the failures are deliberately not surfaced.
 */

import { serverConnection } from '../server/connection';

const COOLDOWN_MS = 30_000;
/**
 * How long to wait after an attempt that never actually read anything.
 *
 * Not COOLDOWN_MS: a skipped attempt has produced no data, so treating it like
 * a successful read means a launch — when the socket is not up yet — burns
 * every visible tile's cooldown at once and then stays quiet for 30 seconds.
 */
const RETRY_AFTER_SKIP_MS = 2_000;
const MAX_CONCURRENT = 4;

const nextEligibleAt = new Map<string, number>();
const homeIds = new Map<string, string>();
const queued = new Set<string>();
let inFlight = 0;

async function runOne(accessoryId: string): Promise<void> {
  inFlight++;
  // Whether a read was actually issued and answered. Only that earns the full
  // cooldown; see RETRY_AFTER_SKIP_MS.
  let read = false;
  try {
    // Don't bother the server if we already know the relay isn't reachable.
    // The server would just return NO_DEVICE and we'd log it as an error per
    // visible tile — a dashboard with 10 tiles produces 10 console errors
    // every time the user opens the page on an offline home.
    const conn = serverConnection.getState();
    if (!conn.isActive || conn.connectionState !== 'connected') return;

    // homeId is what lets the server pick a relay to route to. Without it the
    // request cannot be addressed and comes straight back as NO_DEVICE — which
    // is what every one of these did, for as long as this file has existed, in
    // cloud mode. `characteristic.set` has always passed it; this never did.
    const homeId = homeIds.get(accessoryId);
    await serverConnection.request('accessory.refresh', {
      accessoryId,
      ...(homeId && { homeId }),
    });
    read = true;
  } catch (err) {
    // NO_DEVICE just means the relay went offline between the gate above and
    // the request landing — silent in prod, warn in dev only. It read nothing,
    // so it must not start a full cooldown.
    const code = (err as { code?: string } | null)?.code;
    if (code !== 'NO_DEVICE' && import.meta.env.DEV) {
      console.warn(`[accessoryRefresh] ${accessoryId.slice(0, 8)} failed`, err);
    }
  } finally {
    nextEligibleAt.set(accessoryId, Date.now() + (read ? COOLDOWN_MS : RETRY_AFTER_SKIP_MS));
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

/**
 * Request a refresh; respects cooldown + concurrency cap. No-op if already
 * pending.
 *
 * `homeId` is optional only so callers without one still compile — pass it
 * whenever it is known, because without it the request cannot be routed.
 */
export function requestAccessoryRefresh(accessoryId: string, homeId?: string): void {
  if (homeId) homeIds.set(accessoryId, homeId);

  const next = nextEligibleAt.get(accessoryId);
  if (next !== undefined && Date.now() < next) return;
  if (queued.has(accessoryId)) return;

  if (inFlight < MAX_CONCURRENT) {
    void runOne(accessoryId);
  } else {
    queued.add(accessoryId);
  }
}
