/**
 * End-to-end engine coverage: HomeKit event -> StateStore -> TriggerManager ->
 * conditions -> ActionExecutor -> bridge -> trace.
 *
 * The existing AutomationEngine suite always passes a no-op subscription
 * (`() => () => {}`) and never invokes the handler, so the production path —
 * where a real HomeKit event drives a trigger — was never exercised. Here the
 * test owns the subscription and emits events itself.
 *
 * Also covers the action types with no coverage at all: repeat (4 modes),
 * choose, parallel, stop, set_service_group, toggle_automation, plus engine
 * mode arbitration and the rate limiter.
 */

import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { AutomationEngine } from '../engine/AutomationEngine';
import type { HomeKitEvent } from '../../native/homekit-bridge';
import type { Action, Automation, Trigger } from '../types/automation';
import type { ExecutionTrace } from '../types/execution';

let engine: AutomationEngine;
let bridge: {
  setCharacteristic: ReturnType<typeof vi.fn>;
  setServiceGroup: ReturnType<typeof vi.fn>;
  executeScene: ReturnType<typeof vi.fn>;
};
let traces: ExecutionTrace[];
let notifications: Array<{ message: string; title?: string }>;
let emit: (e: HomeKitEvent) => void;

/** Sandbox that runs code inline — Workers don't exist in the node test env. */
const inlineCodeSandbox = {
  async run(code: string, input: unknown) {
    // eslint-disable-next-line no-new-func
    const fn = new Function('input', code);
    return fn(input);
  },
  terminate() {},
};

function makeAutomation(overrides: Partial<Automation> = {}): Automation {
  return {
    id: 'auto-1',
    name: 'Test automation',
    homeId: 'home-1',
    enabled: true,
    mode: 'single',
    triggers: [],
    conditions: { operator: 'and', conditions: [] },
    actions: [],
    metadata: { createdAt: '', updatedAt: '', triggerCount: 0 },
    ...overrides,
  };
}

const setLight = (id = 'a1', value: unknown = true): Action => ({
  id, type: 'set_characteristic', accessoryId: 'light-1', characteristicType: 'power_state', value,
});

const motionTrigger: Trigger = {
  id: 't1', type: 'state', accessoryId: 'sensor-1', characteristicType: 'motion_detected', to: true,
};

function motionEvent(value: unknown = true): HomeKitEvent {
  return { type: 'characteristic.updated', accessoryId: 'sensor-1', characteristicType: 'motion_detected', value };
}

beforeEach(() => {
  bridge = {
    setCharacteristic: vi.fn(async () => {}),
    setServiceGroup: vi.fn(async () => {}),
    executeScene: vi.fn(async () => {}),
  };
  traces = [];
  notifications = [];
  engine = new AutomationEngine({
    bridge,
    onTraceComplete: (t) => { traces.push(t); },
    onNotify: async (message, title) => { notifications.push({ message, title }); },
    codeSandbox: inlineCodeSandbox,
    serviceGroupResolver: {
      getGroupsForAccessory: (id) => (id === 'sensor-1' ? ['group-1'] : []),
    },
  });
  engine.initialize((handler) => {
    emit = handler;
    return () => {};
  });
});

afterEach(() => {
  engine.teardown();
});

/** Wait for the automation's trace to land rather than guessing at timing. */
async function waitForTrace(count = 1) {
  await vi.waitFor(() => expect(traces.length).toBeGreaterThanOrEqual(count), { timeout: 2000 });
}

