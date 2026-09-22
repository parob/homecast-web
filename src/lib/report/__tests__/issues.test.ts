// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';

import { relativeAge, relativeMoment } from '../issues';

describe('relativeAge', () => {
  const now = Date.UTC(2026, 8, 21, 12, 0, 0);
  const ago = (ms: number) => new Date(now - ms).toISOString();

  it('reads as a person would say it', () => {
    expect(relativeAge(ago(0), now)).toBe('today');
    expect(relativeAge(ago(86_400_000), now)).toBe('yesterday');
    expect(relativeAge(ago(3 * 86_400_000), now)).toBe('3d ago');
    expect(relativeAge(ago(45 * 86_400_000), now)).toBe('1mo ago');
    expect(relativeAge(ago(400 * 86_400_000), now)).toBe('1y ago');
  });

  it('is empty for nothing usable', () => {
    expect(relativeAge(null, now)).toBe('');
    expect(relativeAge(undefined, now)).toBe('');
    expect(relativeAge('not a date', now)).toBe('');
  });
});

describe('relativeMoment', () => {
  const now = Date.UTC(2026, 8, 22, 12, 0, 0);
  const ago = (ms: number) => new Date(now - ms).toISOString();

  it('counts a recent comment in minutes and hours, not days', () => {
    expect(relativeMoment(ago(10_000), now)).toBe('just now');
    expect(relativeMoment(ago(11 * 60_000), now)).toBe('11m ago');
    expect(relativeMoment(ago(3 * 3_600_000), now)).toBe('3h ago');
    expect(relativeMoment(ago(23 * 3_600_000), now)).toBe('23h ago');
  });

  it('falls through to the day count past a day', () => {
    expect(relativeMoment(ago(30 * 3_600_000), now)).toBe('yesterday');
    expect(relativeMoment(ago(3 * 86_400_000), now)).toBe('3d ago');
  });

  it('is empty for nothing usable', () => {
    expect(relativeMoment(null, now)).toBe('');
    expect(relativeMoment('not a date', now)).toBe('');
  });
});

describe('the timestamps the reporter actually sends', () => {
  // `2026-09-22 07:00:03+00:00` — a space where ISO 8601 has a T. Date is only
  // required to parse the ISO form, and this app runs in JavaScriptCore.
  const at = '2026-09-22 07:00:03+00:00';
  const now = Date.parse('2026-09-22T07:11:21Z');

  it('reads a space-separated timestamp rather than blanking the age', () => {
    expect(relativeMoment(at, now)).toBe('11m ago');
    expect(relativeAge(at, now)).toBe('today');
  });
});
