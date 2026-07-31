// Tests for ConditionEvaluator.evaluateDetailed — the rich result tree the
// trace records so "conditions failed" can say which one and why. evaluate()
// is now derived from it, so ConditionEvaluator.test.ts pins the boolean
// semantics; this file pins the recorded shape.

import { describe, it, expect, beforeEach } from 'vitest';
import { ConditionEvaluator } from './ConditionEvaluator';
import { StateStore } from '../state/StateStore';
import type { ConditionBlock, TriggerData } from '../types/automation';

function makeTrigger(overrides?: Partial<TriggerData>): TriggerData {
  return { triggerId: 't1', triggerType: 'state', timestamp: Date.now(), ...overrides };
}

describe('ConditionEvaluator.evaluateDetailed', () => {
  let stateStore: StateStore;
  let evaluator: ConditionEvaluator;

  beforeEach(() => {
    stateStore = new StateStore();
    evaluator = new ConditionEvaluator(stateStore);
  });

  it('evaluates every child of an OR block instead of short-circuiting', () => {
    stateStore.updateDeviceState('a', 'power_state', 1);
    stateStore.updateDeviceState('b', 'power_state', 0);
    const block: ConditionBlock = {
      operator: 'or',
      conditions: [
        { id: 'c1', type: 'state', accessoryId: 'a', characteristicType: 'power_state', value: 1 },
        { id: 'c2', type: 'state', accessoryId: 'b', characteristicType: 'power_state', value: 1 },
      ],
    };

    const detail = evaluator.evaluateDetailed(block, makeTrigger());

    expect(detail.passed).toBe(true);
    expect(detail.operator).toBe('or');
    // Both leaves recorded, each with its actual value — the first matching
    // would have been enough for the verdict, but not for the trace.
    expect(detail.children).toHaveLength(2);
    expect(detail.children![0]).toMatchObject({ passed: true, actual: 1, expected: 1 });
    expect(detail.children![1]).toMatchObject({ passed: false, actual: 0, expected: 1 });
  });

  it('marks disabled leaves and keeps the pre-existing NOT quirk', () => {
    const notBlock: ConditionBlock = {
      operator: 'not',
      conditions: [
        { id: 'c1', type: 'state', accessoryId: 'a', characteristicType: 'power_state', value: 1, enabled: false },
      ],
    };

    const detail = evaluator.evaluateDetailed(notBlock, makeTrigger());

    expect(detail.children![0]).toMatchObject({ passed: true, disabled: true });
    // Disabled counts as passing, which NOT inverts — behavior preserved
    // exactly from the boolean-only implementation.
    expect(detail.passed).toBe(false);
    expect(evaluator.evaluate(notBlock, makeTrigger())).toBe(false);
  });

  it('records numeric bounds as expected and the reading as actual', () => {
    stateStore.updateDeviceState('a', 'temperature', 18);
    const block: ConditionBlock = {
      operator: 'and',
      conditions: [{ id: 'c1', type: 'numeric_state', accessoryId: 'a', characteristicType: 'temperature', above: 20, below: 25 }],
    };

    const detail = evaluator.evaluateDetailed(block, makeTrigger());
    const leaf = detail.children![0];

    expect(leaf.passed).toBe(false);
    expect(leaf.actual).toBe(18);
    expect(leaf.expected).toEqual({ above: 20, below: 25 });
    expect(leaf.description).toContain('> 20');
    expect(leaf.description).toContain('< 25');
  });

  it('nests block details for nested groups', () => {
    stateStore.updateDeviceState('a', 'power_state', 1);
    const block: ConditionBlock = {
      operator: 'and',
      conditions: [
        {
          operator: 'or',
          conditions: [{ id: 'c1', type: 'state', accessoryId: 'a', characteristicType: 'power_state', value: 1 }],
        },
      ],
    };

    const detail = evaluator.evaluateDetailed(block, makeTrigger());

    expect(detail.children![0].kind).toBe('block');
    expect(detail.children![0].children![0].kind).toBe('leaf');
    expect(detail.passed).toBe(true);
  });

  it('keeps evaluate() and evaluateDetailed().passed in agreement', () => {
    stateStore.updateDeviceState('a', 'power_state', 0);
    const blocks: ConditionBlock[] = [
      { operator: 'and', conditions: [] },
      { operator: 'and', conditions: [{ id: 'c', type: 'state', accessoryId: 'a', characteristicType: 'power_state', value: 1 }] },
      { operator: 'or', conditions: [{ id: 'c', type: 'state', accessoryId: 'a', characteristicType: 'power_state', value: 0 }] },
      { operator: 'not', conditions: [{ id: 'c', type: 'state', accessoryId: 'a', characteristicType: 'power_state', value: 1 }] },
      { operator: 'and', conditions: [{ id: 'c', type: 'trigger', triggerId: 't1' }] },
    ];

    for (const block of blocks) {
      expect(evaluator.evaluate(block, makeTrigger())).toBe(
        evaluator.evaluateDetailed(block, makeTrigger()).passed,
      );
    }
  });
});
