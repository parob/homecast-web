// The value a window OPENS with, and what "we weren't recording" really means.
//
// History records on change, so the first sample inside any window is almost
// always later than the window's start — pick 6h and the first reading might
// be 18 minutes in. That is not a gap in the recording: the value was known
// the whole time, it just hadn't moved. The server already sends the reading
// that preceded the window (`prevValue`, from _last_value_before / the rollup
// carry row) precisely so the client can draw that stretch; the numeric charts
// were throwing it away, drawing a line that started late and then labelling
// the space in front of it "not recorded" — while the state strips, which do
// use prevValue, drew the same period correctly.

import type { HistoryPointData, HistorySeriesData } from '@/lib/graphql/types';

/**
 * The series' points with the opening value prepended at `fromTs`, so a
 * chart is drawn across everything that was known rather than from the first
 * time something changed. `count: 0` marks it as carried, not measured.
 */
export function withCarryIn(data: HistorySeriesData, fromTs: number): HistoryPointData[] {
  const { prevValue, points } = data;
  if (prevValue === null || prevValue === undefined) return points;
  if (points.length > 0 && points[0].ts <= fromTs) return points;
  return [
    { ts: fromTs, min: prevValue, avg: prevValue, max: prevValue, last: prevValue, count: 0 },
    ...points,
  ];
}

/**
 * The first instant anything is known about this series — `fromTs` when the
 * window opened with a carried value, otherwise the first recorded thing of
 * any kind. Infinity when the series is empty across the window.
 *
 * Everything before this is genuinely unrecorded; everything after is
 * covered, whether or not a sample happens to land there.
 */
export function coverageStart(data: HistorySeriesData, fromTs: number): number {
  if (data.prevValue !== null && data.prevValue !== undefined) return fromTs;
  const first = data.points[0]?.ts
    ?? data.states[0]?.ts
    ?? data.stateBuckets[0]?.ts;
  return first ?? Infinity;
}

/**
 * Is the unrecorded stretch worth drawing attention to? Under a twentieth of
 * the window it is the axis edge, not a story.
 */
export function unrecordedLeadIn(
  coverage: number, fromTs: number, toTs: number,
): number | null {
  if (!Number.isFinite(coverage)) return toTs;
  return coverage - fromTs > (toTs - fromTs) * 0.05 ? coverage : null;
}
