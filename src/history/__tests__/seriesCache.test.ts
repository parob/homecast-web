import { describe, it, expect, beforeEach } from 'vitest';
import {
  ANALYTICS_TTL_MS,
  analyticsFetchCount,
  analyticsWindowEnd,
  clearSeriesCache,
  getCachedSeries,
  inflight,
  seriesCacheGeneration,
  seriesCacheKey,
  setCachedSeries,
  subscribeAnalyticsFetching,
  __resetSeriesCacheForTests,
} from '../seriesCache';
import type { HistorySeriesData } from '@/lib/graphql/types';

const series = (accessoryId: string): HistorySeriesData => ({
  accessoryId,
  characteristicType: 'current_temperature',
  kind: 'numeric',
  unit: '°C',
  resolution: 'raw',
  prevValue: 19,
  prevValueText: null,
  points: [{ ts: 1, min: 20, avg: 20, max: 20, last: 20, count: 1 }],
  states: [],
  stateBuckets: [],
}) as unknown as HistorySeriesData;

const KEY = seriesCacheKey('home-1', 'abc', 'current_temperature', 0, 86_400_000, 500);

beforeEach(() => {
  __resetSeriesCacheForTests();
});

describe('analyticsWindowEnd', () => {
  it('holds still across a grid step, so the same question recurs', () => {
    // The whole cache rests on this: the room and the house ask for the same
    // window even though they call Date.now() seconds apart.
    const base = 1_700_000_000_000 - (1_700_000_000_000 % ANALYTICS_TTL_MS);
    expect(analyticsWindowEnd(base)).toBe(base);
    expect(analyticsWindowEnd(base + 1)).toBe(base);
    expect(analyticsWindowEnd(base + ANALYTICS_TTL_MS - 1)).toBe(base);
  });

  it('steps exactly one grid unit, never a partial one', () => {
    const base = 1_700_000_000_000 - (1_700_000_000_000 % ANALYTICS_TTL_MS);
    expect(analyticsWindowEnd(base + ANALYTICS_TTL_MS)).toBe(base + ANALYTICS_TTL_MS);
    expect(analyticsWindowEnd(base + ANALYTICS_TTL_MS) - analyticsWindowEnd(base))
      .toBe(ANALYTICS_TTL_MS);
  });
});

describe('seriesCacheKey', () => {
  it('ignores accessory id case — UUIDs are case-insensitive', () => {
    // The relay, HomeKit and the dashboard cache use UPPERCASE; the cloud
    // bridge resolves lowercase. Both must land on one entry.
    expect(seriesCacheKey('h', 'abc-DEF', 't', 0, 1, 500))
      .toBe(seriesCacheKey('h', 'ABC-def', 't', 0, 1, 500));
  });

  it('separates every other axis', () => {
    const base = seriesCacheKey('h', 'a', 't', 0, 100, 500);
    expect(seriesCacheKey('h2', 'a', 't', 0, 100, 500)).not.toBe(base);
    expect(seriesCacheKey('h', 'a2', 't', 0, 100, 500)).not.toBe(base);
    expect(seriesCacheKey('h', 'a', 't2', 0, 100, 500)).not.toBe(base);
    expect(seriesCacheKey('h', 'a', 't', 1, 100, 500)).not.toBe(base);
    expect(seriesCacheKey('h', 'a', 't', 0, 101, 500)).not.toBe(base);
    // maxPoints picks the rollup tier server-side, so it is part of identity.
    expect(seriesCacheKey('h', 'a', 't', 0, 100, 200)).not.toBe(base);
  });

  it('namespaces a share away from a signed-in view', () => {
    expect(seriesCacheKey('share:hash', 'a', 't', 0, 1, 500))
      .not.toBe(seriesCacheKey('home-1', 'a', 't', 0, 1, 500));
  });
});

describe('the five-minute TTL', () => {
  it('hits inside the window', () => {
    setCachedSeries(KEY, series('abc'), seriesCacheGeneration(), 1000);
    expect(getCachedSeries(KEY, 1000 + ANALYTICS_TTL_MS - 1)?.accessoryId).toBe('abc');
  });

  it('misses on the boundary and after it', () => {
    setCachedSeries(KEY, series('abc'), seriesCacheGeneration(), 1000);
    expect(getCachedSeries(KEY, 1000 + ANALYTICS_TTL_MS)).toBeUndefined();
  });

  it('drops the expired entry rather than re-reading it every time', () => {
    setCachedSeries(KEY, series('abc'), seriesCacheGeneration(), 1000);
    getCachedSeries(KEY, 1000 + ANALYTICS_TTL_MS);
    // Even asked about again at a time it WOULD have been valid for, it is gone.
    expect(getCachedSeries(KEY, 1001)).toBeUndefined();
  });
});

describe('clearSeriesCache', () => {
  it('empties the map', () => {
    setCachedSeries(KEY, series('abc'), seriesCacheGeneration(), 1000);
    clearSeriesCache();
    expect(getCachedSeries(KEY, 1001)).toBeUndefined();
  });

  it('discards a write from a fetch that was already in flight', () => {
    // The reason a generation counter exists at all. Refresh clears the cache
    // while ~700 queries are outstanding; each of those resolves afterwards
    // and would otherwise restore exactly what was just dropped.
    const gen = seriesCacheGeneration();
    clearSeriesCache();
    setCachedSeries(KEY, series('stale'), gen, 1001);
    expect(getCachedSeries(KEY, 1002)).toBeUndefined();
  });

  it('accepts writes started after the clear', () => {
    clearSeriesCache();
    setCachedSeries(KEY, series('fresh'), seriesCacheGeneration(), 1001);
    expect(getCachedSeries(KEY, 1002)?.accessoryId).toBe('fresh');
  });
});

describe('inflight', () => {
  it('collapses concurrent callers into one fetch', async () => {
    let calls = 0;
    const fetcher = () => {
      calls++;
      return Promise.resolve('answer');
    };
    const [a, b] = await Promise.all([inflight('k', fetcher), inflight('k', fetcher)]);
    expect(calls).toBe(1);
    expect(a).toBe('answer');
    expect(b).toBe('answer');
  });

  it('lets the next caller retry after a rejection', async () => {
    let calls = 0;
    const failing = () => {
      calls++;
      return Promise.reject(new Error('nope'));
    };
    await expect(inflight('k', failing)).rejects.toThrow('nope');
    await expect(inflight('k', failing)).rejects.toThrow('nope');
    // A held rejection would have served the first failure to the second call.
    expect(calls).toBe(2);
  });

  it('counts outstanding queries and returns to zero either way', async () => {
    expect(analyticsFetchCount()).toBe(0);
    const ok = inflight('a', () => Promise.resolve(1));
    const bad = inflight('b', () => Promise.reject(new Error('x')));
    expect(analyticsFetchCount()).toBe(2);
    await ok;
    await bad.catch(() => {});
    expect(analyticsFetchCount()).toBe(0);
  });

  it('notifies subscribers as the count moves', async () => {
    const seen: number[] = [];
    const off = subscribeAnalyticsFetching(() => seen.push(analyticsFetchCount()));
    await inflight('a', () => Promise.resolve(1));
    off();
    expect(seen).toEqual([1, 0]);
  });
});
