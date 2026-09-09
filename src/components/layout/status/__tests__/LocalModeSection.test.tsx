// @vitest-environment jsdom
//
// The status popover overran the phone it was reported from
// (homecast-cloud#103), and most of what made it long was the same fact said
// more than once. These lock in each removal, because the panel got this long
// by accretion — every section that made it long was merged separately and was
// defensible alone. Nothing here asserts a pixel height; they assert that a
// given sentence is said once.

import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';

import { LocalModeSectionView } from '../LocalModeSection';

afterEach(cleanup);

function renderSection(overrides: Partial<React.ComponentProps<typeof LocalModeSectionView>> = {}) {
  return render(
    <LocalModeSectionView
      reason="relay-offline"
      identityState="partial"
      matched={728}
      reported={751}
      isPhone
      {...overrides}
    />,
  );
}

describe('what the section no longer repeats', () => {
  it('does not restate the pill that opened it', () => {
    renderSection();
    // ConnectionSection above has already said this, and you cannot reach this
    // section without tapping a green-dotted pill reading "Local Mode".
    expect(screen.queryByText('Active')).toBeNull();
    expect(screen.queryByText(/talking to your Apple Home directly/i)).toBeNull();
  });

  it('still says why Local Mode engaged — that part is not repeated anywhere', () => {
    renderSection();
    expect(screen.getByText('Your home relay is offline.')).toBeTruthy();
  });

  it('says nothing at all when there is no reason to give', () => {
    renderSection({ reason: null });
    expect(screen.queryByText(/relay is offline/i)).toBeNull();
  });
});

describe('the capability list', () => {
  it('is closed by default — eight static rows that never vary', () => {
    renderSection();
    expect(screen.queryByText('Lights, switches and plugs')).toBeNull();
    expect(screen.queryByText('Sharing with other people')).toBeNull();
    expect(screen.getByRole('button', { name: /what works in local mode/i })).toBeTruthy();
  });

  it('opens on tap, and carries the whole of it', () => {
    renderSection();
    fireEvent.click(screen.getByRole('button', { name: /what works in local mode/i }));
    for (const row of [
      'Lights, switches and plugs', 'Sensors and thermostats', 'Locks and blinds',
      'Scenes and rooms', 'Automations', 'Notifications', 'History recording',
      'Sharing with other people',
    ]) {
      expect(screen.getByText(row)).toBeTruthy();
    }
    // The relay caveat travelled with the list rather than staying behind as a
    // loose line under a collapsed disclosure.
    expect(screen.getByText(/Automations keep running on your relay/i)).toBeTruthy();
  });

  it('reports its own state to assistive tech', () => {
    renderSection();
    const toggle = screen.getByRole('button', { name: /what works in local mode/i });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
  });
});

describe('what survived, because it exists nowhere else', () => {
  it('keeps the identity count when the layout only partly matched', () => {
    renderSection();
    expect(screen.getByText(/728 of 751 accessories/)).toBeTruthy();
  });

  it('keeps the unmapped warning, and words it for the device it is on', () => {
    cleanup();
    renderSection({ identityState: 'unmapped', isPhone: false });
    expect(screen.getByText(/when this Mac is next online/i)).toBeTruthy();
  });
});
