import { describe, it, expect } from 'vitest';
import { planHistoryQuery, queryHistorySeries, type HistoryStore } from '../query';
import { rollupBuckets, HOUR_MS, DAY_MS, type RawSample, type RollupBucket } from '../rollup';

// In-memory store: raw samples plus eagerly-materialised rollups, the same
// invariant maintenance guarantees in production.
function makeStore(samples: RawSample[], kind: 'numeric' | 'bool' = 'numeric', rolledThrough?: number): HistoryStore {
  const sorted = [...samples].sort((a, b) => a.ts - b.ts);
  const end = rolledThrough ?? (sorted.length ? Math.floor(sorted[sorted.length - 1].ts / HOUR_MS) * HOUR_MS : 0);
  const hourly = rollupBuckets(kind, sorted.filter(s => s.ts < end), null, HOUR_MS, 0, end);
  const dailyEnd = Math.floor(end / DAY_MS) * DAY_MS;
  const daily = rollupBuckets(kind, sorted.filter(s => s.ts < dailyEnd), null, DAY_MS, 0, dailyEnd);
  const tiers: Record<'h' | 'd', RollupBucket[]> = { h: hourly, d: daily };

  return {
    async getSamples(_sid, from, to) {
      return sorted.filter(s => s.ts >= from && s.ts < to);
    },
    async getLastSampleBefore(_sid, ts) {
      const before = sorted.filter(s => s.ts < ts);
      return before[before.length - 1];
    },
    async getFirstSampleTs() {
      return sorted.length ? sorted[0].ts : null;
    },
    async getRollups(_sid, tier, from, to) {
      return tiers[tier].filter(r => r.bucket >= from && r.bucket < to);
    },
    async getLastRollupBefore(_sid, tier, bucket) {
      const before = tiers[tier].filter(r => r.bucket < bucket);
      return before[before.length - 1];
    },
  };
}

describe('planHistoryQuery', () => {
  it('serves narrow ranges from raw when raw covers them', () => {
    expect(planHistoryQuery(0, 6 * HOUR_MS, 500, 0)).toEqual({ tier: 'raw', bucketMs: 0 });
  });

  it('falls to hourly when raw has been pruned past the range start', () => {
    const plan = planHistoryQuery(0, 6 * HOUR_MS, 500, 4 * HOUR_MS);
    expect(plan.tier).toBe('hourly');
  });

  it('serves a week at hourly and a year at daily', () => {
    expect(planHistoryQuery(0, 7 * DAY_MS, 500, 0).tier).toBe('hourly');
    expect(planHistoryQuery(0, 365 * DAY_MS, 500, 0).tier).toBe('daily');
  });

  it('widens buckets instead of exceeding maxPoints', () => {
    // 30 days at 500 points → ~86 min per bucket → 2-hour buckets.
    const plan = planHistoryQuery(0, 30 * DAY_MS, 500, null);
    expect(plan.tier).toBe('hourly');
    expect(plan.bucketMs).toBe(2 * HOUR_MS);
  });
});

describe('queryHistorySeries', () => {
  it('returns raw points with the LOCF seed', async () => {
    const store = makeStore([
      { ts: HOUR_MS - 60_000, v: 19 },
      { ts: HOUR_MS + 60_000, v: 20 },
      { ts: HOUR_MS + 120_000, v: 21 },
    ]);
    const data = await queryHistorySeries(store, 's', 'numeric', HOUR_MS, 2 * HOUR_MS, 500, 2 * HOUR_MS);
    expect(data.resolution).toBe('raw');
    expect(data.prevValue).toBe(19);
    expect(data.points.map(p => p.avg)).toEqual([20, 21]);
    expect(data.points[0]).toMatchObject({ min: 20, max: 20, last: 20, count: 1 });
  });

  it('never returns more than maxPoints numeric points', async () => {
    const samples: RawSample[] = [];
    for (let i = 0; i < 5000; i++) samples.push({ ts: i * 1000, v: i % 50 });
    const store = makeStore(samples);
    const data = await queryHistorySeries(store, 's', 'numeric', 0, 5000 * 1000, 400, 5000 * 1000);
    expect(data.resolution).toBe('raw');
    expect(data.points.length).toBeLessThanOrEqual(400);
    // Downsampled buckets carry real min/max envelopes.
    expect(data.points.some(p => p.max > p.min)).toBe(true);
  });

  it('serves rolled tiers with a trailing partial bucket from raw', async () => {
    const samples: RawSample[] = [];
    for (let h = 0; h < 50; h++) samples.push({ ts: h * HOUR_MS + 10 * 60_000, v: 10 + (h % 5) });
    // "now" is 49.5h — hour 49 is still open, rolled through hour 49 start.
    const now = 49 * HOUR_MS + 30 * 60_000;
    const store = makeStore(samples, 'numeric', 49 * HOUR_MS);

    const data = await queryHistorySeries(store, 's', 'numeric', 0, now, 100, now);
    expect(data.resolution).toBe('hourly');
    const last = data.points[data.points.length - 1];
    // The open hour appears, aggregated from its raw sample.
    expect(last.ts).toBe(49 * HOUR_MS);
    expect(last.last).toBe(10 + (49 % 5));
  });

  it('returns transition spans for state kinds at raw tier', async () => {
    const store = makeStore([
      { ts: 1000, v: 1 },
      { ts: 5000, v: 0 },
      { ts: 9000, v: 1 },
    ], 'bool');
    const data = await queryHistorySeries(store, 's', 'bool', 0, HOUR_MS, 500, HOUR_MS);
    expect(data.states.map(s => s.value)).toEqual([1, 0, 1]);
    expect(data.prevValue).toBeNull();
  });

  it('returns state buckets with dominant values at rolled tiers', async () => {
    const samples: RawSample[] = [];
    for (let h = 0; h < 8 * 24; h++) {
      samples.push({ ts: h * HOUR_MS, v: h % 4 === 0 ? 1 : 0 });
    }
    const now = 8 * 24 * HOUR_MS;
    const store = makeStore(samples, 'bool', now);
    const data = await queryHistorySeries(store, 's', 'bool', 0, now, 200, now);
    expect(data.resolution).toBe('hourly');
    expect(data.stateBuckets.length).toBeGreaterThan(0);
    expect(data.stateBuckets[0].dominant).toBeDefined();
    const total = Object.values(data.stateBuckets[0].stateMs).reduce((a, b) => a + b, 0);
    expect(total).toBeGreaterThan(0);
  });

  it('handles an empty range and an empty series', async () => {
    const store = makeStore([]);
    const empty = await queryHistorySeries(store, 's', 'numeric', 1000, 1000, 500);
    expect(empty.points).toHaveLength(0);
    const none = await queryHistorySeries(store, 's', 'numeric', 0, DAY_MS, 500, DAY_MS);
    expect(none.points).toHaveLength(0);
    expect(none.prevValue).toBeNull();
  });
});
