/**
 * What a full-viewport scrim tells the browser's own bars.
 *
 * Render this beside every scrim — it is the one component that knows what a
 * dimmed page owes the chrome around it, and it does two jobs.
 *
 * **1. The two edge slivers, for iOS Safari.** Two short gradients of plain
 * paint at the top and bottom of the viewport, solid for their first 12px in
 * the colour a scrim makes of the page's canvas and running out over 80px.
 *
 * iOS 26 Safari paints the page into the bands behind its status bar and URL
 * bar — until a `position: fixed` layer covers the page from the top edge, as
 * every scrim does. Then each band becomes one flat colour, sampled from the
 * page's own top and bottom few pixels of PLAIN paint: composited layers are
 * skipped, and a scrim (a backdrop-filter, or a translucent fill over a
 * filtered wallpaper) is one, so what it sampled was the undimmed canvas
 * beneath. The page went dark under the scrim and the bands stayed light —
 * two bars, top and bottom, for as long as anything was expanded or open.
 *
 * These sit ABOVE the scrim and give the sampler the answer the eye expects:
 * the canvas colour with the scrim's own darkening on it. They are painted,
 * not filtered, so they are what it reads. They sit below the overlay's own
 * content, so a full-height surface (the automation editor, a sheet) covers
 * them where it stands and the sampler reads that surface instead, which is
 * the right answer there too.
 *
 * **2. The canvas itself, everywhere.** A sliver is `position: fixed`, and a
 * fixed layer is not painted past the viewport's edges — so there are surfaces
 * it cannot reach at all: the overscroll strip, and the band past the end of a
 * document that an open overlay has scroll-locked. Those show WebKit's
 * extended background colour, which is the root element's — the undimmed
 * wallpaper sample. So the dim is also registered with `lib/overlay-dim`,
 * which `useCanvasTint` composes into the root's colour and into
 * `theme-color`. That half runs on every platform, because Android Chrome
 * paints an opaque toolbar from `theme-color` and has the same problem.
 *
 * The two halves are one component on purpose. They were separable once and
 * the result was parob/homecast-cloud#165: four call sites remembered the
 * slivers, a fifth (`AreaSummary`'s status panel) did not, and its bands sat
 * at rgb(37,166,185) — the raw canvas tint — over a page at rgb(22,98,108).
 * One component, rendered next to the scrim, is the thing a reviewer can look
 * for; `__tests__/edge-sample-coverage.test.ts` is the thing that looks for it
 * automatically.
 */
import { useOverlayDim } from '@/hooks/useOverlayDim';
import { isIOSBrowser } from '@/lib/platform';
import type React from 'react';

interface EdgeSampleSliversProps {
  /** How much black the scrim lays over the page, 0–1 (`bg-black/40` → 0.4). */
  dim: number;
  /** The scrim's own stacking level; the slivers paint over it, under its content. */
  zIndex?: React.CSSProperties['zIndex'];
  className?: string;
}

export function EdgeSampleSlivers({ dim, zIndex, className }: EdgeSampleSliversProps) {
  // Before the early return: this half is not iOS-only, and a hook cannot be
  // conditional. Registering on every platform is also what keeps the registry
  // honest in jsdom, where `isIOSBrowser()` is false and the slivers render
  // nothing — the coverage test can still see that a scrim declared its dim.
  useOverlayDim(dim);

  if (!isIOSBrowser()) return null;
  const black = `${Math.round(Math.min(1, Math.max(0, dim)) * 100)}%`;
  // Both edges in the one canvas colour the wallpaper fades into at its top
  // and its bottom (useCanvasTint). A gradient, not a strip: Safari reads a
  // gradient at its edge value, so the sampler still gets the solid colour,
  // while to the eye the sliver runs out into the scrimmed page instead of
  // meeting it as a line.
  const top = `color-mix(in srgb, #000 ${black}, var(--canvas-tint, #000))`;
  const bottom = top;
  return (
    <>
      <div
        aria-hidden
        data-edge-sample="top"
        className={`fixed left-0 right-0 top-0 h-20 pointer-events-none ${className ?? ''}`}
        style={{ zIndex, background: `linear-gradient(to bottom, ${top} 0, ${top} 12px, transparent 100%)` }}
      />
      <div
        aria-hidden
        data-edge-sample="bottom"
        className={`fixed left-0 right-0 bottom-0 h-20 pointer-events-none ${className ?? ''}`}
        style={{ zIndex, background: `linear-gradient(to top, ${bottom} 0, ${bottom} 12px, transparent 100%)` }}
      />
    </>
  );
}
