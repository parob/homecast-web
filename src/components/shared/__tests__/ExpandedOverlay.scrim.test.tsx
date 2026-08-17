// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, act, cleanup, waitFor } from '@testing-library/react';
import { ExpandedOverlay } from '../ExpandedOverlay';

/**
 * The scrim is what makes "tap the background" mean only "close".
 *
 * It used to be pointer-events-none so that tapping another widget dismissed
 * this overlay AND pressed that widget. In practice that meant the dimmed,
 * blurred backdrop — which reads as unreachable — was still switching lights on
 * behind it. Now the scrim takes the tap and the overlay closes, full stop.
 *
 * jsdom does no hit testing, so a click cannot be shown to physically miss the
 * widget underneath. What is pinned here is the thing hit testing depends on:
 * the scrim is interactive exactly while the overlay is up, and a pointerdown
 * on it dismisses.
 */

if (!globalThis.ResizeObserver) {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
}

if (!window.matchMedia) {
  window.matchMedia = ((query: string) => ({
    matches: false, media: query, onchange: null,
    addEventListener: () => {}, removeEventListener: () => {},
    addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

const scrim = () => document.body.querySelector<HTMLElement>('.fixed-full-screen');
const panel = () => document.body.querySelector<HTMLElement>('[data-expandable-widget]');

// `ready` flips a frame after mount, and the scrim only becomes interactive then.
const openScrim = async () => {
  await waitFor(() => {
    const el = scrim();
    expect(el?.className).toContain('pointer-events-auto');
  });
  return scrim()!;
};

afterEach(cleanup);

describe('ExpandedOverlay backdrop', () => {
  it('takes the pointer while the overlay is up', async () => {
    render(
      <ExpandedOverlay isExpanded onClose={() => {}}>
        <div>content</div>
      </ExpandedOverlay>,
    );
    const el = await openScrim();
    expect(el.className).not.toContain('pointer-events-none');
  });

  it('closes on a tap, and only closes', async () => {
    const onClose = vi.fn();
    render(
      <ExpandedOverlay isExpanded onClose={onClose}>
        <div>content</div>
      </ExpandedOverlay>,
    );
    const el = await openScrim();
    act(() => {
      el.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('leaves taps inside the panel alone', async () => {
    const onClose = vi.fn();
    render(
      <ExpandedOverlay isExpanded onClose={onClose}>
        <button type="button">control</button>
      </ExpandedOverlay>,
    );
    await openScrim();
    const control = panel()!.querySelector('button')!;
    act(() => {
      control.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
    });
    expect(onClose).not.toHaveBeenCalled();
  });

  it('goes inert for the close animation, so the next tap is not eaten', async () => {
    const { rerender } = render(
      <ExpandedOverlay isExpanded onClose={() => {}}>
        <div>content</div>
      </ExpandedOverlay>,
    );
    await openScrim();
    rerender(
      <ExpandedOverlay isExpanded={false} onClose={() => {}}>
        <div>content</div>
      </ExpandedOverlay>,
    );
    // Still in the DOM — it fades out over 150ms — but no longer in the way.
    expect(scrim()?.className).toContain('pointer-events-none');
  });
});
