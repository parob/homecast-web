// No action may report a failure as "[object Object]".
//
// The native bridge rejects with a plain {code, message} object, so every
// `String(e)` in the engine produced that string. The execution history — the
// only place a user can see why an automation failed — showed it for every
// HomeKit error, and the real message was sitting in the discarded object.
//
// describe-error.test.ts pins the helper. This pins the *wiring*: each action
// type is driven through a native-shaped rejection and its recorded error is
// checked. A new action type that reaches for String(e) fails here.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AutomationEngine } from '../engine/AutomationEngine';
import type { HomeKitBridge } from '../engine/ActionExecutor';
import type { Automation, Action } from '../types/automation';
import type { ExecutionTrace } from '../types/execution';

/** Exactly what Swift's sendError puts on the wire. */
const NATIVE_REJECTION = {
  code: 'CHARACTERISTIC_NOT_WRITABLE',
  message: 'Characteristic is not writable',
};

function rejectingBridge(): HomeKitBridge {
  return {
    setCharacteristic: vi.fn().mockRejectedValue(NATIVE_REJECTION),
    setServiceGroup: vi.fn().mockRejectedValue(NATIVE_REJECTION),
    executeScene: vi.fn().mockRejectedValue(NATIVE_REJECTION),
  };
}

/** Every action type that talks to something that can fail. */
const FAILING_ACTIONS: [string, Action][] = [
  ['set_characteristic', { type: 'set_characteristic', id: 'n1', accessoryId: 'bulb-1', characteristicType: 'power_state', value: 1 }],
  ['set_service_group', { type: 'set_service_group', id: 'n1', groupId: 'group-1', characteristicType: 'power_state', value: 1 }],
  ['execute_scene', { type: 'execute_scene', id: 'n1', sceneId: 'scene-1' }],
  ['notify', { type: 'notify', id: 'n1', message: 'hi' }],
];

async function runAndGetTrace(action: Action, onNotify?: () => Promise<never>): Promise<ExecutionTrace> {
  const traces: ExecutionTrace[] = [];
  const automation: Automation = {
    id: 'auto-1', name: 'Failing', enabled: true, mode: 'single',
    triggers: [{ type: 'state', id: 't1', accessoryId: 'sensor-1', characteristicType: 'power_state', to: 1 }],
    conditions: { operator: 'and', conditions: [] },
    actions: [action],
    metadata: { createdAt: '', updatedAt: '', triggerCount: 0 },
  };

  const engine = new AutomationEngine({
    bridge: rejectingBridge(),
    onNotify: onNotify ?? (async () => {}),
    onTraceComplete: (t) => { traces.push(t); },
  });

  let emit: ((e: any) => void) | undefined;
  engine.initialize((h) => { emit = h; return () => {}; });
  engine.loadAutomations([automation]);
  emit!({ type: 'characteristic.updated', accessoryId: 'sensor-1', characteristicType: 'power_state', value: 1 });

  for (let i = 0; i < 30 && traces.length === 0; i++) await Promise.resolve();
  await new Promise((r) => setTimeout(r, 0));
  engine.teardown();

  expect(traces).toHaveLength(1);
  return traces[0];
}

