/**
 * Manual-override detection — "don't fight the human".
 *
 * Apple Home has no concept of this: automations don't care what you changed
 * by hand, so people resort to encoding override state in a light's brightness
 * value. The engine can do it properly because it knows what it wrote — any
 * change that doesn't match a recent write of ours came from somebody else.
 *
 * This also covers the feedback loop people report constantly: an automation
 * turns a light on, the camera sees the light change, and that re-triggers the
 * automation. Attribution is what breaks the cycle.
 */

import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { StateStore } from '../state/StateStore';
import { AutomationEngine } from '../engine/AutomationEngine';
import type { HomeKitEvent } from '../../native/homekit-bridge';
import type { Automation } from '../types/automation';

let store: StateStore;

beforeEach(() => { store = new StateStore(); });
afterEach(() => { vi.useRealTimers(); });

describe('write attribution', () => {
  it('treats an unheralded change as manual', () => {
    store.updateDeviceState('light-1', 'power_state', true);

    expect(store.wasManuallyChanged('light-1', 'power_state')).toBe(true);
  });

  it('credits a change that matches our own write', () => {
    store.recordWrite('light-1', 'power_state', true);
    store.updateDeviceState('light-1', 'power_state', true);

    expect(store.wasManuallyChanged('light-1', 'power_state')).toBe(false);
  });

  it('treats a different value as manual even right after our write', () => {
    store.recordWrite('light-1', 'brightness', 80);
    store.updateDeviceState('light-1', 'brightness', 20);

    expect(store.wasManuallyChanged('light-1', 'brightness')).toBe(true);
  });

  it('credits a write only once — a later echo is somebody else', () => {
    store.recordWrite('light-1', 'power_state', true);
    store.updateDeviceState('light-1', 'power_state', true);
    store.updateDeviceState('light-1', 'power_state', true);

    expect(store.wasManuallyChanged('light-1', 'power_state')).toBe(true);
  });

  it('stops crediting a write once the attribution window passes', () => {
    vi.useFakeTimers();
    store.recordWrite('light-1', 'power_state', true);

    vi.advanceTimersByTime(11_000);
    store.updateDeviceState('light-1', 'power_state', true);

    expect(store.wasManuallyChanged('light-1', 'power_state')).toBe(true);
  });

  it('compares loosely, since HomeKit values arrive as strings sometimes', () => {
    store.recordWrite('light-1', 'brightness', 50);
    store.updateDeviceState('light-1', 'brightness', '50');

    expect(store.wasManuallyChanged('light-1', 'brightness')).toBe(false);
  });

  it('is undefined before anything has changed', () => {
    expect(store.wasManuallyChanged('light-1', 'power_state')).toBeUndefined();
  });

  it('tracks characteristics independently', () => {
    store.recordWrite('light-1', 'power_state', true);
    store.updateDeviceState('light-1', 'power_state', true);
    store.updateDeviceState('light-1', 'brightness', 30);

    expect(store.wasManuallyChanged('light-1', 'power_state')).toBe(false);
    expect(store.wasManuallyChanged('light-1', 'brightness')).toBe(true);
  });
});

describe('hasRecentManualChange', () => {
  it('reports a recent human change', () => {
    store.updateDeviceState('light-1', 'brightness', 20);

    expect(store.hasRecentManualChange('light-1', 60_000)).toBe(true);
  });

  it('ignores one outside the window', () => {
    vi.useFakeTimers();
    store.updateDeviceState('light-1', 'brightness', 20);

    vi.advanceTimersByTime(120_000);

    expect(store.hasRecentManualChange('light-1', 60_000)).toBe(false);
  });

  it('does not report our own writes as human', () => {
    store.recordWrite('light-1', 'power_state', true);
    store.updateDeviceState('light-1', 'power_state', true);

    expect(store.hasRecentManualChange('light-1', 60_000)).toBe(false);
  });

  it('can be narrowed to one characteristic', () => {
    store.updateDeviceState('light-1', 'brightness', 20);

    expect(store.hasRecentManualChange('light-1', 60_000, 'brightness')).toBe(true);
    expect(store.hasRecentManualChange('light-1', 60_000, 'power_state')).toBe(false);
  });

  it('does not confuse accessories', () => {
    store.updateDeviceState('light-1', 'brightness', 20);

    expect(store.hasRecentManualChange('light-2', 60_000)).toBe(false);
  });

  it('handles accessory ids containing colons', () => {
    store.updateDeviceState('bridge:1:acc:2', 'power_state', true);

    expect(store.hasRecentManualChange('bridge:1:acc:2', 60_000, 'power_state')).toBe(true);
  });

  it('is cleared by clear()', () => {
    store.updateDeviceState('light-1', 'brightness', 20);
    store.clear();

    expect(store.hasRecentManualChange('light-1', 60_000)).toBe(false);
  });
});

