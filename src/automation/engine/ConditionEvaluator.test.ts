// Tests for ConditionEvaluator — AND/OR/NOT condition trees

import { describe, it, expect, beforeEach } from 'vitest';
import { ConditionEvaluator } from './ConditionEvaluator';
import { StateStore } from '../state/StateStore';
import type { ConditionBlock, TriggerData } from '../types/automation';

function makeTrigger(overrides?: Partial<TriggerData>): TriggerData {
  return { triggerId: 't1', triggerType: 'state', timestamp: Date.now(), ...overrides };
}

describe('ConditionEvaluator', () => {
  let stateStore: StateStore;
  let evaluator: ConditionEvaluator;

  beforeEach(() => {
    stateStore = new StateStore();
    evaluator = new ConditionEvaluator(stateStore);
  });

  describe('empty conditions', () => {
    it('returns true for empty condition block', () => {
      const block: ConditionBlock = { operator: 'and', conditions: [] };
      expect(evaluator.evaluate(block, makeTrigger())).toBe(true);
    });
  });

  describe('state conditions', () => {
    it('passes when state matches', () => {
      stateStore.updateDeviceState('acc-1', 'power_state', 1);
      const block: ConditionBlock = {
        operator: 'and',
        conditions: [{ type: 'state', accessoryId: 'acc-1', characteristicType: 'power_state', value: 1 }],
      };
      expect(evaluator.evaluate(block, makeTrigger())).toBe(true);
    });

    it('fails when state does not match', () => {
      stateStore.updateDeviceState('acc-1', 'power_state', 0);
      const block: ConditionBlock = {
        operator: 'and',
        conditions: [{ type: 'state', accessoryId: 'acc-1', characteristicType: 'power_state', value: 1 }],
      };
      expect(evaluator.evaluate(block, makeTrigger())).toBe(false);
    });

    it('handles string/number loose equality', () => {
      stateStore.updateDeviceState('acc-1', 'power_state', '1');
      const block: ConditionBlock = {
        operator: 'and',
        conditions: [{ type: 'state', accessoryId: 'acc-1', characteristicType: 'power_state', value: 1 }],
      };
      expect(evaluator.evaluate(block, makeTrigger())).toBe(true);
    });
  });

  describe('numeric state conditions', () => {
    it('passes when above threshold', () => {
      stateStore.updateDeviceState('acc-1', 'temperature', 30);
      const block: ConditionBlock = {
        operator: 'and',
        conditions: [{ type: 'numeric_state', accessoryId: 'acc-1', characteristicType: 'temperature', above: 25 }],
      };
      expect(evaluator.evaluate(block, makeTrigger())).toBe(true);
    });

    it('fails when below threshold', () => {
      stateStore.updateDeviceState('acc-1', 'temperature', 20);
      const block: ConditionBlock = {
        operator: 'and',
        conditions: [{ type: 'numeric_state', accessoryId: 'acc-1', characteristicType: 'temperature', above: 25 }],
      };
      expect(evaluator.evaluate(block, makeTrigger())).toBe(false);
    });

    it('checks below threshold', () => {
      stateStore.updateDeviceState('acc-1', 'temperature', 15);
      const block: ConditionBlock = {
        operator: 'and',
        conditions: [{ type: 'numeric_state', accessoryId: 'acc-1', characteristicType: 'temperature', below: 20 }],
      };
      expect(evaluator.evaluate(block, makeTrigger())).toBe(true);
    });
  });

  describe('AND operator', () => {
    it('requires all conditions to pass', () => {
      stateStore.updateDeviceState('acc-1', 'power_state', 1);
      stateStore.updateDeviceState('acc-2', 'power_state', 0);
      const block: ConditionBlock = {
        operator: 'and',
        conditions: [
          { type: 'state', accessoryId: 'acc-1', characteristicType: 'power_state', value: 1 },
          { type: 'state', accessoryId: 'acc-2', characteristicType: 'power_state', value: 1 },
        ],
      };
      expect(evaluator.evaluate(block, makeTrigger())).toBe(false);
    });

    it('passes when all conditions match', () => {
      stateStore.updateDeviceState('acc-1', 'power_state', 1);
      stateStore.updateDeviceState('acc-2', 'power_state', 1);
      const block: ConditionBlock = {
        operator: 'and',
        conditions: [
          { type: 'state', accessoryId: 'acc-1', characteristicType: 'power_state', value: 1 },
          { type: 'state', accessoryId: 'acc-2', characteristicType: 'power_state', value: 1 },
        ],
      };
      expect(evaluator.evaluate(block, makeTrigger())).toBe(true);
    });
  });

  describe('OR operator', () => {
    it('passes when any condition matches', () => {
      stateStore.updateDeviceState('acc-1', 'power_state', 1);
      stateStore.updateDeviceState('acc-2', 'power_state', 0);
      const block: ConditionBlock = {
        operator: 'or',
        conditions: [
          { type: 'state', accessoryId: 'acc-1', characteristicType: 'power_state', value: 1 },
          { type: 'state', accessoryId: 'acc-2', characteristicType: 'power_state', value: 1 },
        ],
      };
      expect(evaluator.evaluate(block, makeTrigger())).toBe(true);
    });

    it('fails when no conditions match', () => {
      stateStore.updateDeviceState('acc-1', 'power_state', 0);
      stateStore.updateDeviceState('acc-2', 'power_state', 0);
      const block: ConditionBlock = {
        operator: 'or',
        conditions: [
          { type: 'state', accessoryId: 'acc-1', characteristicType: 'power_state', value: 1 },
          { type: 'state', accessoryId: 'acc-2', characteristicType: 'power_state', value: 1 },
        ],
      };
      expect(evaluator.evaluate(block, makeTrigger())).toBe(false);
    });
  });

  describe('NOT operator', () => {
    it('inverts condition result', () => {
      stateStore.updateDeviceState('acc-1', 'power_state', 0);
      const block: ConditionBlock = {
        operator: 'not',
        conditions: [{ type: 'state', accessoryId: 'acc-1', characteristicType: 'power_state', value: 1 }],
      };
      // NOT(false) = true
      expect(evaluator.evaluate(block, makeTrigger())).toBe(true);
    });
  });

  describe('nested conditions', () => {
    it('evaluates nested AND inside OR', () => {
      stateStore.updateDeviceState('acc-1', 'power_state', 1);
      stateStore.updateDeviceState('acc-2', 'power_state', 0);
      stateStore.updateDeviceState('acc-3', 'power_state', 1);

      const block: ConditionBlock = {
        operator: 'or',
        conditions: [
          // AND branch: acc-1 ON and acc-2 ON — fails (acc-2 is OFF)
          {
            operator: 'and',
            conditions: [
              { type: 'state', accessoryId: 'acc-1', characteristicType: 'power_state', value: 1 },
              { type: 'state', accessoryId: 'acc-2', characteristicType: 'power_state', value: 1 },
            ],
          },
          // Simple: acc-3 ON — passes
          { type: 'state', accessoryId: 'acc-3', characteristicType: 'power_state', value: 1 },
        ],
      };
      // OR(false, true) = true
      expect(evaluator.evaluate(block, makeTrigger())).toBe(true);
    });
  });

  describe('trigger condition', () => {
    it('passes when trigger ID matches', () => {
      const block: ConditionBlock = {
        operator: 'and',
        conditions: [{ type: 'trigger', triggerId: 't1' }],
      };
      expect(evaluator.evaluate(block, makeTrigger({ triggerId: 't1' }))).toBe(true);
    });

    it('fails when trigger ID does not match', () => {
      const block: ConditionBlock = {
        operator: 'and',
        conditions: [{ type: 'trigger', triggerId: 't1' }],
      };
      expect(evaluator.evaluate(block, makeTrigger({ triggerId: 't2' }))).toBe(false);
    });
  });
});
