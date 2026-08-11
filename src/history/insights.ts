// Computed highlights for the Analytics overview.
//
// "Insights" here are plain statistics, not AI: a room running warmer than
// the rest, a door busier than yesterday, a battery about to die. Each one
// is a sentence a person can act on, with a link to the exact chart that
// explains it. (The AI-analysis story stays on MCP — query_history hands an
// assistant the raw material; this module is what the app itself can say.)
//
// Pure functions: live state + two bounded history windows in, ranked
// sentences out. No fetching, no clock — the caller owns both.

import type { HistorySeriesData, HistorySeriesInfo } from '@/lib/graphql/types';
import type { CategoryId } from './categories';
import {
  climateSummary,
  batterySummary,
  safetySummary,
  type LiveAccessory,
} from './summaries';

export type InsightIcon =
  | 'warm' | 'cold' | 'trend-up' | 'trend-down'
  | 'battery' | 'activity' | 'air' | 'alert' | 'usage';

export interface InsightLink {
  category: CategoryId;
  room?: string | null;
}

export interface Insight {
  id: string;
  icon: InsightIcon;
  /** The sentence. */
  text: string;
  /** Optional second line ("lowest: Front Door at 12%"). */
  detail?: string;
  /** Ranking weight; higher = shown first. */
  severity: number;
  link?: InsightLink;
}

export interface InsightRefs {
  temperature: HistorySeriesInfo[];
  humidity: HistorySeriesInfo[];
  activity: HistorySeriesInfo[];
  power: HistorySeriesInfo[];
  /** Metered wattage series — the energy card's trend. */
  watts?: HistorySeriesInfo[];
}

const ACTIVITY_TYPES = new Set(['motion_detected', 'contact_state', 'occupancy_detected', 'current_door_state']);

/**
 * The bounded ref set the overview fetches for insight computation: one
 * temperature + humidity series per room, activity sensors, and switched
 * accessories — a couple of dozen refs, not the whole home.
 */
export function selectInsightRefs(
  recorded: HistorySeriesInfo[],
  info: Map<string, { name: string; room: string | null }>,
): InsightRefs {
  const onePerRoom = (type: string, cap: number): HistorySeriesInfo[] => {
    const seen = new Set<string>();
    const out: HistorySeriesInfo[] = [];
    for (const s of recorded) {
      if (!s.enabled || s.characteristicType !== type) continue;
      const room = info.get(s.accessoryId.toUpperCase())?.room ?? `__${s.accessoryId}`;
      if (seen.has(room)) continue;
      seen.add(room);
      out.push(s);
      if (out.length >= cap) break;
    }
    return out;
  };

  const activity: HistorySeriesInfo[] = [];
  const activityRooms = new Set<string>();
  for (const s of recorded) {
    if (!s.enabled || !ACTIVITY_TYPES.has(s.characteristicType)) continue;
    const room = info.get(s.accessoryId.toUpperCase())?.room ?? `__${s.accessoryId}`;
    if (activityRooms.has(`${room}|${s.characteristicType}`)) continue;
    activityRooms.add(`${room}|${s.characteristicType}`);
    activity.push(s);
    if (activity.length >= 8) break;
  }

  return {
    temperature: onePerRoom('current_temperature', 8),
    humidity: onePerRoom('relative_humidity', 6),
    activity,
    power: recorded.filter(s => s.enabled && s.characteristicType === 'power_state').slice(0, 6),
    watts: recorded.filter(s => s.enabled && s.characteristicType === 'eve_energy_watt').slice(0, 4),
  };
}

/** Transition count across whatever tier the window was served at. */
export function eventCount(data: HistorySeriesData): number {
  if (data.states.length > 0) return data.states.length;
  return data.stateBuckets.reduce((n, b) => n + b.transitions, 0);
}

/** Plain mean of the served averages — insight thresholds, not billing. */
export function meanValue(data: HistorySeriesData): number | null {
  if (data.points.length === 0) return null;
  return data.points.reduce((a, p) => a + p.avg, 0) / data.points.length;
}

/** Time spent in a non-zero state over [fromTs, toTs]. */
export function onMs(data: HistorySeriesData, fromTs: number, toTs: number): number {
  if (data.states.length > 0) {
    let total = 0;
    let prevTs = fromTs;
    let prevOn = (data.prevValue ?? 0) !== 0;
    for (const span of data.states) {
      if (prevOn) total += Math.max(0, span.ts - prevTs);
      prevTs = span.ts;
      prevOn = span.value !== 0;
    }
    if (prevOn) total += Math.max(0, toTs - prevTs);
    return total;
  }
  let total = 0;
  for (const bucket of data.stateBuckets) {
    try {
      const stateMs = JSON.parse(bucket.stateMsJson) as Record<string, number>;
      for (const [key, ms] of Object.entries(stateMs)) {
        if (key !== '0') total += ms;
      }
    } catch { /* dominant-only cell */ }
  }
  return total;
}

export interface InsightsInput {
  live: LiveAccessory[];
  refs: InsightRefs;
  /** `${ACCESSORYID.toUpperCase()}|${type}` → series for today's window. */
  today: Map<string, HistorySeriesData>;
  /** Same keys, same clock window 24h earlier. */
  yesterday: Map<string, HistorySeriesData>;
  window: { fromTs: number; toTs: number };
  info: Map<string, { name: string; room: string | null }>;
}

const keyOf = (s: HistorySeriesInfo) => `${s.accessoryId.toUpperCase()}|${s.characteristicType}`;