describe('HomeKit event drives the full loop', () => {
  it('fires an automation from a real characteristic event', async () => {
    engine.loadAutomations([makeAutomation({ triggers: [motionTrigger], actions: [setLight()] })]);

    emit(motionEvent(true));
    await waitForTrace();

    expect(bridge.setCharacteristic).toHaveBeenCalledWith('light-1', 'power_state', true, 'home-1');
    expect(traces[0].status).toBe('success');
  });

  it('ignores an event that does not match the trigger value', async () => {
    engine.loadAutomations([makeAutomation({ triggers: [motionTrigger], actions: [setLight()] })]);

    emit(motionEvent(false));
    await new Promise(r => setTimeout(r, 50));

    expect(bridge.setCharacteristic).not.toHaveBeenCalled();
  });

  it('does not fire a disabled automation', async () => {
    engine.loadAutomations([makeAutomation({ enabled: false, triggers: [motionTrigger], actions: [setLight()] })]);

    emit(motionEvent(true));
    await new Promise(r => setTimeout(r, 50));

    expect(bridge.setCharacteristic).not.toHaveBeenCalled();
  });

  it('honours a condition that blocks execution', async () => {
    engine.loadAutomations([makeAutomation({
      triggers: [motionTrigger],
      conditions: {
        operator: 'and',
        conditions: [{ id: 'c1', type: 'state', accessoryId: 'light-2', characteristicType: 'power_state', value: true }],
      },
      actions: [setLight()],
    })]);

    emit(motionEvent(true));
    await new Promise(r => setTimeout(r, 50));

    expect(bridge.setCharacteristic).not.toHaveBeenCalled();
  });

  it('routes a service-group trigger via the resolver', async () => {
    engine.loadAutomations([makeAutomation({
      triggers: [{ id: 't1', type: 'state', serviceGroupId: 'group-1', characteristicType: 'motion_detected', to: true }],
      actions: [setLight()],
    })]);

    emit(motionEvent(true));
    await waitForTrace();

    expect(bridge.setCharacteristic).toHaveBeenCalled();
  });

  it('stops firing after the automation is removed', async () => {
    engine.loadAutomations([makeAutomation({ triggers: [motionTrigger], actions: [setLight()] })]);
    engine.removeAutomation('auto-1');

    emit(motionEvent(true));
    await new Promise(r => setTimeout(r, 50));

    expect(bridge.setCharacteristic).not.toHaveBeenCalled();
  });
});

describe('repeat', () => {
  async function runRepeat(action: Action) {
    engine.loadAutomations([makeAutomation({ actions: [action] })]);
    await engine.manualTrigger('auto-1');
  }

  it('count mode runs the sequence N times', async () => {
    await runRepeat({ id: 'r1', type: 'repeat', mode: 'count', count: 3, sequence: [setLight()] });

    expect(bridge.setCharacteristic).toHaveBeenCalledTimes(3);
  });

  it('for_each mode runs once per item and exposes the item', async () => {
    await runRepeat({
      id: 'r1', type: 'repeat', mode: 'for_each',
      forEachItems: ['light-a', 'light-b'],
      sequence: [{ id: 'a1', type: 'set_characteristic', accessoryId: '{{ repeat.item }}', characteristicType: 'power_state', value: true }],
    });

    expect(bridge.setCharacteristic).toHaveBeenCalledTimes(2);
    expect(bridge.setCharacteristic).toHaveBeenCalledWith('light-a', 'power_state', true, 'home-1');
    expect(bridge.setCharacteristic).toHaveBeenCalledWith('light-b', 'power_state', true, 'home-1');
  });

  it('until mode always runs at least once', async () => {
    await runRepeat({
      id: 'r1', type: 'repeat', mode: 'until',
      untilCondition: { operator: 'and', conditions: [] },
      sequence: [setLight()],
    });

    expect(bridge.setCharacteristic).toHaveBeenCalledTimes(1);
  });

  it('while mode does not run when the condition is false at entry', async () => {
    await runRepeat({
      id: 'r1', type: 'repeat', mode: 'while',
      whileCondition: {
        operator: 'and',
        conditions: [{ id: 'c1', type: 'state', accessoryId: 'nope', characteristicType: 'power_state', value: true }],
      },
      sequence: [setLight()],
    });

    expect(bridge.setCharacteristic).not.toHaveBeenCalled();
  });

  it('caps a runaway loop at MAX_LOOP_ITERATIONS', async () => {
    await runRepeat({
      id: 'r1', type: 'repeat', mode: 'count', count: 10_000, sequence: [setLight()],
    });

    expect(bridge.setCharacteristic.mock.calls.length).toBeLessThanOrEqual(1001);
  });
});

