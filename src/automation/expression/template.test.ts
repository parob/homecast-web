// Tests for the shared template test and the numeric read-back of rendered values

import { describe, it, expect } from 'vitest';
import { isTemplate, numberIfRenderedNumeric } from './template';

describe('isTemplate', () => {
  it('is true for any string the engine would resolve', () => {
    expect(isTemplate("{{ nodes['code1'].data.brightness }}")).toBe(true);
    expect(isTemplate('Level {{ trigger.to_value }}%')).toBe(true);
  });

  it('is false for fixed values', () => {
    expect(isTemplate(55)).toBe(false);
    expect(isTemplate(0)).toBe(false);
    expect(isTemplate('55')).toBe(false);
    expect(isTemplate('')).toBe(false);
    expect(isTemplate(undefined)).toBe(false);
    expect(isTemplate(null)).toBe(false);
  });
});

describe('numberIfRenderedNumeric', () => {
  const raw = '{{ nodes.http1.data.body.level }}';

  it('reads numeric text a template produced as a number', () => {
    expect(numberIfRenderedNumeric(raw, '55')).toBe(55);
    expect(numberIfRenderedNumeric(raw, ' 21.5 ')).toBe(21.5);
    expect(numberIfRenderedNumeric(raw, '-3')).toBe(-3);
  });

  it('leaves values that are not numeric text alone', () => {
    expect(numberIfRenderedNumeric(raw, 55)).toBe(55);
    expect(numberIfRenderedNumeric(raw, 'warm')).toBe('warm');
    expect(numberIfRenderedNumeric(raw, '')).toBe('');
    expect(numberIfRenderedNumeric(raw, '0x10')).toBe('0x10');
    expect(numberIfRenderedNumeric(raw, undefined)).toBeUndefined();
  });

  it('never touches a literal string the user typed', () => {
    expect(numberIfRenderedNumeric('55', '55')).toBe('55');
  });
});
