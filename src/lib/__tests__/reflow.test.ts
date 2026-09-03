// @vitest-environment jsdom
/**
 * The pure half of the reflow animation: what changed, and by how much.
 *
 * `playHeightChanges` is deliberately not unit tested — it is transitions and
 * `transitionend`, neither of which jsdom has. The Playwright spec
 * `screenshots/hidden-items-enter.spec.ts` samples the real thing in a real
 * browser, which is the only place that claim can be made honestly.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { emptyingContainers, heightChanges, type HeightMap } from '../reflow';

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

/**
 * `heightChanges` above is the reason this exists: it walks the map taken AFTER
 * the change, so an element that is gone by then is invisible to it. A room
 * whose every tile was a revealed hidden one is exactly that element — it
 * unmounts whole when the reveal ends — and its height then closed in a single
 * frame (parob/homecast-cloud#60).
 *
 * `collapseContainers` is not unit tested, for the reason at the top of this
 * file: it is `Element.animate`, which jsdom does not have. The browser spec
 * `screenshots/edit-layout-exit-motion.spec.ts` measures the real thing.
 */
describe('emptyingContainers', () => {
  /** A room container holding `count` draggables, `hidden` of them revealed. */
  function room(count: number, hidden: number) {
    const el = document.createElement('div');
    el.setAttribute('data-room-container', '');
    for (let i = 0; i < count; i++) {
      const item = document.createElement('div');
      item.setAttribute('data-draggable-item', '');
      if (i < hidden) {
        // Where WidgetWrapper puts it: inside the draggable, not around it.
        const widget = document.createElement('div');
        widget.setAttribute('data-hidden-item', 'true');
        item.appendChild(widget);
      }
      el.appendChild(item);
    }
    document.body.appendChild(el);
    return el;
  }

  beforeEach(() => { document.body.innerHTML = ''; });

  it('finds a room whose every tile is a revealed one', () => {
    const el = room(2, 2);
    expect(emptyingContainers(document)).toEqual([el]);
  });

  it('leaves a room that keeps something — the space it loses can be animated', () => {
    room(3, 2);
    expect(emptyingContainers(document)).toEqual([]);
  });

  it('leaves a room with nothing in it: already empty is not emptying', () => {
    room(0, 0);
    expect(emptyingContainers(document)).toEqual([]);
  });

  it('finds a whole revealed room, where the mark is on the container itself', () => {
    // Hiding a room takes the section, so its own tiles are not marked — the
    // container is. Both directions have to be asked, which is the bug this
    // catches if `closest` is ever dropped for `querySelector` alone.
    const el = room(2, 0);
    el.setAttribute('data-hidden-item', 'true');
    expect(emptyingContainers(document)).toEqual([el]);
  });

  it('keeps only the outermost when a room and its drop container empty together', () => {
    const outer = room(0, 0);
    const inner = document.createElement('div');
    inner.setAttribute('data-drop-container', '');
    const item = document.createElement('div');
    item.setAttribute('data-draggable-item', '');
    const widget = document.createElement('div');
    widget.setAttribute('data-hidden-item', 'true');
    item.appendChild(widget);
    inner.appendChild(item);
    outer.appendChild(inner);
    expect(emptyingContainers(document)).toEqual([outer]);
  });
});
