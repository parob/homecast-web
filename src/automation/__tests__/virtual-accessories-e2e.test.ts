/**
 * Helpers: virtual switches, timers, counters and modes.
 *
 * `VirtualAccessoryManager` was fully implemented but never instantiated — zero
 * references outside its own file — and there were no actions to mutate a
 * helper, so even wired up an automation could not toggle one.
 *
 * These tests are written as the scenarios the community builds Homebridge
 * dummy-switch plugins to fake, because Apple Home has no variables, no
 * counters, no modes and no resettable timers.
 */

import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { AutomationEngine } from '../engine/AutomationEngine';
import type { HomeKitEvent } from '../../native/homekit-bridge';
import type { Automation, Action, VirtualAccessoryDefinition } from '../types/automation';

let engine: AutomationEngine;
let bridge: { setCharacteristic: ReturnType<typeof vi.fn>; setServiceGroup: ReturnType<typeof vi.fn>; executeScene: ReturnType<typeof vi.fn> };
let helperWrites: Array<{ accessoryId: string; state: unknown }>;
let emit: (e: HomeKitEvent) => void;

const HELPERS: VirtualAccessoryDefinition[] = [
  { id: 'guest_mode', type: 'input_boolean', name: 'Guest mode', homeId: 'home-1', initialValue: false },
  { id: 'house_mode', type: 'input_select', name: 'House mode', homeId: 'home-1', options: ['Home', 'Away', 'Night', 'Vacation'], initialValue: 'Home' },
  { id: 'door_opens', type: 'counter', name: 'Door opens today', homeId: 'home-1', initial: 0, step: 1 },
  { id: 'brightness_floor', type: 'input_number', name: 'Minimum brightness', homeId: 'home-1', min: 0, max: 100, step: 5, initialValue: 20 },
  { id: 'bathroom_timer', type: 'timer', name: 'Bathroom timer', homeId: 'home-1' },
];

function automation(id: string, actions: Action[], overrides: Partial<Automation> = {}): Automation {
  return {
    id, name: id, homeId: 'home-1', enabled: true, mode: 'single',
    triggers: [], conditions: { operator: 'and', conditions: [] }, actions,
    metadata: { createdAt: '', updatedAt: '', triggerCount: 0 },
    ...overrides,
  };
}

beforeEach(() => {
  bridge = {
    setCharacteristic: vi.fn(async () => {}),
    setServiceGroup: vi.fn(async () => {}),
    executeScene: vi.fn(async () => {}),
  };
  helperWrites = [];
  engine = new AutomationEngine({
    bridge,
    onTraceComplete: () => {},
    onNotify: async () => {},
    onVirtualStateChange: (accessoryId, state) => { helperWrites.push({ accessoryId, state }); },
  });
  engine.initialize((handler) => { emit = handler; return () => {}; });
  engine.loadVirtualAccessories(HELPERS);
});

afterEach(() => engine.teardown());

const state = (id: string) => engine.stateStore.getVirtualState(id);

describe('virtual switch (replaces homebridge-dummy)', () => {
  it('starts at its initial value', () => {
    expect(state('guest_mode')).toBe(false);
  });

  it('is turned on by an automation', async () => {
    engine.loadAutomations([automation('a', [
      { id: 'h1', type: 'virtual', accessoryId: 'guest_mode', operation: 'turn_on' },
    ])]);

    await engine.manualTrigger('a');

    expect(state('guest_mode')).toBe(true);
  });

  it('toggles', async () => {
    engine.loadAutomations([automation('a', [
      { id: 'h1', type: 'virtual', accessoryId: 'guest_mode', operation: 'toggle' },
    ])]);

    await engine.manualTrigger('a');
    expect(state('guest_mode')).toBe(true);
    await engine.manualTrigger('a');
    expect(state('guest_mode')).toBe(false);
  });

  it('gates another automation through a condition', async () => {
    engine.loadAutomations([
      automation('setter', [{ id: 'h1', type: 'virtual', accessoryId: 'guest_mode', operation: 'turn_on' }]),
      automation('gated', [
        { id: 'a1', type: 'set_characteristic', accessoryId: 'blind-1', characteristicType: 'position', value: 100 },
      ], {
        triggers: [{ id: 't1', type: 'state', accessoryId: 'sensor-1', characteristicType: 'motion_detected', to: true }],
        conditions: {
          operator: 'and',
          conditions: [{ id: 'c1', type: 'template', expression: "virtual('guest_mode') == false" }],
        },
      }),
    ]);

    // Guest mode on -> the blind automation must not run.
    await engine.manualTrigger('setter');
    emit({ type: 'characteristic.updated', accessoryId: 'sensor-1', characteristicType: 'motion_detected', value: true });
    await new Promise(r => setTimeout(r, 40));

    expect(bridge.setCharacteristic).not.toHaveBeenCalled();
  });
});

