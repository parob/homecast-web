/**
 * Deciding when a server reading is our own write coming back.
 *
 * Split out of useHomeKitData rather than left beside its only caller, for the
 * same reason lib/pending-writes.ts is: that module reaches the transport, the
 * config and the window object on import, so the two pure predicates below
 * could not be tested without standing up a DOM to get at them.
 */

/**
 * How far a server value may sit from the one we wrote and still be read as
 * confirmation, per characteristic.
 *
 * The match was exact, which is right for a switch and wrong for anything with
 * a position. Blinds round: write 37 to a bridge whose motor has 5% steps and
 * it reports back 35, for ever. That never equalled 37, so the pending entry
 * survived until the 5s window expired and *then* let the reading through —
 * the bar sat where the user put it, then jumped somewhere else a few seconds
 * later, with nothing in between to explain it.
 */
const CONFIRMATION_TOLERANCE: Record<string, number> = {
  target_position: 2,
  current_position: 2,
  target_horizontal_tilt: 2,
  target_vertical_tilt: 2,
};

/**
 * How long stale readings are ignored, for characteristics whose device takes
 * far longer than the default to get there.
 *
 * A blind can be thirty seconds in transit, and for all of it the bridge keeps
 * reporting the target it had before. Five seconds of protection means the last
 * twenty-five are spent watching the bar snap back to the old command.
 */
const EXTENDED_IGNORE_WINDOW: Record<string, number> = {
  target_position: 30000,
  target_horizontal_tilt: 30000,
  target_vertical_tilt: 30000,
};

/**
 * Extended to 5s (from 2s) to account for slow HomeKit responses (B8 fix), and
 * further still for the characteristics above.
 */
const DEFAULT_IGNORE_WINDOW_MS = 5000;

/** The window a pending write protects its characteristic for. */
export function ignoreWindowMs(characteristicType: string): number {
  return EXTENDED_IGNORE_WINDOW[characteristicType] ?? DEFAULT_IGNORE_WINDOW_MS;
}

/**
 * Is this server value the one we asked for, give or take?
 *
 * Only numbers get the slack, and only for the characteristics above; anything
 * else falls back to the exact comparison, because a mode or a boolean that is
 * nearly right is simply wrong.
 */
export function confirmsPending(characteristicType: string, serverValue: unknown, pendingValue: unknown): boolean {
  const tolerance = CONFIRMATION_TOLERANCE[characteristicType];
  if (tolerance !== undefined) {
    const server = Number(serverValue);
    const pending = Number(pendingValue);
    if (Number.isFinite(server) && Number.isFinite(pending)) {
      return Math.abs(server - pending) <= tolerance;
    }
  }
  return JSON.stringify(serverValue) === JSON.stringify(pendingValue);
}
