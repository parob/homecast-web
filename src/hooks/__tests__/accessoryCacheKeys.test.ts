import { describe, it, expect } from 'vitest';
import { sameAccessoryId, resolveAccessoriesCacheKey } from '../accessoryCacheKeys';

// Regression: an individual light inside a service group, toggled over MQTT,
// did not update the dashboard in real time. The cloud MQTT optimistic echo
// emits a characteristic_update carrying a LOWERCASE homeId/accessoryId (Python
// str(UUID)), but the client cache is keyed by the relay's UPPERCASE homeId and
// matched accessories with a case-sensitive compare — so the write silently
// no-opped and the tile (plus the derived group tile) stayed stale until reload.

describe('sameAccessoryId', () => {
  it('matches the same UUID regardless of case', () => {
    expect(sameAccessoryId('ABC-123', 'abc-123')).toBe(true);
    expect(sameAccessoryId('abc-123', 'ABC-123')).toBe(true);
    expect(sameAccessoryId('ABC-123', 'ABC-123')).toBe(true);
  });

  it('does not match different UUIDs', () => {
    expect(sameAccessoryId('ABC-123', 'def-456')).toBe(false);
  });
});

describe('resolveAccessoriesCacheKey', () => {
  const UPPER = '6E2D...A1B2'.toUpperCase();

  it('finds the UPPERCASE cache key when given a lowercase homeId (MQTT echo case)', () => {
    const existing = new Set([`accessories:${UPPER}`]);
    const key = resolveAccessoriesCacheKey(UPPER.toLowerCase(), k => existing.has(k));
    expect(key).toBe(`accessories:${UPPER}`);
  });

  it('prefers the exact key when it already exists', () => {
    const existing = new Set([`accessories:${UPPER.toLowerCase()}`]);
    const key = resolveAccessoriesCacheKey(UPPER.toLowerCase(), k => existing.has(k));
    expect(key).toBe(`accessories:${UPPER.toLowerCase()}`);
  });

  it('falls back to the direct key when nothing is cached yet', () => {
    const key = resolveAccessoriesCacheKey(UPPER.toLowerCase(), () => false);
    expect(key).toBe(`accessories:${UPPER.toLowerCase()}`);
  });
});
