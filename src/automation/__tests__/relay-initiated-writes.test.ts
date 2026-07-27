/**
 * Automations must fire for changes made from Homecast, not just from Apple Home.
 *
 * Reported from production: a "Kitchen Lights turn on" automation ran when the
 * lights were switched in the Apple Home app, and did nothing when the same
 * group was switched on from the Homecast dashboard.
 *
 * HomeKit does not fire its accessory observer for writes the relay itself
 * initiated, and the observer is the engine's only source of state — so a
 * self-initiated write was invisible to it. The cloud already worked around the
 * same gap for its WS/MQTT subscribers by echoing writes; the engine running
 * beside the relay got nothing.
 */

import { vi, describe, it, expect, afterEach } from 'vitest';
import {
  initAutomationEngine,
  teardownAutomationEngine,
  notifyRelayWrite,
  notifyRelayGroupWrite,
} from '../index';
import type { HomeKitEvent } from '../../native/homekit-bridge';
import type { Automation } from '../types/automation';

const MEMBERS = ['bulb-1', 'bulb-2', 'bulb-3'];

const resolver = {
  getGroupsForAccessory: (id: string) => (MEMBERS.includes(id) ? ['group-1'] : []),
  getMembers: (groupId: string) => (groupId === 'group-1' ? MEMBERS : []),
};

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
  } as Automation;
}

function deviceAutomation(): Automation {
  return {
    ...groupAutomation(),
    id: 'auto-bulb',
    triggers: [
      { id: 't2', type: 'state', accessoryId: 'bulb-2', characteristicType: 'power_state', to: true },
    ],
  } as Automation;
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

async function startEngine(harness: ReturnType<typeof makeHarness>, autos: Automation[]) {
  const engine = await initAutomationEngine({
    bridge: harness.bridge,
    subscribeToHomeKit: harness.subscribeToHomeKit,
    onNotify: async () => {},
    serviceGroupResolver: resolver,
  });
  engine.loadAutomations(autos);
  return engine;
}

afterEach(() => {
  teardownAutomationEngine();
  vi.restoreAllMocks();
});

describe('relay-initiated writes', () => {
  it('fires a group automation when the group is set from Homecast', async () => {
    const h = makeHarness();
    await startEngine(h, [groupAutomation()]);

    // No HomeKit observer event — this is exactly what a self-initiated write
    // looks like to the engine.
    notifyRelayGroupWrite('group-1', 'power_state', true);

    await vi.waitFor(() => expect(h.bridge.setCharacteristic).toHaveBeenCalledTimes(1));
  });

  it('fires a per-accessory automation when that accessory is set from Homecast', async () => {
    const h = makeHarness();
    await startEngine(h, [deviceAutomation()]);

    notifyRelayWrite('bulb-2', 'power_state', true);

    await vi.waitFor(() => expect(h.bridge.setCharacteristic).toHaveBeenCalledTimes(1));
  });

  it('still runs only once for a whole group, not once per member', async () => {
    const h = makeHarness();
    await startEngine(h, [groupAutomation()]);

    notifyRelayGroupWrite('group-1', 'power_state', true);
    await vi.waitFor(() => expect(h.bridge.setCharacteristic).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 60));

    expect(h.bridge.setCharacteristic).toHaveBeenCalledTimes(1);
  });

  it('does not double-fire when HomeKit also reports the change', async () => {
    const h = makeHarness();
    await startEngine(h, [deviceAutomation()]);

    notifyRelayWrite('bulb-2', 'power_state', true);
    // Some accessories do echo their own change; the store already holds the
    // value, so this must not count as a second transition.
    notifyRelayWrite('bulb-2', 'power_state', true);
    await new Promise((r) => setTimeout(r, 60));

    expect(h.bridge.setCharacteristic).toHaveBeenCalledTimes(1);
  });

  it('ignores a write that changes nothing', async () => {
    const h = makeHarness();
    await startEngine(h, [deviceAutomation()]);

    // Device is already on; re-asserting it shouldn't run the automation.
    h.emit({ type: 'characteristic.updated', accessoryId: 'bulb-2', characteristicType: 'power_state', value: true });
    await vi.waitFor(() => expect(h.bridge.setCharacteristic).toHaveBeenCalledTimes(1));

    notifyRelayWrite('bulb-2', 'power_state', true);
    await new Promise((r) => setTimeout(r, 60));

    expect(h.bridge.setCharacteristic).toHaveBeenCalledTimes(1);
  });

  it('is a no-op when no engine is running', () => {
    teardownAutomationEngine();
    expect(() => notifyRelayWrite('bulb-1', 'power_state', true)).not.toThrow();
    expect(() => notifyRelayGroupWrite('group-1', 'power_state', true)).not.toThrow();
  });
});
