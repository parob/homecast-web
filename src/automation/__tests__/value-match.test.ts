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
