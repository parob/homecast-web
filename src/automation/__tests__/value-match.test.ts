/**
 * Characteristic value comparison.
 *
 * Found in production: "Notify Annex Lights" never fired. HomeKit reports a
 * light's power_state as boolean `false`/`true`, while the editor stored the
 * trigger as `to: 1`. The old comparison was `===` then String()-equality, so
 * `true` vs `1` compared "true" vs "1" and never matched — every on/off
 * trigger and every on/off condition was dead, which is the most common
 * automation there is.
 */
import { describe, it, expect } from 'vitest';
import { valuesMatch } from '../state/valueMatch';

describe('valuesMatch — the boolean/number mismatch that broke on-off triggers', () => {
  it.each([
    [true, 1],
    [true, '1'],
    [true, 'true'],
    [1, true],
    ['1', true],
  ])('treats %o as equal to %o (on)', (a, b) => {
    expect(valuesMatch(a, b)).toBe(true);
  });

  it.each([
    [false, 0],
    [false, '0'],
    [false, 'false'],
    [0, false],
    ['0', false],
  ])('treats %o as equal to %o (off)', (a, b) => {
    expect(valuesMatch(a, b)).toBe(true);
  });

  it.each([
    [true, 0],
    [false, 1],
    [true, false],
    [1, 0],
  ])('keeps %o distinct from %o', (a, b) => {
    expect(valuesMatch(a, b)).toBe(false);
  });
});

describe('valuesMatch — everything else still behaves', () => {
  it('matches identical values', () => {
    expect(valuesMatch(50, 50)).toBe(true);
    expect(valuesMatch('heat', 'heat')).toBe(true);
  });

  it('still coerces numeric strings, which the bridge sometimes sends', () => {
    expect(valuesMatch('50', 50)).toBe(true);
    expect(valuesMatch(50, '50')).toBe(true);
  });

  it('does not match different numbers', () => {
    expect(valuesMatch(50, 51)).toBe(false);
  });

  it('does not conflate an unset value with off', () => {
    expect(valuesMatch(undefined, false)).toBe(false);
    expect(valuesMatch(null, 0)).toBe(false);
  });

  it('handles enum-style numeric characteristics', () => {
    // lock_target_state: 0 = unsecured, 1 = secured
    expect(valuesMatch(1, 1)).toBe(true);
    expect(valuesMatch(0, 1)).toBe(false);
  });
});

describe('every comparison of a characteristic value goes through valuesMatch', () => {
  /**
   * The bug existed in five places at once, because each layer had rolled its
   * own `String(a) === String(b)`. That idiom looks harmless and is wrong for
   * every boolean characteristic, so the only durable fix is that nobody
   * writes it again.
   */
  const FILES = [
    'src/automation/engine/TriggerManager.ts',
    'src/automation/engine/ConditionEvaluator.ts',
    'src/automation/expression/ExpressionEval.ts',
    'src/automation/expression/functions.ts',
    'src/automation/state/StateStore.ts',
  ];

  it.each(FILES)('%s does not hand-roll String() equality', async (file) => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(file, 'utf8');

    expect(src).not.toMatch(/String\([^)]*\)\s*===\s*String\(/);
  });

  it.each(FILES)('%s imports the shared comparison', async (file) => {
    const { readFileSync } = await import('node:fs');
    expect(readFileSync(file, 'utf8')).toMatch(/valuesMatch/);
  });
});

describe('the layers that used to disagree now agree', () => {
  /**
   * Same automation expressed three ways — trigger, condition, template — must
   * reach the same verdict against a boolean characteristic. They didn't
   * before: each had its own comparison.
   */
  it('trigger, condition and expression all match boolean true against 1', async () => {
    const { StateStore } = await import('../state/StateStore');
    const { ConditionEvaluator } = await import('../engine/ConditionEvaluator');
    const { ExpressionEngine } = await import('../expression/ExpressionEngine');

    const store = new StateStore();
    store.updateDeviceState('light-1', 'power_state', true);   // HomeKit: boolean

    // Condition stored numerically by the editor
    const conditions = new ConditionEvaluator(store);
    const conditionPasses = conditions.evaluate(
      { operator: 'and', conditions: [{ id: 'c1', type: 'state', accessoryId: 'light-1', characteristicType: 'power_state', value: 1 }] },
      { triggerId: 't', triggerType: 'state', timestamp: Date.now() },
    );

    // Same comparison via a template expression
    const expr = new ExpressionEngine();
    const ctx = ExpressionEngine.buildContext(store, { triggerId: 't', triggerType: 'state', timestamp: Date.now() }, {});
    const templatePasses = expr.evaluateBoolean("is_state('light-1', 'power_state', 1)", ctx);
    const operatorPasses = expr.evaluateBoolean("states('light-1', 'power_state') == 1", ctx);

    expect({ conditionPasses, templatePasses, operatorPasses })
      .toEqual({ conditionPasses: true, templatePasses: true, operatorPasses: true });
  });

  it('manual-override attribution is not fooled by the same mismatch', async () => {
    const { StateStore } = await import('../state/StateStore');
    const store = new StateStore();

    // The engine writes 1; HomeKit echoes back boolean true.
    store.recordWrite('light-1', 'power_state', 1);
    store.updateDeviceState('light-1', 'power_state', true);

    // Must be credited to us, not read as a human reaching for the switch —
    // otherwise "don't fight the human" suppresses our own automations.
    expect(store.wasManuallyChanged('light-1', 'power_state')).toBe(false);
  });
});
