/**
 * Who `theme-color` is describing, on a home-screen web app.
 *
 * Added to an iPhone's home screen, the page is drawn UNDER the status bar —
 * that is what `env(safe-area-inset-top)` buys — and iOS draws only the glyphs
 * over it, in whichever of black or white contrasts with the page's declared
 * `theme-color`. So the page makes two separate statements about the top of
 * the screen: the colour it paints there, and the colour it declares. They
 * have to agree, or the glyphs are chosen for a surface they do not land on.
 *
 * Today nothing reconciles them in that one mode. `useCanvasTint` treats
 * standalone as a native shell (`checkIsInMobileApp` counts
 * `navigator.standalone`) and returns before the meta, and the WKWebView
 * message it sends instead has no handler there — so `theme-color` never moves
 * off the `#333333` index.html ships. That is dark, so iOS draws the glyphs
 * white for the life of the app. Over the dashboard's dark wallpaper they are
 * fine; over the automation editor, a full-bleed white dialog, the clock, the
 * signal bars and the battery all disappear (parob/homecast-cloud#155).
 *
 * This is the gap left by the two surfaces that already handle their own:
 *
 * | surface | who tells the status bar |
 * |---|---|
 * | Mac / iOS app | `coverAppearance` → the native bar (`native-header.ts`) |
 * | iOS Safari | it samples the page's own top paint; the dialog covers the slivers |
 * | home screen web app | nothing — this hook |
 *
 * It is deliberately safe on the other two. In a phone browser `useCanvasTint`
 * removes the meta outright (Safari 26 tints its glass with it), so the lookup
 * below finds nothing and this does nothing; in the app shells the WKWebView
 * ignores `theme-color` and `coverAppearance` is what moves the bar.
 */

import { useEffect } from 'react';

/**
 * The first opaque background at or above `el` — the surface a viewer sees.
 *
 * Walked rather than read off `el` itself because the element filling the
 * screen is usually not the one carrying the colour; the dialog paints and its
 * contents are transparent. Returned as a plain `rgb()`, which is what the meta
 * tag can carry — `hsl(var(--background))` is a CSS expression Safari silently
 * ignores there, the same trap `useCanvasTint` documents.
 */
function opaqueBackgroundOf(el: HTMLElement): string | null {
  for (let node: HTMLElement | null = el; node; node = node.parentElement) {
    const parts = (getComputedStyle(node).backgroundColor.match(/[\d.]+/g) ?? []).map(Number);
    if (parts.length >= 3 && (parts[3] ?? 1) > 0.99) {
      return `rgb(${parts[0]}, ${parts[1]}, ${parts[2]})`;
    }
  }
  return null;
}

/**
 * Declares `surface` as the page's theme colour for as long as it is mounted.
 *
 * Pass `null` when the surface is not on screen; the previous declaration is
 * handed back then, and on unmount.
 *
 * Only claims it while the surface really does fill the viewport. The same
 * dialog is inset 48px on a tablet or a desktop, where the wallpaper still owns
 * the strip and claiming it would be a lie in the other direction. The test is
 * `offsetWidth`/`offsetHeight` rather than a bounding rect because the dialog
 * animates in on a transform, and a rect read on the first frame is still
 * mid-zoom — the same reason `coverAppearance` measures `offsetHeight`.
 */
export function useSurfaceThemeColor(surface: HTMLElement | null) {
  useEffect(() => {
    if (!surface) return;
    const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
    if (!meta) return;
    const fillsViewport =
      surface.offsetWidth >= window.innerWidth - 1 &&
      surface.offsetHeight >= window.innerHeight - 1;
    if (!fillsViewport) return;
    const colour = opaqueBackgroundOf(surface);
    if (!colour) return;
    const previous = meta.content;
    meta.content = colour;
    return () => {
      meta.content = previous;
    };
  }, [surface]);
}
