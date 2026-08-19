// @vitest-environment jsdom
//
// The decisions behind the left menu's swipe. The listeners are tested in
// hooks/__tests__/useDrawerSwipe.test.tsx; what is here is the part that has to
// be right for a gesture to feel like a gesture rather than a tripwire.

import { describe, it, expect, afterEach } from 'vitest';

import {
  AXIS_SLOP,
  CLOSE_TRAVEL,
  FLICK_MIN_TRAVEL,
  OPEN_TRAVEL,
  blocksSwipe,
  commitsSwipe,
  hasOpenOverlay,
  resolveAxis,
  scrollBlocksSwipe,
} from '../swipe';

afterEach(() => { document.body.innerHTML = ''; });

describe('resolveAxis', () => {
  it('waits for the slop before committing to a direction', () => {
    expect(resolveAxis(AXIS_SLOP - 1, 0)).toBe('undecided');
    expect(resolveAxis(0, AXIS_SLOP - 1)).toBe('undecided');
    expect(resolveAxis(AXIS_SLOP, 0)).toBe('horizontal');
  });

  it('reads a clear sideways drag as horizontal, either way', () => {
    expect(resolveAxis(40, 5)).toBe('horizontal');
    expect(resolveAxis(-40, 5)).toBe('horizontal');
  });

  it('gives a near-diagonal to the scroll', () => {
    // A drawer's contents scroll. Anything ambiguous has to be a scroll, or
    // reading a long list would keep dismissing the list.
    expect(resolveAxis(10, 9)).toBe('vertical');
    expect(resolveAxis(30, 30)).toBe('vertical');
  });
});

describe('commitsSwipe', () => {
  it('commits once the travel is covered, however slowly', () => {
    expect(commitsSwipe({ travel: OPEN_TRAVEL, elapsedMs: 4000, threshold: OPEN_TRAVEL })).toBe(true);
  });

  it('does not commit a short, slow drag', () => {
    expect(commitsSwipe({ travel: 30, elapsedMs: 500, threshold: OPEN_TRAVEL })).toBe(false);
  });

  it('commits a short, fast flick', () => {
    expect(commitsSwipe({ travel: 30, elapsedMs: 40, threshold: OPEN_TRAVEL })).toBe(true);
  });

  it('will not let a fast twitch stand in for a flick', () => {
    expect(commitsSwipe({ travel: FLICK_MIN_TRAVEL - 1, elapsedMs: 2, threshold: OPEN_TRAVEL })).toBe(false);
  });

  it('never divides by a zero timestamp gap', () => {
    expect(commitsSwipe({ travel: 40, elapsedMs: 0, threshold: CLOSE_TRAVEL })).toBe(false);
  });
});

describe('scrollBlocksSwipe', () => {
  const scroller = (scrollLeft: number) => ({ scrollLeft, scrollWidth: 500, clientWidth: 200 });

  it('ignores an element that does not actually scroll', () => {
    expect(scrollBlocksSwipe(1, { scrollLeft: 0, scrollWidth: 200.4, clientWidth: 200 })).toBe(false);
  });

  it('lets a swipe through at the end it is already parked against', () => {
    // The first screen of a horizontal row is the common case, and it has
    // nothing to the left — so the swipe is the menu's, not the row's.
    expect(scrollBlocksSwipe(1, scroller(0))).toBe(false);
    expect(scrollBlocksSwipe(-1, scroller(300))).toBe(false);
  });

  it('keeps the swipe when the scroller can still move that way', () => {
    expect(scrollBlocksSwipe(1, scroller(120))).toBe(true);
    expect(scrollBlocksSwipe(-1, scroller(0))).toBe(true);
  });
});

describe('blocksSwipe', () => {
  it('yields to a slider', () => {
    document.body.innerHTML = '<div id="row"><span id="thumb" role="slider"></span></div>';
    expect(blocksSwipe(document.getElementById('thumb'), 1)).toBe(true);
  });

  it('yields to anything that has opted out, at any depth', () => {
    document.body.innerHTML = '<div data-no-swipe><span id="deep"></span></div>';
    expect(blocksSwipe(document.getElementById('deep'), -1)).toBe(true);
  });

  it('stops walking at the root it was given', () => {
    // The open panel's own guard must not be answered by the page behind it.
    document.body.innerHTML = '<div data-no-swipe><div id="panel"><span id="row"></span></div></div>';
    const panel = document.getElementById('panel');
    expect(blocksSwipe(document.getElementById('row'), -1, panel)).toBe(false);
    expect(blocksSwipe(document.getElementById('row'), -1)).toBe(true);
  });

  it('lets an ordinary target through', () => {
    document.body.innerHTML = '<div><button id="b">Kitchen</button></div>';
    expect(blocksSwipe(document.getElementById('b'), 1)).toBe(false);
  });
});

describe('hasOpenOverlay', () => {
  it('sees an open dialog', () => {
    document.body.innerHTML = '<div role="dialog" data-state="open"></div>';
    expect(hasOpenOverlay(document)).toBe(true);
  });

  it('ignores one on its way out', () => {
    document.body.innerHTML = '<div role="dialog" data-state="closed"></div>';
    expect(hasOpenOverlay(document)).toBe(false);
  });
});