export function computeInsights(input: InsightsInput): Insight[] {
  const { live, refs, today, yesterday, window, info } = input;
  const out: Insight[] = [];
  const fmtH = (ms: number) => (ms / 3_600_000).toFixed(1).replace(/\.0$/, '');

  // 1. Safety sensors currently triggered — always first.
  const safety = safetySummary(live);
  for (const t of safety.triggered) {
    out.push({
      id: `safety:${t.name}`,
      icon: 'alert',
      text: `${t.label} detected — ${t.name}${t.room ? ` (${t.room})` : ''}`,
      severity: 100,
      link: { category: 'safety' },
    });
  }

  // 2. Room temperature outlier vs the rest of the home (live).
  const climate = climateSummary(live);
  if (climate.avgTemp !== null && climate.rooms.length >= 3) {
    for (const room of [climate.warmest, climate.coldest]) {
      if (!room) continue;
      const rest = (climate.avgTemp * climate.sensorCount - room.temp * room.sensorCount)
        / Math.max(climate.sensorCount - room.sensorCount, 1);
      const diff = room.temp - rest;
      if (Math.abs(diff) >= 2) {
        out.push({
          id: `outlier:${room.room}`,
          icon: diff > 0 ? 'warm' : 'cold',
          text: `${room.room} is ${Math.abs(diff).toFixed(1)}° ${diff > 0 ? 'warmer' : 'cooler'} than the rest of the home`,
          detail: `${room.temp.toFixed(1)}° now · home average ${climate.avgTemp.toFixed(1)}°`,
          severity: 55 + Math.min(Math.abs(diff) * 2, 15),
          link: { category: 'climate', room: room.room },
        });
      }
    }
  }

  // 3. CO₂ high (live).
  for (const acc of live) {
    const co2 = acc.values['carbon_dioxide_level'];
    if (typeof co2 === 'number' && co2 > 1000) {
      out.push({
        id: `co2:${acc.id}`,
        icon: 'air',
        text: `CO₂ in ${acc.room ?? acc.name} is ${Math.round(co2)} ppm — time to air the room`,
        severity: 70,
        link: { category: 'safety' },
      });
    }
  }

  // 4. Low batteries (live).
  const battery = batterySummary(live);
  if (battery.lowCount > 0 && battery.lowest) {
    out.push({
      id: 'battery-low',
      icon: 'battery',
      text: battery.lowCount === 1
        ? `${battery.lowest.name} battery is at ${Math.round(battery.lowest.level)}%`
        : `${battery.lowCount} batteries below 20%`,
      detail: battery.lowCount === 1 ? undefined : `lowest: ${battery.lowest.name} at ${Math.round(battery.lowest.level)}%`,
      severity: 50,
      link: { category: 'battery' },
    });
  }

  // 5. Activity vs the same window yesterday.
  let eventsToday = 0;
  let eventsYesterday = 0;
  for (const ref of refs.activity) {
    const k = keyOf(ref);
    const t = today.get(k);
    const y = yesterday.get(k);
    if (t) eventsToday += eventCount(t);
    if (y) eventsYesterday += eventCount(y);
  }
  if (eventsYesterday >= 6 || eventsToday >= 6) {
    const ratio = eventsYesterday > 0 ? eventsToday / eventsYesterday : Infinity;
    if (ratio >= 1.6 || ratio <= 0.4) {
      const busier = ratio >= 1.6;
      out.push({
        id: 'activity-anomaly',
        icon: 'activity',
        text: busier
          ? `Busier than usual: ${eventsToday} events so far today`
          : `Quieter than usual: ${eventsToday} events so far today`,
        detail: `about ${eventsYesterday} by this time yesterday`,
        severity: 40,
        link: { category: 'activity' },
      });
    }
  }

  // 6. Room climate drift vs the same window yesterday (max 2 shown).
  const drifts: Insight[] = [];
  const driftCheck = (ref: HistorySeriesInfo, unit: '°' | '%', threshold: number, measure: string) => {
    const k = keyOf(ref);
    const t = today.get(k);
    const y = yesterday.get(k);
    if (!t || !y) return;
    const tv = meanValue(t);
    const yv = meanValue(y);
    if (tv === null || yv === null) return;
    const diff = tv - yv;
    if (Math.abs(diff) < threshold) return;
    const room = info.get(ref.accessoryId.toUpperCase())?.room ?? 'A room';
    drifts.push({
      id: `drift:${k}`,
      icon: diff > 0 ? 'trend-up' : 'trend-down',
      text: `${room} ${measure} is ${diff > 0 ? 'up' : 'down'} ${Math.abs(diff).toFixed(unit === '°' ? 1 : 0)}${unit} on yesterday`,
      severity: 34 + Math.min(Math.abs(diff), 6),
      link: { category: 'climate', room },
    });
  };
  for (const ref of refs.temperature) driftCheck(ref, '°', 1.5, 'temperature');
  for (const ref of refs.humidity) driftCheck(ref, '%', 8, 'humidity');
  drifts.sort((a, b) => b.severity - a.severity);
  out.push(...drifts.slice(0, 2));

  // 7. Longest-running switched accessory today.
  let longest: { name: string; ms: number } | null = null;
  for (const ref of refs.power) {
    const t = today.get(keyOf(ref));
    if (!t) continue;
    const ms = onMs(t, window.fromTs, window.toTs);
    if (!longest || ms > longest.ms) {
      longest = { name: info.get(ref.accessoryId.toUpperCase())?.name ?? ref.accessoryId, ms };
    }
  }
  if (longest && longest.ms >= 8 * 3_600_000) {
    out.push({
      id: 'longest-on',
      icon: 'usage',
      text: `${longest.name} has been on ${fmtH(longest.ms)}h today`,
      severity: 30,
      link: { category: 'energy' },
    });
  }

  out.sort((a, b) => b.severity - a.severity);
  return out.slice(0, 6);
}
