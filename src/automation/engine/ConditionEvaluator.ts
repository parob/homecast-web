// Homecast Automation Engine - Condition Evaluator
// Recursively evaluates AND/OR/NOT condition trees

import type { StateStore } from '../state/StateStore';
import { valuesMatch } from '../state/valueMatch';
import type {
  Condition,
  ConditionBlock,
  StateCondition,
  NumericStateCondition,
  TimeCondition,
  SunCondition,
  TemplateCondition,
  TriggerCondition,
  TriggerData,
} from '../types/automation';
import { isConditionBlock, durationToMs } from '../types/automation';
import type { ConditionEvalDetail } from '../types/execution';
import { calculateSunTimes } from '../state/SunCalculator';
import { ExpressionEngine } from '../expression/ExpressionEngine';
import { fmtWeekdays } from './trace-summaries';

const BLOCK_DESCRIPTIONS: Record<ConditionBlock['operator'], (n: number) => string> = {
  and: (n) => `All of ${n} condition${n === 1 ? '' : 's'}`,
  or: (n) => `Any of ${n} condition${n === 1 ? '' : 's'}`,
  not: (n) => `None of ${n} condition${n === 1 ? '' : 's'}`,
};

/**
 * Evaluates condition trees against current device/helper state.
 * Supports recursive AND/OR/NOT grouping.
 */
export class ConditionEvaluator {
  private expressionEngine = new ExpressionEngine();
  private latitude = 0;
  private longitude = 0;

  constructor(private stateStore: StateStore) {}

  setLocation(latitude: number, longitude: number): void {
    this.latitude = latitude;
    this.longitude = longitude;
  }

  /**
   * Evaluate a condition block. Returns true if the automation should proceed.
   */
  evaluate(block: ConditionBlock, triggerData: TriggerData, variables?: Record<string, unknown>): boolean {
    return this.evaluateDetailed(block, triggerData, variables).passed;
  }

  /**
   * Evaluate a condition block, recording each node's actual value against
   * what it wanted. This is what the trace stores, so "conditions failed"
   * finally says which one and why.
   *
   * Semantics are identical to the boolean path this replaced — including
   * the pre-existing quirk that a disabled child counts as passing, which
   * inside a NOT block makes the block fail. The one deliberate difference:
   * children are all evaluated (no short-circuit), so every leaf's actual
   * value gets recorded. All leaves are in-memory reads, so this is cheap.
   */
  evaluateDetailed(
    block: ConditionBlock,
    triggerData: TriggerData,
    variables?: Record<string, unknown>,
  ): ConditionEvalDetail {
    const count = block.conditions.length;
    if (count === 0) {
      return { passed: true, kind: 'block', operator: block.operator, description: 'No conditions' };
    }

    const children = block.conditions.map((c) => this.evaluateNodeDetailed(c, triggerData, variables));

    let passed: boolean;
    switch (block.operator) {
      case 'and':
        passed = children.every((c) => c.passed);
        break;
      case 'or':
        passed = children.some((c) => c.passed);
        break;
      case 'not':
        // NOT inverts: true if ALL sub-conditions are false
        passed = !children.some((c) => c.passed);
        break;
      default:
        console.warn(`[ConditionEvaluator] Unknown operator: ${block.operator}`);
        return {
          passed: true, kind: 'block', operator: block.operator, children,
          description: `Unknown operator: ${block.operator}`, error: `Unknown operator: ${block.operator}`,
        };
    }

    return {
      passed,
      kind: 'block',
      operator: block.operator,
      description: BLOCK_DESCRIPTIONS[block.operator](count),
      children,
    };
  }

  private evaluateNodeDetailed(
    node: Condition | ConditionBlock,
    triggerData: TriggerData,
    variables?: Record<string, unknown>,
  ): ConditionEvalDetail {
    // If the node has enabled === false, treat as always passing
    if ('enabled' in node && node.enabled === false) {
      return {
        passed: true,
        kind: isConditionBlock(node) ? 'block' : 'leaf',
        type: isConditionBlock(node) ? undefined : node.type,
        description: 'Disabled — skipped',
        disabled: true,
      };
    }

    if (isConditionBlock(node)) {
      return this.evaluateDetailed(node, triggerData, variables);
    }

    return this.evaluateLeafDetailed(node, triggerData, variables);
  }

