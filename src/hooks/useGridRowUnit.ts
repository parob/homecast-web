import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * The natural height of an ordinary 1×1 tile in this grid, in pixels.
 *
 * ## Why this has to be measured rather than computed
 *
 * A Large tile is meant to be exactly **two rows tall, gap included** — "2× the
 * height of the other widgets", which is the only definition that makes it read
 * as four tiles' worth of space rather than merely a big rectangle.
 *
 * CSS cannot express that on its own here. Both dashboard grids size their rows
 * from content, and a tile spanning *both* columns of a two-column phone grid is
 * alone in the rows it spans — so those tracks collapse to the tile's own height
 * and `align-self: stretch` has nothing to stretch into. The first attempt used
 * a fixed `aspect-ratio` instead, which produced the right number at one column
 * width by coincidence and the wrong one everywhere else: 16/9 of a 358px phone
 * column is 201px and two rows is 202px, but 16/9 of a 648px desktop span is
 * 364px against two rows of 288px.
 *
 * Giving the grid an explicit row track fixes it at every width, and the track's
 * value is the one thing only the DOM knows: how tall this grid's ordinary tiles
 * happen to be at this text size, in this mode, with this content.
 *
 * ## What it measures
 *
 * Direct children that are **not** themselves spanning rows — a sized tile must
 * not size the track it is stretching into, which would be circular. The tallest
 * of them, because a track shorter than its content would clip.
 *
 * Returns `null` until there is something to measure, which callers must treat
 * as "leave the grid alone": a grid of nothing but sized tiles has no ordinary
 * tile to be twice the height of, and guessing would be worse than not acting.
 */
export function useGridRowUnit(enabled: boolean): [(el: HTMLElement | null) => void, number | null] {
  const [rowUnit, setRowUnit] = useState<number | null>(null);
  const elementRef = useRef<HTMLElement | null>(null);
  const observerRef = useRef<ResizeObserver | null>(null);

  const measure = useCallback(() => {
    const grid = elementRef.current;
    if (!grid) return;
    let tallest = 0;
    for (const child of Array.from(grid.children)) {
      if (!(child instanceof HTMLElement)) continue;
      // A spanning tile is excluded: it is the thing being sized, and letting it
      // feed the track it stretches into would chase its own tail — literally.
      // Checking `gridRowEnd` alone does not work and the failure is a runaway:
      // the `grid-row: span 2` shorthand sets *start* to `span 2` and leaves
      // *end* at `auto`, so the sized tile passed the filter, measured itself at
      // 202px, made the track 202px, became 412px, and grew without bound until
      // Playwright gave up waiting for the page to stop moving.
      const rowStyle = getComputedStyle(child);
      const spans = (v: string) => !!v && v !== 'auto' && v !== 'span 1';
      if (spans(rowStyle.gridRowStart) || spans(rowStyle.gridRowEnd)) continue;
      tallest = Math.max(tallest, child.getBoundingClientRect().height);
    }
    // Round to whole pixels: sub-pixel churn from a font metric would otherwise
    // re-render the grid on every observer callback.
    const next = tallest > 0 ? Math.round(tallest) : null;
    setRowUnit(prev => (prev === next ? prev : next));
  }, []);

  const ref = useCallback((el: HTMLElement | null) => {
    elementRef.current = el;
    observerRef.current?.disconnect();
    observerRef.current = null;
    if (!el || !enabled || typeof ResizeObserver === 'undefined') {
      if (!el || !enabled) setRowUnit(null);
      return;
    }
    // Observe the grid and its children: a tile growing (a longer name wrapping,
    // a status line appearing) changes the unit just as a resize does.
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    for (const child of Array.from(el.children)) {
      if (child instanceof HTMLElement) observer.observe(child);
    }
    observerRef.current = observer;
    measure();
  }, [enabled, measure]);

  useEffect(() => () => observerRef.current?.disconnect(), []);

  return [ref, enabled ? rowUnit : null];
}
