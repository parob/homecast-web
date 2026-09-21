// @vitest-environment jsdom
/**
 * The canvas is as dark as the page in front of it.
 *
 * parob/homecast-cloud#165: on iOS 26 Safari the status-bar and URL-bar bands
 * are filled from the page's own plain paint, and past the ends of a
 * scroll-locked document that paint is the ROOT element's colour — the
 * wallpaper sample, at the wallpaper's brightness. Open a scrimmed overlay and
 * the page goes dark while the root does not, so the bands sit at the undimmed
 * value: measured rgb(37,166,185) in both bands against rgb(22,98,108) of page
 * immediately beneath them, a 1.7× step.
 *
 * `EdgeSampleSlivers` paints over the two edges; this is the other half, for
 * the surfaces a `position: fixed` sliver cannot be painted into at all. Every
 * scrim renders the slivers (enforced by
 * `components/shared/__tests__/edge-sample-coverage.test.ts`), the slivers
 * register the dim, and `useCanvasTint` composes it into the root and into
 * `theme-color`.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { EdgeSampleSlivers } from '@/components/shared/EdgeSampleSlivers';
import { useCanvasTint } from '@/hooks/useCanvasTint';
import { dimColour, resetOverlayDim } from '@/lib/overlay-dim';
import type { BackgroundSettings } from '@/lib/graphql/types';

/** The reporter's device, so `isIOSBrowser()` answers true and slivers render. */
const IPHONE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 26_6_1 like Mac OS X) AppleWebKit/605.1.15 ' +
  '(KHTML, like Gecko) Version/26.6.1 Mobile/15E148 Safari/604.1';

/** A wallpaper with a known, bright sample — the shape of the reported one. */
const WALLPAPER = { type: 'custom', brightness: 50 } as unknown as BackgroundSettings;
const SAMPLED_TOP = '#1a6a76';

/** The dashboard's status panel: `overlayScrim(true)` is `bg-black/40`. */
const STATUS_PANEL_DIM = 0.4;

function Page({ overlayOpen }: { overlayOpen: boolean }) {
  useCanvasTint({
    background: WALLPAPER,
    sampledTopColor: SAMPLED_TOP,
    isDark: true,
    isNativeShell: false,
  });
  return overlayOpen ? <EdgeSampleSlivers dim={STATUS_PANEL_DIM} zIndex={10004} /> : null;
}

const rootColour = () => getComputedStyle(document.documentElement).backgroundColor;
const themeColour = () =>
  document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')?.content ?? null;

beforeEach(() => {
  resetOverlayDim();
  Object.defineProperty(window.navigator, 'userAgent', { value: IPHONE_UA, configurable: true });
});

afterEach(() => {
  cleanup();
  resetOverlayDim();
  document.documentElement.removeAttribute('style');
  document.querySelector('meta[name="theme-color"]')?.remove();
});

describe('the canvas under an open overlay', () => {
  it('is the wallpaper colour with nothing open', () => {
    const { rerender } = render(<Page overlayOpen={false} />);
    rerender(<Page overlayOpen={false} />);
    expect(rootColour()).toMatch(/^rgb\(/);
  });

  it('carries the scrim’s dim while the overlay is up, and hands it back after', () => {
    const view = render(<Page overlayOpen={false} />);
    const undimmed = rootColour();

    view.rerender(<Page overlayOpen />);
    const dimmed = rootColour();

    // The invariant, stated as the scrim states it: the canvas is the page's
    // colour with the same black over it that the page is under.
    expect(dimmed).toBe(dimColour(undimmed, STATUS_PANEL_DIM));
    expect(dimmed).not.toBe(undimmed);

    view.rerender(<Page overlayOpen={false} />);
    expect(rootColour()).toBe(undimmed);
  });

  it('leaves --canvas-tint undimmed, so the slivers do not dim it twice', () => {
    const view = render(<Page overlayOpen={false} />);
    const undimmed = document.documentElement.style.getPropertyValue('--canvas-tint');
    expect(undimmed).toMatch(/^rgb\(/);

    view.rerender(<Page overlayOpen />);
    // The slivers mix their own dim into this variable
    // (`color-mix(in srgb, #000 40%, var(--canvas-tint))`). Dimming it here as
    // well would land them at 64% black on a 40% scrim.
    expect(document.documentElement.style.getPropertyValue('--canvas-tint')).toBe(undimmed);
  });

  it('paints a sliver at each edge on iOS, above the scrim', () => {
    const view = render(<Page overlayOpen={false} />);
    expect(document.querySelectorAll('[data-edge-sample]')).toHaveLength(0);

    view.rerender(<Page overlayOpen />);
    const top = document.querySelector<HTMLElement>('[data-edge-sample="top"]');
    const bottom = document.querySelector<HTMLElement>('[data-edge-sample="bottom"]');
    expect(top).not.toBeNull();
    expect(bottom).not.toBeNull();
    expect(top!.style.zIndex).toBe('10004');
    expect(bottom!.style.zIndex).toBe('10004');
    expect(top!.style.background).toContain('40%');
  });

  it('dims theme-color too, for Android Chrome’s opaque toolbar', () => {
    Object.defineProperty(window.navigator, 'userAgent', {
      value: 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/126 Mobile Safari/537.36',
      configurable: true,
    });
    const meta = document.createElement('meta');
    meta.name = 'theme-color';
    meta.content = '#333333';
    document.head.appendChild(meta);

    const view = render(<Page overlayOpen={false} />);
    const undimmed = themeColour();
    expect(undimmed).toMatch(/^rgb\(/);

    view.rerender(<Page overlayOpen />);
    expect(themeColour()).toBe(dimColour(undimmed!, STATUS_PANEL_DIM));

    view.rerender(<Page overlayOpen={false} />);
    expect(themeColour()).toBe(undimmed);
  });

  it('renders no slivers away from iOS, but still dims the canvas', () => {
    Object.defineProperty(window.navigator, 'userAgent', {
      value: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Safari/605.1.15',
      configurable: true,
    });
    const view = render(<Page overlayOpen={false} />);
    const undimmed = rootColour();
    view.rerender(<Page overlayOpen />);
    expect(document.querySelectorAll('[data-edge-sample]')).toHaveLength(0);
    expect(rootColour()).toBe(dimColour(undimmed, STATUS_PANEL_DIM));
  });
});
