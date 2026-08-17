import { describe, it, expect } from 'vitest';
import { isOn, triState, powerCountDescription } from '../shared/powerState';

describe('isOn', () => {
  it('accepts every encoding a device or the cache can produce', () => {
    // The cache JSON-stringifies, and devices disagree: a switch reports a
    // boolean, an air purifier's `active` reports 1, and either can arrive as a
    // string. All four have to mean the same thing.
    expect(isOn(true)).toBe(true);
    expect(isOn(1)).toBe(true);
    expect(isOn('1')).toBe(true);
    expect(isOn('true')).toBe(true);
  });

  it('treats everything else as off, including the shapes that look on', () => {
    expect(isOn(false)).toBe(false);
    expect(isOn(0)).toBe(false);
    expect(isOn('0')).toBe(false);
    expect(isOn('false')).toBe(false);
    expect(isOn(null)).toBe(false);
    expect(isOn(undefined)).toBe(false);
    // Truthy in JavaScript, not on in a house.
    expect(isOn('yes')).toBe(false);
    expect(isOn(2)).toBe(false);
    expect(isOn({})).toBe(false);
  });
});

describe('triState', () => {
  it('is mixed only when some are on and some are not', () => {
    expect(triState(1, 3)).toBe('mixed');
    expect(triState(2, 3)).toBe('mixed');
    expect(triState(7, 8)).toBe('mixed');
  });

  it('is on only when every one of them is', () => {
    expect(triState(3, 3)).toBe('on');
    expect(triState(1, 1)).toBe('on');
  });

  it('is off when none are', () => {
    expect(triState(0, 3)).toBe('off');
    expect(triState(0, 1)).toBe('off');
  });

  it('calls an empty set off, never mixed', () => {
    // A group whose members have all gone away has nothing to be partly
    // anything about, and a half-filled track there invites a press that would
    // write to nobody.
    expect(triState(0, 0)).toBe('off');
  });

  it('does not go mixed on a count that overshoots its total', () => {
    // Defensive: the two numbers come from one traversal today, but a caller
    // that counted them separately should still land on a sane end.
    expect(triState(4, 3)).toBe('on');
    expect(triState(-1, 3)).toBe('off');
  });
});

describe('powerCountDescription', () => {
  it('reads as a sentence a screen reader can announce', () => {
    expect(powerCountDescription(3, 8)).toBe('3 of 8 on');
    expect(powerCountDescription(0, 2)).toBe('0 of 2 on');
  });
});