describe('mode state machine (Home / Away / Night / Vacation)', () => {
  it('sets a named mode', async () => {
    engine.loadAutomations([automation('a', [
      { id: 'h1', type: 'virtual', accessoryId: 'house_mode', operation: 'set', value: 'Night' },
    ])]);

    await engine.manualTrigger('a');

    expect(state('house_mode')).toBe('Night');
  });

  it('resolves the mode from a template', async () => {
    engine.loadAutomations([automation('a', [
      { id: 'v1', type: 'variables', variables: { target: 'Vacation' } },
      { id: 'h1', type: 'virtual', accessoryId: 'house_mode', operation: 'set', value: '{{ variables.target }}' },
    ])]);

    await engine.manualTrigger('a');

    expect(state('house_mode')).toBe('Vacation');
  });

  it('drives a choose branch off the current mode', async () => {
    engine.loadAutomations([automation('a', [
      { id: 'h1', type: 'virtual', accessoryId: 'house_mode', operation: 'set', value: 'Away' },
      {
        id: 'ch1', type: 'choose',
        choices: [{
          conditions: { operator: 'and', conditions: [{ id: 'c1', type: 'template', expression: "virtual('house_mode') == 'Away'" }] },
          actions: [{ id: 'a1', type: 'set_characteristic', accessoryId: 'lock-1', characteristicType: 'lock_target_state', value: 1 }],
        }],
      },
    ])]);

    await engine.manualTrigger('a');

    expect(bridge.setCharacteristic).toHaveBeenCalledWith('lock-1', 'lock_target_state', 1, 'home-1');
  });
});

describe('counter (no HomeKit equivalent at all)', () => {
  it('increments on each run', async () => {
    engine.loadAutomations([automation('a', [
      { id: 'h1', type: 'virtual', accessoryId: 'door_opens', operation: 'increment' },
    ])]);

    await engine.manualTrigger('a');
    await engine.manualTrigger('a');
    await engine.manualTrigger('a');

    expect(state('door_opens')).toBe(3);
  });

  it('resets', async () => {
    engine.loadAutomations([
      automation('inc', [{ id: 'h1', type: 'virtual', accessoryId: 'door_opens', operation: 'increment' }]),
      automation('reset', [{ id: 'h2', type: 'virtual', accessoryId: 'door_opens', operation: 'reset' }]),
    ]);

    await engine.manualTrigger('inc');
    await engine.manualTrigger('reset');

    expect(state('door_opens')).toBe(0);
  });

  it('supports "notify only on the third occurrence"', async () => {
    engine.loadAutomations([automation('a', [
      { id: 'h1', type: 'virtual', accessoryId: 'door_opens', operation: 'increment' },
      {
        id: 'if1', type: 'if_then_else',
        condition: { operator: 'and', conditions: [{ id: 'c1', type: 'template', expression: "virtual('door_opens') >= 3" }] },
        then: [{ id: 'a1', type: 'set_characteristic', accessoryId: 'siren-1', characteristicType: 'active', value: true }],
      },
    ])]);

    await engine.manualTrigger('a');
    await engine.manualTrigger('a');
    expect(bridge.setCharacteristic).not.toHaveBeenCalled();

    await engine.manualTrigger('a');
    expect(bridge.setCharacteristic).toHaveBeenCalledWith('siren-1', 'active', true, 'home-1');
  });
});

describe('input_number', () => {
  it('clamps to the configured range', async () => {
    engine.loadAutomations([automation('a', [
      { id: 'h1', type: 'virtual', accessoryId: 'brightness_floor', operation: 'set', value: 500 },
    ])]);

    await engine.manualTrigger('a');

    expect(state('brightness_floor')).toBe(100);
  });

  it('feeds its value into a device write', async () => {
    engine.loadAutomations([automation('a', [
      { id: 'h1', type: 'virtual', accessoryId: 'brightness_floor', operation: 'set', value: 40 },
      { id: 'a1', type: 'set_characteristic', accessoryId: 'light-1', characteristicType: 'brightness', value: "{{ virtual('brightness_floor') }}" },
    ])]);

    await engine.manualTrigger('a');

    expect(bridge.setCharacteristic).toHaveBeenCalledWith('light-1', 'brightness', 40, 'home-1');
  });

  it('increments by the helper step', async () => {
    engine.loadAutomations([automation('a', [
      { id: 'h1', type: 'virtual', accessoryId: 'brightness_floor', operation: 'increment' },
    ])]);

    await engine.manualTrigger('a');

    expect(state('brightness_floor')).toBe(25);
  });
});

