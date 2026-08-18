// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, act, cleanup, waitFor } from '@testing-library/react';
import { ExpandedOverlay } from '../ExpandedOverlay';

/**
 * A dialog opened FROM the expanded panel is not "outside" it — it is on top
 * of it.
 *
 * The panel's action bar opens three (analytics, prices, share), each a Radix
 * dialog portalled to the body at z-[10050]. Every one of them was unusable on
 * a touch screen: tapping outside the dialog dismissed the panel's blurred
 * backdrop and left the dialog sitting there.
 *
 * Two things went wrong on that one tap, and only the second is really nasty.
 * The overlay treated the dialog as background and closed. Then it armed its
 * click swallow — a capture-phase listener on document that spends the click
 * belonging to the dismissing gesture, so the tile underneath is not pressed.
 * But Radix defers a touch pointer-down-outside to exactly that click (a mouse
 * one it dispatches immediately, which is why this never reproduced at a desk),
 * and stopPropagation at document capture means its own document listener never
 * ran. The overlay ate the dialog's dismissal.
 *
 * jsdom does no hit testing and paints nothing, so the layers here carry inline
 * z-indexes and the "dialog" is a stand-in — what is pinned is the rule the fix
 * turns on: elevation decides whose event it is.
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

const openScrim = async () => {
  await waitFor(() => {
    expect(scrim()?.className).toContain('pointer-events-auto');
  });
};

/**
 * A stand-in for DialogContent + DialogOverlay: portalled to the body, above
 * the dashboard's overlay, with the one behaviour that matters — Radix's
 * touch path, which waits for the click after the pointerdown before deciding
 * it was dismissed.
 */
function mountDialogLike(z: number) {
  const overlay = document.createElement('div');
  overlay.style.zIndex = String(z);
  const inner = document.createElement('div');
  overlay.appendChild(inner);
  document.body.appendChild(overlay);

  const dismissed = vi.fn();
  const onPointerDown = (e: PointerEvent) => {
    if (overlay.contains(e.target as Node)) {
      // Radix's onPointerDownCapture on the content marks it as inside.
      if (inner.contains(e.target as Node)) return;
    }
    document.addEventListener('click', dismissed, { once: true });
  };
  document.addEventListener('pointerdown', onPointerDown);

  return {
    overlay,
    inner,
    dismissed,
    remove: () => {
      document.removeEventListener('pointerdown', onPointerDown);
      overlay.remove();
    },
  };
}

const tap = (el: Element) => {
  act(() => {
    el.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
  });
  act(() => {
    document.dispatchEvent(new MouseEvent('pointerup', { bubbles: true }));
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  });
};

afterEach(cleanup);

describe('ExpandedOverlay and the layers above it', () => {
  it('leaves a dialog stacked above it to handle its own taps', async () => {
    const onClose = vi.fn();
    render(
      <ExpandedOverlay isExpanded onClose={onClose}>
        <div>content</div>
      </ExpandedOverlay>,
    );
    await openScrim();

    // Default elevation is 10017; DialogOverlay is z-[10050].
    const dialog = mountDialogLike(10050);
    tap(dialog.overlay);

    // The panel stays: you opened the dialog from it, and it is what you come
    // back to.
    expect(onClose).not.toHaveBeenCalled();
    // ...and the dialog's own dismissal survived the trip.
    expect(dialog.dismissed).toHaveBeenCalledTimes(1);

    dialog.remove();
  });

  it('still dismisses for a layer BELOW it — the dialog it was expanded from', async () => {
    const onClose = vi.fn();
    // AccessorySearch expands widgets from inside its own dialog and lifts them
    // above it. Tapping the dialog behind must still collapse the widget.
    render(
      <ExpandedOverlay isExpanded onClose={onClose} zIndex={10051}>
        <div>content</div>
      </ExpandedOverlay>,
    );
    await openScrim();

    const dialog = mountDialogLike(10050);
    act(() => {
      dialog.overlay.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
    });
    expect(onClose).toHaveBeenCalledTimes(1);

    dialog.remove();
  });

  it('ignores a scroll inside a dialog above it', async () => {
    const onClose = vi.fn();
    render(
      <ExpandedOverlay isExpanded onClose={onClose}>
        <div>content</div>
      </ExpandedOverlay>,
    );
    await openScrim();

    const dialog = mountDialogLike(10050);
    // A tall dialog scrolls its own body; past the 40px threshold that is a
    // page scroll, not a dialog scroll, only if you ignore who is on top.
    Object.defineProperty(dialog.inner, 'scrollTop', { value: 0, writable: true, configurable: true });
    act(() => { dialog.inner.dispatchEvent(new Event('scroll', { bubbles: true })); });
    (dialog.inner as HTMLElement & { scrollTop: number }).scrollTop = 400;
    act(() => { dialog.inner.dispatchEvent(new Event('scroll', { bubbles: true })); });

    expect(onClose).not.toHaveBeenCalled();

    dialog.remove();
  });

  /**
   * The rule is elevation, not containment — which also settles the nested
   * case. A per-accessory panel opened from inside an expanded group portals to
   * the body, so the group's `contains` check can never see it; only its
   * inherited z-index says it is on top.
   */
  it('leaves a nested panel to handle its own taps', async () => {
    const closeOuter = vi.fn();
    render(
      <ExpandedOverlay isExpanded onClose={closeOuter}>
        <ExpandedOverlay isExpanded onClose={() => {}}>
          <button type="button">inner control</button>
        </ExpandedOverlay>
      </ExpandedOverlay>,
    );
    await openScrim();

    const panels = Array.from(document.body.querySelectorAll<HTMLElement>('[data-expandable-widget]'));
    expect(panels).toHaveLength(2);
    const inner = panels.sort((a, b) => Number(a.style.zIndex) - Number(b.style.zIndex))[1];

    act(() => {
      inner.querySelector('button')!.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
    });
    expect(closeOuter).not.toHaveBeenCalled();
  });
});
