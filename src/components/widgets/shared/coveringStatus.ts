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
 * What the blind is doing, in words, given openness (0 closed → 100 open).
 * "Open" alone was ambiguous at 60%, where a blind is neither open nor closed.
 */
export function coveringStatusText(isMoving: boolean, isOpening: boolean, openness: number): string {
  if (isMoving) return isOpening ? 'Opening' : 'Closing';
  if (openness <= 0) return 'Currently Closed';
  if (openness >= 100) return 'Currently Fully Open';
  return 'Currently Partially Open';
}
