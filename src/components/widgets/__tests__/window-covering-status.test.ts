import { describe, it, expect } from 'vitest';
import { coveringMotion, coveringStatusText, isOpeningFromState } from '../shared/coveringStatus';

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

describe('window covering motion', () => {
  // Pressing Open caches the target write immediately, so the target moves a
  // beat before the device admits to moving. That gap is the whole point.
  it('reports movement the moment a target differs, before the device agrees', () => {
    const { isMoving, isOpening } = coveringMotion(0, 100, STOPPED, true);
    expect(isMoving).toBe(true);
    expect(isOpening).toBe(true);
  });

  it('takes the direction from the device once it is actually moving', () => {
    // Device says Increasing on a coverage-reporting blind: it is closing, even
    // though the target happens to sit above the current position.
    expect(coveringMotion(50, 90, INCREASING, false).isOpening).toBe(false);
    expect(coveringMotion(50, 90, DECREASING, false).isOpening).toBe(true);
  });

  it('falls back to the target when the blind publishes no state', () => {
    expect(coveringMotion(20, 80, null, true)).toEqual({ isMoving: true, isOpening: true });
    expect(coveringMotion(80, 20, null, true)).toEqual({ isMoving: true, isOpening: false });
  });

  it('is still once it has arrived, allowing for a blind that stops slightly off', () => {
    expect(coveringMotion(100, 100, STOPPED, true).isMoving).toBe(false);
    expect(coveringMotion(99, 100, STOPPED, true).isMoving).toBe(false);
    expect(coveringMotion(97, 100, STOPPED, true).isMoving).toBe(true);
  });

  it('drives the wording end to end', () => {
    const arriving = coveringMotion(60, 100, STOPPED, true);
    expect(coveringStatusText(arriving.isMoving, arriving.isOpening, 60)).toBe('Opening');

    const settled = coveringMotion(100, 100, STOPPED, true);
    expect(coveringStatusText(settled.isMoving, settled.isOpening, 100)).toBe('Currently Fully Open');
  });
});
