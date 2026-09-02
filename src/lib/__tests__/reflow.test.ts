// @vitest-environment jsdom
/**
 * The pure half of the reflow animation: what changed, and by how much.
 *
 * `playHeightChanges` is deliberately not unit tested — it is transitions and
 * `transitionend`, neither of which jsdom has. The Playwright spec
 * `screenshots/hidden-items-enter.spec.ts` samples the real thing in a real
 * browser, which is the only place that claim can be made honestly.
 */
import { describe, it, expect } from 'vitest';
import { heightChanges, type HeightMap } from '../reflow';

/** A detached tree, so `contains` is real rather than mocked. */
function tree() {
  const outer = document.createElement('div');
  const inner = document.createElement('div');
  const other = document.createElement('div');
  outer.appendChild(inner);
  document.body.append(outer, other);
  return { outer, inner, other };
}

const map = (...pairs: Array<[Element, number]>): HeightMap => new Map(pairs);

describe('heightChanges', () => {
  it('reports an element that grew, with both ends', () => {
    const { other } = tree();
    expect(heightChanges(map([other, 100]), map([other, 228]))).toEqual([
      { el: other, from: 100, to: 228 },
    ]);
  });

  it('reports a shrink the same way — the exit collapses through this too', () => {
    const { other } = tree();
    expect(heightChanges(map([other, 228]), map([other, 100]))[0]).toMatchObject({ from: 228, to: 100 });
  });

  it('treats an element that was not there as growing from nothing', () => {
    const { other } = tree();
    expect(heightChanges(map(), map([other, 140]))).toEqual([{ el: other, from: 0, to: 140 }]);
  });

  it('ignores an element that has been removed — there is nothing left to animate', () => {
    const { other } = tree();
    expect(heightChanges(map([other, 140]), map())).toEqual([]);
  });

  it('ignores sub-pixel noise', () => {
    const { other } = tree();
    expect(heightChanges(map([other, 140]), map([other, 140.4]))).toEqual([]);
  });

  it('keeps only the outermost of nested containers', () => {
    const { outer, inner } = tree();
    // A room container and the drop container inside it both gain the same row.
    // Animating both would clip the inner against the outer while they ran.
    const changes = heightChanges(map([outer, 150], [inner, 118]), map([outer, 278], [inner, 246]));
    expect(changes.map(c => c.el)).toEqual([outer]);
  });

  it('keeps siblings that both changed', () => {
    const { outer, other } = tree();
    const changes = heightChanges(map([outer, 150], [other, 100]), map([outer, 278], [other, 228]));
    expect(new Set(changes.map(c => c.el))).toEqual(new Set([outer, other]));
  });
});
