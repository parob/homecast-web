// @vitest-environment jsdom
//
// The edit-mode summary row exists for the one thing the live pills cannot do:
// offer a hidden section back. A hidden pill does not render, and the live pills
// also hide themselves when they have nothing to show — both correct in normal
// use, both a one-way door in an editor.
//
// It must not take the pills' normal job away in exchange. Each still opens and
// closes its section; hiding is a second target beside it.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { SummarySectionEditPills } from '../SummarySectionEditPills';
import type { HomeLayoutData } from '@/hooks/useEntityLayout';
import type { SummarySectionId } from '@/lib/summary-sections';

afterEach(cleanup);

function setup(layout: HomeLayoutData | null = null, openSection: SummarySectionId | null = null) {
  const onToggleOpen = vi.fn();
  const onToggleHidden = vi.fn();
  render(
    <SummarySectionEditPills
      layout={layout}
      openSection={openSection}
      onToggleOpen={onToggleOpen}
      onToggleHidden={onToggleHidden}
    />,
  );
  return { onToggleOpen, onToggleHidden };
}

const hidden = (...ids: SummarySectionId[]): HomeLayoutData =>
  ({ visibility: { hiddenSummarySections: ids } });

describe('the edit-mode summary row', () => {
  it('shows every section, including the hidden ones', () => {
    setup(hidden('scenes', 'status'));
    for (const label of ['Actions', 'Scenes', 'Automations', 'Status']) {
      expect(screen.getByText(label)).toBeTruthy();
    }
  });

  it('still opens and closes a section — editing does not freeze the row', () => {
    const { onToggleOpen, onToggleHidden } = setup();

    fireEvent.click(screen.getByRole('button', { expanded: false, name: /Actions/ }));
    expect(onToggleOpen).toHaveBeenCalledWith('actions');
    // Opening is not hiding.
    expect(onToggleHidden).not.toHaveBeenCalled();
  });

  it('reflects which section is open', () => {
    setup(null, 'scenes');
    const opened = screen.getAllByRole('button', { expanded: true });
    expect(opened).toHaveLength(1);
    expect(opened[0].textContent).toContain('Scenes');
  });

  it('hides a shown section from its own eye, without opening it', () => {
    const { onToggleOpen, onToggleHidden } = setup();

    fireEvent.click(screen.getByRole('button', { name: 'Hide Automations' }));
    expect(onToggleHidden).toHaveBeenCalledWith('automations', false);
    expect(onToggleOpen).not.toHaveBeenCalled();
  });

  it('turns a hidden section back on, and offers nothing to expand', () => {
    const { onToggleOpen, onToggleHidden } = setup(hidden('scenes'));

    // Nothing to open: the section does not render while hidden, so there is no
    // expand target that would do nothing.
    expect(screen.queryByRole('button', { expanded: false, name: /Scenes/ })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Unhide Scenes' }));
    expect(onToggleHidden).toHaveBeenCalledWith('scenes', true);
    expect(onToggleOpen).not.toHaveBeenCalled();
  });

  it('treats a home with no stored layout as everything shown', () => {
    setup(null);
    for (const label of ['Actions', 'Scenes', 'Automations', 'Status']) {
      expect(screen.getByRole('button', { name: `Hide ${label}` })).toBeTruthy();
    }
  });

  it('says which way it goes in words, not by colour', () => {
    setup(hidden('status'));
    // The badge says which way it goes, in words, matching the tile buttons.
    expect(screen.getByRole('button', { name: 'Hide Actions' }).textContent).toBe('Hide');
    expect(screen.getByRole('button', { name: 'Unhide Status' }).textContent).toBe('Unhide');
  });
});

describe('a pill is the same size whichever state it is in', () => {
  it('builds both states from the same shell', () => {
    // jsdom has no layout, so measuring heights would be theatre. The invariant
    // that actually prevents the jump is structural: both states put their
    // padding on the same outer shell rather than on whatever each happens to
    // wrap inside, so assert that instead.
    const { container: shown } = render(
      <SummarySectionEditPills
        layout={null} openSection={null}
        onToggleOpen={vi.fn()} onToggleHidden={vi.fn()}
      />,
    );
    const shownShell = shown.querySelector('span')!.className;
    cleanup();

    const { container: isHidden } = render(
      <SummarySectionEditPills
        layout={hidden('actions')} openSection={null}
        onToggleOpen={vi.fn()} onToggleHidden={vi.fn()}
      />,
    );
    const hiddenShell = isHidden.querySelector('span')!.className;

    // Only the colour classes may differ between the two.
    const box = (cls: string) => cls.split(/\s+/).filter(c => /^(py|px|pl|pr|text-xs|rounded|gap|inline-flex|items)/.test(c)).sort();
    expect(box(hiddenShell)).toEqual(box(shownShell));
  });
});
