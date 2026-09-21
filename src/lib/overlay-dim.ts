/**
 * How much black the overlays currently on screen lay over the page.
 *
 * iOS 26 Safari fills its status-bar and URL-bar bands from the page's own
 * PLAIN paint — the canvas colour `useCanvasTint` puts on the root element.
 * That colour is sampled from the wallpaper and is deliberately bright. Open a
 * scrimmed overlay and the page goes dark while the canvas does not, so the
 * bands stay at the undimmed value and the screen reads as one dark page
 * between two bright bars (parob/homecast-cloud#165: measured rgb(37,166,185)
 * in both bands against rgb(22,98,108) of page immediately beneath them).
 *
 * `EdgeSampleSlivers` answers that at the two edges by painting the dimmed
 * colour over the scrim. This module answers it for the canvas itself, which
 * is the surface a sliver cannot reach: the overscroll strip, and everything
 * past the end of a scroll-locked document. One registry, read by
 * `useCanvasTint`, so the canvas is dimmed by whatever is on top of it without
 * any overlay having to know that the canvas exists.
 *
 * Deliberately NOT React state. `useCanvasTint` lives at the top of the tree
 * and the scrims are portalled leaves, often in other trees entirely; a context
 * would have to be hoisted above every route that can open one. A module-level
 * registry with `useSyncExternalStore` is the same subscription without the
 * hoisting, and it composes across the app shells and the cloud UI, which do
 * not share a provider.
 */

/** A registered scrim: its id, and how much black it lays over the page. */
interface Entry {
  id: number;
  dim: number;
}

let entries: Entry[] = [];
let nextId = 1;
const listeners = new Set<() => void>();

/**
 * What a stack of scrims comes to, as one number.
 *
 * Two 30% washes are not a 30% wash and are not a 60% one either — the second
 * dims what is left of the first, so they compose to 1 − 0.7 × 0.7 = 51%. That
 * is what the eye sees through them, so it is what the canvas behind them has
 * to be. A dialog opened from an expanded panel is exactly this case.
 */
export function composeDim(dims: readonly number[]): number {
  let remaining = 1;
  for (const dim of dims) {
    remaining *= 1 - Math.min(1, Math.max(0, dim));
  }
  return 1 - remaining;
}

/** Registers a scrim. Returns the id to hand back to `removeOverlayDim`. */
export function addOverlayDim(dim: number): number {
  const id = nextId++;
  entries = [...entries, { id, dim }];
  listeners.forEach(fn => fn());
  return id;
}

/** Unregisters a scrim. Unknown ids are ignored, so a double-clear is safe. */
export function removeOverlayDim(id: number): void {
  const next = entries.filter(entry => entry.id !== id);
  if (next.length === entries.length) return;
  entries = next;
  listeners.forEach(fn => fn());
}

/** The composed dim of everything currently registered, 0 when nothing is. */
export function currentOverlayDim(): number {
  return composeDim(entries.map(entry => entry.dim));
}

export function subscribeOverlayDim(fn: () => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

/** Test seam. Nothing in the app calls this. */
export function resetOverlayDim(): void {
  entries = [];
  listeners.forEach(fn => fn());
}

/**
 * `colour` with `dim` of black over it — the JS twin of the `color-mix(in
 * srgb, #000 N%, c)` the slivers paint, so the canvas and the slivers land on
 * the same value rather than two nearly-equal ones.
 *
 * Takes and returns a plain `rgb()`/`rgba()`, which is what `getComputedStyle`
 * hands back and what a `theme-color` meta can carry. Anything it cannot parse
 * is returned unchanged: a colour we do not understand is better left alone
 * than replaced with a guess.
 */
export function dimColour(colour: string, dim: number): string {
  if (dim <= 0) return colour;
  const parts = (colour.match(/[\d.]+/g) ?? []).map(Number);
  if (parts.length < 3 || parts.some(n => !Number.isFinite(n))) return colour;
  const keep = 1 - Math.min(1, dim);
  const [r, g, b] = parts;
  return `rgb(${Math.round(r * keep)}, ${Math.round(g * keep)}, ${Math.round(b * keep)})`;
}
