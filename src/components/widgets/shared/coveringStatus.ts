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
