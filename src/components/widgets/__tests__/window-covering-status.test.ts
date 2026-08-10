import { describe, it, expect } from 'vitest';
import { coveringStatusText, isOpeningFromState } from '../shared/coveringStatus';

// HomeKit's position_state values, of the RAW position.
const DECREASING = 0;
const INCREASING = 1;
const STOPPED = 2;

describe('window covering status', () => {
  it('names the resting state rather than calling everything Open', () => {
    expect(coveringStatusText(false, false, 0)).toBe('Currently Closed');
    expect(coveringStatusText(false, false, 60)).toBe('Currently Partially Open');
    expect(coveringStatusText(false, false, 100)).toBe('Currently Fully Open');
  });

  it('reports the direction while it moves, whatever the position', () => {
    for (const openness of [0, 40, 100]) {
      expect(coveringStatusText(true, true, openness)).toBe('Opening');
      expect(coveringStatusText(true, false, openness)).toBe('Closing');
    }
  });

  it('treats out-of-range readings as the nearest end stop', () => {
    expect(coveringStatusText(false, false, -1)).toBe('Currently Closed');
    expect(coveringStatusText(false, false, 101)).toBe('Currently Fully Open');
  });

  it('reads the direction the way the blind reports position', () => {
    // Openness-reporting (Lutron and friends): rising means opening.
    expect(isOpeningFromState(INCREASING, true)).toBe(true);
    expect(isOpeningFromState(DECREASING, true)).toBe(false);

    // Coverage-reporting, which is most roller blinds: rising means the blind
    // is coming DOWN, so the same raw direction is the opposite word.
    expect(isOpeningFromState(INCREASING, false)).toBe(false);
    expect(isOpeningFromState(DECREASING, false)).toBe(true);
  });

  it('never calls a stopped blind opening', () => {
    expect(isOpeningFromState(STOPPED, true)).toBe(false);
    expect(isOpeningFromState(STOPPED, false)).toBe(false);
  });
});
