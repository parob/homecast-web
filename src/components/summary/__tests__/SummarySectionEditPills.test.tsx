// @vitest-environment jsdom
//
// The edit-mode summary row. Its whole reason to exist is the one thing the live
// pills cannot do: offer a hidden section back. A hidden pill does not render,
// and the live pills also hide themselves when they have nothing to show — both
// correct in normal use, both a one-way door in an editor.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { SummarySectionEditPills } from '../SummarySectionEditPills';
import type { HomeLayoutData } from '@/hooks/useEntityLayout';

afterEach(cleanup);

function setup(layout: HomeLayoutData | null = null) {
  const onToggle = vi.fn();
  render(<SummarySectionEditPills layout={layout} onToggle={onToggle} />);
  return onToggle;
}

describe('the edit-mode summary row', () => {
  it('shows every section, including the ones that are hidden', () => {
    setup({ visibility: { hiddenSummarySections: ['scenes', 'status'] } });

    // All four present — a hidden one you cannot see is one you cannot restore.
    for (const label of ['Actions', 'Scenes', 'Automations', 'Status']) {
      expect(screen.getByText(label)).toBeTruthy();
    }
  });

  it('offers Hide for a shown section and Show for a hidden one', () => {
    setup({ visibility: { hiddenSummarySections: ['scenes'] } });

    expect(screen.getByRole('button', { name: 'Hide Actions' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Show Scenes' })).toBeTruthy();
  });

  it('asks for the opposite of the current state', () => {
    const onToggle = setup({ visibility: { hiddenSummarySections: ['scenes'] } });

    fireEvent.click(screen.getByRole('button', { name: 'Hide Actions' }));
    expect(onToggle).toHaveBeenLastCalledWith('actions', false);

    fireEvent.click(screen.getByRole('button', { name: 'Show Scenes' }));
    expect(onToggle).toHaveBeenLastCalledWith('scenes', true);
  });

  it('treats a home with no stored layout as everything shown', () => {
    setup(null);
    for (const label of ['Actions', 'Scenes', 'Automations', 'Status']) {
      expect(screen.getByRole('button', { name: `Hide ${label}` })).toBeTruthy();
    }
  });

  it('reports its state to assistive tech, not just by colour', () => {
    setup({ visibility: { hiddenSummarySections: ['status'] } });
    expect(screen.getByRole('button', { name: 'Hide Actions' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: 'Show Status' }).getAttribute('aria-pressed')).toBe('false');
  });
});
