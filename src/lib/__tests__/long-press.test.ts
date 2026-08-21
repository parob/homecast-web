// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import {
  exceededSlop,
  isBackgroundTarget,
  LIFT_DELAY_EDITING,
  LIFT_DELAY_IDLE,
  LIFT_SLOP,
} from '../long-press';

/** Build a detached tree and hand back the deepest node, to press on. */
function tree(html: string, selector: string): Element {
  const host = document.createElement('div');
  host.innerHTML = html;
  const el = host.querySelector(selector);
  if (!el) throw new Error(`no ${selector}`);
  return el;
}

describe('what counts as the background', () => {
  it('treats bare page furniture as background', () => {
    expect(isBackgroundTarget(tree('<div><span id="t">Kitchen</span></div>', '#t'))).toBe(true);
  });

  it('does not fire on a tile, which lifts itself', () => {
    const el = tree('<div data-draggable-item=""><span id="t">Lamp</span></div>', '#t');
    expect(isBackgroundTarget(el)).toBe(false);
  });

  it('does not fire on a sidebar row or a tab, for the same reason', () => {
    expect(isBackgroundTarget(tree('<div data-sortable-id="r1"><i id="t"></i></div>', '#t'))).toBe(false);
    expect(isBackgroundTarget(tree('<div data-tab-slot><i id="t"></i></div>', '#t'))).toBe(false);
  });

  it('does not fire on a control, however long the press lasts', () => {
    expect(isBackgroundTarget(tree('<button id="t">Run</button>', '#t'))).toBe(false);
    expect(isBackgroundTarget(tree('<div role="switch" id="t"></div>', '#t'))).toBe(false);
    expect(isBackgroundTarget(tree('<div role="slider" id="t"></div>', '#t'))).toBe(false);
    expect(isBackgroundTarget(tree('<a href="#" id="t">x</a>', '#t'))).toBe(false);
  });

  it('honours an explicit opt-out', () => {
    expect(isBackgroundTarget(tree('<div data-no-lift><span id="t"></span></div>', '#t'))).toBe(false);
  });

  it('walks up rather than testing the target alone', () => {
    // The press lands on the name inside the tile, which is not itself marked.
    const el = tree('<div data-draggable-item=""><div><p><span id="t">Lamp</span></p></div></div>', '#t');
    expect(isBackgroundTarget(el)).toBe(false);
  });

  it('reads a non-element target as background', () => {
    // Only elements carry gestures, so a text node can only be the page.
    expect(isBackgroundTarget(null)).toBe(true);
    expect(isBackgroundTarget(document.createTextNode('x') as unknown as EventTarget)).toBe(true);
  });
});

describe('when a hold becomes a scroll', () => {
  it('tolerates a wobble', () => {
    expect(exceededSlop(0, 0)).toBe(false);
    expect(exceededSlop(LIFT_SLOP, -LIFT_SLOP)).toBe(false);
  });

  it('gives up once the finger travels, on either axis and either direction', () => {
    expect(exceededSlop(LIFT_SLOP + 1, 0)).toBe(true);
    expect(exceededSlop(0, LIFT_SLOP + 1)).toBe(true);
    expect(exceededSlop(-(LIFT_SLOP + 1), 0)).toBe(true);
    expect(exceededSlop(0, -(LIFT_SLOP + 1))).toBe(true);
  });

  it('takes an explicit slop when the caller has one', () => {
    expect(exceededSlop(6, 0, 5)).toBe(true);
    expect(exceededSlop(6, 0, 20)).toBe(false);
  });
});

describe('the two delays', () => {
  it('makes entering the mode more deliberate than picking something up in it', () => {
    expect(LIFT_DELAY_IDLE).toBeGreaterThan(LIFT_DELAY_EDITING);
  });

  it('leaves the background looser than the sensor, which has a rect to aim at', () => {
    expect(LIFT_SLOP).toBeGreaterThan(5);
  });
});
