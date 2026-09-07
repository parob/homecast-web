// @vitest-environment jsdom
/**
 * The badge has to survive sitting on the selected row.
 *
 * Edit Layout puts Hide/Pin on every sidebar row, and the selected row is filled
 * with `bg-primary` — the badge's own fill. On that one row the pill had no edge
 * at all: only its label survived, reading as part of the row's text rather than
 * as something you can press. Every other row's badge sits on the wallpaper,
 * where the fill is the whole affordance.
 *
 * Reported as homecast-cloud#86, on the selected home. It was never only the
 * home: a selected room, collection group and collection fill the same way, so
 * the outline is keyed on `onPrimary` and each row passes its own fill
 * condition.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { RowEditActions } from '../EditActions';
import { PinnedTabsProvider } from '@/contexts/PinnedTabsContext';

afterEach(cleanup);

const PINS = { enabled: true, isPinned: () => false, isFull: false, toggle: vi.fn() };

const row = (onPrimary: boolean) => (
  <PinnedTabsProvider value={PINS as never}>
    <RowEditActions
      onPrimary={onPrimary}
      action={{ kind: 'hide', isHidden: false, onToggle: vi.fn(), name: 'George Street' }}
      tab={{ type: 'home', id: 'h', name: 'George Street', homeId: 'h' }}
    />
  </PinnedTabsProvider>
);

/** Every class that draws the badge's edge. */
const ring = (el: HTMLElement) =>
  el.className.split(/\s+/).filter(c => c.startsWith('ring')).sort().join(' ');

describe('the edit badge on a selected row', () => {
  it('outlines both buttons when it sits on the primary fill', () => {
    render(row(true));
    for (const name of ['Hide George Street', 'Pin to Tab Bar']) {
      // Without this the pill is bg-primary on bg-primary and has no edge.
      expect(ring(screen.getByRole('button', { name }))).toBe('ring-1 ring-inset ring-primary-foreground');
    }
  });

  it('leaves the unselected rows alone', () => {
    render(row(false));
    for (const name of ['Hide George Street', 'Pin to Tab Bar']) {
      expect(ring(screen.getByRole('button', { name }))).toBe('');
    }
  });

  it('draws the outline in the badge’s own text colour, not a hardcoded white', () => {
    // primary-foreground is white in the light theme and near-black in the dark
    // one. Hardcoding white would put a white ring around dark text in dark mode.
    render(row(true));
    const cls = screen.getByRole('button', { name: 'Hide George Street' }).className;
    expect(cls).toContain('ring-primary-foreground');
    expect(cls).toContain('text-primary-foreground');
  });

  it('outlines without changing the badge’s size', () => {
    // The sidebar row reserves a measured 81px for the Hide+Pin cluster, so a
    // border (which grows the box) would push the name into truncation. `ring`
    // is drawn as a shadow and takes no layout.
    const sizing = (el: HTMLElement) =>
      el.className.split(/\s+/).filter(c => /^(px-|py-|text-\[|leading-|border)/.test(c)).sort().join(' ');

    render(row(true));
    const outlined = sizing(screen.getByRole('button', { name: 'Hide George Street' }));
    cleanup();

    render(row(false));
    expect(outlined).toBe(sizing(screen.getByRole('button', { name: 'Hide George Street' })));
  });
});
