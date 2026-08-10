// Rollup algebra for characteristic history.
//
// Raw samples are recorded on change, so between two samples the value simply
// *was* the earlier one — every aggregate here is therefore LOCF
// (last-observation-carried-forward) and time-weighted. That is what makes a
// thermostat that reports once an hour and a sensor that reports every minute
// comparable in the same chart, and it is why every bucket needs the `carry`:
// the value the series held when the bucket opened, i.e. the previous
// bucket's `vLast`.
//
// Rollups are sparse — a bucket with no samples produces no row. Queries
// LOCF-fill gaps from the previous row's vLast, so an idle lock costs nothing
// to keep forever. Pure math, no clock, no storage: the same functions roll
// hourly buckets on the CE relay and (mirrored in Python) on the cloud
// server, and they are what the fixtures pin down.

import type { HistoryKind } from './policy';

export interface RawSample {
  /** Epoch ms. */
  ts: number;
  v: number;
}

export interface RollupBucket {
  /** Bucket start, epoch ms. */
  bucket: number;
  /** Numeric kinds. Null for bool/enum. */
  vMin: number | null;
  vMax: number | null;
  /** Time-weighted (LOCF) mean over the bucket. */
  vAvg: number | null;
  /** Value at bucket close — the next bucket's carry. All kinds. */
  vLast: number;
  /** Samples recorded in this bucket. */
  count: number;
  /** bool/enum: ms spent in each value. Keys are String(value). */
  stateMs: Record<string, number> | null;
  /** bool/enum: value changes within the bucket. */
  transitions: number | null;
}

export const HOUR_MS = 3_600_000;
export const DAY_MS = 86_400_000;

/**
 * Roll raw samples into fixed-width buckets over [rangeStart, rangeEnd).
 *
 * `samples` must be sorted by ts ascending and lie within the range.
 * `carry` is the series value at rangeStart (null only if the series has no
 * sample before the range — then weighting starts at the first sample).
 * Only buckets containing at least one sample are returned (sparse).
 */
export function rollupBuckets(
  kind: HistoryKind,
  samples: RawSample[],
  carry: number | null,
  bucketMs: number,
  rangeStart: number,
  rangeEnd: number,
): RollupBucket[] {
  const buckets: RollupBucket[] = [];
  if (samples.length === 0) return buckets;

  let i = 0;
  let carryValue = carry;

  for (let bucketStart = alignToBucket(samples[0].ts, bucketMs); bucketStart < rangeEnd; bucketStart += bucketMs) {
    const bucketEnd = Math.min(bucketStart + bucketMs, rangeEnd);
    const inBucket: RawSample[] = [];
    while (i < samples.length && samples[i].ts < bucketEnd) {
      if (samples[i].ts >= bucketStart) inBucket.push(samples[i]);
      i++;
    }
    if (inBucket.length === 0) {
      // Sparse: no row, but the carry still advances through the empty bucket
      // unchanged (nothing was recorded, so the value held).
      if (i >= samples.length) break;
      continue;
    }

    buckets.push(rollOneBucket(kind, inBucket, carryValue, bucketStart, bucketEnd));
    carryValue = inBucket[inBucket.length - 1].v;
    if (i >= samples.length) break;
  }
  return buckets;
}

function alignToBucket(ts: number, bucketMs: number): number {
  return Math.floor(ts / bucketMs) * bucketMs;
}

function rollOneBucket(
  kind: HistoryKind,
  samples: RawSample[],
  carry: number | null,
  bucketStart: number,
  bucketEnd: number,
): RollupBucket {
  const vLast = samples[samples.length - 1].v;

  if (kind === 'numeric') {
    // The trace inside the bucket: carry holds from bucketStart to the first
    // sample, then each sample holds until the next.
    let min = Infinity;
    let max = -Infinity;
    let weighted = 0;
    let weightedSpan = 0;

    let prevValue = carry;
    let prevTs = bucketStart;
    for (const s of samples) {
      if (prevValue !== null && s.ts > prevTs) {
        weighted += prevValue * (s.ts - prevTs);
        weightedSpan += s.ts - prevTs;
        min = Math.min(min, prevValue);
        max = Math.max(max, prevValue);
      }
      prevValue = s.v;
      prevTs = s.ts;
    }
    if (prevValue !== null && bucketEnd > prevTs) {
      weighted += prevValue * (bucketEnd - prevTs);
      weightedSpan += bucketEnd - prevTs;
      min = Math.min(min, prevValue);
      max = Math.max(max, prevValue);
    }

    return {
      bucket: bucketStart,
      vMin: min,
      vMax: max,
      vAvg: weightedSpan > 0 ? weighted / weightedSpan : vLast,
      vLast,
      count: samples.length,
      stateMs: null,
      transitions: null,
    };
  }

  // bool/enum: time-in-state plus transition count.
  const stateMs: Record<string, number> = {};
  let transitions = 0;
  let prevValue = carry;
  let prevTs = bucketStart;
  for (const s of samples) {
    if (prevValue !== null && s.ts > prevTs) {
      const key = String(prevValue);
      stateMs[key] = (stateMs[key] ?? 0) + (s.ts - prevTs);
    }
    if (prevValue !== null && s.v !== prevValue) transitions++;
    prevValue = s.v;
    prevTs = s.ts;
  }
  if (prevValue !== null && bucketEnd > prevTs) {
    const key = String(prevValue);
    stateMs[key] = (stateMs[key] ?? 0) + (bucketEnd - prevTs);
  }

  return {
    bucket: bucketStart,
    vMin: null,
    vMax: null,
    vAvg: null,
    vLast,
    count: samples.length,
    stateMs,
    transitions,
  };
}

