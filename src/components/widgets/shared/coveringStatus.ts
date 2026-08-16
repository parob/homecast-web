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
  const headingElsewhere = Math.abs(target - openness) > 1;
  return {
    isMoving: deviceMoving || headingElsewhere,
    isOpening: deviceMoving
      ? isOpeningFromState(positionState as number, usesStandardLogic)
      : target > openness,
  };
}

/**
 * What the blind is doing, in words, given openness (0 closed → 100 open).
 * "Open" alone was ambiguous at 60%, where a blind is neither open nor closed.
 */
export function coveringStatusText(isMoving: boolean, isOpening: boolean, openness: number): string {
  if (isMoving) return isOpening ? 'Opening' : 'Closing';
  if (openness <= 0) return 'Currently Closed';
  if (openness >= 100) return 'Currently Fully Open';
  return 'Currently Partially Open';
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
