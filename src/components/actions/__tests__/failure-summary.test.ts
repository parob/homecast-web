import { describe, it, expect } from 'vitest';
import { describeFailedWrites } from '../failure-summary';
import type { HomeActionWrite } from '../catalog';

const w = (accessoryId: string, name?: string, characteristicType = 'power_state'): HomeActionWrite => ({
  accessoryId,
  characteristicType,
  reportedCharacteristicType: characteristicType,
  value: true,
  previousValue: false,
  ...(name === undefined ? {} : { name }),
});

describe('describeFailedWrites', () => {
  it('names a single accessory', () => {
    expect(describeFailedWrites([w('a', 'Hall Lamp')])).toBe('Hall Lamp didn’t respond');
  });

  it('joins two with "and", not a comma', () => {
    expect(describeFailedWrites([w('a', 'Hall Lamp'), w('b', 'Porch Light')]))
      .toBe('Hall Lamp and Porch Light didn’t respond');
  });

  it('names the first two and counts the rest', () => {
    const failed = [w('a', 'Hall Lamp'), w('b', 'Porch Light'), w('c', 'Landing'), w('d', 'Study')];
    expect(describeFailedWrites(failed)).toBe('Hall Lamp, Porch Light and 2 more didn’t respond');
  });

  it('counts an unnamed accessory into "and N more" rather than dropping it', () => {
    // Only the power actions populate `name`, so a mixed set is reachable —
    // and a notice that silently under-counts is worse than a vaguer one.
    expect(describeFailedWrites([w('a', 'Hall Lamp'), w('b')]))
      .toBe('Hall Lamp and 1 more didn’t respond');
  });

  it('falls back to the count when nothing carries a name', () => {
    expect(describeFailedWrites([w('a'), w('b')])).toBe('2 accessories didn’t respond');
    expect(describeFailedWrites([w('a')])).toBe('1 accessory didn’t respond');
  });

  it('counts an accessory once even when the step wrote two characteristics to it', () => {
    expect(describeFailedWrites([w('a', 'Hall Lamp'), w('a', 'Hall Lamp', 'brightness')]))
      .toBe('Hall Lamp didn’t respond');
  });

  it('ignores a name that is only whitespace', () => {
    expect(describeFailedWrites([w('a', '   ')])).toBe('1 accessory didn’t respond');
  });
});
