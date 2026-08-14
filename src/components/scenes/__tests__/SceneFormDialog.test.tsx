// @vitest-environment jsdom
//
// Scene editing used to be a flat "select accessory / select characteristic /
// set value" triple per action: no search, no rooms, raw characteristic names,
// and a fresh three-step trip through the form for every device. It now
// borrows the automations flow — a searchable multi-select picker, then one
// card per device with named properties and values.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor, fireEvent } from '@testing-library/react';
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

import { SceneFormDialog } from '../SceneFormDialog';
import { GET_ACCESSORIES, GET_HOMES } from '@/lib/graphql/queries';
import type { HomeKitScene } from '@/lib/graphql/types';

const HOME_ID = 'HOME-1111';

// The picker list is virtualized: it renders nothing until something reports a
// viewport size, and jsdom measures every element as 0×0. Report a real size.
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

const LAMP = {
  __typename: 'HomeKitAccessory',
  id: 'ACC-LAMP', name: 'Reading Lamp', homeId: HOME_ID, category: 'Lightbulb',
  isReachable: true, roomId: 'ROOM-1', roomName: 'Living Room',
  services: [{
    __typename: 'HomeKitService',
    id: 'SVC-LAMP', name: 'Lamp', serviceType: 'lightbulb',
    characteristics: [
      { __typename: 'HomeKitCharacteristic', id: 'CH-1', characteristicType: 'power_state', value: false, isReadable: true, isWritable: true, validValues: null, minValue: null, maxValue: null, stepValue: null },
      { __typename: 'HomeKitCharacteristic', id: 'CH-2', characteristicType: 'brightness', value: 40, isReadable: true, isWritable: true, validValues: null, minValue: 0, maxValue: 100, stepValue: 1 },
      { __typename: 'HomeKitCharacteristic', id: 'CH-3', characteristicType: 'serial_number', value: 'X1', isReadable: true, isWritable: false, validValues: null, minValue: null, maxValue: null, stepValue: null },
    ],
  }],
};

const LOCK = {
  __typename: 'HomeKitAccessory',
  id: 'ACC-LOCK', name: 'Front Door', homeId: HOME_ID, category: 'Lock',
  isReachable: true, roomId: 'ROOM-2', roomName: 'Hallway',
  services: [{
    __typename: 'HomeKitService',
    id: 'SVC-LOCK', name: 'Lock', serviceType: 'lock',
    characteristics: [
      { __typename: 'HomeKitCharacteristic', id: 'CH-4', characteristicType: 'lock_target_state', value: 0, isReadable: true, isWritable: true, validValues: [0, 1], minValue: 0, maxValue: 1, stepValue: 1 },
    ],
  }],
};

/**
 * `isAdmin` is the relay's HomeKit edit access in this home. Built as one
 * literal so the mock array keeps the shape MockedProvider's prop accepts —
 * assembling it from parts produces a union that doesn't type-check.
 */
const makeMocks = (isAdmin: boolean | null = true) => [
  {
    request: { query: GET_ACCESSORIES, variables: { homeId: HOME_ID } },
    result: { data: { accessories: [LAMP, LOCK] } },
    maxUsageCount: 5,
  },
  {
    request: { query: GET_HOMES },
    result: { data: { homes: [{ __typename: 'HomeKitHome', id: HOME_ID, name: 'Test Home', isPrimary: true, roomCount: 2, accessoryCount: 2, role: 'owner', isAdmin }] } },
    maxUsageCount: 5,
  },
];

const mocks = makeMocks();

function scene(actions: unknown[]): HomeKitScene {
  return {
    id: 'SCENE-1', name: 'Movie Night', actionCount: actions.length,
    actions: JSON.stringify(actions),
  } as unknown as HomeKitScene;
}

function renderDialog(existing?: HomeKitScene) {
  return render(
    <MockedProvider mocks={mocks} addTypename={false}>
      <SceneFormDialog open onOpenChange={() => {}} homeId={HOME_ID} scene={existing ?? null} />
    </MockedProvider>,
  );
}

