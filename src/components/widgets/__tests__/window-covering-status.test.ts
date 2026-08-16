import { describe, it, expect } from 'vitest';
import { coveringMotion, coveringStatusText, coveringToggleLabel, coveringToggleTarget, isOpeningFromState, usesStandardPositionLogic, toOpenness, fromOpenness } from '../shared/coveringStatus';

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

describe('position conventions', () => {
  it('knows which makers report openness', () => {
    expect(usesStandardPositionLogic('Eve Systems', 'Eve MotionBlinds 20CAA9901')).toBe(true);
    expect(usesStandardPositionLogic('Lutron', 'Serena')).toBe(true);
    expect(usesStandardPositionLogic('Hunter Douglas', 'PowerView')).toBe(true);
    // The model alone is enough — some bridges report the maker differently.
    expect(usesStandardPositionLogic('', 'MotionBlinds Roller')).toBe(true);
    // Everything else reports coverage.
    expect(usesStandardPositionLogic('Aqara', 'Curtain Driver E1')).toBe(false);
    expect(usesStandardPositionLogic('', '')).toBe(false);
  });

  it('converts a coverage-reporting blind to openness and back', () => {
    // 80 raw on a coverage blind means 80% covered — 20% open.
    expect(toOpenness(80, false)).toBe(20);
    expect(fromOpenness(20, false)).toBe(80);
    // An openness-reporting blind passes straight through.
    expect(toOpenness(80, true)).toBe(80);
    expect(fromOpenness(20, true)).toBe(20);
  });

  it('round-trips whatever the convention', () => {
    for (const standard of [true, false]) {
      for (const raw of [0, 25, 60, 100]) {
        expect(fromOpenness(toOpenness(raw, standard), standard)).toBe(raw);
      }
    }
  });

  it('averages a mixed group correctly once converted', () => {
    // Two blinds both physically half open, reporting it oppositely.
    const eve = toOpenness(50, true);    // openness-reporting
    const aqara = toOpenness(50, false); // coverage-reporting
    expect(Math.round((eve + aqara) / 2)).toBe(50);

    // Both fully open: one says 100, the other says 0.
    expect(Math.round((toOpenness(100, true) + toOpenness(0, false)) / 2)).toBe(100);
  });
});

describe('the compact one-press button', () => {
  it('offers the undo while the covering is still moving', () => {
    // Half-way through closing: openness 60, heading for 0. The press that is
    // worth having is Open. Reading the current position instead gave "Close",
    // which re-sent the target it was already obeying and did nothing visible.
    expect(coveringToggleLabel(60, 0, true)).toBe('Open');
    expect(coveringToggleTarget(60, 0, true)).toBe(100);

    // …and the mirror image, half-way through opening.
    expect(coveringToggleLabel(40, 100, true)).toBe('Close');
    expect(coveringToggleTarget(40, 100, true)).toBe(0);
  });

  it('offers the opposite of where it is once it has stopped', () => {
    expect(coveringToggleLabel(0, 0, false)).toBe('Open');
    expect(coveringToggleLabel(100, 100, false)).toBe('Close');
    // Partially open and at rest is not closed, so the press closes it.
    expect(coveringToggleLabel(60, 60, false)).toBe('Close');
  });

  it('ignores a stale target once motion has finished', () => {
    // Target still reads 0 from the last command, but nothing is moving and the
    // blind is open — the button must describe the blind, not the old order.
    expect(coveringToggleLabel(100, 0, false)).toBe('Close');
  });
});
