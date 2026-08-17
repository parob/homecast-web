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

  /**
   * The scrim only ever swallowed the pointerdown. A widget expands on click,
   * and by the time the click is dispatched the scrim has gone inert for its
   * close animation — so on WebKit, which hit-tests the touch point at
   * touchend, the tile underneath still received it and expanded. jsdom does no
   * hit testing, so what is pinned here is the part that does not need it: the
   * click belonging to the dismissing gesture never reaches anything.
   */
  it('spends the tap that dismissed it, so the tile underneath is not pressed', async () => {
    const onClose = vi.fn();
    const underneath = vi.fn();
    const tile = document.createElement('button');
    tile.addEventListener('click', underneath);
    document.body.appendChild(tile);

    render(
      <ExpandedOverlay isExpanded onClose={onClose}>
        <div>content</div>
      </ExpandedOverlay>,
    );
    await openScrim();

    // The gesture: pointerdown lands on the scrim, and the click that completes
    // it lands on the tile — which is exactly what WebKit does after the scrim
    // drops out of the hit test.
    act(() => {
      scrim()!.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
    });
    expect(onClose).toHaveBeenCalledTimes(1);
    act(() => {
      tile.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });
    expect(underneath).not.toHaveBeenCalled();

    // ...and only that one click. The next genuine tap gets through.
    act(() => {
      tile.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });
    expect(underneath).toHaveBeenCalledTimes(1);

    tile.remove();
  });

  /**
   * The tile that kept expanding is a React onClick (WidgetCard), and the menu
   * that kept opening is a Radix trigger — also click, not pointerdown. React 18
   * listens on its root container, which is a descendant of document, so a
   * capture-phase listener on document runs first and stopPropagation keeps the
   * synthetic event from ever being dispatched. That is the whole fix, so it is
   * worth asserting against a real React handler and not just a raw one.
   */
  it('stops a React onClick, which is what the tile and the menu both use', async () => {
    const tileClick = vi.fn();
    render(
      <>
        <button type="button" onClick={tileClick}>tile</button>
        <ExpandedOverlay isExpanded onClose={vi.fn()}>
          <div>content</div>
        </ExpandedOverlay>
      </>,
    );
    await openScrim();
    const tile = document.querySelector<HTMLButtonElement>('button')!;

    act(() => {
      scrim()!.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
    });
    act(() => {
      tile.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });
    expect(tileClick).not.toHaveBeenCalled();

    // The overlay is gone; the tile works again on the next tap.
    act(() => {
      tile.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });
    expect(tileClick).toHaveBeenCalledTimes(1);
  });

  /**
   * The click belongs to the release, not the press. A finger that rests on the
   * backdrop for longer than the grace period before lifting would outlive a
   * timer started at pointerdown, and its click would reach the tile after all —
   * the same bug, at the speed of an unhurried tap.
   */
  it('still spends the tap when the finger rests before lifting', async () => {
    const underneath = vi.fn();
    const tile = document.createElement('button');
    tile.addEventListener('click', underneath);
    document.body.appendChild(tile);

    render(
      <ExpandedOverlay isExpanded onClose={vi.fn()}>
        <div>content</div>
      </ExpandedOverlay>,
    );
    await openScrim();

    act(() => {
      scrim()!.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
    });
    // Held past the grace period, then released.
    await new Promise(r => setTimeout(r, 500));
    act(() => {
      document.dispatchEvent(new MouseEvent('pointerup', { bubbles: true }));
      tile.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });
    expect(underneath).not.toHaveBeenCalled();

    tile.remove();
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
