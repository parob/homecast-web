/**
 * How much room the request log is taking at the edges of the screen.
 *
 * `DebugDock` squashes the app into the space above the log by making its
 * wrapper a containing block for `fixed` children — see the note at the top of
 * `components/debug/DebugDock.tsx`. That works for everything rendered inside
 * the app, and cannot work for anything portalled to `document.body`: a child
 * of `body` resolves `fixed` against the viewport, so it lands on top of the
 * dock however the app above it is sized.
 *
 * The tab bar is exactly that — portalled out so its glass pill can beat a
 * portalled scrim on z-index — so it was sitting over the log, and over the
 * collapsed bar's expand chevron, which is the only way back into the panel.
 *
 * Hence a published height rather than more CSS: the panel owns the number
 * (it is resizable, and collapses to a bar), and anything that has escaped the
 * dock can read it and hold itself clear.
 *
 * Zero whenever the log is off, which is the case for everyone but a developer
 * who has switched it on — and zero again once it is minimised, which now
 * costs the layout nothing at all: the collapsed log is a floating button,
 * not a bar the app has to make room for.
 *
 * That button brings the mirror-image problem with it, which is what the rail
 * below is for. It sits in the bottom-right, on the tab bar's own floor, and
 * the bar's pill is centred with a `calc(100% - 32px)` ceiling — so a phone
 * with enough pins puts the two in the same place, and the bar would be the
 * thing covered this time. The rail is how wide a berth to give it.
 */

import { useSyncExternalStore } from 'react';

let height = 0;
let rail = 0;
const listeners = new Set<() => void>();

function publish(): void {
  for (const l of listeners) l();
}

export function getDebugDockHeight(): number {
  return height;
}

/** Called by the panel as it opens, resizes, collapses and unmounts. */
export function setDebugDockHeight(next: number): void {
  if (next === height) return;
  height = next;
  publish();
}

/**
 * How much of the bottom-right corner the minimised log's button occupies,
 * including the gap that keeps anything beside it from touching.
 *
 * Measured rather than declared: the button's width is its contents — the
 * request count, and a failure count that is only there sometimes.
 */
export function getDebugDockRail(): number {
  return rail;
}

/** Called by the panel as it minimises, as its counts grow, and on unmount. */
export function setDebugDockRail(next: number): void {
  if (next === rail) return;
  rail = next;
  publish();
}

export function subscribeDebugDockHeight(fn: () => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

/**
 * The live height, for chrome that has to hold itself above the dock.
 *
 * The server snapshot is the same getter: the dock is a client-only developer
 * tool that cannot be open before hydration, so it is 0 either way.
 */
export function useDebugDockHeight(): number {
  return useSyncExternalStore(subscribeDebugDockHeight, getDebugDockHeight, getDebugDockHeight);
}

/** The live rail, for chrome sharing the bottom edge with the collapsed log. */
export function useDebugDockRail(): number {
  return useSyncExternalStore(subscribeDebugDockHeight, getDebugDockRail, getDebugDockRail);
}
