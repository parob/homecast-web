// @vitest-environment jsdom
/**
 * The Scenes pill, after Actions was folded into it.
 *
 * Its count now spans both halves of the section, and the two halves have
 * separate visibility switches — so the pill has to survive one being off, and
 * disappear only when there is nothing behind it at all.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { MockedProvider } from '@apollo/client/testing/react';
import type { MockLink } from '@apollo/client/testing';

// config.ts reads localStorage at module scope, which jsdom doesn't provide here.
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
import { ScenesPill } from '../ScenesSection';
import { GET_SCENES } from '@/lib/graphql/queries';

const HOME_ID = 'HOME-1';

function acc(id: string, serviceType: string, characteristicType: string, value: unknown, isWritable = true): HomeKitAccessory {
  return {
    id,
    name: id,
    roomName: 'Room',
    category: 'other',
    isReachable: true,
    services: [{
      id: `svc-${id}`,
      name: serviceType,
      serviceType,
      characteristics: [{ id: `char-${id}`, characteristicType, value, isReadable: true, isWritable }],
    }],
  } as HomeKitAccessory;
}

const light = acc('l', 'lightbulb', 'power_state', true);
const motionSensor = acc('m', 'motion_sensor', 'motion_detected', true, false);

const scene = (id: string, name: string): HomeKitScene =>
  ({ id, name, actionCount: 2 } as HomeKitScene);

function renderPill(
  props: Partial<React.ComponentProps<typeof ScenesPill>> = {},
  scenes: HomeKitScene[] = [],
) {
  const mocks: MockLink.MockedResponse[] = [{
    request: { query: GET_SCENES, variables: { homeId: props.homeId ?? HOME_ID } },
    result: { data: { scenes } },
  }];
  return render(
    <MockedProvider mocks={mocks}>
      <ScenesPill
        homeId={HOME_ID}
        accessories={[]}
        homeLayout={null}
        open={false}
        onToggle={() => {}}
        {...props}
      />
    </MockedProvider>,
  );
}

const label = () => screen.getByRole('button').textContent;

describe('ScenesPill', () => {
  afterEach(cleanup);

  /**
   * The Actions pill used to hide itself at zero, which was right for a thing
   * that cannot be created. Scenes can be, and the section holds the only
   * "Create scene" button — so hiding at zero would strand a new home with no
   * way to make its first one.
   */
  it('still renders for a home with nothing actionable and no scenes', async () => {
    renderPill({ accessories: [motionSensor] });
    await waitFor(() => expect(screen.getByRole('button')).toBeTruthy());
    expect(label()).toBe('Scenes');
  });

  it('renders nothing without a real home', () => {
    const { container } = renderPill({ homeId: '' });
    expect(container.innerHTML).toBe('');
  });

  it('counts shortcuts and scenes together', async () => {
    // A lone light yields both "Lights" and "Everything off", plus two scenes.
    renderPill({ accessories: [light] }, [scene('s1', 'Movie Night'), scene('s2', 'Good Night')]);
    await waitFor(() => expect(label()).toBe('Scenes 4'));
  });

  it('drops the count when counts are hidden', async () => {
    renderPill({ accessories: [light], hideAccessoryCounts: true }, [scene('s1', 'Movie Night')]);
    await waitFor(() => expect(screen.getByRole('button')).toBeTruthy());
    expect(label()).toBe('Scenes');
  });

  it('excludes shortcuts hidden for this home', async () => {
    const homeLayout = { visibility: { hiddenActions: ['everything-off' as const] } };
    renderPill({ accessories: [light], homeLayout });
    await waitFor(() => expect(label()).toBe('Scenes 1'));
  });

  it('counts only the scenes when the shortcut half is switched off', async () => {
    const homeLayout = { visibility: { hiddenSummarySections: ['actions' as const] } };
    renderPill({ accessories: [light], homeLayout }, [scene('s1', 'Movie Night')]);
    await waitFor(() => expect(label()).toBe('Scenes 1'));
  });

  it('counts only the shortcuts when the Apple Home half is switched off', async () => {
    const homeLayout = { visibility: { hiddenSummarySections: ['scenes' as const] } };
    renderPill({ accessories: [light], homeLayout }, [scene('s1', 'Movie Night')]);
    await waitFor(() => expect(label()).toBe('Scenes 2'));
  });

  it('reports presses and rotates the chevron while open', async () => {
    const onToggle = vi.fn();
    const { rerender } = renderPill({ accessories: [light], onToggle });
    await waitFor(() => expect(screen.getByRole('button')).toBeTruthy());

    fireEvent.click(screen.getByRole('button'));
    expect(onToggle).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button').querySelector('.rotate-90')).toBeNull();

    rerender(
      <MockedProvider mocks={[] as MockLink.MockedResponse[]}>
        <ScenesPill homeId={HOME_ID} accessories={[light]} homeLayout={null} open onToggle={onToggle} />
      </MockedProvider>,
    );
    expect(screen.getByRole('button').querySelector('.rotate-90')).not.toBeNull();
  });
});
