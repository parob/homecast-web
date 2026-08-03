/**
 * The catalogue is the list of virtual accessory types a user is offered. Its one job is
 * to stay honest about what the engine can actually run.
 *
 * `HelperDefinition` declares ten types; `HelperManager.register()` handles
 * seven. Offering one of the other three would create a virtual accessory that registers
 * with no value and no behaviour — indistinguishable, from the outside, from one
 * that simply never changes. That is the drift these tests exist to
 * catch, because nothing else in the type system will: the union compiles fine
 * whether or not the switch handles a member.
 */
import { describe, it, expect } from 'vitest';
import { StateStore } from '../state/StateStore';
import { HelperManager } from '../state/HelperManager';
import {
  CREATABLE_VIRTUAL_TYPES, VIRTUAL_TYPES, VIRTUAL_TYPE_LIST,
  defaultVirtualAccessory, validateVirtualAccessory, formatVirtualValue, isCreatableVirtualType,
} from '../virtual-accessories/catalogue';

describe('virtual accessory catalogue', () => {
  it('offers only types the engine gives an initial value to', () => {
    // register() is the contract: a type it doesn't handle leaves the store
    // with no entry, which is what "silently does nothing" looks like.
    for (const type of CREATABLE_VIRTUAL_TYPES) {
      const store = new StateStore();
      const manager = new HelperManager(store, () => {}, () => {});
      manager.register(defaultVirtualAccessory(type, 'x', 'H', 'Test'));

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
      expect(isCreatableVirtualType(type)).toBe(false);
    }
  });

  it('produces a valid accessory for every type with no further configuration', () => {
    for (const type of CREATABLE_VIRTUAL_TYPES) {
      const helper = defaultVirtualAccessory(type, 'x', 'H', 'Test');
      expect(validateVirtualAccessory(helper), `${type} default is not valid`).toBeNull();
    }
  });

  it('describes every creatable type exactly once, in order', () => {
    expect(VIRTUAL_TYPE_LIST.map(i => i.type)).toEqual([...CREATABLE_VIRTUAL_TYPES]);
    for (const info of VIRTUAL_TYPE_LIST) {
      expect(info.label).toBeTruthy();
      expect(info.description).toBeTruthy();
      expect(info.example).toBeTruthy();
      expect(info.icon).toBeTruthy();
    }
    expect(Object.keys(VIRTUAL_TYPES).sort()).toEqual([...CREATABLE_VIRTUAL_TYPES].sort());
  });

  it('gives a mode two distinct options and starts on one of them', () => {
    // One option is not a choice, and zero makes initialValue resolve to '' —
    // a mode that reads as empty until someone edits it.
    const helper = defaultVirtualAccessory('input_select', 'x', 'H', 'Mode');
    if (helper.type !== 'input_select') throw new Error('wrong type');
    expect(helper.options.length).toBeGreaterThanOrEqual(2);
    expect(new Set(helper.options).size).toBe(helper.options.length);
    expect(helper.options).toContain(helper.initialValue);
  });
});

describe('validateVirtualAccessory', () => {
  const named = <T extends Parameters<typeof defaultVirtualAccessory>[0]>(type: T) =>
    defaultVirtualAccessory(type, 'x', 'H', 'Test');

  it('requires a name', () => {
    expect(validateVirtualAccessory({ ...named('input_boolean'), name: '   ' })).toMatch(/name/i);
  });

  it('rejects a mode with fewer than two usable options', () => {
    const h = named('input_select');
    if (h.type !== 'input_select') throw new Error('wrong type');
    expect(validateVirtualAccessory({ ...h, options: ['Only'] })).toMatch(/two options/i);
    expect(validateVirtualAccessory({ ...h, options: ['Home', '  '] })).toMatch(/two options/i);
  });

  it('rejects duplicate options', () => {
    const h = named('input_select');
    if (h.type !== 'input_select') throw new Error('wrong type');
    expect(validateVirtualAccessory({ ...h, options: ['Home', 'Home'] })).toMatch(/unique/i);
  });

  it('rejects a starting value that is not one of the options', () => {
    const h = named('input_select');
    if (h.type !== 'input_select') throw new Error('wrong type');
    expect(validateVirtualAccessory({ ...h, initialValue: 'Nowhere' })).toMatch(/must be one of/i);
  });

  it('rejects an inverted or zero-width number range', () => {
    const h = named('input_number');
    if (h.type !== 'input_number') throw new Error('wrong type');
    expect(validateVirtualAccessory({ ...h, min: 10, max: 5 })).toMatch(/greater than minimum/i);
    expect(validateVirtualAccessory({ ...h, min: 5, max: 5 })).toMatch(/greater than minimum/i);
    expect(validateVirtualAccessory({ ...h, step: 0 })).toMatch(/step/i);
  });

  it('rejects a timer with no duration', () => {
    const h = named('timer');
    if (h.type !== 'timer') throw new Error('wrong type');
    expect(validateVirtualAccessory({ ...h, duration: {} })).toMatch(/how long/i);
    expect(validateVirtualAccessory({ ...h, duration: undefined })).toMatch(/how long/i);
  });

  it('rejects a date-time that is neither a date nor a time', () => {
    const h = named('input_datetime');
    if (h.type !== 'input_datetime') throw new Error('wrong type');
    expect(validateVirtualAccessory({ ...h, hasDate: false, hasTime: false })).toMatch(/date, a time/i);
  });
});

describe('formatVirtualValue', () => {
  it('shows an em dash for a value the engine has not reported', () => {
    const h = defaultVirtualAccessory('input_boolean', 'x', 'H', 'Flag');
    expect(formatVirtualValue(h, undefined)).toBe('—');
    expect(formatVirtualValue(h, null)).toBe('—');
  });

  it('reads booleans as On/Off rather than true/false', () => {
    const h = defaultVirtualAccessory('input_boolean', 'x', 'H', 'Flag');
    expect(formatVirtualValue(h, true)).toBe('On');
    expect(formatVirtualValue(h, false)).toBe('Off');
  });

  it('appends a number unit when it has one', () => {
    const h = defaultVirtualAccessory('input_number', 'x', 'H', 'Temp');
    if (h.type !== 'input_number') throw new Error('wrong type');
    expect(formatVirtualValue({ ...h, unit: '°C' }, 21)).toBe('21 °C');
    expect(formatVirtualValue(h, 21)).toBe('21');
  });

  it('shows a counter at zero as 0, not as unset', () => {
    // `0` is falsy; an emptiness check here would hide a real count.
    const h = defaultVirtualAccessory('counter', 'x', 'H', 'Count');
    expect(formatVirtualValue(h, 0)).toBe('0');
  });
});
