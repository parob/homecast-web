/**
 * Trace capture fidelity: what a completed run's trace actually records.
 *
 * The execution history is only as useful as what the engine writes down.
 * These tests pin the Tier-A capture upgrades: a trigger step with from→to
 * values, per-leaf condition detail (actual vs expected), retry attempts,
 * stop as a recorded step, branch/iteration parentage tags, and stub traces
 * for runs that were blocked before they could start.
 */

import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { AutomationEngine } from '../engine/AutomationEngine';
import type { HomeKitEvent } from '../../native/homekit-bridge';
import type { Action, Automation, Trigger } from '../types/automation';
import type { ExecutionTrace, ConditionEvalDetail } from '../types/execution';

let engine: AutomationEngine;
let bridge: {
  setCharacteristic: ReturnType<typeof vi.fn>;
  setServiceGroup: ReturnType<typeof vi.fn>;
  executeScene: ReturnType<typeof vi.fn>;
};
let traces: ExecutionTrace[];
let emit: (e: HomeKitEvent) => void;

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
  engine = new AutomationEngine({
    bridge,
    onTraceComplete: (t) => { traces.push(t); },
    onNotify: async () => {},
  });
  engine.initialize((handler) => {
    emit = handler;
    return () => {};
  });
});

afterEach(() => {
  engine.teardown();
});

async function waitForTrace(count = 1) {
  await vi.waitFor(() => expect(traces.length).toBeGreaterThanOrEqual(count), { timeout: 2000 });
}

describe('trigger step', () => {
  it('records what fired the run as the first step, with from→to values', async () => {
    engine.loadAutomations([makeAutomation({ triggers: [motionTrigger], actions: [setLight()] })]);

    emit(motionEvent(false));
    emit(motionEvent(true));
    await waitForTrace();

    const first = traces[0].steps[0];
    expect(first.type).toBe('trigger');
    expect(first.nodeId).toBe('t1');
    expect(first.result).toBe('passed');
    expect(first.nodeSummary).toContain('motion_detected');
    expect(first.nodeSummary).toContain('→');
    expect(first.input).toMatchObject({
      accessoryId: 'sensor-1',
      characteristicType: 'motion_detected',
      toValue: true,
    });
  });

  it('records a Manual test trigger step for manual runs', async () => {
    engine.loadAutomations([makeAutomation({ actions: [setLight()] })]);

    await engine.manualTrigger('auto-1');

    const first = traces[0].steps[0];
    expect(first.type).toBe('trigger');
    expect(first.nodeSummary).toBe('Manual test');
  });
});

describe('condition detail', () => {
  it('records per-leaf actual vs expected when conditions fail', async () => {
    engine.loadAutomations([makeAutomation({
      triggers: [motionTrigger],
      conditions: {
        operator: 'and',
        conditions: [
          { id: 'c1', type: 'state', accessoryId: 'door-1', characteristicType: 'contact_state', value: 1 },
        ],
      },
      actions: [setLight()],
    })]);

    // Door state is 0 — the condition must fail and say so.
    emit({ type: 'characteristic.updated', accessoryId: 'door-1', characteristicType: 'contact_state', value: 0 });
    emit(motionEvent(true));
    await waitForTrace();

    expect(traces[0].status).toBe('stopped');
    const conditionStep = traces[0].steps.find(s => s.type === 'condition')!;
    expect(conditionStep.result).toBe('failed');

    const detail = conditionStep.output?.detail as ConditionEvalDetail;
    expect(detail.passed).toBe(false);
    expect(detail.operator).toBe('and');
    const leaf = detail.children![0];
    expect(leaf).toMatchObject({
      passed: false,
      type: 'state',
      accessoryId: 'door-1',
      actual: 0,
      expected: 1,
    });
  });

  it('records a template evaluation error instead of a silent false', async () => {
    engine.loadAutomations([makeAutomation({
      triggers: [motionTrigger],
      conditions: {
        operator: 'and',
        conditions: [{ id: 'c1', type: 'template', expression: '{{ this is not valid !!! }}' }],
      },
      actions: [setLight()],
    })]);

    emit(motionEvent(true));
    await waitForTrace();

    const detail = traces[0].steps.find(s => s.type === 'condition')!.output?.detail as ConditionEvalDetail;
    const leaf = detail.children![0];
    expect(leaf.passed).toBe(false);
    expect(leaf.error).toBeTruthy();
  });
});

