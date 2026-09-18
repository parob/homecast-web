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

/**
 * How far a phone browser's page scrolls before the canvas switches from the
 * wallpaper's top colour to its bottom colour. The status bar band is ~62pt
 * on every current iPhone (59 with a Dynamic Island, 47 with a notch); once
 * the page has scrolled past it, nothing above the page is on screen any
 * more. Dashboard gives its page at least this much scroll room.
 */
export const PHONE_BROWSER_BAND_TOP = 64;

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

  // iOS Safari. Its bars are glass, and what shows through them past the
  // viewport's edges is the DOCUMENT's own paint: tiles, and under them the
  // body's background — never the wallpaper, which is a composited sticky
  // layer (see `.sticky-wallpaper`). Above a page at rest and past its end
  // there is no document either, and Safari fills with the root's plain
  // background-color, images ignored.
  //
  // The two edges of the wallpaper have different colours (a beach is sky
  // at the top and sand at the bottom), and one document-positioned paint
  // cannot be both at once. So the body carries a gradient over the first
  // screen's worth of the page only — the TOP colour at the top, the BOTTOM
  // colour from a little over halfway down — and is transparent below it,
  // where the root shows through. The status bar band, where the tiles run
  // under the clock, is right for the first few hundred pixels of a scroll;
  // the URL bar band, which is the big one, is right everywhere.
  // Deliberately on BODY: a background image on the root is one more thing
  // Safari treats differently, and body's background-COLOUR has to be
  // transparent, not the bottom tint — WebKit's fill colour is the root's
  // colour with body's blended over it (LocalFrameView::
  // documentBackgroundColor; images are ignored), so an opaque body colour
  // would be the fill everywhere, top band included.
  //
  // The root is the top colour while the page sits at rest (the band above
  // it shows the root, and meets the wallpaper's top scrim, which is this
  // same tint, with no seam) and the bottom colour once the page has
  // scrolled past the status bar band — from then on the root is only ever
  // seen below the gradient and past the page's end, both under the URL
  // bar, where a solid bar in the wallpaper's top colour was exactly the
  // complaint. Dashboard guarantees every page can scroll that far.
  // Declared after the theme-colour effect above on purpose: that one reads
  // the PAINTED root colour to resolve `--canvas-tint`, and this one sets
  // the painted root colour.
  useEffect(() => {
    if (isNativeShell || !isIOSBrowser()) return;
    const root = document.documentElement;
    const body = document.body;
    body.style.backgroundImage = 'linear-gradient(to bottom, var(--canvas-tint) 0, var(--canvas-tint-bottom, var(--canvas-tint)) 60%)';
    body.style.backgroundRepeat = 'no-repeat';
    // Past the tallest viewport by more than the URL bar band, so that at
    // rest the whole band below the page's first screen is the bottom colour
    // rather than the last of it being the (top-coloured) root.
    body.style.backgroundSize = '100% calc(100lvh + 120px)';
    body.style.backgroundColor = 'transparent';
    let past: boolean | null = null;
    let raf = 0;
    const apply = () => {
      raf = 0;
      const next = window.scrollY >= PHONE_BROWSER_BAND_TOP;
      if (next === past) return;
      past = next;
      root.style.backgroundColor = next ? 'var(--canvas-tint-bottom, var(--canvas-tint))' : 'var(--canvas-tint)';
    };
    const onScroll = () => { if (!raf) raf = requestAnimationFrame(apply); };
    apply();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll);
      if (raf) cancelAnimationFrame(raf);
      body.style.removeProperty('background-image');
      body.style.removeProperty('background-repeat');
      body.style.removeProperty('background-size');
    };
  }, [tint, bottomTint, isNativeShell]);

  return tint;
}
