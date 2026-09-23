// @vitest-environment jsdom
/** Browser and native retain the same wallpaper colour, delivered through
 * their respective canvas / WKWebView paths. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, renderHook } from '@testing-library/react';
import { useCanvasTint } from '../useCanvasTint';
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
function renderTint(isNativeShell: boolean) {
  const { result } = renderHook(() => useCanvasTint({
    background: WALLPAPER,
    sampledTopColor: SAMPLED_TOP_EDGE,
    isDark: true,
    isNativeShell,
  }));
  return result.current;
}

describe('useCanvasTint across shells', () => {
  it('keeps the browser colour identical to the native backdrop', () => {
    expect(renderTint(false)).toBe(SAMPLED_TOP_EDGE);
    expect(renderTint(true)).toBe(SAMPLED_TOP_EDGE);
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
