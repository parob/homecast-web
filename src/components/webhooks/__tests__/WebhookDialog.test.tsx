// @vitest-environment jsdom
//
// The webhook's accessory scope was a 120px scroll box of raw checkboxes over
// every accessory in the home — no search, no filters, no icons. It now opens
// the same AccessoryPicker the scenes and automations use.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { MockedProvider } from '@apollo/client/testing/react';

vi.mock('@/lib/config', () => ({
  isCommunity: false,
  getCommunityMode: () => null,
  isRelayMode: () => false,
  isClientMode: () => false,
  isRelaySetupComplete: () => false,
  getRelayAddress: () => null,
  config: { isCommunity: false, apiBase: 'https://api.test', graphqlUrl: 'https://api.test/', wsUrl: 'wss://api.test/ws' },
}));

import { WebhookDialog } from '../WebhookDialog';
import { GET_HOMES, GET_ROOMS, GET_ACCESSORIES } from '@/lib/graphql/queries';

const HOME_ID = 'HOME-1111';

class ResizeObserverStub {
  constructor(private cb: ResizeObserverCallback) {}
  observe(el: Element) {
    queueMicrotask(() => this.cb(
      [{ target: el, contentRect: { width: 400, height: 600 }, borderBoxSize: [{ inlineSize: 400, blockSize: 600 }] } as unknown as ResizeObserverEntry],
      this as unknown as ResizeObserver,
    ));
  }
  unobserve() {}
  disconnect() {}
}

function accessory(id: string, name: string, room: string) {
  return {
    __typename: 'HomeKitAccessory', id, name, homeId: HOME_ID, category: 'Lightbulb',
    isReachable: true, roomId: `ROOM-${room}`, roomName: room,
    services: [{
      __typename: 'HomeKitService', id: `SVC-${id}`, name, serviceType: 'lightbulb',
      characteristics: [{ __typename: 'HomeKitCharacteristic', id: `CH-${id}`, characteristicType: 'power_state', value: true, isReadable: true, isWritable: true, validValues: null, minValue: null, maxValue: null, stepValue: null }],
    }],
  };
}

const mocks = [
  {
    request: { query: GET_HOMES },
    result: { data: { homes: [{ __typename: 'HomeKitHome', id: HOME_ID, name: 'Test Home', isPrimary: true, roomCount: 1, accessoryCount: 2, role: 'owner', isAdmin: true }] } },
    maxUsageCount: 5,
  },
  {
    request: { query: GET_ROOMS, variables: { homeId: HOME_ID } },
    result: { data: { rooms: [{ __typename: 'HomeKitRoom', id: 'ROOM-Kitchen', name: 'Kitchen', homeId: HOME_ID, accessoryCount: 2 }] } },
    maxUsageCount: 5,
  },
  {
    request: { query: GET_ACCESSORIES, variables: { homeId: HOME_ID } },
    result: { data: { accessories: [accessory('ACC-1', 'Reading Lamp', 'Kitchen'), accessory('ACC-2', 'Counter Light', 'Kitchen')] } },
    maxUsageCount: 5,
  },
];

beforeEach(() => {
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = ResizeObserverStub;
  (window as unknown as { ResizeObserver: unknown }).ResizeObserver = ResizeObserverStub;
  Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({ width: 400, height: 600, top: 0, left: 0, right: 400, bottom: 600, x: 0, y: 0, toJSON: () => ({}) }),
  });
});
afterEach(() => cleanup());

/** Open the dialog, expand Scope, and pick the home that unlocks accessories. */
async function openScope() {
  render(
    <MockedProvider mocks={mocks} addTypename={false}>
      <WebhookDialog open onOpenChange={() => {}} />
    </MockedProvider>,
  );
  fireEvent.click(screen.getByText('Scope'));
  fireEvent.click(await screen.findByLabelText('Test Home'));
}

describe('WebhookDialog accessory scope', () => {
  it('picks accessories through the searchable picker', async () => {
    await openScope();

    fireEvent.click(await screen.findByRole('button', { name: /choose accessories/i }));
    expect(await screen.findByPlaceholderText(/search accessories/i)).toBeTruthy();

    fireEvent.click(await screen.findByRole('button', { name: /reading lamp/i }));
    fireEvent.click(screen.getByRole('button', { name: /done/i }));

    // Chosen accessories are listed in the scope section, with a way back in
    await waitFor(() => expect(screen.getByRole('button', { name: /remove reading lamp/i })).toBeTruthy());
    expect(screen.getByRole('button', { name: /add more accessories/i })).toBeTruthy();
  });

  it('removes an accessory from the scope', async () => {
    await openScope();

    fireEvent.click(await screen.findByRole('button', { name: /choose accessories/i }));
    fireEvent.click(await screen.findByRole('button', { name: /reading lamp/i }));
    fireEvent.click(screen.getByRole('button', { name: /done/i }));

    const remove = await screen.findByRole('button', { name: /remove reading lamp/i });
    fireEvent.click(remove);

    await waitFor(() => expect(screen.queryByRole('button', { name: /remove reading lamp/i })).toBeNull());
    expect(screen.getByRole('button', { name: /choose accessories/i })).toBeTruthy();
  });

  it('counts the scoped accessories in plain English', async () => {
    await openScope();

    fireEvent.click(await screen.findByRole('button', { name: /choose accessories/i }));
    fireEvent.click(await screen.findByRole('button', { name: /reading lamp/i }));
    fireEvent.click(await screen.findByRole('button', { name: /counter light/i }));
    fireEvent.click(screen.getByRole('button', { name: /done/i }));

    // Was "2 accessoryies"
    await waitFor(() => expect(screen.getByText('2 accessories')).toBeTruthy());
  });
});