describe('end to end through the engine', () => {
  function makeEngine() {
    const bridge = {
      setCharacteristic: vi.fn(async () => {}),
      setServiceGroup: vi.fn(async () => {}),
      executeScene: vi.fn(async () => {}),
    };
    const engine = new AutomationEngine({ bridge, onTraceComplete: () => {}, onNotify: async () => {} });
    let emit: ((e: HomeKitEvent) => void) | undefined;
    engine.initialize((h) => { emit = h; return () => {}; });
    return { engine, bridge, emit: (e: HomeKitEvent) => emit?.(e) };
  }

  const automation = (): Automation => ({
    id: 'a1', name: 'Motion light', homeId: 'home-1', enabled: true, mode: 'single',
    triggers: [{ id: 't1', type: 'state', accessoryId: 'sensor-1', characteristicType: 'motion_detected', to: true }],
    conditions: { operator: 'and', conditions: [] },
    actions: [{ id: 'x1', type: 'set_characteristic', accessoryId: 'light-1', characteristicType: 'power_state', value: true }],
    metadata: { createdAt: '', updatedAt: '', triggerCount: 0 },
  });

  it('does not mark the engine\'s own device write as a manual change', async () => {
    const { engine, bridge, emit } = makeEngine();
    engine.loadAutomations([automation()]);

    emit({ type: 'characteristic.updated', accessoryId: 'sensor-1', characteristicType: 'motion_detected', value: true });
    await vi.waitFor(() => expect(bridge.setCharacteristic).toHaveBeenCalled());

    // The device reports back the value we just set.
    emit({ type: 'characteristic.updated', accessoryId: 'light-1', characteristicType: 'power_state', value: true });

    expect(engine.stateStore.wasManuallyChanged('light-1', 'power_state')).toBe(false);
    engine.teardown();
  });

  it('marks a human flipping the same light as manual', async () => {
    const { engine, bridge, emit } = makeEngine();
    engine.loadAutomations([automation()]);

    emit({ type: 'characteristic.updated', accessoryId: 'sensor-1', characteristicType: 'motion_detected', value: true });
    await vi.waitFor(() => expect(bridge.setCharacteristic).toHaveBeenCalled());
    emit({ type: 'characteristic.updated', accessoryId: 'light-1', characteristicType: 'power_state', value: true });

    // Someone reaches over and switches it off.
    emit({ type: 'characteristic.updated', accessoryId: 'light-1', characteristicType: 'power_state', value: false });

    expect(engine.stateStore.wasManuallyChanged('light-1', 'power_state')).toBe(true);
    expect(engine.stateStore.hasRecentManualChange('light-1', 60_000)).toBe(true);
    engine.teardown();
  });

  it('lets a condition hold off automating a device someone just touched', async () => {
    const { engine, bridge, emit } = makeEngine();
    engine.loadAutomations([{
      ...automation(),
      conditions: {
        operator: 'and',
        conditions: [{ id: 'c1', type: 'template', expression: "manual_override('light-1', 3600) == false" }],
      },
    }]);

    // Human adjusts the light first.
    emit({ type: 'characteristic.updated', accessoryId: 'light-1', characteristicType: 'power_state', value: false });
    emit({ type: 'characteristic.updated', accessoryId: 'sensor-1', characteristicType: 'motion_detected', value: true });
    await new Promise(r => setTimeout(r, 50));

    expect(bridge.setCharacteristic).not.toHaveBeenCalled();
    engine.teardown();
  });
});
