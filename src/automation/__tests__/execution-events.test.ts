/**
 * Live execution event stream: the engine emits started / step /
 * variables_changed / finished synchronously as a run progresses, so the
 * editor can show the run on the canvas while it happens. Emission must never
 * add an await to the action chain — the notify-delivery latency suite pins
 * that separately and must stay green.
 */

import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { AutomationEngine } from '../engine/AutomationEngine';
import type { Action, Automation } from '../types/automation';
import type { ExecutionEvent } from '../types/execution';
import { subscribeExecutionEvents, emitExecutionEvent } from '../live-execution';

let engine: AutomationEngine;
let bridge: {
  setCharacteristic: ReturnType<typeof vi.fn>;
  setServiceGroup: ReturnType<typeof vi.fn>;
  executeScene: ReturnType<typeof vi.fn>;
};
let events: ExecutionEvent[];

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

beforeEach(() => {
  bridge = {
    setCharacteristic: vi.fn(async () => {}),
    setServiceGroup: vi.fn(async () => {}),
    executeScene: vi.fn(async () => {}),
  };
  events = [];
  engine = new AutomationEngine({
    bridge,
    onTraceComplete: () => {},
    onNotify: async () => {},
    onExecutionEvent: (e) => { events.push(e); },
  });
  engine.initialize(() => () => {});
});

afterEach(() => {
  engine.teardown();
});

describe('execution event stream', () => {
  it('emits started → steps → finished, in order, with the automation id', async () => {
    engine.loadAutomations([makeAutomation({ actions: [setLight()] })]);

    await engine.manualTrigger('auto-1');

    expect(events[0].type).toBe('started');
    expect(events[0].automationId).toBe('auto-1');
    expect(events[events.length - 1].type).toBe('finished');
    expect((events[events.length - 1] as any).status).toBe('success');

    const stepEvents = events.filter((e) => e.type === 'step') as Extract<ExecutionEvent, { type: 'step' }>[];
    // Trigger + conditions + action, each begun (running) and ended.
    expect(stepEvents.some((e) => e.step.type === 'trigger')).toBe(true);
    expect(stepEvents.some((e) => e.step.nodeId === 'a1' && e.step.result === 'running')).toBe(true);
    expect(stepEvents.some((e) => e.step.nodeId === 'a1' && e.step.result === 'executed')).toBe(true);

    // Every event carries the same trace id.
    const traceIds = new Set(events.map((e) => e.traceId));
    expect(traceIds.size).toBe(1);
  });

  it('carries triggerData on started so tests are recognizable', async () => {
    engine.loadAutomations([makeAutomation({ actions: [setLight()] })]);

    await engine.manualTrigger('auto-1');

    const started = events[0] as Extract<ExecutionEvent, { type: 'started' }>;
    expect(started.triggerData?.eventType).toBe('manual_trigger');
  });

  it('emits immutable step snapshots — later mutation does not rewrite them', async () => {
    engine.loadAutomations([makeAutomation({ actions: [setLight()] })]);

    await engine.manualTrigger('auto-1');

    const running = events.find(
      (e): e is Extract<ExecutionEvent, { type: 'step' }> => e.type === 'step' && e.step.nodeId === 'a1' && e.step.result === 'running',
    )!;
    // The engine later marked this step executed; the emitted snapshot must
    // still say running or the live view can't replay the run's history.
    expect(running.step.result).toBe('running');
    expect(running.step.finishedAt).toBeUndefined();
  });

  it('throttles variables_changed', async () => {
    vi.useFakeTimers();
    try {
      engine.loadAutomations([makeAutomation({
        actions: [{
          id: 'v1', type: 'variables',
          variables: { a: 1, b: 2, c: 3 },
        }],
      })]);

      const run = engine.manualTrigger('auto-1');
      await vi.runAllTimersAsync();
      await run;

      const varEvents = events.filter((e) => e.type === 'variables_changed') as Extract<ExecutionEvent, { type: 'variables_changed' }>[];
      // Three assignments, one trailing emission with the merged result.
      expect(varEvents).toHaveLength(1);
      expect(varEvents[0].variables).toMatchObject({ a: 1, b: 2, c: 3 });
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('live-execution pub/sub', () => {
  it('routes events to per-automation subscribers and unsubscribes cleanly', () => {
    const seen: ExecutionEvent[] = [];
    const unsubscribe = subscribeExecutionEvents('auto-x', (e) => seen.push(e));

    emitExecutionEvent({ type: 'started', traceId: 't', automationId: 'auto-x', timestamp: 'now' });
    emitExecutionEvent({ type: 'started', traceId: 't', automationId: 'other', timestamp: 'now' });
    expect(seen).toHaveLength(1);

    unsubscribe();
    emitExecutionEvent({ type: 'started', traceId: 't', automationId: 'auto-x', timestamp: 'now' });
    expect(seen).toHaveLength(1);
  });

  it('a throwing listener does not break emission for others', () => {
    const seen: ExecutionEvent[] = [];
    const unsubA = subscribeExecutionEvents('auto-x', () => { throw new Error('boom'); });
    const unsubB = subscribeExecutionEvents('auto-x', (e) => seen.push(e));

    expect(() =>
      emitExecutionEvent({ type: 'started', traceId: 't', automationId: 'auto-x', timestamp: 'now' }),
    ).not.toThrow();
    expect(seen).toHaveLength(1);

    unsubA();
    unsubB();
  });
});