describe('branching and flow control', () => {
  it('choose runs the first matching branch', async () => {
    engine.loadAutomations([makeAutomation({
      actions: [{
        id: 'ch1', type: 'choose',
        choices: [{
          conditions: { operator: 'and', conditions: [] },
          actions: [setLight('a1', 'matched')],
        }],
        default: [setLight('a2', 'default')],
      }],
    })]);

    await engine.manualTrigger('auto-1');

    expect(bridge.setCharacteristic).toHaveBeenCalledWith('light-1', 'power_state', 'matched', 'home-1');
  });

  it('choose falls back to the default branch', async () => {
    engine.loadAutomations([makeAutomation({
      actions: [{
        id: 'ch1', type: 'choose',
        choices: [{
          conditions: {
            operator: 'and',
            conditions: [{ id: 'c1', type: 'state', accessoryId: 'nope', characteristicType: 'x', value: true }],
          },
          actions: [setLight('a1', 'matched')],
        }],
        default: [setLight('a2', 'default')],
      }],
    })]);

    await engine.manualTrigger('auto-1');

    expect(bridge.setCharacteristic).toHaveBeenCalledWith('light-1', 'power_state', 'default', 'home-1');
  });

  it('parallel runs every branch', async () => {
    engine.loadAutomations([makeAutomation({
      actions: [{
        id: 'p1', type: 'parallel',
        branches: [[setLight('a1', 'one')], [setLight('a2', 'two')]],
      }],
    })]);

    await engine.manualTrigger('auto-1');

    expect(bridge.setCharacteristic).toHaveBeenCalledWith('light-1', 'power_state', 'one', 'home-1');
    expect(bridge.setCharacteristic).toHaveBeenCalledWith('light-1', 'power_state', 'two', 'home-1');
  });

  it('stop halts the remaining actions', async () => {
    engine.loadAutomations([makeAutomation({
      actions: [
        setLight('a1', 'before'),
        { id: 's1', type: 'stop', reason: 'done' },
        setLight('a2', 'after'),
      ],
    })]);

    await engine.manualTrigger('auto-1');

    expect(bridge.setCharacteristic).toHaveBeenCalledWith('light-1', 'power_state', 'before', 'home-1');
    expect(bridge.setCharacteristic).not.toHaveBeenCalledWith('light-1', 'power_state', 'after');
  });

  it('variables feed later template expressions', async () => {
    engine.loadAutomations([makeAutomation({
      actions: [
        { id: 'v1', type: 'variables', variables: { level: 42 } },
        { id: 'a1', type: 'set_characteristic', accessoryId: 'light-1', characteristicType: 'brightness', value: '{{ variables.level }}' },
      ],
    })]);

    await engine.manualTrigger('auto-1');

    expect(bridge.setCharacteristic).toHaveBeenCalledWith('light-1', 'brightness', 42, 'home-1');
  });
});

describe('device and group actions', () => {
  it('set_service_group reaches the bridge', async () => {
    engine.loadAutomations([makeAutomation({
      actions: [{ id: 'g1', type: 'set_service_group', groupId: 'group-1', characteristicType: 'power_state', value: true, homeId: 'home-1' }],
    })]);

    await engine.manualTrigger('auto-1');

    expect(bridge.setServiceGroup).toHaveBeenCalledWith('group-1', 'power_state', true, 'home-1');
  });

  it('execute_scene reaches the bridge', async () => {
    engine.loadAutomations([makeAutomation({
      actions: [{ id: 's1', type: 'execute_scene', sceneId: 'scene-1', homeId: 'home-1' }],
    })]);

    await engine.manualTrigger('auto-1');

    expect(bridge.executeScene).toHaveBeenCalledWith('scene-1', 'home-1');
  });

  it('notify reaches the notification callback', async () => {
    engine.loadAutomations([makeAutomation({
      actions: [{ id: 'n1', type: 'notify', message: 'Motion detected', title: 'Alert' }],
    })]);

    await engine.manualTrigger('auto-1');

    expect(notifications).toEqual([{ message: 'Motion detected', title: 'Alert' }]);
  });
});

describe('toggle_automation', () => {
  it('disables another automation so it stops firing', async () => {
    engine.loadAutomations([
      makeAutomation({
        id: 'controller', triggers: [],
        actions: [{ id: 'x1', type: 'toggle_automation', automationId: 'target', action: 'disable' }],
      }),
      makeAutomation({ id: 'target', triggers: [motionTrigger], actions: [setLight()] }),
    ]);

    await engine.manualTrigger('controller');
    emit(motionEvent(true));
    await new Promise(r => setTimeout(r, 50));

    expect(bridge.setCharacteristic).not.toHaveBeenCalled();
  });

  it('re-enables a disabled automation', async () => {
    engine.loadAutomations([
      makeAutomation({
        id: 'controller',
        actions: [{ id: 'x1', type: 'toggle_automation', automationId: 'target', action: 'enable' }],
      }),
      makeAutomation({ id: 'target', enabled: false, triggers: [motionTrigger], actions: [setLight()] }),
    ]);

    await engine.manualTrigger('controller');
    emit(motionEvent(true));
    await vi.waitFor(() => expect(bridge.setCharacteristic).toHaveBeenCalled(), { timeout: 2000 });
  });
});

