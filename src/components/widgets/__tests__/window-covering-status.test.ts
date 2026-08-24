import { describe, it, expect } from 'vitest';
import { coveringMotion, coveringPositionWord, coveringStatusText, coveringStopWrite, coveringToggleLabel, coveringToggleTarget, hasDeviceStarted, isCommandAbandoned, isOpeningFromState, usesStandardPositionLogic, toOpenness, fromOpenness } from '../shared/coveringStatus';

// HomeKit's position_state values, of the RAW position.
const DECREASING = 0;
const INCREASING = 1;
const STOPPED = 2;

describe('window covering status', () => {
  it('names the resting state rather than calling everything Open', () => {
    expect(coveringStatusText(false, false, 0)).toBe('Closed');
    expect(coveringStatusText(false, false, 60)).toBe('Half Open');
    expect(coveringStatusText(false, false, 100)).toBe('Open');
  });

  it('reports the direction while it moves, whatever the position', () => {
    for (const openness of [0, 40, 100]) {
      expect(coveringStatusText(true, true, openness)).toBe('Opening');
      expect(coveringStatusText(true, false, openness)).toBe('Closing');
    }
  });

  it('treats out-of-range readings as the nearest end stop', () => {
    expect(coveringStatusText(false, false, -1)).toBe('Closed');
    expect(coveringStatusText(false, false, 101)).toBe('Open');
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
    expect(coveringStatusText(settled.isMoving, settled.isOpening, 100)).toBe('Open');
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

describe('asked for, versus happening', () => {
  it('reads the device as started once it says it is moving', () => {
    // Not an inch of travel reported yet, but position_state is definite.
    expect(hasDeviceStarted(40, 40, true)).toBe(true);
  });

  it('reads it as started once the position leaves where it was', () => {
    // Plenty of blinds publish no position_state at all; the reading moving is
    // the only evidence there is.
    expect(hasDeviceStarted(40, 46, false)).toBe(true);
  });

  it('does not mistake settling slop for the journey beginning', () => {
    expect(hasDeviceStarted(40, 40, false)).toBe(false);
    expect(hasDeviceStarted(40, 41, false)).toBe(false);
  });

  it('marks the wait with an ellipsis and nothing louder', () => {
    expect(coveringStatusText(true, true, 40, false)).toBe('Opening…');
    expect(coveringStatusText(true, false, 40, false)).toBe('Closing…');
    // Once it is genuinely under way, the plain word.
    expect(coveringStatusText(true, true, 40, true)).toBe('Opening');
  });

  it('says nothing about waiting when the blind is at rest', () => {
    // A resting blind has no outstanding command to be waiting on, whatever the
    // flag says — the wording must not leak into the idle states.
    expect(coveringStatusText(false, false, 0, false)).toBe('Closed');
    expect(coveringStatusText(false, false, 100, false)).toBe('Open');
  });

  it('assumes started when the caller does not track commands', () => {
    // The default keeps every existing call site's wording unchanged.
    expect(coveringStatusText(true, true, 40)).toBe('Opening');
  });
});

describe('a command that was thrown away', () => {
  it('accepts a blind that stops a percent short of its target', () => {
    expect(isCommandAbandoned(100, 99)).toBe(false);
    expect(isCommandAbandoned(60, 60)).toBe(false);
  });

  it('notices the target being put back by a rejected write', () => {
    // writeCharacteristic reverts target_position on failure. The bar draws the
    // target, so this is the moment it slides away from where the user put it.
    expect(isCommandAbandoned(100, 0)).toBe(true);
  });
});

describe('stopping where it stands', () => {
  it('uses hold_position when the covering offers it', () => {
    expect(coveringStopWrite(45, true)).toEqual({ characteristicType: 'hold_position', value: true });
  });

  it('otherwise commands the position it is passing through', () => {
    // Raw, not openness: this goes straight to the write path. A blind sent its
    // own current position has already arrived, so it halts.
    expect(coveringStopWrite(45, false)).toEqual({ characteristicType: 'target_position', value: 45 });
  });

  it('stops at the raw reading whichever convention the blind uses', () => {
    // The value is echoed untouched, so an openness-reporting blind and a
    // coverage-reporting one are both told exactly where they already are.
    for (const raw of [0, 45, 100]) {
      expect(coveringStopWrite(raw, false).value).toBe(raw);
    }
  });
});


describe('how far open, in words', () => {
  it('keeps the end stops bare', () => {
    // Not "Fully Open", and not prefixed with "Currently" — the line only ever
    // describes now, so the word was doing no work.
    expect(coveringPositionWord(0)).toBe('Closed');
    expect(coveringPositionWord(100)).toBe('Open');
  });

  it('climbs the ladder in between rather than saying Partially Open to everything', () => {
    // 5% and 95% are both "partially open" and that told you nothing you could
    // not already see.
    expect(coveringPositionWord(5)).toBe('Slightly Open');
    expect(coveringPositionWord(50)).toBe('Half Open');
    expect(coveringPositionWord(95)).toBe('Mostly Open');
  });

  it('puts the boundaries where the words stop being true', () => {
    expect(coveringPositionWord(34)).toBe('Slightly Open');
    expect(coveringPositionWord(35)).toBe('Half Open');
    expect(coveringPositionWord(64)).toBe('Half Open');
    expect(coveringPositionWord(65)).toBe('Mostly Open');
  });

  it('never calls a blind that is barely cracked Closed', () => {
    // 1% open is open, and a blind reporting 99 has not finished arriving.
    expect(coveringPositionWord(1)).toBe('Slightly Open');
    expect(coveringPositionWord(99)).toBe('Mostly Open');
  });

  it('clamps a reading from outside the range', () => {
    expect(coveringPositionWord(-5)).toBe('Closed');
    expect(coveringPositionWord(120)).toBe('Open');
  });
});
