// @vitest-environment jsdom
/**
 * Dropping a card has to rearrange the grid in the same commit as the drop.
 *
 * `updateHomeLayout` writes the Apollo cache optimistically, but the re-render
 * that follows is scheduled by Apollo's broadcast rather than batched with the
 * drag-end event. dnd-kit measures the dragged node the instant the drag ends,
 * so it still found the card in its old slot — the card flew back to where it
 * started and only then slid across to where it had been dropped. The
 * accessory tiles never showed it because their reorder goes through plain
 * React state.
 *
 * Driving a real dnd-kit drag needs layout, which jsdom does not have, so the
 * grid's own drag plumbing is stubbed and `onReorder` called directly. What is
 * under test is what happens *after* the drop, which is where the bug was.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, waitFor, act } from '@testing-library/react';
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

/** Captures the grid's `onReorder` so a drop can be replayed without layout. */
let dropOnto: ((order: string[]) => void) | null = null;
vi.mock('@/components/shared/DraggableGrid', () => ({
  DraggableGrid: ({ children, onReorder }: { children: React.ReactNode; onReorder: (o: string[]) => void }) => {
    dropOnto = onReorder;
    return <div>{children}</div>;
  },
  useDraggableGrid: () => ({ activeId: null, isDragging: false }),
}));

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

const scene = (id: string, name: string): HomeKitScene => ({ id, name, actionCount: 2 } as HomeKitScene);

function renderSection(layout: HomeLayoutData | null) {
  const scenes = [scene('s1', 'Movie Night'), scene('s2', 'Good Night'), scene('s3', 'Wake Up')];
  const mocks: MockLink.MockedResponse[] = [
    { request: { query: GET_SCENES, variables: { homeId: HOME_ID } }, result: { data: { scenes } } },
    {
      request: { query: GET_HOMES },
      result: { data: { homes: [{ id: HOME_ID, name: 'Test Home', isPrimary: true, role: 'owner', isAdmin: true }] } },
      maxUsageCount: Number.POSITIVE_INFINITY,
    },
  ];
  const onReorderCards = vi.fn();
  const pins = { enabled: false, isPinned: () => false, isFull: false, toggle: () => {} };
  const view = render(
    <MockedProvider mocks={mocks}>
      <PinnedTabsProvider value={pins as never}>
        <LayoutEditProvider value={{ touchMode: false, editMode: false }}>
          <ScenesSection
            homeId={HOME_ID}
            accessories={[]}
            homeLayout={layout}
            open
            onRunAction={async () => {}}
            onReorderCards={onReorderCards}
          />
        </LayoutEditProvider>
      </PinnedTabsProvider>
    </MockedProvider>,
  );
  return { onReorderCards, view };
}

async function names(expected: number) {
  await waitFor(() => {
    expect(document.querySelectorAll('p[title]')).toHaveLength(expected);
  });
  return Array.from(document.querySelectorAll('p[title]')).map(n => n.getAttribute('title'));
}

describe('dropping a card', () => {
  afterEach(() => { cleanup(); dropOnto = null; });
  beforeEach(() => {
    (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = ResizeObserverStub;
  });

  it('rearranges the grid without waiting for the layout to come back', async () => {
    // No stored order, so the natural one is s1, s2, s3.
    renderSection(null);
    expect(await names(3)).toEqual(['Movie Night', 'Good Night', 'Wake Up']);

    // Drop "Wake Up" at the front. `homeLayout` deliberately does NOT change —
    // this is the window in which the card used to snap back.
    act(() => { dropOnto!(['scene:s3', 'scene:s1', 'scene:s2']); });

    expect(await names(3)).toEqual(['Wake Up', 'Movie Night', 'Good Night']);
  });

  it('still asks for the new order to be saved', async () => {
    const { onReorderCards } = renderSection(null);
    await names(3);

    act(() => { dropOnto!(['scene:s3', 'scene:s1', 'scene:s2']); });

    expect(onReorderCards).toHaveBeenCalledWith(['scene:s3', 'scene:s1', 'scene:s2']);
  });

  it('hands back to the saved order once it arrives, without flinching', async () => {
    const { view } = renderSection(null);
    await names(3);
    act(() => { dropOnto!(['scene:s3', 'scene:s1', 'scene:s2']); });
    expect(await names(3)).toEqual(['Wake Up', 'Movie Night', 'Good Night']);

    // The layout catches up with what was just dropped.
    view.rerender(
      <MockedProvider mocks={[]}>
        <PinnedTabsProvider value={{ enabled: false, isPinned: () => false, isFull: false, toggle: () => {} } as never}>
          <LayoutEditProvider value={{ touchMode: false, editMode: false }}>
            <ScenesSection
              homeId={HOME_ID}
              accessories={[]}
              homeLayout={{ sceneCardOrder: ['scene:s3', 'scene:s1', 'scene:s2'] }}
              open
              onRunAction={async () => {}}
              onReorderCards={vi.fn()}
            />
          </LayoutEditProvider>
        </PinnedTabsProvider>
      </MockedProvider>,
    );

    expect(await names(3)).toEqual(['Wake Up', 'Movie Night', 'Good Night']);
  });
});
