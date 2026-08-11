// A group's activity as ONE strip: how many of its members were on.
//
// A room of nine downlights drew nine timelines that said the same thing —
// "Off 20h 30m · 1 change" — nine times, because those bulbs are a group and
// move together. The group is the unit people think in ("were the lights
// on?"), so the group gets the row and the members go behind a chevron.
//
// It reuses the rolled-bucket shape the strip already knows: a bucket's fill
// fraction normally means "how much of this hour was it on", and here it
// means "how many of these were on", which reads the same way — a solid bar
// is everything, a pale one is a few.

import type { HistorySeriesData, HistoryStateBucketData } from '@/lib/graphql/types';

/** State of a bool/enum series at `ts`, LOCF, via a walking cursor. */
function stateAt(data: HistorySeriesData, ts: number, cursor: { i: number; value: number | null }): number | null {
  const spans = data.states;
  if (spans.length > 0) {
    while (cursor.i < spans.length && spans[cursor.i].ts <= ts) {
      cursor.value = spans[cursor.i].value;
      cursor.i++;
    }
    return cursor.value;
  }
  const rolled = data.stateBuckets;
  while (cursor.i < rolled.length && rolled[cursor.i].ts <= ts) {
    cursor.value = rolled[cursor.i].dominant;
    cursor.i++;
  }
  return cursor.value;
}

export interface GroupStripResult {
  buckets: HistoryStateBucketData[];
  /** Time every member was on. */
  allOnMs: number;
  /** Time at least one — but not all — were on. */
  someOnMs: number;
  /** Time none were. */
  offMs: number;
  /** Most members on at once, and how many there are. */
  peak: number;
  members: number;
}

export function groupStrip(
  members: HistorySeriesData[],
  fromTs: number,
  toTs: number,
  buckets = 240,
): GroupStripResult {
  const span = toTs - fromTs;
  if (span <= 0 || members.length === 0) {
    return { buckets: [], allOnMs: 0, someOnMs: 0, offMs: 0, peak: 0, members: members.length };
  }
  const step = span / buckets;
  const cursors = members.map(m => ({ i: 0, value: m.prevValue }));

  const out: HistoryStateBucketData[] = [];
  let allOnMs = 0;
  let someOnMs = 0;
  let offMs = 0;
  let peak = 0;

  for (let b = 0; b < buckets; b++) {
    const ts = fromTs + b * step;
    let on = 0;
    let known = 0;
    members.forEach((member, i) => {
      const state = stateAt(member, ts, cursors[i]);
      // A member with no reading yet is unknown, not off: counting it as off
      // would draw a group as darker than it was.
      if (state === null) return;
      known++;
      if (state !== 0) on++;
    });
    const share = known > 0 ? on / known : 0;
    if (on > peak) peak = on;
    if (known > 0 && on === known) allOnMs += step;
    else if (on > 0) someOnMs += step;
    else offMs += step;

    out.push({
      ts,
      // Always the "on" state, shaded by how much of the group it was —
      // a bucket's fraction is what the strip renders as fill.
      dominant: 1,
      transitions: 0,
      stateMsJson: JSON.stringify({ '0': Math.round(step * (1 - share)), '1': Math.round(step * share) }),
    } as HistoryStateBucketData);
  }

  return { buckets: out, allOnMs, someOnMs, offMs, peak, members: members.length };
}
