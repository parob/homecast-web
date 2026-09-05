import { describe, expect, it } from 'vitest';
import { holdUntil, usableGaps, withGapBreaks } from '../gaps';
import type { HistoryPointData } from '@/lib/graphql/types';

const HOUR = 3_600_000;
const FROM = Date.UTC(2026, 8, 4, 5, 30);
const TO = FROM + 24 * HOUR;

const p = (ts: number, v = 18): HistoryPointData =>
  ({ ts, min: v, avg: v, max: v, last: v, count: 1 });

describe('usableGaps', () => {
  it('is empty when the server said nothing', () => {
    expect(usableGaps(undefined, [p(FROM)], FROM, TO)).toEqual([]);
    expect(usableGaps([], [p(FROM)], FROM, TO)).toEqual([]);
  });

  it('clips to the window and drops what falls outside it', () => {
    const gaps = usableGaps(
      [{ fromTs: FROM - 5 * HOUR, toTs: FROM + HOUR }, { fromTs: TO + HOUR, toTs: TO + 2 * HOUR }],
      [], FROM, TO,
    );
    expect(gaps).toEqual([{ fromTs: FROM, toTs: FROM + HOUR }]);
  });

  it('drops a gap that has a reading inside it', () => {
    // A gap is the server's claim that nothing was recorded. A point sitting
    // in it is proof that something was, and the point is the harder evidence.
    const gap = [{ fromTs: FROM + HOUR, toTs: FROM + 5 * HOUR }];
    expect(usableGaps(gap, [p(FROM + 3 * HOUR)], FROM, TO)).toEqual([]);
    // A reading exactly on either edge is not "inside" it.
    expect(usableGaps(gap, [p(FROM + HOUR), p(FROM + 5 * HOUR)], FROM, TO)).toEqual(gap);
  });

  it('sorts, so the break walk can consume them in one pass', () => {
    const out = usableGaps(
      [{ fromTs: FROM + 8 * HOUR, toTs: FROM + 9 * HOUR },
       { fromTs: FROM + 2 * HOUR, toTs: FROM + 3 * HOUR }],
      [], FROM, TO,
    );
    expect(out.map(g => g.fromTs)).toEqual([FROM + 2 * HOUR, FROM + 8 * HOUR]);
  });
});

describe('withGapBreaks', () => {
  it('leaves the points alone when there is nothing to break for', () => {
    const points = [p(FROM), p(FROM + HOUR)];
    expect(withGapBreaks(points, [])).toBe(points);
  });

  it('puts one empty row between the readings either side of a gap', () => {
    const points = [p(FROM), p(FROM + 9 * HOUR)];
    const gap = { fromTs: FROM + HOUR, toTs: FROM + 8 * HOUR };
    const out = withGapBreaks(points, [gap]);
    expect(out.map(d => [d.ts, d.avg])).toEqual([
      [FROM, 18],
      [gap.fromTs, null],
      [FROM + 9 * HOUR, 18],
    ]);
  });

  it('keeps a reading that lands on the gap start ahead of the break', () => {
    // This is where the held last value sits when an outage runs to the edge
    // of the window; putting the break first would strand it on its own.
    const gap = { fromTs: FROM + HOUR, toTs: TO };
    const out = withGapBreaks([p(FROM), p(gap.fromTs)], [gap]);
    expect(out.map(d => d.avg)).toEqual([18, 18]);
  });
});

describe('holdUntil', () => {
  const last = FROM + 4 * HOUR;

  it('runs the last reading to the window edge when nothing was missed', () => {
    expect(holdUntil(TO, last, [])).toBe(TO);
  });

  it('stops at an outage that is still running rather than crossing it', () => {
    const gap = { fromTs: FROM + 6 * HOUR, toTs: TO };
    expect(holdUntil(TO, last, [gap])).toBe(gap.fromTs);
  });

  it('holds nothing when the outage began before the last reading', () => {
    // Reading the value out to the right would only re-assert the stretch.
    const gap = { fromTs: FROM + 2 * HOUR, toTs: TO };
    expect(holdUntil(TO, last, [gap])).toBeNull();
  });

  it('ignores an outage that ended inside the window', () => {
    // Recording resumed, so the final reading is real and reaches the edge.
    expect(holdUntil(TO, last, [{ fromTs: FROM + HOUR, toTs: FROM + 2 * HOUR }])).toBe(TO);
  });
});
