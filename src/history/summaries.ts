// Semantic headline metrics for the Analytics overview.
//
// The first version's tiles derived their headline from "the first numeric
// series in the category", which on a real home showed a humidity as the
// Climate number and 0.0% as Energy. Headlines now come from LIVE accessory
// state — complete, current, and free (the dashboard already holds it) —
// while history only supplies trends. Pure functions over a neutral
// LiveAccessory shape so the mock and the real dashboard feed the same code.

import { canonicalHistoryType } from './keys';
import type { HomeKitAccessory } from '@/lib/graphql/types';

export interface LiveAccessory {
  id: string;
  name: string;
  room: string | null;
  isVirtual?: boolean;
  /** canonical characteristicType → current value. */
  values: Record<string, number | string>;
}

/** Real dashboard data → the neutral shape (canonicalised, values only). */
export function liveFromHomeKit(accessories: HomeKitAccessory[]): LiveAccessory[] {
  return accessories.map(acc => {
    const values: Record<string, number | string> = {};
    for (const service of acc.services ?? []) {
      for (const char of service.characteristics ?? []) {
        const value = char.value;
        if (value === null || value === undefined) continue;
        if (typeof value !== 'number' && typeof value !== 'string' && typeof value !== 'boolean') continue;
        const canonical = canonicalHistoryType(char.characteristicType);
        if (!(canonical in values)) {
          values[canonical] = typeof value === 'boolean' ? (value ? 1 : 0) : value;
        }
      }
    }
    return {
      id: acc.id,
      name: acc.name,
      room: acc.roomName ?? null,
      isVirtual: Boolean((acc as { isVirtual?: boolean }).isVirtual),
      values,
    };
  });
}

function num(v: number | string | undefined): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

export interface RoomTemp {
  room: string;
  temp: number;
  sensorCount: number;
}

export interface ClimateSummary {
  /** Average of every current_temperature reading in the home. */
  avgTemp: number | null;
  sensorCount: number;
  /** Per-room averages, sorted warm → cold. */
  rooms: RoomTemp[];
  warmest: RoomTemp | null;
  coldest: RoomTemp | null;
}

export function climateSummary(live: LiveAccessory[]): ClimateSummary {
  const byRoom = new Map<string, { sum: number; n: number }>();
  let sum = 0;
  let n = 0;
  for (const acc of live) {
    if (acc.isVirtual) continue;
    const temp = num(acc.values['current_temperature']);
    if (temp === null) continue;
    sum += temp;
    n++;
    const room = acc.room ?? 'Elsewhere';
    const entry = byRoom.get(room) ?? { sum: 0, n: 0 };
    entry.sum += temp;
    entry.n++;
    byRoom.set(room, entry);
  }
  const rooms = [...byRoom.entries()]
    .map(([room, { sum: s, n: c }]) => ({ room, temp: s / c, sensorCount: c }))
    .sort((a, b) => b.temp - a.temp);
  return {
    avgTemp: n > 0 ? sum / n : null,
    sensorCount: n,
    rooms,
    warmest: rooms[0] ?? null,
    coldest: rooms[rooms.length - 1] ?? null,
  };
}

export interface BatterySummary {
  lowest: { name: string; room: string | null; level: number } | null;
  /** Count below 20%. */
  lowCount: number;
  count: number;
}

export function batterySummary(live: LiveAccessory[]): BatterySummary {
  let lowest: BatterySummary['lowest'] = null;
  let lowCount = 0;
  let count = 0;
  for (const acc of live) {
    const level = num(acc.values['battery_level']);
    if (level === null) continue;
    count++;
    if (level < 20) lowCount++;
    if (!lowest || level < lowest.level) lowest = { name: acc.name, room: acc.room, level };
  }
  return { lowest, lowCount, count };
}

export interface EnergySummary {
  /** Sum of live wattage across metered accessories; null when none metered. */
  watts: number | null;
  meteredCount: number;
  /** Accessories currently switched on (power_state/active). */
  onCount: number;
  switchedCount: number;
}

export function energySummary(live: LiveAccessory[]): EnergySummary {
  let watts = 0;
  let meteredCount = 0;
  let onCount = 0;
  let switchedCount = 0;
  for (const acc of live) {
    if (acc.isVirtual) continue;
    const w = num(acc.values['eve_energy_watt']);
    if (w !== null) {
      watts += w;
      meteredCount++;
    }
    const power = num(acc.values['power_state']) ?? num(acc.values['active']);
    if (power !== null) {
      switchedCount++;
      if (power !== 0) onCount++;
    }
  }
  return { watts: meteredCount > 0 ? watts : null, meteredCount, onCount, switchedCount };
}

const SAFETY_TRIGGER_TYPES: Record<string, string> = {
  smoke_detected: 'Smoke',
  carbon_monoxide_detected: 'Carbon monoxide',
  carbon_dioxide_detected: 'CO₂',
  leak_detected: 'Leak',
};

export interface SafetySummary {
  /** Currently-triggered sensors — empty means all clear. */
  triggered: Array<{ name: string; room: string | null; label: string }>;
  sensorCount: number;
}

export function safetySummary(live: LiveAccessory[]): SafetySummary {
  const triggered: SafetySummary['triggered'] = [];
  let sensorCount = 0;
  for (const acc of live) {
    for (const [type, label] of Object.entries(SAFETY_TRIGGER_TYPES)) {
      const value = num(acc.values[type]);
      if (value === null) continue;
      sensorCount++;
      if (value !== 0) triggered.push({ name: acc.name, room: acc.room, label });
    }
  }
  return { triggered, sensorCount };
}
