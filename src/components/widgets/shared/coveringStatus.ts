/**
 * Which way the blind is travelling.
 *
 * HomeKit's position_state describes the RAW position — 0 Decreasing,
 * 1 Increasing, 2 Stopped. On a blind that reports coverage rather than
 * openness the raw number rises as the blind comes down, so the direction
 * inverts with it; otherwise most blinds announce "Opening" while closing.
 */
export function isOpeningFromState(positionState: number, usesStandardLogic: boolean): boolean {
  return usesStandardLogic ? positionState === 1 : positionState === 0;
}

/**
 * Is the blind on its way somewhere, and which way?
 *
 * Two sources, because neither is enough alone. position_state is the device's
 * own account, but it lags: press Open and the blind reports Stopped until it
 * actually starts, so the tile sat there saying nothing had changed. A target
 * that differs from the current position is the other account, and it is known
 * the instant you press the button, because the write is cached optimistically.
 *
 * Taking either as movement is what lets the widget say "Opening" straight away
 * and still be right about it — the direction comes from wherever it is known.
 */
export function coveringMotion(
  openness: number,
  target: number,
  positionState: number | null,
  usesStandardLogic: boolean,
): { isMoving: boolean; isOpening: boolean } {
  const deviceMoving = positionState !== null && positionState !== 2;
  // A degree of slack: blinds settle a percent or two off their target and
  // would otherwise claim to be moving for ever.
  const headingElsewhere = !samePosition(target, openness);
  return {
    isMoving: deviceMoving || headingElsewhere,
    isOpening: deviceMoving
      ? isOpeningFromState(positionState as number, usesStandardLogic)
      : target > openness,
  };
}

/**
 * Where the blind is standing, in words, given openness (0 closed → 100 open).
 *
 * Everything between the end stops used to be one phrase, "Partially Open",
 * which is true of 5% and 95% alike and so tells you nothing you could not see.
 * A blind is a thing you glance at, and the useful glance is roughly how far
 * open it is, not the exact number — which the bar is already showing.
 *
 * The end stops are the bare words: a fully open blind is Open, not "Fully
 * Open", and certainly not "Currently Fully Open". The prefix was doing no work
 * — the line only ever describes now.
 */
export function coveringPositionWord(openness: number): string {
  if (openness <= 0) return 'Closed';
  if (openness >= 100) return 'Open';
  if (openness < SLIGHTLY_OPEN_BELOW) return 'Slightly Open';
  if (openness < MOSTLY_OPEN_FROM) return 'Half Open';
  return 'Mostly Open';
}

/** Below this it is barely cracked; from MOSTLY_OPEN_FROM it is nearly wide. */
const SLIGHTLY_OPEN_BELOW = 35;
const MOSTLY_OPEN_FROM = 65;

/**
 * What the blind is doing, in words, given openness (0 closed → 100 open).
 *
 * `hasStarted` separates a blind that is moving from one that has merely been
 * asked to — see hasDeviceStarted. The difference is an ellipsis, which is
 * deliberately quiet: the loud half of that signal is the pulse the widget puts
 * on the bar, and two shouty indicators for one state is worse than none.
 */
export function coveringStatusText(
  isMoving: boolean,
  isOpening: boolean,
  openness: number,
  hasStarted = true,
): string {
  if (isMoving) {
    const verb = isOpening ? 'Opening' : 'Closing';
    return hasStarted ? verb : `${verb}…`;
  }
  return coveringPositionWord(openness);
}

/**
 * Does this blind report position as openness, or as coverage?
 *
 * HomeKit says 0–100 and leaves the meaning to the manufacturer. Most roller
 * blinds report coverage — how far down the blind is — so 100 means shut. A
 * few report openness, the way the characteristic reads. There is no flag for
 * it; the only signal is who made the thing.
 */
export function usesStandardPositionLogic(manufacturer: string, model: string): boolean {
  const make = (manufacturer || '').toLowerCase();
  const type = (model || '').toLowerCase();
  return make.includes('lutron')
    || make.includes('hunter douglas')
    || make.includes('eve')
    || type.includes('motionblinds');
}