describe('retry and continue visibility', () => {
  it('tags retry attempts on their steps and annotates exhaustion', async () => {
    bridge.setCharacteristic.mockRejectedValue(new Error('device offline'));
    engine.loadAutomations([makeAutomation({
      actions: [{ ...setLight(), onError: 'retry', maxRetries: 2, retryDelayMs: 1 }],
    })]);

    await engine.manualTrigger('auto-1');

    const attempts = traces[0].steps.filter(s => s.nodeId === 'a1');
    expect(attempts).toHaveLength(3); // initial + 2 retries
    expect(attempts[0].attempt).toBeUndefined();
    expect(attempts[1].attempt).toBe(2);
    expect(attempts[2].attempt).toBe(3);
    expect(attempts[2].output).toMatchObject({ onError: 'retry', retriesExhausted: true, maxRetries: 2 });
  });

  it('annotates a swallowed failure when onError is continue', async () => {
    bridge.setCharacteristic.mockRejectedValueOnce(new Error('device offline'));
    engine.loadAutomations([makeAutomation({
      actions: [{ ...setLight('a1'), onError: 'continue' }, setLight('a2', false)],
    })]);

    await engine.manualTrigger('auto-1');

    const failed = traces[0].steps.find(s => s.nodeId === 'a1')!;
    expect(failed.result).toBe('error');
    expect(failed.output).toMatchObject({ onError: 'continue', continued: true });
    // The run itself carried on and succeeded.
    expect(traces[0].status).toBe('success');
  });
});

describe('stop and structure', () => {
  it('records the stop action as a step', async () => {
    engine.loadAutomations([makeAutomation({
      actions: [setLight(), { id: 's1', type: 'stop', reason: 'Done early' }],
    })]);

    await engine.manualTrigger('auto-1');

    const stopStep = traces[0].steps.find(s => s.nodeType === 'stop')!;
    expect(stopStep.nodeSummary).toBe('Done early');
    expect(stopStep.result).toBe('executed');
    expect(traces[0].status).toBe('stopped');
    expect(traces[0].error).toBe('Done early');
  });

  it('tags branch children with their container and records tested choices', async () => {
    engine.loadAutomations([makeAutomation({
      actions: [{
        id: 'ch1',
        type: 'choose',
        choices: [
          {
            alias: 'never',
            conditions: { operator: 'and', conditions: [{ id: 'c1', type: 'state', accessoryId: 'x', characteristicType: 'power_state', value: 'nope' }] },
            actions: [setLight('a-never')],
          },
          {
            alias: 'always',
            conditions: { operator: 'and', conditions: [] },
            actions: [setLight('a-always')],
          },
        ],
      }],
    })]);

    await engine.manualTrigger('auto-1');

    const chooseStep = traces[0].steps.find(s => s.nodeId === 'ch1')!;
    expect(chooseStep.output).toMatchObject({ branch: 'always', index: 1 });
    expect(chooseStep.output?.tested).toEqual([
      { index: 0, alias: 'never', passed: false },
      { index: 1, alias: 'always', passed: true },
    ]);

    const child = traces[0].steps.find(s => s.nodeId === 'a-always')!;
    expect(child.parentNodeId).toBe('ch1');
    expect(child.branch).toBe('always');
  });

  it('tags repeat children with their iteration', async () => {
    engine.loadAutomations([makeAutomation({
      actions: [{ id: 'r1', type: 'repeat', mode: 'count', count: 2, sequence: [setLight('inner')] }],
    })]);

    await engine.manualTrigger('auto-1');

    const inner = traces[0].steps.filter(s => s.nodeId === 'inner');
    expect(inner.map(s => s.iteration)).toEqual([0, 1]);
    expect(inner.every(s => s.parentNodeId === 'r1')).toBe(true);
  });

  it('stamps per-step durations', async () => {
    engine.loadAutomations([makeAutomation({ actions: [setLight()] })]);

    await engine.manualTrigger('auto-1');

    for (const step of traces[0].steps) {
      expect(step.durationMs).toBeTypeOf('number');
      expect(step.durationMs!).toBeGreaterThanOrEqual(0);
    }
  });
});

describe('blocked runs', () => {
  it('records a rate-limit stub trace, storm-guarded', async () => {
    engine.loadAutomations([makeAutomation({
      mode: 'parallel',
      triggers: [motionTrigger],
      actions: [setLight()],
    })]);

    // 10/min allowed; everything after that is rate-limited.
    for (let i = 0; i < 14; i++) {
      emit(motionEvent(false));
      emit(motionEvent(true));
      await new Promise(r => setTimeout(r, 1));
    }
    await vi.waitFor(() => expect(traces.some(t => t.blockedReason === 'rate_limit')).toBe(true), { timeout: 2000 });

    const stubs = traces.filter(t => t.blockedReason === 'rate_limit');
    // The storm guard allows at most one stub per 10s window per automation.
    expect(stubs).toHaveLength(1);
    expect(stubs[0].status).toBe('stopped');
    expect(stubs[0].steps[0].type).toBe('trigger');
    expect(stubs[0].steps[1].nodeType).toBe('blocked');
    expect(stubs[0].steps[1].result).toBe('skipped');
  });
});
