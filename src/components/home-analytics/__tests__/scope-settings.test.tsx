// @vitest-environment jsdom
//
// The session window, kept apart from scope.test.ts so those stay pure.
//
// windowEnd is the whole reason the Analytics cache can hit at all: every view
// used to call Date.now() for itself, so the room and the house asked about
// windows a few seconds apart and no two questions ever matched.

import { describe, it, expect } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useAnalyticsScope } from '../scope';
import { ANALYTICS_TTL_MS } from '@/history/seriesCache';

describe('useAnalyticsScope settings', () => {
  it('opens on a quantised window, so two views ask the same question', () => {
    const { result } = renderHook(() => useAnalyticsScope());
    expect(result.current.settings.windowEnd % ANALYTICS_TTL_MS).toBe(0);
  });

  it('leaves the window alone when only the scope moves', () => {
    // The point of the whole change: drilling from the house into a room must
    // not change the question, or the room refetches what the house just held.
    const { result } = renderHook(() => useAnalyticsScope());
    const before = result.current.settings.windowEnd;
    act(() => result.current.setScope({ level: 'room', room: 'Kitchen' }));
    expect(result.current.settings.windowEnd).toBe(before);
  });

  it('re-mints the window when the range changes', () => {
    // A new range is a new question; it should be asked about now rather than
    // about whenever the surface happened to open.
    const { result } = renderHook(() => useAnalyticsScope());
    const before = result.current.settings.windowEnd;
    act(() => result.current.setSettings({ rangeMs: 7 * 86_400_000 }));
    expect(result.current.settings.rangeMs).toBe(7 * 86_400_000);
    expect(result.current.settings.windowEnd).toBeGreaterThanOrEqual(before);
    expect(result.current.settings.windowEnd % ANALYTICS_TTL_MS).toBe(0);
  });

  it('keeps an explicit windowEnd — this is what Refresh sends', () => {
    // Refresh passes the exact instant precisely to escape the grid. Re-minting
    // it here would hand back data up to five minutes old.
    const { result } = renderHook(() => useAnalyticsScope());
    const exact = 1_700_000_000_123;
    act(() => result.current.setSettings({ windowEnd: exact }));
    expect(result.current.settings.windowEnd).toBe(exact);
    // Even alongside a range change, an explicit window wins.
    act(() => result.current.setSettings({ rangeMs: 6 * 3_600_000, windowEnd: exact + 1 }));
    expect(result.current.settings.windowEnd).toBe(exact + 1);
  });
});