describe('timer (resettable, unlike HomeKit "turn off after")', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('goes active while running and fires an event when it finishes', async () => {
    engine.loadAutomations([
      automation('start', [{ id: 'h1', type: 'virtual', accessoryId: 'bathroom_timer', operation: 'start', duration: { minutes: 5 } }]),
      automation('onFinish', [
        { id: 'a1', type: 'set_characteristic', accessoryId: 'light-1', characteristicType: 'power_state', value: false },
      ], { triggers: [{ id: 't1', type: 'event', eventType: 'timer.finished' }] }),
    ]);

    await engine.manualTrigger('start');
    expect(state('bathroom_timer')).toBe('active');

    await vi.advanceTimersByTimeAsync(5 * 60_000 + 100);

    expect(bridge.setCharacteristic).toHaveBeenCalledWith('light-1', 'power_state', false, 'home-1');
  });

  it('restarting resets the countdown rather than letting the original expire', async () => {
    engine.loadAutomations([
      automation('start', [{ id: 'h1', type: 'virtual', accessoryId: 'bathroom_timer', operation: 'start', duration: { minutes: 5 } }]),
      automation('onFinish', [
        { id: 'a1', type: 'set_characteristic', accessoryId: 'light-1', characteristicType: 'power_state', value: false },
      ], { triggers: [{ id: 't1', type: 'event', eventType: 'timer.finished' }] }),
    ]);

    await engine.manualTrigger('start');
    await vi.advanceTimersByTimeAsync(4 * 60_000);

    // Re-triggered before expiry — this is exactly what HomeKit's "turn off
    // after" cannot do, and why homebridge-magic-occupancy exists.
    await engine.manualTrigger('start');
    await vi.advanceTimersByTimeAsync(2 * 60_000);

    expect(bridge.setCharacteristic).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(3 * 60_000 + 100);
    expect(bridge.setCharacteristic).toHaveBeenCalled();
  });

  it('records when the countdown was due, not when the callback ran', async () => {
    // setTimeout has no deadline guarantee — a throttled tab or a Mac under
    // App Nap delivers it late — so a stamped `Date.now()` recorded a finish
    // after the one the countdown itself showed. Fake timers reproduce that
    // exactly: advancing past the due point runs the callback at the later
    // clock reading.
    engine.loadAutomations([
      automation('start', [{ id: 'h1', type: 'virtual', accessoryId: 'bathroom_timer', operation: 'start', duration: { minutes: 5 } }]),
    ]);

    const startedAt = Date.now();
    await engine.manualTrigger('start');
    // Overshoot: the callback lands well past the moment it was due for.
    await vi.advanceTimersByTimeAsync(5 * 60_000 + 30_000);

    const info = engine.virtualManager.getTimerInfo('bathroom_timer');
    expect(info?.state).toBe('idle');
    expect(info?.finishedAt).toBe(startedAt + 5 * 60_000);
  });

  it('cancelling stops it firing', async () => {
    engine.loadAutomations([
      automation('start', [{ id: 'h1', type: 'virtual', accessoryId: 'bathroom_timer', operation: 'start', duration: { minutes: 1 } }]),
      automation('cancel', [{ id: 'h2', type: 'virtual', accessoryId: 'bathroom_timer', operation: 'cancel' }]),
      automation('onFinish', [
        { id: 'a1', type: 'set_characteristic', accessoryId: 'light-1', characteristicType: 'power_state', value: false },
      ], { triggers: [{ id: 't1', type: 'event', eventType: 'timer.finished' }] }),
    ]);

    await engine.manualTrigger('start');
    await engine.manualTrigger('cancel');
    await vi.advanceTimersByTimeAsync(2 * 60_000);

    expect(bridge.setCharacteristic).not.toHaveBeenCalled();
  });
});

describe('persistence', () => {
  it('reports every helper change so it can be stored', async () => {
    engine.loadAutomations([automation('a', [
      { id: 'h1', type: 'virtual', accessoryId: 'door_opens', operation: 'increment' },
    ])]);

    await engine.manualTrigger('a');

    expect(helperWrites).toContainEqual({ accessoryId: 'door_opens', state: 1 });
  });

  it('restores persisted values over the initial ones', () => {
    const restored = new AutomationEngine({ bridge, onTraceComplete: () => {}, onNotify: async () => {} });
    restored.initialize(() => () => {});

    restored.loadVirtualAccessories(HELPERS, { door_opens: 17, house_mode: 'Vacation' });

    expect(restored.stateStore.getVirtualState('door_opens')).toBe(17);
    expect(restored.stateStore.getVirtualState('house_mode')).toBe('Vacation');
    restored.teardown();
  });

  it('does not resume a timer across a restart', () => {
    const restored = new AutomationEngine({ bridge, onTraceComplete: () => {}, onNotify: async () => {} });
    restored.initialize(() => () => {});

    restored.loadVirtualAccessories(HELPERS, { bathroom_timer: 'active' });

    expect(restored.stateStore.getVirtualState('bathroom_timer')).toBe('idle');
    restored.teardown();
  });
});

describe('a timer whose duration comes from the action', () => {
  // `duration` is optional on a timer definition — a Start action can carry it
  // instead. Reading it unguarded threw, and listVirtualAccessories asks for
  // it per timer, so one such helper broke the whole accessory list.
  it('reports its running duration without a configured one', async () => {
    vi.useFakeTimers();
    try {
      engine.loadAutomations([
        automation('start', [{ id: 'h1', type: 'virtual', accessoryId: 'bathroom_timer', operation: 'start', duration: { seconds: 30 } }]),
      ]);

      expect(() => engine.virtualManager.getTimerInfo('bathroom_timer')).not.toThrow();

      await engine.manualTrigger('start');
      const info = engine.virtualManager.getTimerInfo('bathroom_timer');
      expect(info?.state).toBe('active');
      expect(info?.durationMs).toBe(30_000);
    } finally {
      vi.useRealTimers();
    }
  });
});
