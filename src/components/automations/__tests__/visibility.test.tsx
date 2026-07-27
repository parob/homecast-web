// @vitest-environment jsdom
//
// Regression guard for the empty-list discovery trap.
//
// Both pills used to `return null` when their list was empty. Since the pill is
// the only control that expands its section, and the section holds the only
// "New" button, a home with zero scenes/automations had no way to create its
// first one. See db0aea4, which introduced the pills.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import { MockedProvider } from '@apollo/client/testing/react';

// config.ts reads localStorage at module scope, which jsdom doesn't provide here.
// Same approach as useSharedWebSocket.test.ts.
vi.mock('@/lib/config', () => ({
  isCommunity: false,
  getCommunityMode: () => null,
  isRelayMode: () => false,
  isClientMode: () => false,
  isRelaySetupComplete: () => false,
  getRelayAddress: () => null,
  config: { isCommunity: false, apiBase: 'https://api.test', graphqlUrl: 'https://api.test/', wsUrl: 'wss://api.test/ws' },
}));

import { ScenesPill, ScenesSection } from '../../scenes/ScenesSection';
import { AutomationsPill, AutomationsSection } from '../AutomationsSection';
import { GET_SCENES, GET_AUTOMATIONS, GET_HOMES, HC_AUTOMATIONS } from '@/lib/graphql/queries';

const HOME_ID = 'HOME-1111';

// jsdom lacks both of these; Radix/AnimatedCollapse touch them on mount.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

const emptyMocks = [
  {
    request: { query: GET_SCENES, variables: { homeId: HOME_ID } },
    result: { data: { scenes: [] } },
  },
  {
    request: { query: GET_AUTOMATIONS, variables: { homeId: HOME_ID } },
    result: { data: { automations: [] } },
  },
  {
    request: { query: HC_AUTOMATIONS, variables: { homeId: HOME_ID } },
    result: { data: { hcAutomations: [] } },
  },
  {
    request: { query: GET_HOMES },
    result: { data: { homes: [{ __typename: 'HomeKitHome', id: HOME_ID, name: 'Test Home', isPrimary: true, isAdmin: true }] } },
  },
];

function renderWithApollo(ui: React.ReactElement) {
  return render(
    <MockedProvider mocks={emptyMocks} addTypename={false}>
      {ui}
    </MockedProvider>,
  );
}

describe('scenes/automations visibility with an empty list', () => {
  beforeEach(() => {
    (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = ResizeObserverStub;
  });

  afterEach(() => cleanup());

  it('renders the Scenes pill when the home has no scenes', async () => {
    renderWithApollo(<ScenesPill homeId={HOME_ID} open={false} onToggle={() => {}} />);

    const pill = await screen.findByRole('button', { name: /scenes/i });
    expect(pill).toBeTruthy();
    // No count badge at zero — "Scenes", not "Scenes 0"
    expect(pill.textContent).not.toMatch(/\d/);
  });

  it('renders the Automations pill when the home has no automations', async () => {
    renderWithApollo(<AutomationsPill homeId={HOME_ID} open={false} onToggle={() => {}} />);

    const pill = await screen.findByRole('button', { name: /automations/i });
    expect(pill).toBeTruthy();
    expect(pill.textContent).not.toMatch(/\d/);
  });

  it('keeps the "New scene" button reachable with zero scenes', async () => {
    renderWithApollo(<ScenesSection homeId={HOME_ID} open={true} />);

    expect(await screen.findByRole('button', { name: /new scene/i })).toBeTruthy();
  });

  it('keeps the "New" automation button reachable after the queries settle at zero', async () => {
    renderWithApollo(<AutomationsSection homeId={HOME_ID} open={true} />);

    // Wait for both queries to resolve — the empty-state copy only renders once
    // loading is done. Asserting before this point passes even when the section
    // re-collapses itself on empty (AnimatedCollapse keeps children mounted
    // while loading, then unmounts 200ms after close).
    expect(await screen.findByText(/no automations yet/i)).toBeTruthy();

    // Past AnimatedCollapse's 200ms lazy-unmount window.
    await new Promise(r => setTimeout(r, 350));

    expect(document.querySelector('[data-testid="new-automation-button"]')).toBeTruthy();
  });

  it('shows an empty-state explanation rather than a blank section', async () => {
    renderWithApollo(<ScenesSection homeId={HOME_ID} open={true} />);

    expect(await screen.findByText(/no scenes yet/i)).toBeTruthy();
  });

  it('does not render a pill without a home', () => {
    const { container } = renderWithApollo(
      <ScenesPill homeId="" open={false} onToggle={() => {}} />,
    );
    expect(container.querySelector('button')).toBeNull();
  });
});
