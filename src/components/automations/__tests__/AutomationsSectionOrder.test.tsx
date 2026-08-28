// @vitest-environment jsdom
/**
 * The Automations grid's arrangement and visibility.
 *
 * Two engines' automations share one grid, one order and one hidden list, and
 * they share no id space — so every key is prefixed. The grid also has to
 * survive a card being absent, which here is the *normal* state rather than an
 * edge case: the Homecast half is only fetched once the section is open.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, waitFor, fireEvent } from '@testing-library/react';
import { MockedProvider } from '@apollo/client/testing/react';
import type { MockLink } from '@apollo/client/testing';

vi.mock('@/lib/config', () => ({
  isCommunity: false,
  getCommunityMode: () => null,
  isRelayMode: () => false,
  isClientMode: () => false,
  isRelaySetupComplete: () => false,
  getRelayAddress: () => null,
  config: { isCommunity: false, apiBase: 'https://api.test', graphqlUrl: 'https://api.test/', wsUrl: 'wss://api.test/ws' },
}));

import type { HomeKitAutomation } from '@/lib/graphql/types';
import type { HomeLayoutData } from '@/hooks/useEntityLayout';
import { AutomationsSection } from '../AutomationsSection';
import { GET_AUTOMATIONS, HC_AUTOMATIONS, GET_HOMES } from '@/lib/graphql/queries';
import { LayoutEditProvider } from '@/contexts/LayoutEditContext';

const HOME_ID = 'HOME-1';

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

// Every field the query selects, so Apollo's cache writer has nothing to warn
// about — a partial mock still renders, but floods stderr on every test.
const hk = (id: string, name: string): HomeKitAutomation =>
  ({
    id, name, homeId: HOME_ID, enabled: true, isEnabled: true,
    trigger: null, actions: [], lastFireDate: null,
  } as unknown as HomeKitAutomation);

const hc = (id: string, name: string) =>
  ({ entityId: id, dataJson: JSON.stringify({ id, name, enabled: true }) });

function renderSection(
  automations: HomeKitAutomation[],
  hcAutomations: ReturnType<typeof hc>[],
  layout: HomeLayoutData | null,
  editMode = false,
  { touchMode = false, showHidden = false }: { touchMode?: boolean; showHidden?: boolean } = {},
): { onToggleAutomationHidden: ReturnType<typeof vi.fn> } {
  const onToggleAutomationHidden = vi.fn();
  const mocks: MockLink.MockedResponse[] = [
    {
      request: { query: GET_AUTOMATIONS, variables: { homeId: HOME_ID } },
      result: { data: { automations } },
      maxUsageCount: Number.POSITIVE_INFINITY,
    },
    {
      request: { query: HC_AUTOMATIONS, variables: { homeId: HOME_ID } },
      result: { data: { hcAutomations } },
      maxUsageCount: Number.POSITIVE_INFINITY,
    },
    {
      request: { query: GET_HOMES },
      result: { data: { homes: [{ id: HOME_ID, name: 'Test Home', isPrimary: true, role: 'owner', isAdmin: true }] } },
      maxUsageCount: Number.POSITIVE_INFINITY,
    },
  ];
  render(
    <MockedProvider mocks={mocks}>
      <LayoutEditProvider value={{ touchMode, editMode }}>
        <AutomationsSection
          homeId={HOME_ID}
          open
          homeLayout={layout}
          onReorderCards={() => {}}
          onToggleAutomationHidden={onToggleAutomationHidden}
          showHidden={showHidden}
        />
      </LayoutEditProvider>
    </MockedProvider>,
  );
  return { onToggleAutomationHidden };
}

/** Card names in the order they are painted. Every card titles its name. */
async function names(expected: number) {
  await waitFor(() => {
    expect(document.querySelectorAll('div[title]')).toHaveLength(expected);
  });
  return Array.from(document.querySelectorAll('div[title]')).map(n => n.getAttribute('title'));
}

