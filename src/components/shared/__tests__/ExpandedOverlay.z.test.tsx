// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, act, cleanup } from '@testing-library/react';
import { ExpandedOverlay } from '../ExpandedOverlay';

/**
 * ExpandedOverlay portals to document.body, so anything it is rendered *inside*
 * — a dialog, a sheet — becomes its SIBLING rather than its ancestor, and the
 * two are stacked by z-index alone. The dashboard default deliberately sits
 * below dialogs; expanding a widget from inside the accessory-search dialog
 * (z-[10050]) therefore painted the expanded widget behind the search window.
 *
 * A z-index is invisible to the type checker and to every other test here, so
 * this pins the two things the fix depends on: the caller's elevation is
 * honoured, and nested overlays inherit it instead of dropping back to the
 * dashboard default.
 */

// jsdom has neither ResizeObserver (the panel measures itself to position) nor
// matchMedia (the overlay reaches a breakpoint hook). Neither affects stacking.
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

// Panels position themselves from a measured anchor; jsdom reports zeroes for
// everything, which is fine — this asserts stacking, not geometry.
function renderOverlay(ui: React.ReactElement) {
  const result = render(ui);
  act(() => { /* flush the layout effect that flips `ready` */ });
  return result;
}

const panels = () =>
  Array.from(document.body.querySelectorAll<HTMLElement>('[data-expandable-widget]'));

afterEach(cleanup);

describe('ExpandedOverlay stacking', () => {
  it('defaults below dialogs, where the dashboard wants it', () => {
    renderOverlay(
      <ExpandedOverlay isExpanded onClose={() => {}}>
        <div>content</div>
      </ExpandedOverlay>,
    );
    const panel = panels()[0];
    expect(panel).toBeTruthy();
    // 10018 = the dashboard default (10017) + 1. Below DialogContent's 10050.
    expect(Number(panel.style.zIndex)).toBe(10018);
  });

  it('honours a caller that knows it is inside a dialog', () => {
    renderOverlay(
      <ExpandedOverlay isExpanded onClose={() => {}} zIndex={10051}>
        <div>content</div>
      </ExpandedOverlay>,
    );
    const panel = panels()[0];
    // Must clear DialogOverlay and DialogContent, both z-[10050].
    expect(Number(panel.style.zIndex)).toBeGreaterThan(10050);
  });

  it('lets a nested overlay inherit the elevation rather than fall back', () => {
    renderOverlay(
      <ExpandedOverlay isExpanded onClose={() => {}} zIndex={10051}>
        <ExpandedOverlay isExpanded onClose={() => {}}>
          <div>inner</div>
        </ExpandedOverlay>
      </ExpandedOverlay>,
    );
    const zs = panels().map(p => Number(p.style.zIndex));
    expect(zs).toHaveLength(2);
    // Every panel clears the dialog, and the inner one draws over its parent —
    // a group expanded in a dialog must not send its accessory overlay behind.
    for (const z of zs) expect(z).toBeGreaterThan(10050);
    expect(Math.max(...zs)).toBeGreaterThan(Math.min(...zs));
  });
});
