// @vitest-environment jsdom
//
// The status popover overran the phone it was reported from
// (homecast-cloud#103), and most of what made it long was the same fact said
// more than once. These lock in each removal, because the panel got this long
// by accretion — every section that made it long was merged separately and was
// defensible alone. Nothing here asserts a pixel height; they assert that a
// given sentence is said once, and that nothing was quietly dropped along with
// the space. The heights themselves are measured in a real browser by
// `screenshots/status-panel-height.spec.ts`, which jsdom cannot do.

import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';

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
    // You cannot reach this section without tapping a green-dotted pill
    // reading "Local Mode".
    expect(screen.queryByText('Active')).toBeNull();
  });

  it('does not restate the chain sentence directly above it', () => {
    renderSection();
    expect(screen.queryByText(/talking to your Apple Home directly/i)).toBeNull();
    expect(screen.getByText('Your home relay is offline.')).toBeTruthy();
  });

  it('keeps that sentence when there is no reason to give — then nothing else has said it', () => {
    renderSection({ reason: null });
    expect(screen.getByText(/This device is talking to your Apple Home directly/i)).toBeTruthy();
  });
});

describe('the capability list', () => {
  it('carries all eight facts, as two sentences rather than eight rows', () => {
    renderSection();
    const works = screen.getByText(/^Works:/);
    const paused = screen.getByText(/^Paused:/);
    for (const fact of ['lights', 'switches', 'plugs', 'sensors', 'thermostats', 'locks', 'blinds', 'scenes and rooms']) {
      expect(works.textContent).toContain(fact);
    }
    for (const fact of ['automations', 'notifications', 'history recording', 'sharing with other people']) {
      expect(paused.textContent).toContain(fact);
    }
  });

  it('hides nothing behind a tap — there is no disclosure to miss', () => {
    renderSection();
    expect(screen.queryByRole('button', { name: /what works in local mode/i })).toBeNull();
  });
});

describe('what survived, because it exists nowhere else', () => {
  it('keeps the identity count when the layout only partly matched', () => {
    renderSection();
    expect(screen.getByText(/728 of 751 accessories/)).toBeTruthy();
  });

  it('keeps the unmapped warning, and words it for the device it is on', () => {
    renderSection({ identityState: 'unmapped', isPhone: false });
    expect(screen.getByText(/when this Mac is next online/i)).toBeTruthy();
  });

  it('says the app-open caveat on a phone, where nothing else says it', () => {
    renderSection();
    expect(screen.getByText(/works while the app is open/i)).toBeTruthy();
  });

  it('drops that caveat on a Mac, where it is not true', () => {
    renderSection({ isPhone: false });
    expect(screen.queryByText(/works while the app is open/i)).toBeNull();
  });
});
