/**
 * The registry that tells the canvas how dark the page currently is.
 *
 * See lib/overlay-dim for why this exists; parob/homecast-cloud#165 for what
 * it is worth. The composition rule is the part worth pinning down: two scrims
 * are not one scrim and are not two added together.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  addOverlayDim,
  composeDim,
  currentOverlayDim,
  dimColour,
  removeOverlayDim,
  resetOverlayDim,
  subscribeOverlayDim,
} from '../overlay-dim';

beforeEach(() => resetOverlayDim());

describe('composeDim', () => {
  it('is zero with nothing registered', () => {
    expect(composeDim([])).toBe(0);
  });

  it('is the dim itself for a single scrim', () => {
    expect(composeDim([0.4])).toBeCloseTo(0.4, 10);
  });

  it('stacks multiplicatively, not additively', () => {
    // A dialog over an expanded panel. 0.3 then 0.3 leaves 0.49 of the page
    // showing, so 0.51 — not 0.3 (the page would read darker than the canvas)
    // and not 0.6 (it would read lighter).
    expect(composeDim([0.3, 0.3])).toBeCloseTo(0.51, 10);
  });

  it('never exceeds fully black, whatever is stacked', () => {
    expect(composeDim([0.9, 0.9, 0.9])).toBeLessThanOrEqual(1);
    expect(composeDim([2, -1])).toBe(1);
  });
});

describe('the registry', () => {
  it('reports what is registered and forgets what is removed', () => {
    const a = addOverlayDim(0.4);
    expect(currentOverlayDim()).toBeCloseTo(0.4, 10);
    const b = addOverlayDim(0.3);
    expect(currentOverlayDim()).toBeCloseTo(0.58, 10);
    removeOverlayDim(a);
    expect(currentOverlayDim()).toBeCloseTo(0.3, 10);
    removeOverlayDim(b);
    expect(currentOverlayDim()).toBe(0);
  });

  it('ignores an id that is already gone', () => {
    const id = addOverlayDim(0.5);
    removeOverlayDim(id);
    expect(() => removeOverlayDim(id)).not.toThrow();
    expect(currentOverlayDim()).toBe(0);
  });

  it('notifies subscribers on both edges, and not on a no-op removal', () => {
    const seen = vi.fn();
    const stop = subscribeOverlayDim(seen);
    const id = addOverlayDim(0.4);
    expect(seen).toHaveBeenCalledTimes(1);
    removeOverlayDim(id);
    expect(seen).toHaveBeenCalledTimes(2);
    removeOverlayDim(id);
    expect(seen).toHaveBeenCalledTimes(2);
    stop();
    addOverlayDim(0.4);
    expect(seen).toHaveBeenCalledTimes(2);
  });
});

describe('dimColour', () => {
  it('matches the color-mix the slivers paint', () => {
    // The reported case: --canvas-tint rgb(37,166,185) under the home menu's
    // 30% scrim. The band measured rgb(27,116,130) where the sliver painted,
    // which is what `color-mix(in srgb, #000 30%, rgb(37,166,185))` resolves
    // to. The canvas has to land on the same value.
    expect(dimColour('rgb(37, 166, 185)', 0.3)).toBe('rgb(26, 116, 130)');
  });

  it('leaves the colour alone when nothing is over it', () => {
    expect(dimColour('rgb(37, 166, 185)', 0)).toBe('rgb(37, 166, 185)');
  });

  it('goes to black at full dim', () => {
    expect(dimColour('rgb(37, 166, 185)', 1)).toBe('rgb(0, 0, 0)');
  });

  it('passes through anything it cannot parse rather than guessing', () => {
    // `hsl(var(--background))` is the no-wallpaper tint and is a CSS
    // expression, not a colour — the same trap useCanvasTint documents for
    // the meta tag.
    expect(dimColour('hsl(var(--background))', 0.4)).toBe('hsl(var(--background))');
  });

  it('reads an rgba() and answers in rgb()', () => {
    expect(dimColour('rgba(100, 200, 50, 1)', 0.5)).toBe('rgb(50, 100, 25)');
  });
});
