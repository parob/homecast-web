// @vitest-environment jsdom
/**
 * The badge has to survive sitting on the selected row.
 *
 * Edit Layout puts Hide/Pin on every sidebar row, and the selected row is filled
 * with `bg-primary`. Reported as homecast-cloud#86: at the time the badge's own
 * fill was `bg-primary` too, so on that one row the pill had no edge at all —
 * only its label survived, reading as part of the row's text rather than as
 * something you can press. Every other row's badge sits on a wallpaper, where
 * the fill is the whole affordance.
 *
 * It was fixed then by outlining the badge on that row (an `onPrimary` prop). It
 * is fixed now by the badge not taking that fill in the first place: it is a
 * dark chip again (homecast-cloud#112), which has an edge on the selected row
 * like it does everywhere else, so the outline went with the blue — one row's
 * badges outlined and every other row's not would be the odd one out rather than
 * the fix.
 *
 * So what is asserted here is the invariant, not the mechanism: whatever colour
 * these end up, the badge must not wear the *selected row's own* fill. That is
 * the thing that took the button's edge away, and it is re-introduced by a
 * one-word change to a class string.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { RowEditActions } from '../EditActions';
import { PinnedTabsProvider } from '@/contexts/PinnedTabsContext';

afterEach(cleanup);

const PINS = { enabled: true, isPinned: () => false, isFull: false, toggle: vi.fn() };

const row = () => (
  <PinnedTabsProvider value={PINS as never}>
    <RowEditActions
      action={{ kind: 'hide', isHidden: false, onToggle: vi.fn(), name: 'George Street' }}
      tab={{ type: 'home', id: 'h', name: 'George Street', homeId: 'h' }}
    />
  </PinnedTabsProvider>
);

/** Every class that fills the badge's box. */
const fill = (el: HTMLElement) =>
  el.className.split(/\s+/).filter(c => /^(bg-|hover:bg-|active:bg-)/.test(c)).sort();

describe('the edit badge on a selected row', () => {
  it('never wears the selected row’s own fill', () => {
    render(row());
    for (const name of ['Hide George Street', 'Pin to Tab Bar']) {
      const classes = fill(screen.getByRole('button', { name }));
      // `bg-primary` here is `bg-primary` on `bg-primary`, and the button loses
      // its edge on the one row it is hardest to find.
      expect(classes.filter(c => /(^|:)bg-primary\b/.test(c)), name).toEqual([]);
      expect(classes.some(c => c.startsWith('bg-')), `${name} has a fill at all`).toBe(true);
    }
  });

  it('carries the same fill on every row, selected or not', () => {
    // The selected row used to be the one with outlined badges. A row that
    // styles its badges differently from the row above it reads as a different
    // control, which is what the outline cost — worth paying while the fill was
    // invisible there, not worth paying now it isn't.
    render(row());
    const first = fill(screen.getByRole('button', { name: 'Hide George Street' }));
    cleanup();
    render(row());
    expect(fill(screen.getByRole('button', { name: 'Hide George Street' }))).toEqual(first);
  });

  it('draws no outline, since there is nothing left to rescue', () => {
    render(row());
    for (const name of ['Hide George Street', 'Pin to Tab Bar']) {
      const cls = screen.getByRole('button', { name }).className;
      expect(cls.split(/\s+/).filter(c => c.startsWith('ring')), name).toEqual([]);
    }
  });
});
