// Time-in-state math for state timelines — shared by the accessory popup,
// the analytics strips, and the group sections so their captions can never
// drift apart.

import type { HistorySeriesData } from '@/lib/graphql/types';

/**
 * Time spent in each state across the served range, keyed by state IDENTITY
 * (String(code) for bool/enum, the raw text for the string kind — the same
 * convention rollup stateMs uses), plus the transition count.
 */
export function stateTotals(
  data: HistorySeriesData,
  fromTs: number,
  toTs: number,
): { totals: Array<[string, number]>; transitions: number } {
  const totals = new Map<string, number>();
  let transitions = 0;
  const keyOf = (v: number, vt?: string | null) => vt ?? String(v);

  if (data.states.length > 0) {
    let prevTs = fromTs;
    let prevKey = data.prevValue !== null ? keyOf(data.prevValue, data.prevValueText) : null;
    for (const s of data.states) {
      const key = keyOf(s.value, s.valueText);
      if (prevKey !== null) totals.set(prevKey, (totals.get(prevKey) ?? 0) + (s.ts - prevTs));
      if (prevKey !== null && key !== prevKey) transitions++;
      else if (prevKey === null) transitions++;
      prevTs = s.ts;
      prevKey = key;
    }
    if (prevKey !== null) totals.set(prevKey, (totals.get(prevKey) ?? 0) + (toTs - prevTs));
  } else {
    for (const b of data.stateBuckets) {
      transitions += b.transitions;
      try {
        const stateMs = JSON.parse(b.stateMsJson) as Record<string, number>;
        for (const [key, ms] of Object.entries(stateMs)) {
          totals.set(key, (totals.get(key) ?? 0) + ms);
        }
      } catch { /* cell without detail */ }
    }
  }

  // Nothing happened inside the window, so nothing was sampled inside it
  // either — the value carried in from before held the whole way. A smoke
  // alarm quiet since last month is the ordinary case, and without this it
  // reported no time in any state at all: the strip drew the held bar, the
  // caption underneath denied it.
  if (totals.size === 0 && data.prevValue !== null) {
    totals.set(keyOf(data.prevValue, data.prevValueText), toTs - fromTs);
  }
  return {
    totals: [...totals.entries()].sort((a, b) => b[1] - a[1]),
    transitions,
  };
}

export function formatStateDuration(ms: number): string {
  const minutes = Math.round(ms / 60_000);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours}h ${minutes % 60}m`;
  return `${Math.floor(hours / 24)}d ${hours % 24}h`;
}
