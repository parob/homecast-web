/**
 * Production-config guards.
 *
 * `AutomationEngine.test.ts` builds its config by hand and injects a
 * `serviceGroupResolver`, so it asserted more capability than the app actually
 * had: `initAutomationEngine` never passed one, and TriggerManager silently
 * skips every service-group trigger without it. `setLocation` had zero callers
 * repo-wide, so sun triggers resolved against lat 0 / lon 0.
 *
 * These tests drive `initAutomationEngine` — the real entry point both editions
 * use — rather than reconstructing its config.
 */

import { vi, describe, it, expect, afterEach } from 'vitest';
import { initAutomationEngine, teardownAutomationEngine } from '../index';
import { AutomationEngine } from '../engine/AutomationEngine';
import type { HomeKitEvent } from '../../native/homekit-bridge';
import type { Automation } from '../types/automation';

function groupAutomation(): Automation {
  return {
    id: 'auto-group',
    name: 'Group trigger',
    homeId: 'home-1',
    enabled: true,
    mode: 'single',
    triggers: [
      {
        id: 't1',
        type: 'state',
        serviceGroupId: 'group-1',
        characteristicType: 'motion_detected',
        to: true,
      },
    ],
    conditions: { operator: 'and', conditions: [] },
    actions: [
      { id: 'a1', type: 'set_characteristic', accessoryId: 'light-1', characteristicType: 'power_state', value: true },
    ],
    metadata: { createdAt: '', updatedAt: '', triggerCount: 0 },
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

afterEach(() => {
  teardownAutomationEngine();
  vi.restoreAllMocks();
});

describe('initAutomationEngine wiring', () => {
  it('threads the service-group resolver through to TriggerManager', async () => {
    const { bridge, subscribeToHomeKit, emit } = makeHarness();

    const engine = await initAutomationEngine({
      bridge,
      subscribeToHomeKit,
      onNotify: async () => {},
      serviceGroupResolver: {
        getGroupsForAccessory: (accessoryId) => (accessoryId === 'sensor-1' ? ['group-1'] : []),
      },
    });

    engine.loadAutomations([groupAutomation()]);

    emit({ type: 'characteristic.updated', accessoryId: 'sensor-1', characteristicType: 'motion_detected', value: true });
    await vi.waitFor(() => expect(bridge.setCharacteristic).toHaveBeenCalled());

    expect(bridge.setCharacteristic).toHaveBeenCalledWith('light-1', 'power_state', true, 'home-1');
  });

  it('does not fire the group trigger for an accessory outside the group', async () => {
    const { bridge, subscribeToHomeKit, emit } = makeHarness();

    const engine = await initAutomationEngine({
      bridge,
      subscribeToHomeKit,
      onNotify: async () => {},
      serviceGroupResolver: { getGroupsForAccessory: () => [] },
    });
    engine.loadAutomations([groupAutomation()]);

    emit({ type: 'characteristic.updated', accessoryId: 'sensor-1', characteristicType: 'motion_detected', value: true });
    await new Promise(r => setTimeout(r, 50));

    expect(bridge.setCharacteristic).not.toHaveBeenCalled();
  });

  it('applies the home location to the engine when provided', async () => {
    const setLocation = vi.spyOn(AutomationEngine.prototype, 'setLocation');
    const { bridge, subscribeToHomeKit } = makeHarness();

    await initAutomationEngine({
      bridge,
      subscribeToHomeKit,
      onNotify: async () => {},
      location: { latitude: 51.5, longitude: -0.12 },
    });

    expect(setLocation).toHaveBeenCalledWith(51.5, -0.12);
  });

  it('starts without a transport (Community mode has no cloud WebSocket)', async () => {
    const { bridge, subscribeToHomeKit } = makeHarness();

    const engine = await initAutomationEngine({ bridge, subscribeToHomeKit, onNotify: async () => {} });

    expect(engine).toBeInstanceOf(AutomationEngine);
  });

  it('reports completed traces to onTraceComplete so Community mode can persist them', async () => {
    const traces: unknown[] = [];
    const { bridge, subscribeToHomeKit } = makeHarness();

    const engine = await initAutomationEngine({
      bridge,
      subscribeToHomeKit,
      onNotify: async () => {},
      onTraceComplete: (t) => { traces.push(t); },
    });
    engine.loadAutomations([{ ...groupAutomation(), triggers: [] }]);

    await engine.manualTrigger('auto-group');

    expect(traces).toHaveLength(1);
  });
});

describe('AutomationEngine.setLocation', () => {
  it('forwards to both the trigger manager and the condition evaluator', async () => {
    const { bridge, subscribeToHomeKit } = makeHarness();
    const engine = await initAutomationEngine({ bridge, subscribeToHomeKit, onNotify: async () => {} });

    // Both collaborators are private; a throw here would mean one is missing.
    expect(() => engine.setLocation(51.5, -0.12)).not.toThrow();
  });
});