beforeEach(() => {
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = ResizeObserverStub;
  (window as unknown as { ResizeObserver: unknown }).ResizeObserver = ResizeObserverStub;
  Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({ width: 400, height: 600, top: 0, left: 0, right: 400, bottom: 600, x: 0, y: 0, toJSON: () => ({}) }),
  });
});
afterEach(() => cleanup());

describe('SceneFormDialog action editor', () => {
  it('groups a scene\'s actions under the device they belong to', async () => {
    renderDialog(scene([
      { accessoryId: 'ACC-LAMP', characteristicType: 'power_state', targetValue: true },
      { accessoryId: 'ACC-LAMP', characteristicType: 'brightness', targetValue: 30 },
      { accessoryId: 'ACC-LOCK', characteristicType: 'lock_target_state', targetValue: 1 },
    ]));

    // One card per device, not one row per action
    expect(await screen.findByText('Reading Lamp')).toBeTruthy();
    expect(screen.getByText('Front Door')).toBeTruthy();
    expect(screen.getAllByText('Reading Lamp')).toHaveLength(1);
  });

  it('names properties instead of showing raw characteristic types', async () => {
    renderDialog(scene([{ accessoryId: 'ACC-LAMP', characteristicType: 'brightness', targetValue: 30 }]));

    await screen.findByText('Reading Lamp');
    expect(screen.queryByText('brightness')).toBeNull();
    expect(screen.getByRole('combobox').textContent).toContain('Brightness');
  });

  it('renders a slider with the unit for a ranged property', async () => {
    renderDialog(scene([{ accessoryId: 'ACC-LAMP', characteristicType: 'brightness', targetValue: 30 }]));

    await screen.findByText('Reading Lamp');
    expect(screen.getByText('30%')).toBeTruthy();
    expect(screen.getByRole('slider')).toBeTruthy();
  });

  it('offers a lock its own words rather than an on/off toggle', async () => {
    renderDialog(scene([{ accessoryId: 'ACC-LOCK', characteristicType: 'lock_target_state', targetValue: 1 }]));

    await screen.findByText('Front Door');
    expect(screen.getByRole('button', { name: 'Locked' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Unlocked' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'On' })).toBeNull();
  });

  it('toggles a boolean property between On and Off', async () => {
    renderDialog(scene([{ accessoryId: 'ACC-LAMP', characteristicType: 'power_state', targetValue: true }]));

    await screen.findByText('Reading Lamp');
    const off = screen.getByRole('button', { name: 'Off' });
    fireEvent.click(off);

    // The selected pill is the filled (default) variant
    await waitFor(() => expect(off.className).toContain('bg-primary'));
  });

  it('opens the searchable device picker from "Add devices"', async () => {
    renderDialog();

    fireEvent.click(await screen.findByRole('button', { name: /add devices/i }));

    expect(await screen.findByPlaceholderText(/search accessories/i)).toBeTruthy();
  });

  it('hides the home filter when the scene\'s home is the only one', async () => {
    renderDialog();

    fireEvent.click(await screen.findByRole('button', { name: /add devices/i }));
    await screen.findByPlaceholderText(/search accessories/i);

    const filters = screen.getAllByRole('combobox').map(el => el.textContent);
    expect(filters.some(t => t?.includes('Home'))).toBe(false);
    expect(filters.some(t => t?.includes('Rooms'))).toBe(true);
  });

  it('adds a picked device pre-set to a sensible action', async () => {
    renderDialog();

    fireEvent.click(await screen.findByRole('button', { name: /add devices/i }));
    fireEvent.click(await screen.findByRole('button', { name: /reading lamp/i }));
    fireEvent.click(screen.getByRole('button', { name: /done/i }));

    // Power is the headline property, and devices join a scene switched on
    await waitFor(() => expect(screen.getByTestId('characteristic-select').textContent).toContain('Power State'));
    expect(screen.getByRole('button', { name: 'On' }).className).toContain('bg-primary');
  });

  it('keeps a device out of the list once its actions are removed', async () => {
    renderDialog(scene([
      { accessoryId: 'ACC-LAMP', characteristicType: 'power_state', targetValue: true },
      { accessoryId: 'ACC-LOCK', characteristicType: 'lock_target_state', targetValue: 1 },
    ]));

    await screen.findByText('Front Door');
    fireEvent.click(screen.getByRole('button', { name: /remove front door/i }));

    await waitFor(() => expect(screen.queryByText('Front Door')).toBeNull());
    expect(screen.getByText('Reading Lamp')).toBeTruthy();
  });

  it('shows a read-only summary for a built-in scene', async () => {
    const builtIn = {
      id: 'SCENE-BI', name: 'Good Night', actionCount: 1, actionSetType: 'HMActionSetTypeSleep',
      actions: JSON.stringify([{ accessoryId: 'ACC-LAMP', characteristicType: 'brightness', targetValue: 10 }]),
    } as unknown as HomeKitScene;
    renderDialog(builtIn);

    await screen.findByText('Reading Lamp');
    expect(screen.getByText('Brightness')).toBeTruthy();
    expect(screen.getByText('10%')).toBeTruthy();
    expect(screen.queryByRole('slider')).toBeNull();
    expect(screen.queryByRole('button', { name: /add devices/i })).toBeNull();
  });
});

// A scene used to be fully editable right up to the Create button, which then
// failed with HomeKit's "Insufficient privileges" — every device and value the
// user had set was lost. View-only is now a third read-only reason, alongside
// built-in and automation-owned.
describe('SceneFormDialog when the relay is view-only', () => {
  // No addTypename here: it isn't a prop on this Apollo version (the mocks
  // already carry __typename), and passing it is a type error.
  function renderWithAccess(isAdmin: boolean | null, existing?: HomeKitScene) {
    return render(
      <MockedProvider mocks={makeMocks(isAdmin)}>
        <SceneFormDialog open onOpenChange={() => {}} homeId={HOME_ID} scene={existing ?? null} onDelete={() => {}} />
      </MockedProvider>,
    );
  }

  const oneAction = () => scene([{ accessoryId: 'ACC-LAMP', characteristicType: 'brightness', targetValue: 30 }]);

  it('drops Save and Delete, and says why', async () => {
    renderWithAccess(false, oneAction());

    // The homes query settles after the accessories one, so wait on the notice
    // itself rather than on the device list.
    expect(await screen.findByText(/can view this home but not change it/i)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull();
    expect(screen.queryByRole('button', { name: /delete/i })).toBeNull();
    // Cancel becomes Close. getAll: Radix's DialogContent renders its own
    // sr-only "Close" button too.
    expect(screen.getAllByRole('button', { name: 'Close' }).length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: 'Cancel' })).toBeNull();
    // The fix path, not just the diagnosis. The relay kind rides a separate WS
    // payload that isn't mocked here, so this pins the agnostic fallback —
    // naming either concrete kind on unknown data would mislead half of users.
    expect(screen.getByText(/Add & Edit Accessories/)).toBeTruthy();
    expect(screen.getByText(/the relay user/)).toBeTruthy();
  });

  /**
   * Asserting "Save is present" alone would also pass if the homes query had
   * simply never resolved, which is the same state a broken check produces.
   * Let the query settle first so absence of the notice means something.
   */
  async function expectStaysEditable() {
    await screen.findByText('Reading Lamp');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save' })).toBeTruthy());
    await new Promise(resolve => setTimeout(resolve, 50));
    expect(screen.getByRole('button', { name: 'Save' })).toBeTruthy();
    expect(screen.queryByText(/can view this home but not change it/i)).toBeNull();
  }

  it('keeps the scene editable when the relay has full access', async () => {
    renderWithAccess(true, oneAction());
    await expectStaysEditable();
  });

  // Relays older than 1.1.2 never reported isAdmin. Unknown is not restricted —
  // warning there would put a permission notice in front of users who have none.
  it('stays editable when the relay does not report access at all', async () => {
    renderWithAccess(null, oneAction());
    await expectStaysEditable();
  });
});
