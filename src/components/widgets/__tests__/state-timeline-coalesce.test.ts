import { describe, it, expect } from 'vitest';
import { coalesce, type Segment } from '../StateTimeline';

const seg = (leftPct: number, widthPct: number, value: number, extra: Partial<Segment> = {}): Segment => ({
  leftPct, widthPct, value, fraction: 1, ...extra,
});

describe('coalesce', () => {
  it('joins a run that a device re-reported as several identical spans', () => {
    const out = coalesce([seg(0, 10, 1), seg(10, 15, 1), seg(25, 5, 1)]);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ leftPct: 0, widthPct: 30, value: 1 });
  });

  it('keeps genuinely different states apart', () => {
    const out = coalesce([seg(0, 10, 1), seg(10, 10, 0), seg(20, 10, 1)]);
    expect(out.map(s => s.value)).toEqual([1, 0, 1]);
  });

  it('merges any categorical state, not just on/off', () => {
    // Cool (2) held across four hourly buckets, then Heat (1).
    const out = coalesce([seg(0, 5, 2), seg(5, 5, 2), seg(10, 5, 2), seg(15, 5, 2), seg(20, 5, 1)]);
    expect(out.map(s => [s.value, s.widthPct])).toEqual([[2, 20], [1, 5]]);
  });

  it('merges string states by their text', () => {
    const out = coalesce([
      seg(0, 10, 0, { text: 'Movie Night' }),
      seg(10, 10, 0, { text: 'Movie Night' }),
      seg(20, 10, 0, { text: 'Reading' }),
    ]);
    expect(out.map(s => [s.text, s.widthPct])).toEqual([['Movie Night', 20], ['Reading', 10]]);
  });

  it('does not close a gap between two runs of the same state', () => {
    // Recording paused between them — joining would invent history.
    const out = coalesce([seg(0, 10, 1), seg(40, 10, 1)]);
    expect(out).toHaveLength(2);
  });

  it('keeps buckets with different fills apart', () => {
    // Merging them and averaging the fill was how a group strip — whose fill
    // means "how many members are on" — drew a whole day as one flat block.
    const out = coalesce([seg(0, 10, 1, { fraction: 1 }), seg(10, 30, 1, { fraction: 0.2 })]);
    expect(out).toHaveLength(2);
    expect(out.map(s => s.fraction)).toEqual([1, 0.2]);
  });

  it('still merges buckets that are identical in state AND fill', () => {
    const out = coalesce([seg(0, 10, 1, { fraction: 0.5 }), seg(10, 30, 1, { fraction: 0.5 })]);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ widthPct: 40, fraction: 0.5 });
  });

  it('leaves the input array untouched', () => {
    const input = [seg(0, 10, 1), seg(10, 10, 1)];
    coalesce(input);
    expect(input).toHaveLength(2);
    expect(input[0].widthPct).toBe(10);
  });
});
