/**
 * Paints the page canvas to match the wallpaper.
 *
 * Browser and native use the same sampled wallpaper colour, with the user's
 * brightness applied once. Safari's edge scrims blend into that colour without
 * re-exposing or whitening it. The canvas covers overscroll and browser bands
 * beyond the wallpaper's composited layer.
 *
 * Lives in a hook because two screens need it — the dashboard and everything
 * under MainLayout (MQTT, Analytics, Diagnostics). It used to be an effect
 * inside Dashboard alone, which is why every other route stayed white.
 *
 * The colour decision itself is in lib/canvas-tint.ts, which is pure and tested.
 */

import { useEffect, useMemo, useRef } from 'react';
import { resolveCanvasTint } from '@/lib/canvas-tint';
import { useTotalOverlayDim } from '@/hooks/useOverlayDim';
import { dimColour } from '@/lib/overlay-dim';
import { isIOSBrowser } from '@/lib/platform';
import type { BackgroundSettings } from '@/lib/graphql/types';

interface Options {
  background: BackgroundSettings | null | undefined;
  sampledTopColor: string | null | undefined;
  isDark: boolean;
  /** Mac or iOS shell: the backdrop is the WKWebView's, not the document's. */
  isNativeShell: boolean;
}

export function useCanvasTint({ background, sampledTopColor, isDark, isNativeShell }: Options): string {
  const tint = useMemo(
    () => resolveCanvasTint({ background, sampledTopColor, isDark }),
    [background, sampledTopColor, isDark],
  );

  // How dark the overlays currently on screen have made the page. The canvas
  // is only ever seen at the edges — the overscroll strip, iOS 26 Safari's two
  // glass bands, Android Chrome's toolbar — and while a scrim is up those
  // edges border a dimmed page. Left at the wallpaper's own brightness they
  // read as two lit bars around a dark screen (parob/homecast-cloud#165). The
  // scrims declare this through `EdgeSampleSlivers`; see lib/overlay-dim.
  const overlayDim = useTotalOverlayDim();

  // The colour the root actually ended up painted, recorded by the effect
  // below at the moment it applied it — and recorded UNDIMMED. The effect
  // after it paints the dim ON TOP of this value and re-runs whenever the dim
  // changes, so it cannot read the root back for itself: it would compound its
  // own output every time an overlay opened. A ref rather than state because
  // effects run in order within one commit, so the second effect sees this
  // commit's value with no extra render and no frame at the previous colour.
  const paintedRef = useRef<string | null>(null);

  useEffect(() => {
    if (isNativeShell) {
      // Native apps: hand the WKWebView the exact backdrop colour so anything
      // the page does not paint — safe areas, overscroll — matches it.
      const w = window as unknown as {
        webkit?: { messageHandlers?: { homecast?: { postMessage: (m: unknown) => void } } };
      };
      w.webkit?.messageHandlers?.homecast?.postMessage({ action: 'backgroundColor', color: tint });
      return () => {
        // Clear it so the backgroundDark fallback resumes.
        w.webkit?.messageHandlers?.homecast?.postMessage({ action: 'backgroundColor' });
      };
    }

    // The canvas takes its background from the ROOT element, and only falls
    // back to propagating from body when the root has none. Setting the root
    // directly is what actually paints the overscroll region.
    //
    // body gets it too, and that is not redundant. body carries bg-background —
    // opaque white — across the whole document, so it is a second white surface
    // sitting between the tinted canvas and the wallpaper. Any gap that opens
    // above or below the fixed layer shows whichever of the two it lands in, so
    // both have to agree or the bug just moves.
    //
    // Except in iOS Safari, where body stays transparent and the root alone
    // is the canvas. Its bars are glass, and what shows through them past
    // the viewport's edges is the document's own paint — the tiles, and
    // behind them this canvas — never the wallpaper, which is a composited
    // sticky layer (see `.sticky-wallpaper`); above a page at rest and past
    // its end there is no document at all, and Safari fills with WebKit's
    // extended background colour: the root's colour with body's blended over
    // it, images ignored. Either way the bars show this one colour, at every
    // scroll position, so the wallpaper fades into it at BOTH edges
    // (`.sticky-top-scrim`, `.sticky-bottom-scrim`) and nothing ever meets a
    // bar in a colour other than the bar's own.
    document.documentElement.style.backgroundColor = tint;
    document.body.style.backgroundColor = isIOSBrowser() ? 'transparent' : tint;
    paintedRef.current = getComputedStyle(document.documentElement).backgroundColor;
    return () => {
      document.documentElement.style.removeProperty('background-color');
      document.body.style.removeProperty('background-color');
    };
  }, [tint, isNativeShell]);


  // Safari and Android Chrome paint their own bars — the status bar band and
  // the toolbar — in the page's `theme-color`. index.html ships a neutral
  // grey so the first paint is not white, and left there it drew two flat
  // grey bars above and below the wallpaper. Once the tint is known the bars
  // take it, and the page reads as one surface edge to edge.
  //
  // The PAINTED colour, not `tint` itself: with no wallpaper the tint is
  // `hsl(var(--background))`, a CSS expression the meta tag cannot carry, and
  // Safari silently kept the grey. Reading it back off the root after the
  // effect above has applied it gives a plain rgb() every time.
  useEffect(() => {
    if (isNativeShell) return;
    const painted = paintedRef.current;
    const colour = painted && painted !== 'rgba(0, 0, 0, 0)' ? painted : tint;
    // The same colour for the app shells' edge strips (`.scroll-scrim`) and
    // the phone browser's wallpaper-top scrim (`.sticky-top-scrim`), so
    // content fades into the bars' colour rather than being cut by them.
    //
    // UNDIMMED, deliberately, and the one value here that is. `EdgeSampleSlivers`
    // mixes its own scrim's dim into this variable, so handing it a dimmed
    // colour would darken every sliver twice over. The variable is what a
    // surface fades INTO; the dim belongs to whatever is covering it.
    document.documentElement.style.setProperty('--canvas-tint', colour);

    // The canvas, though, is behind the scrim and has to match it. A sliver
    // cannot reach the overscroll strip or the band past the end of a
    // scroll-locked document — a fixed layer is not painted past the
    // viewport's edges — so those surfaces are the root's own colour, and this
    // is where they get the dim.
    document.documentElement.style.backgroundColor = dimColour(colour, overlayDim);

    const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
    if (!meta) {
      return () => document.documentElement.style.removeProperty('--canvas-tint');
    }
    const previous = meta.content;
    // iOS Safari gets NO theme-color. Its bars are glass over the page
    // (iOS 26), and a theme-color is what it tints that glass with — a dark
    // canvas colour laid a dark gradient over the wallpaper's bottom edge
    // under the URL bar, the one thing there that was not the wallpaper.
    // With none it draws neutral glass, as for a page that never declared
    // one, and takes the status bar's ink from the page's own top — the
    // canvas-coloured scrim over the wallpaper. Android Chrome keeps it: its
    // toolbar is opaque and this is its colour.
    if (isIOSBrowser()) {
      meta.remove();
      return () => {
        const back = document.createElement('meta');
        back.name = 'theme-color';
        back.content = previous;
        document.head.appendChild(back);
        document.documentElement.style.removeProperty('--canvas-tint');
      };
    }
    meta.content = dimColour(colour, overlayDim);
    return () => {
      meta.content = previous;
      document.documentElement.style.removeProperty('--canvas-tint');
    };
  }, [tint, isNativeShell, overlayDim]);


  return tint;
}
