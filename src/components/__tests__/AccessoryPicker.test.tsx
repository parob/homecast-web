// @vitest-environment jsdom
//
// Service groups carry no home, room or type of their own — only member ids.
// The picker's three filters were written against accessories, so a list made
// mostly of group rows (every grouped accessory is deduped away) ignored all
// three: Home needed a map callers didn't pass, Type was never applied, and
// Room sat disabled because the Home filter defaulted to "all".
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor, within } from '@testing-library/react';

vi.mock('@/lib/config', () => ({
  isCommunity: false,
  getCommunityMode: () => null,
  isRelayMode: () => false,
  isClientMode: () => false,
  isRelaySetupComplete: () => false,
  getRelayAddress: () => null,
  config: { isCommunity: false, apiBase: 'https://api.test', graphqlUrl: 'https://api.test/', wsUrl: 'wss://api.test/ws' },
}));

import { AccessoryPicker } from '../AccessoryPicker';
import type { HomeKitAccessory, HomeKitHome, HomeKitServiceGroup } from '@/lib/graphql/types';

const HOME_A = 'HOME-A';
const HOME_B = 'HOME-B';

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

function acc(id: string, name: string, roomId: string, roomName: string, serviceType: string, homeId = HOME_A): HomeKitAccessory {
  return {
    id, name, homeId, isReachable: true, roomId, roomName,
    category: serviceType === 'lightbulb' ? 'Lightbulb' : 'Sensor',
    services: [{ id: `SVC-${id}`, name, serviceType, characteristics: [] }],
  } as unknown as HomeKitAccessory;
}

const KITCHEN_LAMP = acc('ACC-1', 'Reading Lamp', 'ROOM-K', 'Kitchen', 'lightbulb');
const KITCHEN_SPOT = acc('ACC-2', 'Counter Spot', 'ROOM-K', 'Kitchen', 'lightbulb');
const HALL_SENSOR = acc('ACC-3', 'Hall Motion', 'ROOM-H', 'Hallway', 'motion_sensor');
const LOOSE_LAMP = acc('ACC-4', 'Porch Lamp', 'ROOM-H', 'Hallway', 'lightbulb');

const KITCHEN_LIGHTS: HomeKitServiceGroup = {
  id: 'GRP-1', name: 'Kitchen Lights',
  accessoryIds: [KITCHEN_LAMP.id, KITCHEN_SPOT.id], serviceIds: [],
};
const HALL_MIXED: HomeKitServiceGroup = {
  id: 'GRP-2', name: 'Hall Kit',
  accessoryIds: [HALL_SENSOR.id], serviceIds: [],
};

const HOMES: HomeKitHome[] = [
  { id: HOME_A, name: 'Main House' } as HomeKitHome,
  { id: HOME_B, name: 'Beach House' } as HomeKitHome,
];

beforeEach(() => {
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = ResizeObserverStub;
  (window as unknown as { ResizeObserver: unknown }).ResizeObserver = ResizeObserverStub;
  Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({ width: 400, height: 600, top: 0, left: 0, right: 400, bottom: 600, x: 0, y: 0, toJSON: () => ({}) }),
  });
  // Radix Select needs these; jsdom has neither.
  HTMLElement.prototype.hasPointerCapture = () => false;
  HTMLElement.prototype.releasePointerCapture = () => {};
  HTMLElement.prototype.scrollIntoView = () => {};
});
afterEach(() => cleanup());

function renderPicker(overrides: Partial<React.ComponentProps<typeof AccessoryPicker>> = {}) {
  return render(
    <AccessoryPicker
      accessories={[KITCHEN_LAMP, KITCHEN_SPOT, HALL_SENSOR, LOOSE_LAMP]}
      homes={HOMES}
      selectedIds={new Set()}
      onToggle={() => {}}
      serviceGroups={[KITCHEN_LIGHTS, HALL_MIXED]}
      selectedServiceGroupIds={new Set()}
      onToggleServiceGroup={() => {}}
      {...overrides}
    />,
  );
}

/** Open a Radix Select by its current label and choose an option. */
async function chooseFilter(currentLabel: string, option: string) {
  const trigger = screen.getByText(currentLabel).closest('button')!;
  fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: 'mouse' });
  const listbox = await screen.findByRole('listbox');
  fireEvent.click(within(listbox).getByRole('option', { name: option }));
}

