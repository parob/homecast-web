// Homecast Automation Engine - Condition Evaluator
// Recursively evaluates AND/OR/NOT condition trees

import type { StateStore } from '../state/StateStore';
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
import { calculateSunTimes } from '../state/SunCalculator';
import { ExpressionEngine } from '../expression/ExpressionEngine';

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
    if (block.conditions.length === 0) return true;

    switch (block.operator) {
      case 'and':
        return block.conditions.every((c) => this.evaluateNode(c, triggerData, variables));
      case 'or':
        return block.conditions.some((c) => this.evaluateNode(c, triggerData, variables));
      case 'not':
        // NOT inverts: true if ALL sub-conditions are false
        return !block.conditions.some((c) => this.evaluateNode(c, triggerData, variables));
      default:
        console.warn(`[ConditionEvaluator] Unknown operator: ${block.operator}`);
        return true;
    }
  }

  private evaluateNode(
    node: Condition | ConditionBlock,
    triggerData: TriggerData,
    variables?: Record<string, unknown>,
  ): boolean {
    // If the node has enabled === false, treat as always passing
    if ('enabled' in node && node.enabled === false) return true;

    if (isConditionBlock(node)) {
      return this.evaluate(node, triggerData, variables);
    }

    return this.evaluateLeaf(node, triggerData, variables);
  }

  private evaluateLeaf(
    condition: Condition,
    triggerData: TriggerData,
    _variables?: Record<string, unknown>,
  ): boolean {
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
        return this.evaluateTemplate(condition, triggerData, _variables);
      case 'trigger':
        return this.evaluateTrigger(condition, triggerData);
      default:
        console.warn(`[ConditionEvaluator] Unsupported condition type: ${(condition as Condition).type}`);
        return true;
    }
  }

  // ============================================================
  // State Condition
  // ============================================================

  private evaluateState(condition: StateCondition): boolean {
    const currentValue = this.stateStore.getState(
      condition.accessoryId,
      condition.characteristicType,
    );
    return this.valueMatches(currentValue, condition.value);
  }

  // ============================================================
  // Numeric State Condition
  // ============================================================

  private evaluateNumericState(condition: NumericStateCondition): boolean {
    const currentValue = this.stateStore.getState(
      condition.accessoryId,
      condition.characteristicType,
    );
    const numVal = typeof currentValue === 'number' ? currentValue : parseFloat(String(currentValue));
    if (isNaN(numVal)) return false;

    if (condition.above !== undefined && numVal <= condition.above) return false;
    if (condition.below !== undefined && numVal >= condition.below) return false;
    return true;
  }

  // ============================================================
  // Time Condition
  // ============================================================

  private evaluateTime(condition: TimeCondition): boolean {
    const now = new Date();

    // Check weekday filter
    if (condition.weekdays && condition.weekdays.length > 0) {
      if (!condition.weekdays.includes(now.getDay())) return false;
    }

    // Check time window
    if (condition.after || condition.before) {
      const currentMinutes = now.getHours() * 60 + now.getMinutes();
      const afterMinutes = condition.after ? this.parseTimeToMinutes(condition.after) : null;
      const beforeMinutes = condition.before ? this.parseTimeToMinutes(condition.before) : null;

      if (afterMinutes !== null && beforeMinutes !== null) {
        if (afterMinutes <= beforeMinutes) {
          // Normal range: e.g., 09:00 to 17:00
          if (currentMinutes < afterMinutes || currentMinutes >= beforeMinutes) return false;
        } else {
          // Overnight range: e.g., 22:00 to 06:00
          if (currentMinutes < afterMinutes && currentMinutes >= beforeMinutes) return false;
        }
      } else if (afterMinutes !== null) {
        if (currentMinutes < afterMinutes) return false;
      } else if (beforeMinutes !== null) {
        if (currentMinutes >= beforeMinutes) return false;
      }
    }

    return true;
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

  private evaluateSun(condition: SunCondition): boolean {
    const now = new Date();
    const times = calculateSunTimes(now, this.latitude, this.longitude);
    const sunrise = times.sunrise.getTime();
    const sunset = times.sunset.getTime();
    const nowMs = now.getTime();

    if (condition.after) {
      const eventTime = condition.after === 'sunrise' ? sunrise : sunset;
      const offset = condition.afterOffset ? durationToMs(condition.afterOffset) : 0;
      if (nowMs < eventTime + offset) return false;
    }

    if (condition.before) {
      const eventTime = condition.before === 'sunrise' ? sunrise : sunset;
      const offset = condition.beforeOffset ? durationToMs(condition.beforeOffset) : 0;
      if (nowMs >= eventTime + offset) return false;
    }

    return true;
  }

  // ============================================================
  // Template Condition
  // ============================================================

  private evaluateTemplate(
    condition: TemplateCondition,
    triggerData: TriggerData,
    variables?: Record<string, unknown>,
  ): boolean {
    const ctx = ExpressionEngine.buildContext(
      this.stateStore,
      triggerData,
      variables ?? {},
    );
    try {
      return this.expressionEngine.evaluateBoolean(condition.expression, ctx);
    } catch (e) {
      console.warn(`[ConditionEvaluator] Template evaluation error:`, e);
      return false;
    }
  }

  // ============================================================
  // Trigger Condition
  // ============================================================

  private evaluateTrigger(condition: TriggerCondition, triggerData: TriggerData): boolean {
    return triggerData.triggerId === condition.triggerId;
  }

  // ============================================================
  // Utilities
  // ============================================================

  private valueMatches(actual: unknown, expected: unknown): boolean {
    if (actual === expected) return true;
    if (String(actual) === String(expected)) return true;
    return false;
  }
}