/**
 * Re-roll finer buckets into wider ones (hourly → daily, or either → chart
 * buckets). Input rows must be sorted by bucket ascending; `carry` is the
 * vLast of the last row before the range. Sparse gaps between input rows are
 * LOCF-filled: an absent hour contributes a full hour of the carried value.
 */
export function mergeBuckets(
  kind: HistoryKind,
  rows: RollupBucket[],
  carry: RollupBucket | null,
  fineMs: number,
  wideMs: number,
  rangeStart: number,
  rangeEnd: number,
): RollupBucket[] {
  const out: RollupBucket[] = [];
  if (rows.length === 0) return out;

  let i = 0;
  let carryValue: number | null = carry ? carry.vLast : null;

  for (let wideStart = alignToBucket(rows[0].bucket, wideMs); wideStart < rangeEnd; wideStart += wideMs) {
    const wideEnd = Math.min(wideStart + wideMs, rangeEnd);
    const inWide: RollupBucket[] = [];
    while (i < rows.length && rows[i].bucket < wideEnd) {
      if (rows[i].bucket >= wideStart) inWide.push(rows[i]);
      i++;
    }
    if (inWide.length === 0) {
      if (i >= rows.length) break;
      continue;
    }

    const vLast = inWide[inWide.length - 1].vLast;
    const count = inWide.reduce((n, r) => n + r.count, 0);

    if (kind === 'numeric') {
      let min = Infinity;
      let max = -Infinity;
      let weighted = 0;
      let weightedSpan = 0;

      let cursorValue = carryValue;
      let cursorTs = wideStart;
      for (const row of inWide) {
        // LOCF-fill the gap before this row with the carried value.
        if (cursorValue !== null && row.bucket > cursorTs) {
          weighted += cursorValue * (row.bucket - cursorTs);
          weightedSpan += row.bucket - cursorTs;
          min = Math.min(min, cursorValue);
          max = Math.max(max, cursorValue);
        }
        const span = Math.min(fineMs, wideEnd - row.bucket);
        if (row.vAvg !== null) {
          weighted += row.vAvg * span;
          weightedSpan += span;
        }
        if (row.vMin !== null) min = Math.min(min, row.vMin);
        if (row.vMax !== null) max = Math.max(max, row.vMax);
        cursorValue = row.vLast;
        cursorTs = row.bucket + span;
      }
      if (cursorValue !== null && wideEnd > cursorTs) {
        weighted += cursorValue * (wideEnd - cursorTs);
        weightedSpan += wideEnd - cursorTs;
        min = Math.min(min, cursorValue);
        max = Math.max(max, cursorValue);
      }

      out.push({
        bucket: wideStart,
        vMin: min === Infinity ? null : min,
        vMax: max === -Infinity ? null : max,
        vAvg: weightedSpan > 0 ? weighted / weightedSpan : vLast,
        vLast,
        count,
        stateMs: null,
        transitions: null,
      });
    } else {
      const stateMs: Record<string, number> = {};
      let transitions = 0;

      let cursorValue = carryValue;
      let cursorTs = wideStart;
      for (const row of inWide) {
        if (cursorValue !== null && row.bucket > cursorTs) {
          const key = String(cursorValue);
          stateMs[key] = (stateMs[key] ?? 0) + (row.bucket - cursorTs);
        }
        for (const [key, ms] of Object.entries(row.stateMs ?? {})) {
          stateMs[key] = (stateMs[key] ?? 0) + ms;
        }
        transitions += row.transitions ?? 0;
        const span = Math.min(fineMs, wideEnd - row.bucket);
        cursorValue = row.vLast;
        cursorTs = row.bucket + span;
      }
      if (cursorValue !== null && wideEnd > cursorTs) {
        const key = String(cursorValue);
        stateMs[key] = (stateMs[key] ?? 0) + (wideEnd - cursorTs);
      }

      out.push({
        bucket: wideStart,
        vMin: null,
        vMax: null,
        vAvg: null,
        vLast,
        count,
        stateMs,
        transitions,
      });
    }

    carryValue = vLast;
    if (i >= rows.length) break;
  }
  return out;
}
