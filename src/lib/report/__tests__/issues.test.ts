// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';

import { relativeAge } from '../issues';

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
