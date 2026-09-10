// @vitest-environment jsdom
/**
 * One badge, drawn the same way wherever it is rendered.
 *
 * Hide/Unhide and Pin appear in an accessory tile's corner, on a sidebar row and
 * in the summary row's pills, and those are on screen together — so a difference
 * between them reads as two different controls rather than one. The tile's and
 * the row's are identical; the pill's is one step shorter on purpose, because it
 * sits inside its pill rather than on top of something (homecast-cloud#112), and
 * everything else about it still matches.
 *
 * The trap is that `text-[10px]` is an arbitrary font size, so Tailwind sets no
 * line-height with it and the button silently inherits whatever surrounds it:
 * a 16px line box inside a pill (`text-xs`), the body's ~19px on a tile. Measured
 * in a browser, that was 38x19 against 38x20. `leading-4` pins it.
 */
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, screen, cleanup, act } from '@testing-library/react';
import { TileEditActions, RowEditActions } from '../EditActions';
import { PinnedTabsProvider } from '@/contexts/PinnedTabsContext';
import { SummarySectionEditPills } from '@/components/summary/SummarySectionEditPills';

afterEach(cleanup);

const PINS = { enabled: true, isPinned: () => false, isFull: false, toggle: vi.fn() };

/** Every sizing class the badge's height depends on. */
const sizing = (el: HTMLElement) =>
  el.className.split(/\s+/).filter(c => /^(px-|py-|text-\[|leading-)/.test(c)).sort().join(' ');

describe('the edit badge', () => {
  it('is one step shorter in a summary pill than on a tile', () => {
    // These were the same size, so that one control read as one control. At
    // that size the badge exactly filled the pill — `py-1` *is* the pill's own
    // padding — and, both being `rounded-full` at equal heights, capped its
    // trailing edge as well. Reported as homecast-cloud#112: "the status
    // pill/top bubble hide buttons look worse now we made them the
    // height/edge of the pill".
    //
    // So the pill's is deliberately the short one now, and only the pill's: it
    // has to sit *inside* something, where a tile's and a row's sit on top of
    // one. Everything but the height still matches, which is what this pins —
    // a pill badge that also shrank its text or its padding would be a
    // different control again.
    render(
      <PinnedTabsProvider value={PINS as never}>
        <TileEditActions
          action={{ kind: 'hide', isHidden: false, onToggle: vi.fn(), name: 'Lamp' }}
          tab={null}
        />
      </PinnedTabsProvider>,
    );
    const tile = screen.getByRole('button', { name: 'Hide Lamp' }).className;
    cleanup();

    render(
      <SummarySectionEditPills
        layout={null} openSection={null}
        onToggleOpen={vi.fn()} onToggleHidden={vi.fn()}
      />,
    );
    const pill = screen.getByRole('button', { name: 'Hide Scenes' }).className;

    const without = (cls: string, drop: RegExp) =>
      cls.split(/\s+/).filter(c => /^(px-|py-|text-\[|leading-)/.test(c) && !drop.test(c)).sort().join(' ');

    expect(tile).toContain('py-1');
    expect(pill).toContain('py-0.5');
    // ...and the negative margin that keeps the row the height it was, tracking
    // the padding the badge actually carries.
    expect(pill).toContain('-my-0.5');
    // Same padding across, same text, same line box.
    expect(without(pill, /^py-/)).toBe(without(tile, /^py-/));
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

  /**
   * The visible pill is as big as the tile corner allows; the rest of the
   * target is a pseudo-element, which is hit-tested as the button itself.
   * jsdom cannot hit-test, so this only guards that the slop is still declared
   * on every badge — `screenshots/edit-badge-hit-target.spec.ts` measures what
   * a fingertip actually gets, in a real browser.
   */
  it('carries hit slop past its paint, on both buttons', () => {
    render(
      <PinnedTabsProvider value={PINS as never}>
        <TileEditActions
          action={{ kind: 'hide', isHidden: false, onToggle: vi.fn(), name: 'Lamp' }}
          tab={{ type: 'accessory', id: 'a', name: 'Lamp', homeId: 'h' }}
        />
      </PinnedTabsProvider>,
    );
    for (const name of ['Hide Lamp', 'Pin to Tab Bar']) {
      const cls = screen.getByRole('button', { name }).className;
      // `relative` is load-bearing: without it the slop positions against some
      // ancestor and lands nowhere near the badge.
      expect(cls, name).toContain('relative');
      expect(cls, name).toContain('before:absolute');
      expect(cls, name).toContain("before:content-['']");
    }
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

describe('the badges leaving', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  const Badge = ({ visible }: { visible: boolean }) => (
    <PinnedTabsProvider value={PINS as never}>
      <TileEditActions
        visible={visible}
        action={{ kind: 'hide', isHidden: false, onToggle: vi.fn(), name: 'Lamp' }}
        tab={null}
      />
    </PinnedTabsProvider>
  );

  it('stays on screen after the mode ends, so it has something to animate', () => {
    // The whole point: a component that has already unmounted cannot animate
    // away. Callers pass `visible` instead of not rendering it.
    const { rerender } = render(<Badge visible />);
    expect(screen.getByRole('button', { name: 'Hide Lamp' })).toBeTruthy();

    rerender(<Badge visible={false} />);
    const leaving = screen.getByRole('button', { name: 'Hide Lamp' });
    expect(leaving.parentElement!.className).toContain('edit-badge-out');
  });

  it('is gone once the animation has run', () => {
    const { rerender } = render(<Badge visible />);
    rerender(<Badge visible={false} />);
    act(() => { vi.advanceTimersByTime(300); });
    expect(screen.queryByRole('button', { name: 'Hide Lamp' })).toBeNull();
  });

  it('arrives with the enter animation, not the exit one', () => {
    render(<Badge visible />);
    const cls = screen.getByRole('button', { name: 'Hide Lamp' }).parentElement!.className;
    expect(cls).toContain('edit-badge-in');
    expect(cls).not.toContain('edit-badge-out');
  });
});
