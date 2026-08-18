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
    document.documentElement.style.backgroundColor = tint;
    return () => {
      document.documentElement.style.removeProperty('background-color');
    };
  }, [tint, isNativeShell]);

  return tint;
}
