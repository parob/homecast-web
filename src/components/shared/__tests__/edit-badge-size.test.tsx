// @vitest-environment jsdom
/**
 * One badge, one size, wherever it is rendered.
 *
 * Hide/Unhide and Pin appear both in an accessory tile's corner and in the
 * summary row's pills, and those two are on screen together — so a difference
 * between them reads as two different controls rather than one.
 *
 * The trap is that `text-[10px]` is an arbitrary font size, so Tailwind sets no
 * line-height with it and the button silently inherits whatever surrounds it:
 * a 16px line box inside a pill (`text-xs`), the body's ~19px on a tile. Measured
 * in a browser, that was 38x19 against 38x20. `leading-4` pins it.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { TileEditActions, RowEditActions } from '../EditActions';
import { PinnedTabsProvider } from '@/contexts/PinnedTabsContext';
import { SummarySectionEditPills } from '@/components/summary/SummarySectionEditPills';

afterEach(cleanup);

const PINS = { enabled: true, isPinned: () => false, isFull: false, toggle: vi.fn() };

/** Every sizing class the badge's height depends on. */
const sizing = (el: HTMLElement) =>
  el.className.split(/\s+/).filter(c => /^(px-|py-|text-\[|leading-)/.test(c)).sort().join(' ');

describe('the edit badge', () => {
  it('is the same size on a tile and in a summary pill', () => {
    render(
      <PinnedTabsProvider value={PINS as never}>
        <TileEditActions
          action={{ kind: 'hide', isHidden: false, onToggle: vi.fn(), name: 'Lamp' }}
          tab={null}
        />
      </PinnedTabsProvider>,
    );
    const tile = sizing(screen.getByRole('button', { name: 'Hide Lamp' }));
    cleanup();

    render(
      <SummarySectionEditPills
        layout={null} openSection={null}
        onToggleOpen={vi.fn()} onToggleHidden={vi.fn()}
      />,
    );
    const pill = sizing(screen.getByRole('button', { name: 'Hide Scenes' }));

    // The pill adds -my-0.5 to hang into its row; the *sizing* must match.
    expect(pill).toBe(tile);
  });

  it('pins its own line box rather than inheriting the context', () => {
    // Without this the same button is 19px on a tile and 20px in a pill.
    render(
      <PinnedTabsProvider value={PINS as never}>
        <TileEditActions
          action={{ kind: 'hide', isHidden: false, onToggle: vi.fn(), name: 'Lamp' }}
          tab={null}
        />
      </PinnedTabsProvider>,
    );
    expect(screen.getByRole('button', { name: 'Hide Lamp' }).className).toContain('leading-4');
  });

  it('sizes a sidebar row\u2019s badge the same as a tile\u2019s', () => {
    // The left navigation's rows sit beside the tiles they describe, so a
    // narrower badge there read as a different control. It used to be px-1.5.
    render(
      <PinnedTabsProvider value={PINS as never}>
        <RowEditActions
          action={{ kind: 'hide', isHidden: false, onToggle: vi.fn(), name: 'Kitchen' }}
          tab={null}
        />
      </PinnedTabsProvider>,
    );
    const row = sizing(screen.getByRole('button', { name: 'Hide Kitchen' }));
    cleanup();

    render(
      <PinnedTabsProvider value={PINS as never}>
        <TileEditActions
          action={{ kind: 'hide', isHidden: false, onToggle: vi.fn(), name: 'Lamp' }}
          tab={null}
        />
      </PinnedTabsProvider>,
    );
    expect(row).toBe(sizing(screen.getByRole('button', { name: 'Hide Lamp' })));
  });

  it('sizes the pin button the same way, since it is the same control', () => {
    render(
      <PinnedTabsProvider value={PINS as never}>
        <TileEditActions
          action={null}
          tab={{ type: 'accessory', id: 'a', name: 'Lamp', homeId: 'h' }}
        />
      </PinnedTabsProvider>,
    );
    const pin = screen.getByRole('button', { name: 'Pin to Tab Bar' });
    expect(pin.className).toContain('leading-4');
    expect(pin.className).toContain('px-2');
  });
});
