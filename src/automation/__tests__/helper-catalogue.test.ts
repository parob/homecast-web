/**
 * The catalogue is the list of helper types a user is offered. Its one job is
 * to stay honest about what the engine can actually run.
 *
 * `HelperDefinition` declares ten types; `HelperManager.register()` handles
 * seven. Offering one of the other three would create a helper that registers
 * with no value and no behaviour — indistinguishable, from the outside, from a
 * helper that simply never changes. That is the drift these tests exist to
 * catch, because nothing else in the type system will: the union compiles fine
 * whether or not the switch handles a member.
 */
import { describe, it, expect } from 'vitest';
import { StateStore } from '../state/StateStore';
import { HelperManager } from '../state/HelperManager';
import {
  CREATABLE_HELPER_TYPES, HELPER_TYPES, HELPER_TYPE_LIST,
  defaultHelper, validateHelper, formatHelperValue, isCreatableHelperType,
} from '../helpers/catalogue';

describe('helper catalogue', () => {
  it('offers only types the engine gives an initial value to', () => {
    // register() is the contract: a type it doesn't handle leaves the store
    // with no entry, which is what "silently does nothing" looks like.
    for (const type of CREATABLE_HELPER_TYPES) {
      const store = new StateStore();
      const manager = new HelperManager(store, () => {}, () => {});
      manager.register(defaultHelper(type, 'x', 'H', 'Test'));

      expect(
        store.getHelperState('x'),
        `${type} registered without an initial value — HelperManager.register has no case for it`,
      ).toBeDefined();
    }
  });

  it('excludes the three declared-but-unimplemented types', () => {
    // Named explicitly: if one of these gains an implementation, this test
    // should fail and be updated deliberately, not quietly drift.
    for (const type of ['template_sensor', 'group', 'schedule']) {
      expect(isCreatableHelperType(type)).toBe(false);
    }
  });

  it('produces a valid helper for every type with no further configuration', () => {
    for (const type of CREATABLE_HELPER_TYPES) {
      const helper = defaultHelper(type, 'x', 'H', 'Test');
      expect(validateHelper(helper), `${type} default is not valid`).toBeNull();
    }
  });

  it('describes every creatable type exactly once, in order', () => {
    expect(HELPER_TYPE_LIST.map(i => i.type)).toEqual([...CREATABLE_HELPER_TYPES]);
    for (const info of HELPER_TYPE_LIST) {
      expect(info.label).toBeTruthy();
      expect(info.description).toBeTruthy();
      expect(info.example).toBeTruthy();
      expect(info.icon).toBeTruthy();
    }
    expect(Object.keys(HELPER_TYPES).sort()).toEqual([...CREATABLE_HELPER_TYPES].sort());
  });

  it('gives a mode two distinct options and starts on one of them', () => {
    // One option is not a choice, and zero makes initialValue resolve to '' —
    // a mode that reads as empty until someone edits it.
    const helper = defaultHelper('input_select', 'x', 'H', 'Mode');
    if (helper.type !== 'input_select') throw new Error('wrong type');
    expect(helper.options.length).toBeGreaterThanOrEqual(2);
    expect(new Set(helper.options).size).toBe(helper.options.length);
    expect(helper.options).toContain(helper.initialValue);
  });
});

describe('validateHelper', () => {
  const named = <T extends Parameters<typeof defaultHelper>[0]>(type: T) =>
    defaultHelper(type, 'x', 'H', 'Test');

  it('requires a name', () => {
    expect(validateHelper({ ...named('input_boolean'), name: '   ' })).toMatch(/name/i);
  });

  it('rejects a mode with fewer than two usable options', () => {
    const h = named('input_select');
    if (h.type !== 'input_select') throw new Error('wrong type');
    expect(validateHelper({ ...h, options: ['Only'] })).toMatch(/two options/i);
    expect(validateHelper({ ...h, options: ['Home', '  '] })).toMatch(/two options/i);
  });

  it('rejects duplicate options', () => {
    const h = named('input_select');
    if (h.type !== 'input_select') throw new Error('wrong type');
    expect(validateHelper({ ...h, options: ['Home', 'Home'] })).toMatch(/unique/i);
  });

  it('rejects a starting value that is not one of the options', () => {
    const h = named('input_select');
    if (h.type !== 'input_select') throw new Error('wrong type');
    expect(validateHelper({ ...h, initialValue: 'Nowhere' })).toMatch(/must be one of/i);
  });

  it('rejects an inverted or zero-width number range', () => {
    const h = named('input_number');
    if (h.type !== 'input_number') throw new Error('wrong type');
    expect(validateHelper({ ...h, min: 10, max: 5 })).toMatch(/greater than minimum/i);
    expect(validateHelper({ ...h, min: 5, max: 5 })).toMatch(/greater than minimum/i);
    expect(validateHelper({ ...h, step: 0 })).toMatch(/step/i);
  });

  it('rejects a timer with no duration', () => {
    const h = named('timer');
    if (h.type !== 'timer') throw new Error('wrong type');
    expect(validateHelper({ ...h, duration: {} })).toMatch(/how long/i);
    expect(validateHelper({ ...h, duration: undefined })).toMatch(/how long/i);
  });

  it('rejects a date-time that is neither a date nor a time', () => {
    const h = named('input_datetime');
    if (h.type !== 'input_datetime') throw new Error('wrong type');
    expect(validateHelper({ ...h, hasDate: false, hasTime: false })).toMatch(/date, a time/i);
  });
});

describe('formatHelperValue', () => {
  it('shows an em dash for a value the engine has not reported', () => {
    const h = defaultHelper('input_boolean', 'x', 'H', 'Flag');
    expect(formatHelperValue(h, undefined)).toBe('—');
    expect(formatHelperValue(h, null)).toBe('—');
  });

  it('reads booleans as On/Off rather than true/false', () => {
    const h = defaultHelper('input_boolean', 'x', 'H', 'Flag');
    expect(formatHelperValue(h, true)).toBe('On');
    expect(formatHelperValue(h, false)).toBe('Off');
  });

  it('appends a number helper unit when it has one', () => {
    const h = defaultHelper('input_number', 'x', 'H', 'Temp');
    if (h.type !== 'input_number') throw new Error('wrong type');
    expect(formatHelperValue({ ...h, unit: '°C' }, 21)).toBe('21 °C');
    expect(formatHelperValue(h, 21)).toBe('21');
  });

  it('shows a counter at zero as 0, not as unset', () => {
    // `0` is falsy; an emptiness check here would hide a real count.
    const h = defaultHelper('counter', 'x', 'H', 'Count');
    expect(formatHelperValue(h, 0)).toBe('0');
  });
});
