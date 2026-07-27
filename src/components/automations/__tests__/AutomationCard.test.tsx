// @vitest-environment jsdom
//
// Automation names are descriptive sentences ("Turn the heating off when a
// window opens"), but the card rendered them with Tailwind's `truncate`, which
// forces one line and ellipses the rest — so most names were unreadable in the
// list. They now wrap instead.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { MockedProvider } from '@apollo/client/testing/react';
import { AutomationCard } from '../AutomationCard';
import type { Automation } from '@/automation/types/automation';

vi.mock('@/lib/config', () => ({
  isCommunity: false,
  getCommunityMode: () => null,
  isRelayMode: () => false,
  isClientMode: () => false,
  isRelaySetupComplete: () => false,
  getRelayAddress: () => null,
  config: { isCommunity: false, apiBase: 'https://api.test', graphqlUrl: 'https://api.test/', wsUrl: 'wss://api.test/ws' },
}));

const LONG_NAME = 'Turn off the upstairs heating when any bedroom window has been open for five minutes';

function hcAutomation(name: string): Automation {
  return {
    id: 'auto-1', name, homeId: 'home-1', enabled: true, mode: 'single',
    triggers: [], conditions: { operator: 'and', conditions: [] }, actions: [],
    metadata: { createdAt: '', updatedAt: '', triggerCount: 0 },
  };
}

function renderCard(name: string) {
  return render(
    <MockedProvider mocks={[]} addTypename={false}>
      <AutomationCard hcAutomation={hcAutomation(name)} onClick={() => {}} />
    </MockedProvider>,
  );
}

afterEach(() => cleanup());

describe('AutomationCard name rendering', () => {
  it('renders a long automation name in full', () => {
    renderCard(LONG_NAME);

    expect(screen.getByText(LONG_NAME)).toBeTruthy();
  });

  it('does not clip the name to a single ellipsed line', () => {
    renderCard(LONG_NAME);
    const nameEl = screen.getByText(LONG_NAME);

    // `truncate` is white-space:nowrap + overflow:hidden + text-overflow:ellipsis
    expect(nameEl.className).not.toMatch(/\btruncate\b/);
    expect(nameEl.className).not.toMatch(/\bwhitespace-nowrap\b/);
  });

  it('allows the name to wrap onto multiple lines', () => {
    renderCard(LONG_NAME);

    expect(screen.getByText(LONG_NAME).className).toMatch(/\bbreak-words\b/);
  });

  it('exposes the full name as a tooltip', () => {
    renderCard(LONG_NAME);

    expect(screen.getByText(LONG_NAME).getAttribute('title')).toBe(LONG_NAME);
  });

  it('still renders a short name normally', () => {
    renderCard('Goodnight');

    expect(screen.getByText('Goodnight')).toBeTruthy();
  });
});
