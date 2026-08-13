// A trigger that stores clean and never fires is the worst failure this
// codebase has: nothing errors, nothing logs, and the thing the automation was
// guarding just doesn't happen. It has now happened twice — once when `on` and
// `power_state` were the same characteristic under two names, and once when the
// cloud MCP surface's camelCase leaked into a stored trigger as
// `relativeHumidity`, which no HomeKit event has ever been called.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { canonicalCharacteristic, SIMPLE_TO_CHAR } from '../characteristic-aliases';

describe('canonicalCharacteristic', () => {
  it('resolves a short alias to the name events carry', () => {
    expect(canonicalCharacteristic('on')).toBe('power_state');
    expect(canonicalCharacteristic('current_temp')).toBe('current_temperature');
  });

  it('leaves an already-canonical name alone', () => {
    expect(canonicalCharacteristic('relative_humidity')).toBe('relative_humidity');
    expect(canonicalCharacteristic('power_state')).toBe('power_state');
    expect(canonicalCharacteristic('virtual_mode')).toBe('virtual_mode');
  });

  it('snake-cases a camelCase name from the cloud MCP surface', () => {
    // The exact spelling that sat in a live trigger watching a humidity sensor
    // that reports `relative_humidity`, so it could never fire.
    expect(canonicalCharacteristic('relativeHumidity')).toBe('relative_humidity');
    expect(canonicalCharacteristic('currentTemperature')).toBe('current_temperature');
    expect(canonicalCharacteristic('virtualMode')).toBe('virtual_mode');
  });

  it('resolves a camelCased alias too, not just a camelCased canonical name', () => {
    expect(canonicalCharacteristic('currentTemp')).toBe('current_temperature');
    expect(canonicalCharacteristic('heatTarget')).toBe('heating_threshold');
  });

  it('passes an unknown name through rather than inventing one', () => {
    expect(canonicalCharacteristic('not_a_characteristic')).toBe('not_a_characteristic');
  });

  it('is idempotent — canonicalising twice is canonicalising once', () => {
    for (const name of [...Object.keys(SIMPLE_TO_CHAR), ...Object.values(SIMPLE_TO_CHAR)]) {
      const once = canonicalCharacteristic(name);
      expect(canonicalCharacteristic(once)).toBe(once);
    }
  });
});

describe('the canonical vocabulary is snake_case', () => {
  // This is what makes snake-casing an unknown name safe: if any characteristic
  // the bridge reports were camelCase, converting would break it.
  it('has no capital in any name SIMPLE_TO_CHAR maps to', () => {
    const camel = Object.values(SIMPLE_TO_CHAR).filter(name => /[A-Z]/.test(name));
    expect(camel).toEqual([]);
  });

  it('has no capital in any key of the Swift mapper', () => {
    const path = join(
      __dirname, '..', '..', '..', '..',
      'app-ios-macos', 'Sources', 'HomeKit', 'CharacteristicMapper.swift',
    );
    let source: string;
    try {
      source = readFileSync(path, 'utf8');
    } catch {
      return; // standalone app-web checkout has no Mac app sources
    }
    const start = source.indexOf('characteristicMap: [String: String] = [');
    const end = source.indexOf(']', source.indexOf('"product_data"'));
    const keys = [...source.slice(start, end).matchAll(/"([a-zA-Z0-9_]+)":/g)].map(m => m[1]);
    expect(keys.length).toBeGreaterThan(100);
    expect(keys.filter(k => /[A-Z]/.test(k))).toEqual([]);
  });
});
