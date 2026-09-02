// @vitest-environment jsdom
/**
 * The arithmetic behind holding a tile still while the page grows above it.
 *
 * The browser half is driven in `screenshots/reveal-during-lift.spec.ts` — only
 * a real page can show a real shift. This is the part that decides *how much* to
 * correct, and getting its sign or its scroll bookkeeping wrong is how a
 * correction ends up chasing itself.
 */
import { describe, it, expect } from 'vitest';
import { forcedByClamp, isAboveAnchor, pickAnchor, unexplainedShift, type AnchorCandidate } from '../lift-scroll-anchor';

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

  /**
   * The half that took the reporter to the top of the page: the offset moving
   * because the page could no longer hold it (parob/homecast-cloud#58).
   *
   * Measured on the fixture home, scrolled to the end: 1595px of page in a 500px
   * screen sits at 1095, the reveal going away takes it to 1468, and 968 is the
   * furthest it can then be. The browser's own clamp has already moved the page
   * by the whole shrink, and the anchor has not moved at all.
   */
  describe('when the page shrinks out from under the offset', () => {
    const atTheEnd = { top: 300, scrollTop: 1095, maxScrollTop: 1095 };

    it('has nothing left to correct once the clamp has done it', () => {
      const clamped = { top: 300, scrollTop: 968, maxScrollTop: 968 };
      expect(unexplainedShift(atTheEnd, clamped)).toBe(0);
    });

    it('still corrects the part the clamp could not reach', () => {
      // 300 gone above, of which the range could only absorb 127: the anchor is
      // 173 short and that is what is left to do.
      const clamped = { top: 300 - 300 + 127, scrollTop: 968, maxScrollTop: 968 };
      expect(unexplainedShift(atTheEnd, clamped)).toBe(-173);
    });

    it('leaves a flick in the same frame to the viewer', () => {
      // Clamped by 127 and then flicked 468 further up: the shrink is accounted
      // for, and fighting the rest would be fighting the finger.
      const flicked = { top: 300 + 468, scrollTop: 500, maxScrollTop: 968 };
      expect(unexplainedShift(atTheEnd, flicked)).toBe(0);
    });

    it('treats a scroll inside the range as a scroll, as before', () => {
      // Room to spare below, so nothing was forced: this is the viewer moving.
      const scrolled = { top: 350, scrollTop: 1045, maxScrollTop: 2000 };
      expect(unexplainedShift(atTheEnd, scrolled)).toBe(0);
    });
  });
});

describe('forcedByClamp', () => {
  it('is the drop the range left no room for', () => {
    expect(forcedByClamp(
      { top: 0, scrollTop: 1095 },
      { top: 0, scrollTop: 968, maxScrollTop: 968 },
    )).toBe(127);
  });

  it('is never more than the offset actually dropped', () => {
    // Flicked further than the clamp needed; only the clamp's share is forced.
    expect(forcedByClamp(
      { top: 0, scrollTop: 1095 },
      { top: 0, scrollTop: 100, maxScrollTop: 968 },
    )).toBe(127);
  });

  it('is nothing when the offset still fits', () => {
    expect(forcedByClamp(
      { top: 0, scrollTop: 1095 },
      { top: 0, scrollTop: 1000, maxScrollTop: 2000 },
    )).toBe(0);
  });

  it('is nothing when the offset went up', () => {
    expect(forcedByClamp(
      { top: 0, scrollTop: 900 },
      { top: 0, scrollTop: 968, maxScrollTop: 968 },
    )).toBe(0);
  });

  it('is nothing at all when the range was not measured', () => {
    expect(forcedByClamp({ top: 0, scrollTop: 1095 }, { top: 0, scrollTop: 968 })).toBe(0);
  });
});

/**
 * …and which element to take hold of, when the anchor is not a pressed tile.
 *
 * The lift path is handed its anchor by the finger. Edit Layout has to choose
 * one, and the choice is the whole fix: pick something already scrolled past
 * and every change between it and the top edge goes uncorrected.
 *
 * `pickPageAnchor` and `holdScrollAnchor` are not unit tested for the reason
 * the top of this file gives — jsdom has no layout and no rects. The browser
 * half is `screenshots/edit-layout-scroll-anchor.spec.ts`.
 */
describe('pickAnchor', () => {
  const c = (el: string, top: number, bottom: number, usable = true): AnchorCandidate<string> =>
    ({ el, top, bottom, usable });

  it('takes the topmost thing still on screen', () => {
    // Measured off the fixture home, scrolled past two rooms: `home-level` and
    // Bedroom are entirely above the top edge, Front Door straddles it.
    const picked = pickAnchor(
      [c('home-level', -469, -351), c('bedroom', -336, -59), c('frontDoor', -85, 65)],
      0,
    );
    expect(picked?.el).toBe('frontDoor');
  });

  it('ignores anything scrolled entirely past — holding it would hold a point nobody sees', () => {
    expect(pickAnchor([c('gone', -400, -10)], 0)).toBeNull();
  });

  it('counts something straddling the top edge as on screen', () => {
    expect(pickAnchor([c('straddling', -40, 10)], 0)?.el).toBe('straddling');
  });

  it('measures from the scroller, not the window', () => {
    // The native shell scrolls its own div, which starts part way down.
    expect(pickAnchor([c('above', 10, 60), c('first', 70, 200)], 80)?.el).toBe('first');
  });

  it('refuses the unusable, however well placed', () => {
    // A revealed item is the best-placed candidate and the one that unmounts.
    expect(pickAnchor([c('revealed', -10, 100, false), c('solid', 40, 200)], 0)?.el).toBe('solid');
  });

  it('is null when there is nothing on screen at all', () => {
    expect(pickAnchor([], 0)).toBeNull();
  });
});

describe('isAboveAnchor', () => {
  /** first — second — outer, with the anchor inside `outer`. */
  function page() {
    const first = document.createElement('div');
    const second = document.createElement('div');
    const outer = document.createElement('div');
    const anchor = document.createElement('div');
    outer.appendChild(anchor);
    document.body.replaceChildren(first, second, outer);
    return { first, second, outer, anchor };
  }

  it('is true for a container the anchor comes after', () => {
    const { first, anchor } = page();
    expect(isAboveAnchor(first, anchor)).toBe(true);
  });

  it('is false for one that comes after the anchor', () => {
    const { first, second } = page();
    // Read the other way round: with the anchor at `first`, `second` is below it.
    expect(isAboveAnchor(second, first)).toBe(false);
  });

  it('is false for a container the anchor is inside — part of it is on screen', () => {
    const { outer, anchor } = page();
    expect(isAboveAnchor(outer, anchor)).toBe(false);
  });

  it('is false for the anchor itself', () => {
    const { anchor } = page();
    expect(isAboveAnchor(anchor, anchor)).toBe(false);
  });
});
