/**
 * Service-group triggers must fire once per GROUP change, not once per member.
 *
 * HomeKit reports a group change as one event per member accessory, and the
 * engine fanned each of those out independently. Observed in production
 * (2026-07-27): turning on County Hall's 11-light Kitchen group ran a single
 * automation 10 times in 1.3s and produced 10 notifications, each trace naming
 * a different member accessory.
 *
 * The fix must NOT touch per-accessory triggers — an automation bound to one
 * bulb inside a group still has to fire for that bulb.
 */

import { vi, describe, it, expect, afterEach } from 'vitest';
import { initAutomationEngine, teardownAutomationEngine } from '../index';
import type { HomeKitEvent } from '../../native/homekit-bridge';
import type { Automation } from '../types/automation';

const MEMBERS = ['bulb-1', 'bulb-2', 'bulb-3', 'bulb-4'];

function groupAutomation(): Automation {
  return {
    id: 'auto-group',
    name: 'Kitchen lights on',
    homeId: 'home-1',
    enabled: true,
    mode: 'single',
    triggers: [
      { id: 't1', type: 'state', serviceGroupId: 'group-1', characteristicType: 'power_state', to: true },
    ],
    conditions: { operator: 'and', conditions: [] },
    actions: [
      { id: 'a1', type: 'set_characteristic', accessoryId: 'siren', characteristicType: 'power_state', value: true },
    ],
    metadata: { createdAt: '', updatedAt: '', triggerCount: 0 },
  };
}

/** Same shape, but bound to a single bulb that happens to be in the group. */
function singleBulbAutomation(): Automation {
  return {
    ...groupAutomation(),
    id: 'auto-bulb',
    name: 'One bulb',
    triggers: [
      { id: 't2', type: 'state', accessoryId: 'bulb-2', characteristicType: 'power_state', to: true },
    ],
  };
}

function makeHarness() {
  const bridge = {
    setCharacteristic: vi.fn(async () => {}),
    setServiceGroup: vi.fn(async () => {}),
    executeScene: vi.fn(async () => {}),
  };
  let emit: ((e: HomeKitEvent) => void) | undefined;
  const subscribeToHomeKit = (handler: (e: HomeKitEvent) => void) => {
    emit = handler;
    return () => { emit = undefined; };
  };
  return { bridge, subscribeToHomeKit, emit: (e: HomeKitEvent) => emit?.(e) };
}

const resolver = {
  getGroupsForAccessory: (id: string) => (MEMBERS.includes(id) ? ['group-1'] : []),
  getMembers: (groupId: string) => (groupId === 'group-1' ? MEMBERS : []),
};

/**
 * Turn every member on, the way HomeKit reports it: one event each, spaced out.
 *
 * The spacing matters. Emitting synchronously lets `mode: 'single'` swallow the
 * duplicates — each run is still in flight when the next event lands — which
 * masks the bug entirely. In production the 11 members reported ~300ms apart
 * over 1.3s, so every run had finished and all 10 executed for real.
 */
async function turnGroupOn(emit: (e: HomeKitEvent) => void) {
  for (const id of MEMBERS) {
    emit({ type: 'characteristic.updated', accessoryId: id, characteristicType: 'power_state', value: true });
    await new Promise((r) => setTimeout(r, 25));
  }
}

async function turnGroupOff(emit: (e: HomeKitEvent) => void) {
  for (const id of MEMBERS) {
    emit({ type: 'characteristic.updated', accessoryId: id, characteristicType: 'power_state', value: false });
    await new Promise((r) => setTimeout(r, 25));
  }
}

afterEach(() => {
  teardownAutomationEngine();
  vi.restoreAllMocks();
});

describe('service-group trigger coalescing', () => {
  it('runs once when the whole group turns on', async () => {
    const { bridge, subscribeToHomeKit, emit } = makeHarness();
    const engine = await initAutomationEngine({
      bridge, subscribeToHomeKit, onNotify: async () => {}, serviceGroupResolver: resolver,
    });
    engine.loadAutomations([groupAutomation()]);

    await turnGroupOn(emit);
    await vi.waitFor(() => expect(bridge.setCharacteristic).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 60));

    // Was 4 (one per member) before the group edge gate.
    expect(bridge.setCharacteristic).toHaveBeenCalledTimes(1);
  });

  it('re-arms after the group goes off, so a later on-cycle fires again', async () => {
    const { bridge, subscribeToHomeKit, emit } = makeHarness();
    const engine = await initAutomationEngine({
      bridge, subscribeToHomeKit, onNotify: async () => {}, serviceGroupResolver: resolver,
    });
    engine.loadAutomations([groupAutomation()]);

    await turnGroupOn(emit);
    await vi.waitFor(() => expect(bridge.setCharacteristic).toHaveBeenCalledTimes(1));

    await turnGroupOff(emit);
    await turnGroupOn(emit);

    await vi.waitFor(() => expect(bridge.setCharacteristic).toHaveBeenCalledTimes(2));
  });

  it('still fires per-accessory triggers for a single bulb inside the group', async () => {
    const { bridge, subscribeToHomeKit, emit } = makeHarness();
    const engine = await initAutomationEngine({
      bridge, subscribeToHomeKit, onNotify: async () => {}, serviceGroupResolver: resolver,
    });
    engine.loadAutomations([singleBulbAutomation()]);

    emit({ type: 'characteristic.updated', accessoryId: 'bulb-2', characteristicType: 'power_state', value: true });

    await vi.waitFor(() => expect(bridge.setCharacteristic).toHaveBeenCalledTimes(1));
  });

  it('a member turning on while the group is already on does not re-fire', async () => {
    const { bridge, subscribeToHomeKit, emit } = makeHarness();
    const engine = await initAutomationEngine({
      bridge, subscribeToHomeKit, onNotify: async () => {}, serviceGroupResolver: resolver,
    });
    engine.loadAutomations([groupAutomation()]);

    emit({ type: 'characteristic.updated', accessoryId: 'bulb-1', characteristicType: 'power_state', value: true });
    await vi.waitFor(() => expect(bridge.setCharacteristic).toHaveBeenCalledTimes(1));

    emit({ type: 'characteristic.updated', accessoryId: 'bulb-3', characteristicType: 'power_state', value: true });
    await new Promise((r) => setTimeout(r, 60));

    expect(bridge.setCharacteristic).toHaveBeenCalledTimes(1);
  });

  it('falls back to time-coalescing when the resolver exposes no membership', async () => {
    const { bridge, subscribeToHomeKit, emit } = makeHarness();
    const engine = await initAutomationEngine({
      bridge,
      subscribeToHomeKit,
      onNotify: async () => {},
      // Older resolver shape — getMembers absent.
      serviceGroupResolver: { getGroupsForAccessory: (id: string) => (MEMBERS.includes(id) ? ['group-1'] : []) },
    });
    engine.loadAutomations([groupAutomation()]);

    await turnGroupOn(emit);
    await vi.waitFor(() => expect(bridge.setCharacteristic).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 60));

    expect(bridge.setCharacteristic).toHaveBeenCalledTimes(1);
  });
});
