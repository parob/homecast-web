// Read-side of characteristic history: tier planning and downsampling.
//
// A chart never receives raw floods — the store holds months of samples, the
// wire carries at most `maxPoints` buckets. One tier serves the whole range
// (eager rollups guarantee hourly/daily coverage wherever raw has been
// rolled), plus a top-up of the trailing partial bucket from raw, so there is
// no mid-range stitching to get wrong.
//
// Storage-agnostic: the CE resolver hands it IndexedDB accessors, tests hand
// it arrays. The Python server mirrors this planning logic for cloud homes —
// behavioural drift there shows up against the same expectations pinned in
// __tests__/query.test.ts.

import type { HistoryKind } from './policy';
import { rollupBuckets, mergeBuckets, HOUR_MS, DAY_MS, type RawSample, type RollupBucket } from './rollup';

export type HistoryTier = 'raw' | 'hourly' | 'daily';

export interface HistoryStore {
  getSamples(sid: string, fromTs: number, toTs: number): Promise<RawSample[]>;
  getLastSampleBefore(sid: string, ts: number): Promise<RawSample | undefined>;
  /** Oldest raw ts for the series — one cursor step, never a scan. */
  getFirstSampleTs(sid: string): Promise<number | null>;
  getRollups(sid: string, tier: 'h' | 'd', fromBucket: number, toBucket: number): Promise<RollupBucket[]>;
  getLastRollupBefore(sid: string, tier: 'h' | 'd', bucket: number): Promise<RollupBucket | undefined>;
}

export interface HistoryPoint {
  ts: number;
  min: number;
  avg: number;
  max: number;
  last: number;
  count: number;
}

export interface HistoryStateSpan {
  ts: number;
  value: number;
  /** string kind: the state's text (value is the 0 sentinel). */
  valueText?: string | null;
}

export interface HistoryStateBucket {
  ts: number;
  dominant: number;
  /** string kind: the dominant state's text (dominant is the 0 sentinel). */
  dominantText?: string | null;
  stateMs: Record<string, number>;
  transitions: number;
}

export interface HistorySeriesData {
  kind: HistoryKind;
  resolution: HistoryTier;
  /** LOCF seed: the value the series held as the range opened. */
  prevValue: number | null;
  /** string kind: the LOCF seed's text. */
  prevValueText?: string | null;
  /** Numeric kinds. Raw tier: min=avg=max=last, count=1 — one chart code path. */
  points: HistoryPoint[];
  /** bool/enum, raw tier: the transition list. */
  states: HistoryStateSpan[];
  /** bool/enum, rolled tiers. */
  stateBuckets: HistoryStateBucket[];
}

export interface QueryPlan {
  tier: HistoryTier;
  /** Chart bucket width; 0 for untouched raw points. */
  bucketMs: number;
}

/**
 * Raw serves at most this much range. Beyond it, hourly rows answer with two
 * orders of magnitude fewer reads and the chart cannot show sub-hour detail
 * at that zoom anyway.
 */
export const RAW_MAX_SPAN_MS = 48 * HOUR_MS;

/**
 * Pick the one tier that serves [from, to) in ≤ maxPoints buckets.
 * `rawFloorTs` is the oldest raw sample still stored (raw can only serve
 * ranges it fully covers).
 */
export function planHistoryQuery(
  fromTs: number,
  toTs: number,
  maxPoints: number,
  rawFloorTs: number | null,
): QueryPlan {
  const span = Math.max(toTs - fromTs, 1);
  const targetMs = span / Math.max(maxPoints, 1);

  if (span <= RAW_MAX_SPAN_MS && targetMs < HOUR_MS && rawFloorTs !== null && rawFloorTs <= fromTs) {
    return { tier: 'raw', bucketMs: 0 };
  }
  if (targetMs <= 6 * HOUR_MS) {
    // Serve hourly, merged up to a multiple of an hour if the range is wide.
    // Past ~6h buckets, daily rows answer with far fewer reads and no less
    // detail at that zoom.
    const bucketMs = Math.max(HOUR_MS, Math.ceil(targetMs / HOUR_MS) * HOUR_MS);
    return { tier: 'hourly', bucketMs };
  }
  const bucketMs = Math.max(DAY_MS, Math.ceil(targetMs / DAY_MS) * DAY_MS);
  return { tier: 'daily', bucketMs };
}

function pointFromBucket(b: RollupBucket): HistoryPoint {
  return {
    ts: b.bucket,
    min: b.vMin ?? b.vLast,
    avg: b.vAvg ?? b.vLast,
    max: b.vMax ?? b.vLast,
    last: b.vLast,
    count: b.count,
  };
}

function stateBucketFromBucket(kind: HistoryKind, b: RollupBucket): HistoryStateBucket {
  const stateMs = b.stateMs ?? {};
  // stateMs keys ARE the state identity: the raw string for the string kind,
  // String(code) otherwise — dominant is derived per kind from the winner.
  let bestKey: string | null = null;
  let best = -1;
  for (const [key, ms] of Object.entries(stateMs)) {
    if (ms > best) {
      best = ms;
      bestKey = key;
    }
  }
  if (kind === 'string') {
    return {
      ts: b.bucket,
      dominant: 0,
      dominantText: bestKey ?? b.vtLast ?? null,
      stateMs,
      transitions: b.transitions ?? 0,
    };
  }
  return {
    ts: b.bucket,
    dominant: bestKey !== null ? Number(bestKey) : b.vLast,
    stateMs,
    transitions: b.transitions ?? 0,
  };
}

