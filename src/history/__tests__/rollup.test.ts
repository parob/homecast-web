import { describe, it, expect } from 'vitest';
import { rollupBuckets, mergeBuckets, HOUR_MS, DAY_MS, type RawSample } from '../rollup';

describe('rollupBuckets — numeric', () => {
  it('time-weights a step trace with a carry', () => {
    // Carry 20° for the first half hour, then 22° for the second half.
    const buckets = rollupBuckets('numeric', [{ ts: HOUR_MS / 2, v: 22 }], 20, HOUR_MS, 0, HOUR_MS);
    expect(buckets).toHaveLength(1);
    expect(buckets[0].vAvg).toBeCloseTo(21);
    expect(buckets[0].vMin).toBe(20);
    expect(buckets[0].vMax).toBe(22);
    expect(buckets[0].vLast).toBe(22);
    expect(buckets[0].count).toBe(1);
  });

  it('starts weighting at the first sample when there is no carry', () => {
    const buckets = rollupBuckets('numeric', [{ ts: HOUR_MS / 2, v: 22 }], null, HOUR_MS, 0, HOUR_MS);
    expect(buckets[0].vAvg).toBeCloseTo(22);
    expect(buckets[0].vMin).toBe(22);
  });

  it('is sparse: buckets without samples produce no rows, carry survives the gap', () => {
    const samples: RawSample[] = [
      { ts: 0, v: 10 },
      { ts: 3 * HOUR_MS + HOUR_MS / 2, v: 20 },
    ];
    const buckets = rollupBuckets('numeric', samples, null, HOUR_MS, 0, 4 * HOUR_MS);
    expect(buckets.map(b => b.bucket)).toEqual([0, 3 * HOUR_MS]);
    // Hour 3 spent its first half on the value carried through hours 1-2.
    expect(buckets[1].vAvg).toBeCloseTo(15);
    expect(buckets[1].vMin).toBe(10);
  });
});

describe('rollupBuckets — bool/enum', () => {
  it('time-in-state sums to the bucket duration', () => {
    const samples: RawSample[] = [
      { ts: 10 * 60_000, v: 1 },
      { ts: 40 * 60_000, v: 0 },
    ];
    const [b] = rollupBuckets('bool', samples, 0, HOUR_MS, 0, HOUR_MS);
    const total = Object.values(b.stateMs!).reduce((a, x) => a + x, 0);
    expect(total).toBe(HOUR_MS);
    expect(b.stateMs!['1']).toBe(30 * 60_000);
    expect(b.stateMs!['0']).toBe(30 * 60_000);
    expect(b.transitions).toBe(2);
    expect(b.vLast).toBe(0);
  });

  it('counts only real transitions', () => {
    // Recorder dedupe should prevent repeats, but rollups must not trust it.
    const samples: RawSample[] = [
      { ts: 1000, v: 1 },
      { ts: 2000, v: 1 },
      { ts: 3000, v: 0 },
    ];
    const [b] = rollupBuckets('enum', samples, 1, HOUR_MS, 0, HOUR_MS);
    expect(b.transitions).toBe(1);
  });
});

describe('mergeBuckets', () => {
  it('hourly → daily equals direct-from-raw', () => {
    // A day of pseudo-random step data.
    const samples: RawSample[] = [];
    let v = 20;
    for (let t = 0; t < DAY_MS; t += 7 * 60_000) {
      v = 15 + ((v * 31 + t / 60_000) % 100) / 10;
      samples.push({ ts: t, v: Math.round(v * 10) / 10 });
    }

    const hourly = rollupBuckets('numeric', samples, 18, HOUR_MS, 0, DAY_MS);
    const [daily] = mergeBuckets('numeric', hourly, { ...hourly[0], vLast: 18 }, HOUR_MS, DAY_MS, 0, DAY_MS);
    const [direct] = rollupBuckets('numeric', samples, 18, DAY_MS, 0, DAY_MS);

    expect(daily.vMin).toBeCloseTo(direct.vMin!, 6);
    expect(daily.vMax).toBeCloseTo(direct.vMax!, 6);
    expect(daily.vAvg).toBeCloseTo(direct.vAvg!, 6);
    expect(daily.vLast).toBe(direct.vLast);
    expect(daily.count).toBe(direct.count);
  });

  it('hourly → daily equals direct-from-raw for state kinds', () => {
    const samples: RawSample[] = [];
    for (let t = 0; t < DAY_MS; t += 43 * 60_000) {
      samples.push({ ts: t, v: (t / (43 * 60_000)) % 2 === 0 ? 1 : 0 });
    }

    const hourly = rollupBuckets('bool', samples, 0, HOUR_MS, 0, DAY_MS);
    const [daily] = mergeBuckets('bool', hourly, null, HOUR_MS, DAY_MS, 0, DAY_MS);
    const [direct] = rollupBuckets('bool', samples, 0, DAY_MS, 0, DAY_MS);

    // First fine bucket has no carry in the merge, so alignment starts at its
    // bucket; totals must still match the direct roll.
    expect(daily.transitions).toBe(direct.transitions);
    expect(daily.stateMs!['1']).toBeCloseTo(direct.stateMs!['1'], 0);
    expect(daily.stateMs!['0']).toBeCloseTo(direct.stateMs!['0'], 0);
  });

  it('LOCF-fills sparse gaps between fine rows', () => {
    // One hourly row at hour 0 (avg 10, last 10), then nothing for 22 hours,
    // then a row at hour 23 (avg 20 after an immediate step, last 20).
    const rows = [
      { bucket: 0, vMin: 10, vMax: 10, vAvg: 10, vLast: 10, count: 1, stateMs: null, transitions: null },
      { bucket: 23 * HOUR_MS, vMin: 20, vMax: 20, vAvg: 20, vLast: 20, count: 1, stateMs: null, transitions: null },
    ];
    const [daily] = mergeBuckets('numeric', rows, null, HOUR_MS, DAY_MS, 0, DAY_MS);
    // 23 hours at 10, 1 hour at 20.
    expect(daily.vAvg).toBeCloseTo((23 * 10 + 20) / 24, 6);
    expect(daily.vMin).toBe(10);
    expect(daily.vMax).toBe(20);
  });
});