  private evaluateLeafDetailed(
    condition: Condition,
    triggerData: TriggerData,
    variables?: Record<string, unknown>,
  ): ConditionEvalDetail {
    switch (condition.type) {
      case 'state':
        return this.evaluateState(condition);
      case 'numeric_state':
        return this.evaluateNumericState(condition);
      case 'time':
        return this.evaluateTime(condition);
      case 'sun':
        return this.evaluateSun(condition);
      case 'template':
        return this.evaluateTemplate(condition, triggerData, variables);
      case 'trigger':
        return this.evaluateTrigger(condition, triggerData);
      default:
        console.warn(`[ConditionEvaluator] Unsupported condition type: ${(condition as Condition).type}`);
        return {
          passed: true, kind: 'leaf', type: (condition as Condition).type,
          description: `Unsupported condition type: ${(condition as Condition).type}`,
        };
    }
  }

  // ============================================================
  // State Condition
  // ============================================================

  private evaluateState(condition: StateCondition): ConditionEvalDetail {
    const currentValue = this.stateStore.getState(
      condition.accessoryId,
      condition.characteristicType,
    );
    return {
      passed: this.valueMatches(currentValue, condition.value),
      kind: 'leaf',
      type: 'state',
      description: `${condition.characteristicType} is ${String(condition.value)}`,
      accessoryId: condition.accessoryId,
      characteristicType: condition.characteristicType,
      actual: currentValue,
      expected: condition.value,
    };
  }

  // ============================================================
  // Numeric State Condition
  // ============================================================

  private evaluateNumericState(condition: NumericStateCondition): ConditionEvalDetail {
    const currentValue = this.stateStore.getState(
      condition.accessoryId,
      condition.characteristicType,
    );
    const numVal = typeof currentValue === 'number' ? currentValue : parseFloat(String(currentValue));

    const bounds: string[] = [];
    if (condition.above !== undefined) bounds.push(`> ${condition.above}`);
    if (condition.below !== undefined) bounds.push(`< ${condition.below}`);

    let passed = true;
    if (isNaN(numVal)) passed = false;
    else if (condition.above !== undefined && numVal <= condition.above) passed = false;
    else if (condition.below !== undefined && numVal >= condition.below) passed = false;

    return {
      passed,
      kind: 'leaf',
      type: 'numeric_state',
      description: `${condition.characteristicType} ${bounds.join(' and ') || 'is numeric'}`,
      accessoryId: condition.accessoryId,
      characteristicType: condition.characteristicType,
      actual: isNaN(numVal) ? currentValue : numVal,
      expected: { above: condition.above, below: condition.below },
    };
  }

  // ============================================================
  // Time Condition
  // ============================================================

  private evaluateTime(condition: TimeCondition): ConditionEvalDetail {
    const now = new Date();
    const currentMinutes = now.getHours() * 60 + now.getMinutes();
    const actualTime = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

    let passed = true;

    // Check weekday filter
    if (condition.weekdays && condition.weekdays.length > 0) {
      if (!condition.weekdays.includes(now.getDay())) passed = false;
    }

    // Check time window
    if (passed && (condition.after || condition.before)) {
      const afterMinutes = condition.after ? this.parseTimeToMinutes(condition.after) : null;
      const beforeMinutes = condition.before ? this.parseTimeToMinutes(condition.before) : null;

      if (afterMinutes !== null && beforeMinutes !== null) {
        if (afterMinutes <= beforeMinutes) {
          // Normal range: e.g., 09:00 to 17:00
          if (currentMinutes < afterMinutes || currentMinutes >= beforeMinutes) passed = false;
        } else {
          // Overnight range: e.g., 22:00 to 06:00
          if (currentMinutes < afterMinutes && currentMinutes >= beforeMinutes) passed = false;
        }
      } else if (afterMinutes !== null) {
        if (currentMinutes < afterMinutes) passed = false;
      } else if (beforeMinutes !== null) {
        if (currentMinutes >= beforeMinutes) passed = false;
      }
    }

    const window = [
      condition.after ? `after ${condition.after}` : null,
      condition.before ? `before ${condition.before}` : null,
    ].filter(Boolean).join(', ');

    return {
      passed,
      kind: 'leaf',
      type: 'time',
      description: `Time ${window || 'any'}${fmtWeekdays(condition.weekdays)}`,
      actual: `${actualTime} (${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][now.getDay()]})`,
      expected: { after: condition.after, before: condition.before, weekdays: condition.weekdays },
    };
  }

