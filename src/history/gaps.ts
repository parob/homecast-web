// Where the line must stop, because nothing was watching.
//
// `carry.ts` states the assumption the numeric charts were built on:
//
//   > everything after [the coverage start] is covered, whether or not a
//   > sample happens to land there
//
// True while the relay is up — history records on CHANGE, so an absence of
// samples means the value did not move. False when the relay is gone, and the
// two produce an identical hole. A nine-hour power cut therefore arrived as a
// nine-hour flat line at the last reading, drawn with the same stroke and the
// same fill as measured data (homecast-cloud#66).
//
// The server now says which stretches it was not recording (`gaps`, from the
// whole home's silence — see homecast/history/coverage.py). This is what the
// chart does with that: end the line, leave the stretch empty, and let the
// shading say why.

import type { HistoryGapData, HistoryPointData } from '@/lib/graphql/types';

/**
 * A chart row. `avg === null` is a break: recharts starts a fresh subpath at
 * the next real value rather than drawing through it.
 */
export interface ChartDatum {
  ts: number;
  min: number | null;
  avg: number | null;
  max: number | null;
  last: number | null;
  count: number;
}

const BREAK = { min: null, avg: null, max: null, last: null, count: 0 } as const;

/**
 * Gaps worth acting on: inside the window, non-empty, and not contradicted by
 * a point that lands inside them.
 *
 * The last of those is the important one. A gap is the server's claim that
 * nothing was recorded; a point sitting in it is proof that something was. The
 * point is the harder evidence, so the gap loses — better to under-report an
 * outage than to blank out a stretch that has readings in it.
 */
export function usableGaps(
  gaps: HistoryGapData[] | undefined,
  points: HistoryPointData[],
  fromTs: number,
  toTs: number,
): HistoryGapData[] {
  if (!gaps?.length) return [];
  return gaps
    .map(g => ({ fromTs: Math.max(g.fromTs, fromTs), toTs: Math.min(g.toTs, toTs) }))
    .filter(g => g.toTs > g.fromTs)
    .filter(g => !points.some(p => p.ts > g.fromTs && p.ts < g.toTs))
    .sort((a, b) => a.fromTs - b.fromTs);
}

/**
 * The rows to draw: the points, with a break at the start of every gap.
 *
 * The break sits at the gap's own start rather than at the last sample before
 * it, so the short run-up between them — the value really was known then —
 * still counts as measured.
 */
export function withGapBreaks(
  points: HistoryPointData[], gaps: HistoryGapData[],
): ChartDatum[] {
  if (gaps.length === 0) return points;
  const out: ChartDatum[] = [];
  let g = 0;
  for (const p of points) {
    // Strictly before: a reading landing exactly on the gap's start belongs to
    // the recorded side of it, not after the break. That is where the held
    // last value sits when an outage runs to the edge of the window.
    while (g < gaps.length && gaps[g].fromTs < p.ts) {
      out.push({ ts: gaps[g].fromTs, ...BREAK });
      g++;
    }
    out.push(p);
  }
  // Gaps past the last point need no break row: there is nothing after them to
  // be joined to, and an empty row on the end only adds a stray subpath.
  return out;
}

/**
 * How far the last reading may be held to the right of the chart.
 *
 * The chart runs its final value out to the edge of the window, because the
 * value did not stop existing when recording paused and a line ending
 * mid-panel reads as a rendering bug. That is exactly wrong when the window
 * ends inside an outage: there it would hold a stale reading across the very
 * stretch we are trying to say nothing about. Stop at the outage instead, and
 * `null` when one is still running at the edge — nothing to hold out to.
 */
export function holdUntil(
  toTs: number, lastTs: number, gaps: HistoryGapData[],
): number | null {
  const trailing = gaps.find(g => g.toTs >= toTs);
  if (!trailing) return toTs;
  return trailing.fromTs > lastTs ? trailing.fromTs : null;
}
