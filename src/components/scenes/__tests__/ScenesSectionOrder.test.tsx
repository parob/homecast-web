// @vitest-environment jsdom
/**
 * The merged grid's arrangement.
 *
 * Shortcuts and scenes are one draggable list, so the order has to span two
 * kinds of card that share no id space — and has to survive a card being
 * absent, which for a shortcut happens whenever the home loses the last
 * accessory behind it.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
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

import type { HomeKitAccessory } from '@/native/homekit-bridge';
import type { HomeKitScene } from '@/lib/graphql/types';
import type { HomeLayoutData } from '@/hooks/useEntityLayout';
import { ScenesSection } from '../ScenesSection';
import { GET_SCENES, GET_HOMES } from '@/lib/graphql/queries';
import { LayoutEditProvider } from '@/contexts/LayoutEditContext';
import { PinnedTabsProvider } from '@/contexts/PinnedTabsContext';

const HOME_ID = 'HOME-1';

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

function acc(id: string, serviceType: string, characteristicType: string, value: unknown): HomeKitAccessory {
  return {
    id, name: id, roomName: 'Room', category: 'other', isReachable: true,
    services: [{
      id: `svc-${id}`, name: serviceType, serviceType,
      characteristics: [{ id: `char-${id}`, characteristicType, value, isReadable: true, isWritable: true }],
    }],
  } as HomeKitAccessory;
}

const light = acc('l', 'lightbulb', 'power_state', true);

const scene = (id: string, name: string): HomeKitScene => ({ id, name, actionCount: 2 } as HomeKitScene);

function renderSection(scenes: HomeKitScene[], accessories: HomeKitAccessory[], layout: HomeLayoutData | null) {
  const mocks: MockLink.MockedResponse[] = [
    { request: { query: GET_SCENES, variables: { homeId: HOME_ID } }, result: { data: { scenes } } },
    {
      request: { query: GET_HOMES },
      result: { data: { homes: [{ id: HOME_ID, name: 'Test Home', isPrimary: true, role: 'owner', isAdmin: true }] } },
      maxUsageCount: Number.POSITIVE_INFINITY,
    },
  ];
  const pins = { enabled: false, isPinned: () => false, isFull: false, toggle: () => {} };
  return render(
    <MockedProvider mocks={mocks}>
      <PinnedTabsProvider value={pins as never}>
        <LayoutEditProvider value={{ touchMode: false, editMode: false }}>
          <ScenesSection
            homeId={HOME_ID}
            accessories={accessories}
            homeLayout={layout}
            open
            onRunAction={async () => {}}
            onReorderCards={() => {}}
          />
        </LayoutEditProvider>
      </PinnedTabsProvider>
    </MockedProvider>,
  );
}

/** Card names in the order they are painted. Every card titles its name. */
async function names(expected: number) {
  await waitFor(() => {
    expect(document.querySelectorAll('p[title]')).toHaveLength(expected);
  });
  return Array.from(document.querySelectorAll('p[title]')).map(n => n.getAttribute('title'));
}

describe('the merged Scenes grid', () => {
  afterEach(cleanup);
  beforeEach(() => {
    (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = ResizeObserverStub;
  });

  it('leads with the shortcuts before anything has been arranged', async () => {
    renderSection([scene('s1', 'Movie Night')], [light], null);

    const order = await names(3);
    expect(order[order.length - 1]).toBe('Movie Night');
    expect(order.slice(0, -1)).toContain('All lights');
  });

  it('paints the cards in the saved order, intermixing the two kinds', async () => {
    const layout: HomeLayoutData = {
      sceneCardOrder: ['scene:s1', 'action:lights', 'scene:s2', 'action:everything-off'],
    };
    renderSection([scene('s1', 'Movie Night'), scene('s2', 'Good Night')], [light], layout);

    expect(await names(4)).toEqual(['Movie Night', 'All lights', 'Good Night', 'Turn everything off']);
  });

  it('skips an order entry whose card is gone, without disturbing the rest', async () => {
    // No lock in this home any more, and a scene deleted from Apple Home.
    const layout: HomeLayoutData = {
      sceneCardOrder: ['action:locks', 'scene:deleted', 'scene:s1', 'action:lights'],
    };
    renderSection([scene('s1', 'Movie Night')], [light], layout);

    const order = await names(3);
    expect(order.slice(0, 2)).toEqual(['Movie Night', 'All lights']);
  });

  it('puts a card the order has never seen at the end', async () => {
    const layout: HomeLayoutData = { sceneCardOrder: ['scene:s1', 'action:lights'] };
    renderSection([scene('s1', 'Movie Night'), scene('s-new', 'Brand New')], [light], layout);

    const order = await names(4);
    expect(order[0]).toBe('Movie Night');
    expect(order[order.length - 1]).toBe('Brand New');
  });

  it('drops the scene cards when only that half is switched off', async () => {
    const layout: HomeLayoutData = { visibility: { hiddenSummarySections: ['scenes'] } };
    // A lone light earns two shortcuts: All lights, and Turn everything off.
    renderSection([scene('s1', 'Movie Night')], [light], layout);

    const order = await names(2);
    expect(order).not.toContain('Movie Night');
    expect(order).toContain('All lights');
  });

  it('drops the shortcut cards when only that half is switched off', async () => {
    const layout: HomeLayoutData = { visibility: { hiddenSummarySections: ['actions'] } };
    renderSection([scene('s1', 'Movie Night')], [light], layout);

    expect(await names(1)).toEqual(['Movie Night']);
  });
});