/**
 * The full read for one series. `nowTs` bounds the trailing top-up (rollups
 * only exist for closed buckets; the open one is aggregated from raw).
 */
export async function queryHistorySeries(
  store: HistoryStore,
  sid: string,
  kind: HistoryKind,
  fromTs: number,
  toTs: number,
  maxPoints: number,
  nowTs = Date.now(),
): Promise<HistorySeriesData> {
  const empty: HistorySeriesData = {
    kind, resolution: 'raw', prevValue: null, prevValueText: null, points: [], states: [], stateBuckets: [],
  };
  if (toTs <= fromTs) return empty;

  let rawFloor = await store.getFirstSampleTs(sid);
  if (rawFloor !== null && rawFloor > fromTs) {
    // Raw starts after the range opens. If nothing was ever rolled up before
    // that point, the series is simply younger than the range and raw still
    // covers everything that exists; only pruned-away history disqualifies it.
    const rolledBefore = await store.getLastRollupBefore(
      sid, 'h', Math.floor(rawFloor / HOUR_MS) * HOUR_MS,
    );
    if (rolledBefore === undefined) rawFloor = fromTs;
  }
  const plan = planHistoryQuery(fromTs, toTs, maxPoints, rawFloor);

  if (plan.tier === 'raw') {
    const samples = await store.getSamples(sid, fromTs, toTs);
    const carry = await store.getLastSampleBefore(sid, fromTs);
    const prevValue = carry?.v ?? null;
    const prevValueText = carry?.vt ?? null;

    if (kind === 'numeric') {
      if (samples.length <= maxPoints) {
        return {
          kind, resolution: 'raw', prevValue, prevValueText,
          points: samples.map(s => ({ ts: s.ts, min: s.v, avg: s.v, max: s.v, last: s.v, count: 1 })),
          states: [], stateBuckets: [],
        };
      }
      // Too dense even raw: re-bucket to the chart's target width.
      const bucketMs = Math.max(1000, Math.ceil((toTs - fromTs) / maxPoints / 1000) * 1000);
      const buckets = rollupBuckets(kind, samples, prevValue, bucketMs, fromTs, toTs);
      return {
        kind, resolution: 'raw', prevValue, prevValueText,
        points: buckets.map(pointFromBucket), states: [], stateBuckets: [],
      };
    }

    // State kinds keep every transition up to a sanity cap; beyond it the
    // range is too wide for a raw timeline anyway and the caller should have
    // planned a rolled tier — clamp rather than flood.
    return {
      kind, resolution: 'raw', prevValue, prevValueText,
      points: [],
      states: samples.slice(0, maxPoints * 4).map(s => ({ ts: s.ts, value: s.v, valueText: s.vt ?? null })),
      stateBuckets: [],
    };
  }

  const tierKey = plan.tier === 'hourly' ? 'h' : 'd';
  const tierMs = plan.tier === 'hourly' ? HOUR_MS : DAY_MS;
  const alignedFrom = Math.floor(fromTs / tierMs) * tierMs;

  let rows = await store.getRollups(sid, tierKey, alignedFrom, toTs);
  const carryRow = await store.getLastRollupBefore(sid, tierKey, alignedFrom);
  const prevValue = carryRow?.vLast ?? null;
  const prevValueText = carryRow?.vtLast ?? null;

  // Top-up: the open bucket at the head of the range, aggregated from raw.
  const lastClosed = rows.length > 0 ? rows[rows.length - 1].bucket + tierMs : alignedFrom;
  const topUpFrom = Math.max(lastClosed, Math.floor(nowTs / tierMs) * tierMs, fromTs);
  if (topUpFrom < toTs) {
    const tail = await store.getSamples(sid, topUpFrom, toTs);
    if (tail.length > 0) {
      const tailCarry = await store.getLastSampleBefore(sid, topUpFrom);
      const partial = rollupBuckets(
        kind, tail, tailCarry?.v ?? prevValue, tierMs,
        Math.floor(topUpFrom / tierMs) * tierMs, toTs,
        tailCarry ? (tailCarry.vt ?? null) : prevValueText,
      );
      rows = rows.concat(partial);
    }
  }

  if (plan.bucketMs > tierMs) {
    rows = mergeBuckets(kind, rows, carryRow ?? null, tierMs, plan.bucketMs, alignedFrom, toTs);
  }

  if (kind === 'numeric') {
    return {
      kind, resolution: plan.tier, prevValue, prevValueText,
      points: rows.map(pointFromBucket), states: [], stateBuckets: [],
    };
  }
  return {
    kind, resolution: plan.tier, prevValue, prevValueText,
    points: [], states: [],
    stateBuckets: rows.map(b => stateBucketFromBucket(kind, b)),
  };
}