describe('AccessoryPicker filters with service groups', () => {
  it('describes a group by the room and size of its members', async () => {
    renderPicker();

    const row = (await screen.findByText('Kitchen Lights')).closest('button')!;
    expect(row.textContent).toContain('Kitchen');
    expect(row.textContent).toContain('Group of 2');
  });

  it('filters groups by type, not just accessories', async () => {
    renderPicker();
    await screen.findByText('Kitchen Lights');

    await chooseFilter('All Types', 'Sensors');

    // The all-lights group goes; the sensor group and its room stay
    await waitFor(() => expect(screen.queryByText('Kitchen Lights')).toBeNull());
    expect(screen.getByText('Hall Kit')).toBeTruthy();
    // A loose light is filtered out too
    expect(screen.queryByText('Porch Lamp')).toBeNull();
  });

  it('filters groups by room', async () => {
    renderPicker();
    await screen.findByText('Kitchen Lights');

    await chooseFilter('All Rooms', 'Kitchen');

    await waitFor(() => expect(screen.queryByText('Hall Kit')).toBeNull());
    expect(screen.getByText('Kitchen Lights')).toBeTruthy();
  });

  it('filters groups by home when more than one home is represented', async () => {
    const beachLamp = acc('ACC-9', 'Beach Lamp', 'ROOM-B', 'Deck', 'lightbulb', HOME_B);
    const beachGroup: HomeKitServiceGroup = { id: 'GRP-3', name: 'Deck Lights', accessoryIds: [beachLamp.id], serviceIds: [] };
    renderPicker({
      accessories: [KITCHEN_LAMP, KITCHEN_SPOT, beachLamp],
      serviceGroups: [KITCHEN_LIGHTS, beachGroup],
    });
    await screen.findByText('Deck Lights');

    await chooseFilter('All Homes', 'Beach House');

    await waitFor(() => expect(screen.queryByText('Kitchen Lights')).toBeNull());
    expect(screen.getByText('Deck Lights')).toBeTruthy();
  });
});

describe('AccessoryPicker grouped members', () => {
  it('hides accessories that a group already stands for', async () => {
    renderPicker();

    await screen.findByText('Kitchen Lights');
    expect(screen.queryByText('Reading Lamp')).toBeNull();
  });

  it('lists them alongside their group when asked', async () => {
    renderPicker({ showGroupedAccessories: true });

    expect(await screen.findByText('Kitchen Lights')).toBeTruthy();
    expect(screen.getByText('Reading Lamp')).toBeTruthy();
    expect(screen.getByText('Counter Spot')).toBeTruthy();
  });

  it('filters those members by room like any other accessory', async () => {
    renderPicker({ showGroupedAccessories: true });
    await screen.findByText('Reading Lamp');

    await chooseFilter('All Rooms', 'Hallway');

    await waitFor(() => expect(screen.queryByText('Reading Lamp')).toBeNull());
    expect(screen.getByText('Hall Motion')).toBeTruthy();
  });
});

describe('AccessoryPicker home filter', () => {
  it('drops the home filter when the list only covers one home', async () => {
    // The automation editor passes every home the user owns alongside a single
    // home's accessories — the filter's only useful setting was the default.
    renderPicker();
    await screen.findByText('Kitchen Lights');

    expect(screen.queryByText('All Homes')).toBeNull();
    expect(screen.getByText('All Rooms')).toBeTruthy();
  });

  it('keeps the room filter usable without picking a home first', async () => {
    renderPicker();
    await screen.findByText('Kitchen Lights');

    const roomTrigger = screen.getByText('All Rooms').closest('button')!;
    expect(roomTrigger.hasAttribute('disabled')).toBe(false);
  });

  it('offers the home filter once the list spans homes', async () => {
    renderPicker({
      accessories: [KITCHEN_LAMP, acc('ACC-9', 'Beach Lamp', 'ROOM-B', 'Deck', 'lightbulb', HOME_B)],
      serviceGroups: [],
    });

    expect(await screen.findByText('All Homes')).toBeTruthy();
  });
});
