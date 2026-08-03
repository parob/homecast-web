/**
 * Bulk writes must reach the automation engine too.
 *
 * `characteristic.set` and `serviceGroup.set` already tell the engine about
 * writes the relay made itself, because HomeKit will not fire its observer for
 * those. `state.set` did not — and that is the path REST (`POST /rest/state`),
 * the MCP `set_state` tool and the Home Assistant integration all take. So a
 * light switched by an AI assistant, a script or HA triggered nothing, while
 * the same light switched from the dashboard worked.
 *
 * Native already resolves the slug keys to UUIDs and expands a service group to
 * the group plus every member, and returns them as `changes`; only successful
 * writes are included. The relay just has to pass them on.
 */
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

const setState = vi.fn();

vi.mock('@/native/homekit-bridge', () => ({
  HomeKit: { onEvent: vi.fn(() => () => {}), setState: (...a: unknown[]) => setState(...a) },
  default: { onEvent: vi.fn(() => () => {}) },
  getNativeBridge: vi.fn(() => null),
  isRelayCapable: () => true,
  isRelayEnabled: () => true,
}));

import { executeHomeKitAction } from '@/relay/local-handler';
import { initAutomationEngine, teardownAutomationEngine } from '@/automation';
import type { Automation } from '@/automation/types/automation';

const bridge = {
  setCharacteristic: vi.fn(async () => {}),
  setServiceGroup: vi.fn(async () => {}),
  executeScene: vi.fn(async () => {}),
};

/** Fires when bulb-1 turns on, and switches light-9 on in response. */
function automation(): Automation {
  return {
    id: 'auto-1', name: 'Bulb on', homeId: 'home-1', enabled: true, mode: 'single',
    triggers: [{ id: 't1', type: 'state', accessoryId: 'bulb-1', characteristicType: 'power_state', to: true }],
    conditions: { operator: 'and', conditions: [] },
    actions: [{ id: 'a1', type: 'set_characteristic', accessoryId: 'light-9', characteristicType: 'power_state', value: true }],
    metadata: { createdAt: '', updatedAt: '', triggerCount: 0 },
  };
}

async function settle() {
  for (let i = 0; i < 20; i++) await Promise.resolve();
  await new Promise((r) => setTimeout(r, 0));
}

beforeEach(async () => {
  vi.clearAllMocks();
  const engine = await initAutomationEngine({
    bridge,
    subscribeToHomeKit: () => () => {},
    onNotify: async () => {},
  });
  engine.loadAutomations([automation()]);
});

afterEach(() => { teardownAutomationEngine(); });

describe('state.set feeds the automation engine', () => {
  it('fires an automation for a bulk write the relay made itself', async () => {
    setState.mockResolvedValue({
      success: true, ok: 1, failed: [],
      changes: [{ accessoryId: 'bulb-1', characteristicType: 'power_state', value: true }],
    });

    await executeHomeKitAction('state.set', { state: { kitchen: { bulb: { on: true } } } });
    await settle();

    expect(bridge.setCharacteristic).toHaveBeenCalledWith('light-9', 'power_state', true, 'home-1');
  });

  it('fires once per accessory when a group write expands to its members', async () => {
    // Native emits the group id and every member; the engine should see each
    // member's state, and the one automation we loaded should run once.
    setState.mockResolvedValue({
      success: true, ok: 1, failed: [],
      changes: [
        { accessoryId: 'group-7', characteristicType: 'power_state', value: true },
        { accessoryId: 'bulb-1', characteristicType: 'power_state', value: true },
        { accessoryId: 'bulb-2', characteristicType: 'power_state', value: true },
      ],
    });

    await executeHomeKitAction('state.set', { state: { kitchen: { lights: { on: true } } } });
    await settle();

    expect(bridge.setCharacteristic).toHaveBeenCalledTimes(1);
  });

  it('does not fire for a write that reported no changes', async () => {
    // Only successful writes come back in `changes`; a failed one must not
    // trigger anything.
    setState.mockResolvedValue({ success: false, ok: 0, failed: ['kitchen.bulb'], changes: [] });

    await executeHomeKitAction('state.set', { state: { kitchen: { bulb: { on: true } } } });
    await settle();

    expect(bridge.setCharacteristic).not.toHaveBeenCalled();
  });

  it('tolerates a native build that returns no changes field', async () => {
    setState.mockResolvedValue({ success: true, ok: 1, failed: [] });

    await expect(
      executeHomeKitAction('state.set', { state: { kitchen: { bulb: { on: true } } } }),
    ).resolves.toBeDefined();
  });
});