describe('execution modes and limits', () => {
  it('single mode skips a second run while the first is in flight', async () => {
    engine.loadAutomations([makeAutomation({
      mode: 'single',
      triggers: [motionTrigger],
      actions: [{ id: 'd1', type: 'delay', duration: { seconds: 1 } }, setLight()],
    })]);

    emit(motionEvent(true));
    await new Promise(r => setTimeout(r, 20));
    emit(motionEvent(false));
    emit(motionEvent(true));
    await new Promise(r => setTimeout(r, 30));

    expect(engine.isRunning('auto-1')).toBe(true);
    // The delay is still pending, so at most one run can have started. The
    // skipped second trigger records a blocked stub — previously it left no
    // trace at all, indistinguishable from the trigger never firing.
    expect(traces.length).toBe(1);
    expect(traces[0].status).toBe('stopped');
    expect(traces[0].blockedReason).toBe('mode_single');
  });

  it('rate-limits runaway triggering', async () => {
    engine.loadAutomations([makeAutomation({ triggers: [motionTrigger], actions: [setLight()] })]);

    for (let i = 0; i < 25; i++) {
      emit(motionEvent(false));
      emit(motionEvent(true));
    }
    await new Promise(r => setTimeout(r, 100));

    // MAX_EXECUTIONS_PER_MINUTE is 10. Blocked-run stubs don't count against
    // it — they record that runs were skipped, they aren't runs.
    expect(traces.filter(t => !t.blockedReason).length).toBeLessThanOrEqual(10);
  });
});

describe('traces', () => {
  it('records a step per action', async () => {
    engine.loadAutomations([makeAutomation({ actions: [setLight('a1'), setLight('a2', false)] })]);

    await engine.manualTrigger('auto-1');

    expect(traces[0].steps.filter(s => s.type === 'action')).toHaveLength(2);
  });

  it('marks the trace failed when an action throws', async () => {
    bridge.setCharacteristic.mockRejectedValueOnce(new Error('device offline'));
    engine.loadAutomations([makeAutomation({ actions: [setLight()] })]);

    await engine.manualTrigger('auto-1');

    expect(traces[0].status).not.toBe('success');
  });

  it('continues past a failing action when onError is continue', async () => {
    bridge.setCharacteristic.mockRejectedValueOnce(new Error('device offline'));
    engine.loadAutomations([makeAutomation({
      actions: [{ ...setLight('a1'), onError: 'continue' }, setLight('a2', false)],
    })]);

    await engine.manualTrigger('auto-1');

    expect(bridge.setCharacteristic).toHaveBeenCalledTimes(2);
  });
});

describe('boolean characteristics reaching a numeric trigger', () => {
  /**
   * Reproduces "Notify Annex Lights" from production: a service-group trigger
   * stored as `to: 1` by the editor, against lights whose power_state HomeKit
   * reports as a boolean. It never fired.
   */
  const groupTrigger: Trigger = {
    id: 't1', type: 'state', serviceGroupId: 'group-1',
    characteristicType: 'power_state', to: 1,
  };

  function powerEvent(value: unknown): HomeKitEvent {
    return { type: 'characteristic.updated', accessoryId: 'sensor-1', characteristicType: 'power_state', value };
  }

  it('fires when HomeKit reports boolean true against a trigger stored as 1', async () => {
    engine.loadAutomations([makeAutomation({ triggers: [groupTrigger], actions: [setLight()] })]);

    emit(powerEvent(true));
    await waitForTrace();

    expect(bridge.setCharacteristic).toHaveBeenCalled();
  });

  it('does not fire when the light goes off', async () => {
    engine.loadAutomations([makeAutomation({ triggers: [groupTrigger], actions: [setLight()] })]);

    emit(powerEvent(false));
    await new Promise(r => setTimeout(r, 50));

    expect(bridge.setCharacteristic).not.toHaveBeenCalled();
  });

  it('also fires for an individual accessory trigger', async () => {
    engine.loadAutomations([makeAutomation({
      triggers: [{ id: 't1', type: 'state', accessoryId: 'sensor-1', characteristicType: 'power_state', to: 1 }],
      actions: [setLight()],
    })]);

    emit(powerEvent(true));
    await waitForTrace();

    expect(bridge.setCharacteristic).toHaveBeenCalled();
  });

  it('honours a boolean condition against a numerically-stored value', async () => {
    engine.stateStore.updateDeviceState('light-2', 'power_state', true);
    engine.loadAutomations([makeAutomation({
      triggers: [{ id: 't1', type: 'state', accessoryId: 'sensor-1', characteristicType: 'motion_detected', to: true }],
      conditions: {
        operator: 'and',
        conditions: [{ id: 'c1', type: 'state', accessoryId: 'light-2', characteristicType: 'power_state', value: 1 }],
      },
      actions: [setLight()],
    })]);

    emit(motionEvent(true));
    await waitForTrace();

    expect(bridge.setCharacteristic).toHaveBeenCalled();
  });
});