describe('the Automations grid', () => {
  afterEach(cleanup);
  beforeEach(() => {
    (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = ResizeObserverStub;
  });

  it('leads with HomeKit before anything has been arranged', async () => {
    renderSection([hk('a', 'Sunset lights')], [hc('x', 'Away mode')], null);
    expect(await names(2)).toEqual(['Sunset lights', 'Away mode']);
  });

  it('paints the saved order, intermixing the two engines', async () => {
    const layout: HomeLayoutData = { automationCardOrder: ['hc:x', 'hk:b', 'hk:a'] };
    renderSection([hk('a', 'Sunset lights'), hk('b', 'Wake up')], [hc('x', 'Away mode')], layout);
    expect(await names(3)).toEqual(['Away mode', 'Wake up', 'Sunset lights']);
  });

  it('skips an order entry whose card is gone, without disturbing the rest', async () => {
    // Routine here rather than exceptional: an automation was deleted, or its
    // engine has not answered yet.
    const layout: HomeLayoutData = { automationCardOrder: ['hc:deleted', 'hk:b', 'hk:a'] };
    renderSection([hk('a', 'Sunset lights'), hk('b', 'Wake up')], [], layout);
    expect(await names(2)).toEqual(['Wake up', 'Sunset lights']);
  });

  it('puts a newly created automation at the end, not the front', async () => {
    const layout: HomeLayoutData = { automationCardOrder: ['hk:a'] };
    renderSection([hk('a', 'Sunset lights'), hk('new', 'Just made')], [], layout);
    expect(await names(2)).toEqual(['Sunset lights', 'Just made']);
  });

  it('leaves a hidden automation out of the grid', async () => {
    const layout: HomeLayoutData = { visibility: { hiddenAutomations: ['hk:b'] } };
    renderSection([hk('a', 'Sunset lights'), hk('b', 'Wake up')], [], layout);
    expect(await names(1)).toEqual(['Sunset lights']);
  });

  it('reveals hidden ones while editing — you cannot unhide what you cannot see', async () => {
    const layout: HomeLayoutData = { visibility: { hiddenAutomations: ['hk:b'] } };
    renderSection([hk('a', 'Sunset lights'), hk('b', 'Wake up')], [], layout, true);
    expect(await names(2)).toEqual(['Sunset lights', 'Wake up']);
  });

  it('offers Unhide on the revealed card, and Hide on the others', async () => {
    const layout: HomeLayoutData = { visibility: { hiddenAutomations: ['hk:b'] } };
    renderSection([hk('a', 'Sunset lights'), hk('b', 'Wake up')], [], layout, true);
    await names(2);
    expect(screen.getByRole('button', { name: 'Unhide Wake up' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Hide Sunset lights' })).toBeTruthy();
  });

  it('hides the Create button while editing, so the grid does not grow mid-drag', async () => {
    renderSection([hk('a', 'Sunset lights')], [], null, true);
    await names(1);
    expect(screen.queryByTestId('new-automation-button')).toBeNull();
  });
});

/**
 * Hiding an automation from a desktop.
 *
 * Desktop never enters Edit Layout — the long press, the menu item and
 * `beginLift` are all gated on touch — so the badge that touch hides with is
 * unreachable there. Right-click is the desktop equivalent, exactly as it is
 * for a scene card, and Show Hidden Items is what puts a hidden card back on
 * screen to be right-clicked. Without that second half, hiding from a desktop
 * would be a one-way door: it used to take a trip to Settings to undo.
 */
describe('hiding an automation from a desktop', () => {
  afterEach(cleanup);
  beforeEach(() => {
    (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = ResizeObserverStub;
  });

  const HIDDEN_B: HomeLayoutData = { visibility: { hiddenAutomations: ['hk:b'] } };

  it('offers Hide Automation on right-click, and reports which one', async () => {
    const { onToggleAutomationHidden } = renderSection([hk('a', 'Sunset lights')], [], null);
    await names(1);

    fireEvent.contextMenu(screen.getByTestId('automation-a'));
    fireEvent.click(screen.getByText('Hide Automation'));

    expect(onToggleAutomationHidden).toHaveBeenCalledTimes(1);
    // The prefixed key, not the bare id — the two engines share no id space.
    expect(onToggleAutomationHidden.mock.calls[0]).toEqual(['hk:a', false]);
  });

  it('reveals a hidden automation under Show Hidden Items, without editing', async () => {
    renderSection([hk('a', 'Sunset lights'), hk('b', 'Wake up')], [], HIDDEN_B, false, { showHidden: true });
    expect(await names(2)).toEqual(['Sunset lights', 'Wake up']);
  });

  it('offers Unhide on the revealed card — the way back that Settings used to be', async () => {
    const { onToggleAutomationHidden } = renderSection(
      [hk('a', 'Sunset lights'), hk('b', 'Wake up')], [], HIDDEN_B, false, { showHidden: true },
    );
    await names(2);

    fireEvent.contextMenu(screen.getByTestId('automation-b'));
    fireEvent.click(screen.getByText('Unhide Automation'));

    expect(onToggleAutomationHidden.mock.calls[0]).toEqual(['hk:b', true]);
  });

  it('says Hidden on the revealed card, so a dimmed one is not just mysterious', async () => {
    renderSection([hk('a', 'Sunset lights'), hk('b', 'Wake up')], [], HIDDEN_B, false, { showHidden: true });
    await names(2);
    expect(screen.getByText('Hidden')).toBeTruthy();
  });

  it('reaches a Homecast automation too, not only a HomeKit one', async () => {
    const { onToggleAutomationHidden } = renderSection([], [hc('x', 'Away mode')], null);
    await names(1);

    fireEvent.contextMenu(screen.getByTestId('hc-automation-x'));
    fireEvent.click(screen.getByText('Hide Automation'));

    expect(onToggleAutomationHidden.mock.calls[0]).toEqual(['hc:x', false]);
  });

  it('offers nothing to right-click on touch, where Edit Layout owns hiding', async () => {
    renderSection([hk('a', 'Sunset lights')], [], null, false, { touchMode: true });
    await names(1);
    fireEvent.contextMenu(screen.getByTestId('automation-a'));
    expect(screen.queryByText('Hide Automation')).toBeNull();
  });

  it('offers nothing to right-click while editing, where the badge owns hiding', async () => {
    // Radix opens this menu on a native `contextmenu` as well as its own hold
    // timer, and an open menu puts `pointer-events: none` on the body — which
    // would kill a drag that is already in flight.
    renderSection([hk('a', 'Sunset lights')], [], null, true);
    await names(1);
    fireEvent.contextMenu(screen.getByTestId('automation-a'));
    expect(screen.queryByText('Hide Automation')).toBeNull();
  });
});
