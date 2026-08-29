/**
 * How much room the request log dock is taking at the bottom of the screen.
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
 * who has switched it on.
 */

import { useSyncExternalStore } from 'react';

let height = 0;
const listeners = new Set<() => void>();

export function getDebugDockHeight(): number {
  return height;
}

/** Called by the panel as it opens, resizes, collapses and unmounts. */
export function setDebugDockHeight(next: number): void {
  if (next === height) return;
  height = next;
  for (const l of listeners) l();
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