  private parseTimeToMinutes(timeStr: string): number {
    const parts = timeStr.split(':');
    const h = parseInt(parts[0], 10);
    const m = parts.length > 1 ? parseInt(parts[1], 10) : 0;
    return h * 60 + m;
  }

  // ============================================================
  // Sun Condition
  // ============================================================

  private evaluateSun(condition: SunCondition): ConditionEvalDetail {
    const now = new Date();
    const times = calculateSunTimes(now, this.latitude, this.longitude);
    const sunrise = times.sunrise.getTime();
    const sunset = times.sunset.getTime();
    const nowMs = now.getTime();

    let passed = true;

    if (condition.after) {
      const eventTime = condition.after === 'sunrise' ? sunrise : sunset;
      const offset = condition.afterOffset ? durationToMs(condition.afterOffset) : 0;
      if (nowMs < eventTime + offset) passed = false;
    }

    if (passed && condition.before) {
      const eventTime = condition.before === 'sunrise' ? sunrise : sunset;
      const offset = condition.beforeOffset ? durationToMs(condition.beforeOffset) : 0;
      if (nowMs >= eventTime + offset) passed = false;
    }

    const parts = [
      condition.after ? `after ${condition.after}` : null,
      condition.before ? `before ${condition.before}` : null,
    ].filter(Boolean).join(', ');

    return {
      passed,
      kind: 'leaf',
      type: 'sun',
      description: `Sun ${parts || 'any'}`,
      actual: { now: now.toISOString(), sunrise: times.sunrise.toISOString(), sunset: times.sunset.toISOString() },
      expected: {
        after: condition.after, afterOffset: condition.afterOffset,
        before: condition.before, beforeOffset: condition.beforeOffset,
      },
    };
  }

  // ============================================================
  // Template Condition
  // ============================================================

  private evaluateTemplate(
    condition: TemplateCondition,
    triggerData: TriggerData,
    variables?: Record<string, unknown>,
  ): ConditionEvalDetail {
    const ctx = ExpressionEngine.buildContext(
      this.stateStore,
      triggerData,
      variables ?? {},
    );
    const base = {
      kind: 'leaf' as const,
      type: 'template',
      description: condition.expression.slice(0, 120),
      expected: true,
    };
    try {
      const result = this.expressionEngine.evaluateBoolean(condition.expression, ctx);
      return { ...base, passed: result, actual: result };
    } catch (e) {
      // Recorded, not swallowed: a broken expression used to be
      // indistinguishable from one that legitimately evaluated false.
      console.warn(`[ConditionEvaluator] Template evaluation error:`, e);
      return { ...base, passed: false, error: e instanceof Error ? e.message : String(e) };
    }
  }

  // ============================================================
  // Trigger Condition
  // ============================================================

  private evaluateTrigger(condition: TriggerCondition, triggerData: TriggerData): ConditionEvalDetail {
    return {
      passed: triggerData.triggerId === condition.triggerId,
      kind: 'leaf',
      type: 'trigger',
      description: `Fired by trigger ${condition.triggerId.slice(0, 8)}`,
      actual: triggerData.triggerId,
      expected: condition.triggerId,
    };
  }

  // ============================================================
  // Utilities
  // ============================================================

  private valueMatches(actual: unknown, expected: unknown): boolean {
    return valuesMatch(actual, expected);
  }
}
