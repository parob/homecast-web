import { describe, it, expect } from 'vitest';
import {
  defaultValueFor, describeValue, getWritableCharacteristics, isHiddenChar, primaryWritableChar,
} from '../characteristics';
import type { HomeKitAccessory, HomeKitCharacteristic } from '@/lib/graphql/types';

function char(partial: Partial<HomeKitCharacteristic> & { characteristicType: string }): HomeKitCharacteristic {
  return { id: `c-${partial.characteristicType}`, isReadable: true, isWritable: true, ...partial };
}

function accessory(chars: HomeKitCharacteristic[]): HomeKitAccessory {
  return {
    id: 'ACC-1', name: 'Test', isReachable: true,
    services: [{ id: 'S-1', name: 'Service', serviceType: 'lightbulb', characteristics: chars }],
  } as HomeKitAccessory;
}

describe('getWritableCharacteristics', () => {
  it('skips read-only and internal metadata characteristics', () => {
    const chars = getWritableCharacteristics(accessory([
      char({ characteristicType: 'power_state' }),
      char({ characteristicType: 'current_temperature', isWritable: false }),
      char({ characteristicType: 'serial_number' }),
      char({ characteristicType: 'eve_history_status' }),
    ]));

    expect(chars.map(c => c.type)).toEqual(['power_state']);
  });

  it('dedupes a type repeated across services', () => {
    const acc = {
      id: 'ACC-1', name: 'Two Gang', isReachable: true,
      services: [
        { id: 'S-1', name: 'Left', serviceType: 'lightbulb', characteristics: [char({ characteristicType: 'power_state' })] },
        { id: 'S-2', name: 'Right', serviceType: 'lightbulb', characteristics: [char({ characteristicType: 'power_state' })] },
      ],
    } as HomeKitAccessory;

    expect(getWritableCharacteristics(acc)).toHaveLength(1);
  });

  it('labels characteristics rather than exposing raw types', () => {
    const [brightness] = getWritableCharacteristics(accessory([
      char({ characteristicType: 'brightness', minValue: 0, maxValue: 100, stepValue: 1 }),
    ]));

    expect(brightness.label).toBe('Brightness');
    expect(brightness.kind).toBe('range');
    expect(brightness.unit).toBe('%');
  });

  it('treats a named on/off characteristic as boolean even without validValues', () => {
    const [power] = getWritableCharacteristics(accessory([char({ characteristicType: 'power_state' })]));

    expect(power.kind).toBe('boolean');
  });

  it('names the values of enumerated characteristics', () => {
    const [mode] = getWritableCharacteristics(accessory([
      char({ characteristicType: 'heating_cooling_target', validValues: [0, 1, 2, 3], minValue: 0, maxValue: 3 }),
    ]));

    expect(mode.kind).toBe('enum');
    expect(mode.options).toEqual([
      { value: 0, label: 'Off' }, { value: 1, label: 'Heat' },
      { value: 2, label: 'Cool' }, { value: 3, label: 'Auto' },
    ]);
  });

  it('keeps a lock as Unlocked/Locked rather than a 0-1 on/off toggle', () => {
    const [lock] = getWritableCharacteristics(accessory([
      char({ characteristicType: 'lock_target_state', validValues: [0, 1] }),
    ]));

    expect(lock.kind).toBe('enum');
    expect(lock.options?.map(o => o.label)).toEqual(['Unlocked', 'Locked']);
  });

  it('falls back to every known value when HomeKit omits validValues', () => {
    const [lock] = getWritableCharacteristics(accessory([char({ characteristicType: 'lock_target_state' })]));

    expect(lock.options).toHaveLength(2);
  });
});

describe('primaryWritableChar', () => {
  it('prefers power over the other writable characteristics', () => {
    const chars = getWritableCharacteristics(accessory([
      char({ characteristicType: 'hue', minValue: 0, maxValue: 360 }),
      char({ characteristicType: 'brightness', minValue: 0, maxValue: 100 }),
      char({ characteristicType: 'power_state' }),
    ]));

    expect(primaryWritableChar(chars)?.type).toBe('power_state');
  });

  it('falls back to the first characteristic when none is a known headline', () => {
    const chars = getWritableCharacteristics(accessory([char({ characteristicType: 'color_temperature', minValue: 50, maxValue: 400 })]));

    expect(primaryWritableChar(chars)?.type).toBe('color_temperature');
  });
});

describe('defaultValueFor', () => {
  it('switches devices on when they join a scene', () => {
    const [power] = getWritableCharacteristics(accessory([char({ characteristicType: 'power_state', value: false })]));

    expect(defaultValueFor(power)).toBe(true);
  });

  it('keeps the level a device is already at', () => {
    const [brightness] = getWritableCharacteristics(accessory([
      char({ characteristicType: 'brightness', value: 40, minValue: 0, maxValue: 100 }),
    ]));

    expect(defaultValueFor(brightness)).toBe(40);
  });

  it('uses full brightness when the device reports nothing useful', () => {
    const [brightness] = getWritableCharacteristics(accessory([
      char({ characteristicType: 'brightness', minValue: 0, maxValue: 100 }),
    ]));

    expect(defaultValueFor(brightness)).toBe(100);
  });

  it('picks a valid option for an enum', () => {
    const [mode] = getWritableCharacteristics(accessory([
      char({ characteristicType: 'heating_cooling_target', validValues: [0, 1, 2, 3], value: 2 }),
    ]));

    expect(defaultValueFor(mode)).toBe(2);
  });
});

describe('describeValue', () => {
  it('reads back enum values by name', () => {
    const [lock] = getWritableCharacteristics(accessory([char({ characteristicType: 'lock_target_state', validValues: [0, 1] })]));

    expect(describeValue(lock, 1)).toBe('Locked');
    expect(describeValue(lock, 0)).toBe('Unlocked');
  });

  it('reads back booleans as On/Off', () => {
    const [power] = getWritableCharacteristics(accessory([char({ characteristicType: 'power_state' })]));

    expect(describeValue(power, true)).toBe('On');
    expect(describeValue(power, false)).toBe('Off');
  });

  it('keeps units on numbers', () => {
    const [brightness] = getWritableCharacteristics(accessory([
      char({ characteristicType: 'brightness', minValue: 0, maxValue: 100 }),
    ]));

    expect(describeValue(brightness, 30)).toBe('30%');
  });
});

describe('isHiddenChar', () => {
  it('hides raw HomeKit UUID types', () => {
    expect(isHiddenChar('0000023A-0000-1000-8000-0026BB765291')).toBe(true);
    expect(isHiddenChar('brightness')).toBe(false);
  });
});