describe('automation errors are readable', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => { vi.restoreAllMocks(); });

  it.each(FAILING_ACTIONS)('%s reports the native message, not [object Object]', async (type, action) => {
    const onNotify = type === 'notify'
      ? async () => { throw NATIVE_REJECTION; }
      : undefined;

    const trace = await runAndGetTrace(action, onNotify as any);
    const step = trace.steps.find((s: any) => s.nodeType === type);

    expect(step?.result).toBe('error');
    expect(step?.error).toBeTruthy();
    expect(step?.error).not.toContain('[object Object]');
    expect(step?.error).toContain('Characteristic is not writable');
    expect(step?.error).toContain('CHARACTERISTIC_NOT_WRITABLE');
  });

  it('puts a readable error on the trace itself, not just the step', async () => {
    const trace = await runAndGetTrace(FAILING_ACTIONS[0][1]);

    expect(trace.status).toBe('error');
    expect(trace.error).toBeTruthy();
    expect(trace.error).not.toContain('[object Object]');
    expect(trace.error).toContain('Characteristic is not writable');
  });

  it('records the failure on the node output too, where expressions read it', async () => {
    const trace = await runAndGetTrace(FAILING_ACTIONS[0][1]);
    const step: any = trace.steps.find((s: any) => s.nodeType === 'set_characteristic');

    // The step's own output is what `{{ nodes.n1.error }}` resolves to.
    expect(step.error).not.toContain('[object Object]');
  });

  it('is honest when something throws a bare string or nothing at all', async () => {
    for (const thrown of ['just a string', null, undefined, {}]) {
      const trace = await runAndGetTrace(
        { type: 'notify', id: 'n1', message: 'hi' },
        (async () => { throw thrown; }) as any,
      );
      const step: any = trace.steps.find((s: any) => s.nodeType === 'notify');

      expect(step.error).toBeTruthy();
      expect(step.error).not.toContain('[object Object]');
      expect(step.error.trim()).not.toBe('');
    }
  });
});

describe('an action that was never finished configuring', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => { vi.restoreAllMocks(); });

  // A "Set Device" node saves with value: undefined when its Value field was
  // never filled in, and JSON.stringify drops the key entirely. The bridge then
  // failed with a native message that said nothing about the real cause — seen
  // in production as a set_service_group action stored with no `value` at all.
  it.each([
    ['set_characteristic', { type: 'set_characteristic', id: 'n1', accessoryId: 'bulb-1', characteristicType: 'power_state' }],
    ['set_service_group', { type: 'set_service_group', id: 'n1', groupId: 'group-1', characteristicType: 'power_state' }],
  ])('%s says which field is missing instead of failing in the bridge', async (type, action) => {
    const trace = await runAndGetTrace(action as any);
    const step: any = trace.steps.find((s: any) => s.nodeType === type);

    expect(step.result).toBe('error');
    expect(step.error).toContain('No value set for "power_state"');
    expect(step.error).not.toContain('[object Object]');
  });

  it('still writes a legitimate falsy value', async () => {
    // 0 means "off" — it must not be mistaken for "not configured".
    const bridge = {
      setCharacteristic: vi.fn().mockResolvedValue(undefined),
      setServiceGroup: vi.fn().mockResolvedValue(undefined),
      executeScene: vi.fn().mockResolvedValue(undefined),
    };
    const traces: ExecutionTrace[] = [];
    const engine = new AutomationEngine({
      bridge, onNotify: async () => {}, onTraceComplete: (t) => { traces.push(t); },
    });

    let emit: ((e: any) => void) | undefined;
    engine.initialize((h) => { emit = h; return () => {}; });
    engine.loadAutomations([{
      id: 'auto-1', name: 'Off', enabled: true, mode: 'single',
      triggers: [{ type: 'state', id: 't1', accessoryId: 'sensor-1', characteristicType: 'power_state', to: 1 }],
      conditions: { operator: 'and', conditions: [] },
      actions: [{ type: 'set_characteristic', id: 'n1', accessoryId: 'bulb-1', characteristicType: 'power_state', value: 0 }],
      metadata: { createdAt: '', updatedAt: '', triggerCount: 0 },
    }]);
    emit!({ type: 'characteristic.updated', accessoryId: 'sensor-1', characteristicType: 'power_state', value: 1 });
    for (let i = 0; i < 30 && traces.length === 0; i++) await Promise.resolve();
    await new Promise((r) => setTimeout(r, 0));
    engine.teardown();

    expect(bridge.setCharacteristic).toHaveBeenCalledWith('bulb-1', 'power_state', 0);
    expect(traces[0].status).toBe('success');
  });
});
