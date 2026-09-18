/**
 * Paints the page canvas to match the wallpaper.
 *
 * The wallpaper is a fixed layer, so it cannot reach the strip iOS exposes
 * during rubber-band overscroll; whatever shows there comes from the canvas.
 * Left alone that is white, which reads as the wallpaper being clipped.
 *
 * Lives in a hook because two screens need it — the dashboard and everything
 * under MainLayout (MQTT, Analytics, Diagnostics). It used to be an effect
 * inside Dashboard alone, which is why every other route stayed white.
 *
 * The colour decision itself is in lib/canvas-tint.ts, which is pure and tested.
 */

import { useEffect, useMemo } from 'react';
import { resolveCanvasTint } from '@/lib/canvas-tint';
import { isIOSBrowser } from '@/lib/platform';
import type { BackgroundSettings } from '@/lib/graphql/types';

interface Options {
  background: BackgroundSettings | null | undefined;
  sampledTopColor: string | null | undefined;
  /** The wallpaper's visible bottom edge, for iOS Safari's URL bar band. */
  sampledBottomColor?: string | null | undefined;
  isDark: boolean;
  /** Mac or iOS shell: the backdrop is the WKWebView's, not the document's. */
  isNativeShell: boolean;
}

export function useCanvasTint({ background, sampledTopColor, sampledBottomColor, isDark, isNativeShell }: Options): string {
  const tint = useMemo(
    () => resolveCanvasTint({ background, sampledTopColor, isDark }),
    [background, sampledTopColor, isDark],
  );
  // The same decision for the bottom edge: what an iOS Safari sampler should
  // read under the URL bar while a scrim is up (see EdgeSampleSlivers). A
  // wallpaper that runs sky-to-sand has nothing in common at its two ends.
  const bottomTint = useMemo(
    () => resolveCanvasTint({ background, sampledTopColor: sampledBottomColor ?? sampledTopColor, isDark }),
    [background, sampledBottomColor, sampledTopColor, isDark],
  );
  useEffect(() => {
    if (isNativeShell) return;
    document.documentElement.style.setProperty('--canvas-tint-bottom', bottomTint);
    return () => { document.documentElement.style.removeProperty('--canvas-tint-bottom'); };
  }, [bottomTint, isNativeShell]);


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
    document.documentElement.style.backgroundColor = tint;
    document.body.style.backgroundColor = tint;
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
  // effect below has applied it gives a plain rgb() every time.
  useEffect(() => {
    if (isNativeShell) return;
    const painted = getComputedStyle(document.documentElement).backgroundColor;
    const colour = painted && painted !== 'rgba(0, 0, 0, 0)' ? painted : tint;
    // The same colour for the app shells' edge strips (`.scroll-scrim`) and
    // the phone browser's wallpaper-top scrim (`.sticky-top-scrim`), so
    // content fades into the bars' colour rather than being cut by them.
    document.documentElement.style.setProperty('--canvas-tint', colour);

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
    meta.content = colour;
    return () => {
      meta.content = previous;
      document.documentElement.style.removeProperty('--canvas-tint');
    };
  }, [tint, isNativeShell]);

  return tint;
}
