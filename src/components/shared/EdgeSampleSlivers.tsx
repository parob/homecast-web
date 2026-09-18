/**
 * Two short gradients of plain paint at the top and bottom of the viewport,
 * solid for their first 12px in the colour a scrim makes of the page's canvas
 * and running out over 80px, for iOS Safari only.
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
 * the right answer there too. Nothing on any other platform: the slivers
 * exist for one browser's sampler.
 */
import type React from 'react';
import { isIOSBrowser } from '@/lib/platform';

interface EdgeSampleSliversProps {
  /** How much black the scrim lays over the page, 0–1 (`bg-black/40` → 0.4). */
  dim: number;
  /** The scrim's own stacking level; the slivers paint over it, under its content. */
  zIndex?: React.CSSProperties['zIndex'];
  className?: string;
}

export function EdgeSampleSlivers({ dim, zIndex, className }: EdgeSampleSliversProps) {
  if (!isIOSBrowser()) return null;
  const black = `${Math.round(Math.min(1, Math.max(0, dim)) * 100)}%`;
  // Each edge in its own colour: the wallpaper's top under the status bar,
  // its bottom under the URL bar (useCanvasTint samples both). A gradient,
  // not a strip: Safari reads a gradient at its edge value, so the sampler
  // still gets the solid colour, while to the eye the sliver runs out into
  // the scrimmed page instead of meeting it as a line.
  const top = `color-mix(in srgb, #000 ${black}, var(--canvas-tint, #000))`;
  const bottom = `color-mix(in srgb, #000 ${black}, var(--canvas-tint-bottom, var(--canvas-tint, #000)))`;
  return (
    <>
      <div
        aria-hidden
        className={`fixed left-0 right-0 top-0 h-20 pointer-events-none ${className ?? ''}`}
        style={{ zIndex, background: `linear-gradient(to bottom, ${top} 0, ${top} 12px, transparent 100%)` }}
      />
      <div
        aria-hidden
        className={`fixed left-0 right-0 bottom-0 h-20 pointer-events-none ${className ?? ''}`}
        style={{ zIndex, background: `linear-gradient(to top, ${bottom} 0, ${bottom} 12px, transparent 100%)` }}
      />
    </>
  );
}
