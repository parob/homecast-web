// @vitest-environment jsdom
/**
 * The canvas tint has two consumers with different requirements, and the hook
 * is where they part.
 *
 * A browser gets the colour iOS 26 Safari fills its glass bars with, re-exposed
 * to the whole picture's brightness so a bright sky does not put two bright
 * bars around a dark photograph (parob/homecast-cloud#157).
 *
 * An app shell gets the WKWebView's backdrop, which is only ever seen in the
 * strip the page is pulled away from — right against the wallpaper's own top
 * edge. There the picture's average is the wrong number: on a dark photograph
 * with a dark top it came out four times brighter than the edge it borders
 * (parob/homecast-cloud#161).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, renderHook } from '@testing-library/react';
import { useCanvasTint } from '../useCanvasTint';
import { getLuminance, parseColor } from '@/lib/colorUtils';
import type { BackgroundSettings } from '@/lib/graphql/types';

type NativeWindow = Window & {
  webkit?: { messageHandlers?: { homecast?: { postMessage: (m: unknown) => void } } };
};

afterEach(() => {
  cleanup();
  delete (window as NativeWindow).webkit;
  document.documentElement.removeAttribute('style');
  document.body.removeAttribute('style');
});

/** A dark photograph whose top edge is darker still — the reported case. */
const WALLPAPER: BackgroundSettings = { type: 'custom', customUrl: 'https://example.test/night-garden.jpg', blur: 0, brightness: 50 };
const SAMPLED_TOP_EDGE = '#231d2e';   // luminance ≈ 0.02
const WHOLE_PICTURE_LUMINANCE = 0.28; // far brighter than that edge

/** Relative luminance of a hex colour, on the 0–1 scale the tint works in. */
function lum(hex: string): number {
  const rgb = parseColor(hex);
  if (!rgb) throw new Error(`not a colour: ${hex}`);
  return getLuminance(rgb.r, rgb.g, rgb.b);
}

function renderTint(isNativeShell: boolean) {
  const { result } = renderHook(() => useCanvasTint({
    background: WALLPAPER,
    sampledTopColor: SAMPLED_TOP_EDGE,
    isDark: true,
    wallpaperLuminance: WHOLE_PICTURE_LUMINANCE,
    isNativeShell,
  }));
  return result.current;
}

describe('useCanvasTint across shells', () => {
  it('re-exposes to the whole picture in a browser, and does not in an app shell', () => {
    const browserColour = renderTint(false);
    const shellColour = renderTint(true);

    // The browser's band tracks the picture, which is the whole point of #157.
    expect(lum(browserColour)).toBeGreaterThan(WHOLE_PICTURE_LUMINANCE * 0.7);
    // The shell's backdrop is the wallpaper's own top edge, untouched: no
    // re-exposure to the picture, no lift towards white. Both are bar trades.
    expect(shellColour.toLowerCase()).toBe(SAMPLED_TOP_EDGE);
    // Which, on this wallpaper, is a different colour entirely — before the
    // fix these two were one value.
    expect(lum(shellColour)).toBeLessThan(lum(browserColour) / 4);
  });

  it('hands the app shell that same colour over the bridge', () => {
    const postMessage = vi.fn();
    (window as NativeWindow).webkit = { messageHandlers: { homecast: { postMessage } } };

    const tint = renderTint(true);

    const sent = postMessage.mock.calls
      .map(([m]) => m as { action?: string; color?: string })
      .filter(m => m.action === 'backgroundColor' && m.color);
    expect(sent.at(-1)?.color).toBe(tint);
    // And the document canvas is left alone: in an app shell the WKWebView
    // paints the backdrop, not the page.
    expect(document.documentElement.style.backgroundColor).toBe('');
  });
});