/**
 * Between the device's number and openness (0 closed → 100 open).
 *
 * The map is its own inverse, so one function would do — but a call site
 * reading `toOpenness(raw)` says what it means, and a mistake here silently
 * drives blinds the wrong way.
 */
export function toOpenness(rawPosition: number, standardLogic: boolean): number {
  return standardLogic ? rawPosition : 100 - rawPosition;
}

export function fromOpenness(openness: number, standardLogic: boolean): number {
  return standardLogic ? openness : 100 - openness;
}

/**
 * What the one-press button should offer next, in openness terms.
 *
 * Keyed on where the covering is *going*, not where it is. Reading the current
 * position meant a blind half-way through closing still offered "Close" — a
 * press that re-sent the target it was already obeying, and did nothing visible.
 * The useful press mid-motion is the one that undoes it.
 *
 * Returns the openness to write: 100 to open, 0 to close.
 */
export function coveringToggleTarget(
  currentOpenness: number,
  targetOpenness: number,
  isMoving: boolean,
): number {
  const heading = isMoving ? targetOpenness : currentOpenness;
  return heading === 0 ? 100 : 0;
}

/** The label for that button — the verb for what the press will do. */
export function coveringToggleLabel(
  currentOpenness: number,
  targetOpenness: number,
  isMoving: boolean,
): 'Open' | 'Close' {
  return coveringToggleTarget(currentOpenness, targetOpenness, isMoving) === 100 ? 'Open' : 'Close';
}

/**
 * How far off a position reading may be and still count as "the same place".
 *
 * Blinds settle a percent or two off their target, and a bridge that rounds a
 * write of 37 down to 35 is reporting arrival, not disagreement. Every
 * comparison between two positions in this file goes through this.
 */
export const POSITION_TOLERANCE = 1;

/** Are these two positions the same place, allowing for the slop above? */
export function samePosition(a: number, b: number, tolerance = POSITION_TOLERANCE): boolean {
  return Math.abs(a - b) <= tolerance;
}

/**
 * Has the device actually begun moving, or have we only asked it to?
 *
 * Between the press and the first millimetre of travel there is a real state
 * the widget used to have no word for: the write is out, the motor has not
 * started, and `coveringMotion` already says "Opening" because the optimistic
 * target differs from the current position. That is a useful lie — it beats
 * saying nothing — but on a slow link it is also the whole complaint: the tile
 * claims motion for two seconds before anything happens, so when the blind
 * genuinely stalls it looks exactly the same.
 *
 * Two ways to know it started, and either will do: the device says so via
 * position_state, or the position it reports has left where it was when we
 * asked.
 */
export function hasDeviceStarted(
  positionAtRequest: number,
  currentOpenness: number,
  deviceMoving: boolean,
): boolean {
  return deviceMoving || !samePosition(currentOpenness, positionAtRequest);
}

/**
 * Has the target we wrote been thrown away?
 *
 * A rejected write is reverted in the cache by `writeCharacteristic`, which
 * puts `target_position` back where it was. Since the bar now draws the target,
 * that revert is visible on its own — but silently, and the bar is the thing
 * the user just touched, so it deserves to be told rather than to just slide
 * back. Anything that moves the effective target off what we asked for counts:
 * a rejection, or another client commanding something else.
 */
export function isCommandAbandoned(requestedTarget: number, targetOpenness: number): boolean {
  return !samePosition(requestedTarget, targetOpenness);
}

/**
 * The write that stops a covering where it stands.
 *
 * HomeKit's own answer is `hold_position`, a write-only boolean, but plenty of
 * bridges never expose it. The universal fallback is to command the position it
 * is passing through, which every covering understands because it is an
 * ordinary target write — the blind arrives immediately, having already
 * arrived.
 *
 * Takes and returns RAW positions, not openness: this is handed straight to the
 * write path, and the caller has the raw reading anyway.
 */
export function coveringStopWrite(
  rawCurrentPosition: number,
  canHoldPosition: boolean,
): { characteristicType: 'hold_position' | 'target_position'; value: boolean | number } {
  return canHoldPosition
    ? { characteristicType: 'hold_position', value: true }
    : { characteristicType: 'target_position', value: rawCurrentPosition };
}
