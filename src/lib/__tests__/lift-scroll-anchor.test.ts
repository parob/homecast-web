/**
 * The arithmetic behind holding a tile still while the page grows above it.
 *
 * The browser half is driven in `screenshots/reveal-during-lift.spec.ts` — only
 * a real page can show a real shift. This is the part that decides *how much* to
 * correct, and getting its sign or its scroll bookkeeping wrong is how a
 * correction ends up chasing itself.
 */
import { describe, it, expect } from 'vitest';
import { unexplainedShift } from '../lift-scroll-anchor';

describe('unexplainedShift', () => {
  it('is zero when nothing happens', () => {
    expect(unexplainedShift({ top: 100, scrollTop: 0 }, { top: 100, scrollTop: 0 })).toBe(0);
  });

  it('reports content that appeared above the anchor', () => {
    // A room above revealed a 127px row; nothing scrolled.
    expect(unexplainedShift({ top: 793, scrollTop: 669 }, { top: 920, scrollTop: 669 })).toBe(127);
  });

  it('ignores a pure scroll', () => {
    // Scrolling down 50 moves everything up 50. Nothing grew, so nothing to fix
    // — this is what stops a correction fighting a scroll it did not cause.
    expect(unexplainedShift({ top: 300, scrollTop: 100 }, { top: 250, scrollTop: 150 })).toBe(0);
  });

  it('separates growth from a scroll happening at the same time', () => {
    // Grew 127 above and scrolled down 50: the anchor nets +77, and 127 is the
    // part that needs correcting.
    expect(unexplainedShift({ top: 300, scrollTop: 100 }, { top: 377, scrollTop: 150 })).toBe(127);
  });

  it('reports the correction as already applied once it lands', () => {
    // Correcting the 127 above means scrolling 127: the anchor returns to where
    // it was, and the next frame must see nothing left to do.
    const afterGrowth = { top: 920, scrollTop: 669 };
    const afterCorrection = { top: 793, scrollTop: 669 + 127 };
    expect(unexplainedShift(afterGrowth, afterCorrection)).toBe(0);
  });

  it('is signed, so content removed above scrolls the other way', () => {
    expect(unexplainedShift({ top: 920, scrollTop: 0 }, { top: 793, scrollTop: 0 })).toBe(-127);
  });
});
