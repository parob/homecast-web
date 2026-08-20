/**
 * What a Status bubble means in history terms.
 *
 * `AreaSummary` shows six live aggregates — temperature, humidity, motion,
 * locks, contacts, low battery. Every one of them is a recorded series, so
 * each bubble can be charted over time. This module is the one place that
 * knows how to turn an aggregation back into history queries: which
 * characteristic each reading came from, how to phrase the aggregate, and
 * what counts as "on" for the state categories.
 *
 * Pure and unit-tested — the wording and the lock predicate below are the
 * kind of thing that is easy to get subtly wrong and hard to notice.
 */

import { canonicalHistoryType } from './keys';
import type { AggregatedSensorData, SensorReading } from '@/hooks/useSensorAggregation';

export type StatusCategoryKey =
  | 'temperature'
  | 'humidity'
  | 'motion'
  | 'locks'
  | 'contacts'
  | 'battery';

export interface StatusSeriesRef {
  /** A collection's accessories can span homes, and history is per-home. */
  homeId?: string;
  accessoryId: string;
  characteristicType: string;
}

export interface StatusHistoryCategory {
  key: StatusCategoryKey;
  /** Panel heading — "Temperature", "Motion", … */
  title: string;
  kind: 'numeric' | 'state';
  /** Falls back to whatever the served series reports. */
  unit: string | null;
  /** State categories: what counts as "on" in the how-many-are aggregate. */
  isOn?: (value: number) => boolean;
  /** State categories: fills "how many of N are ___" and "___ for 2h 14m". */
  onLabel?: string;
  refs: StatusSeriesRef[];
  /** Sensors dropped by the cap — never truncate silently. */
  truncated: number;
  /** Homes contributing, de-duplicated. The analytics opt-in is per home. */
  homeIds: string[];
}

/**
 * The row dialog charts six categories at once and each ref is a round trip
 * (six to a query), so it takes a tighter default than a single-category
 * popup. Past a couple of dozen sensors an average stops changing shape.
 */
export const DEFAULT_MAX_REFS_PER_CATEGORY = 12;

interface CategorySpec {
  key: StatusCategoryKey;
  title: string;
  kind: 'numeric' | 'state';
  unit: string | null;
  isOn?: (value: number) => boolean;
  onLabel?: string;
  readings: (data: AggregatedSensorData) => SensorReading[] | undefined;
}

/**
 * Order matches the bubbles in AreaSummary, so the dialog reads top to bottom
 * the way the row reads left to right.
 */
const SPECS: CategorySpec[] = [
  {
    key: 'temperature',
    title: 'Temperature',
    kind: 'numeric',
    unit: '°',
    readings: d => d.temperature?.readings,
  },
  {
    key: 'humidity',
    title: 'Humidity',
    kind: 'numeric',
    unit: '%',
    readings: d => d.humidity?.readings,
  },
  {
    key: 'motion',
    title: 'Motion',
    kind: 'state',
    unit: null,
    isOn: v => v !== 0,
    onLabel: 'detecting motion',
    readings: d => d.motion?.readings,
  },
  {
    key: 'locks',
    title: 'Locks',
    kind: 'state',
    unit: null,
    // lock_current_state is 0 unsecured / 1 secured / 2 jammed / 3 unknown.
    // "Unlocked" is everything that is not secured — a jammed lock is not a
    // locked door, and the bubble already warns about it.
    isOn: v => v !== 1,
    onLabel: 'unlocked',
    readings: d => d.locks?.readings,
  },
  {
    key: 'contacts',
    title: 'Contacts',
    kind: 'state',
    unit: null,
    // contact_state is 0 detected (closed) / 1 not detected (open).
    isOn: v => v !== 0,
    onLabel: 'open',
    readings: d => d.contacts?.readings,
  },
  {
    key: 'battery',
    title: 'Low battery',
    kind: 'state',
    unit: null,
    isOn: v => v !== 0,
    onLabel: 'low',
    // Only the accessories currently reporting low — the same set the bubble
    // lists. Charting every battery in the home would answer a different
    // question than the one the bubble was asking.
    readings: d => d.lowBattery?.readings,
  },
];

export const STATUS_CATEGORY_TITLE: Record<StatusCategoryKey, string> = SPECS.reduce(
  (acc, spec) => { acc[spec.key] = spec.title; return acc; },
  {} as Record<StatusCategoryKey, string>,
);

export interface BuildStatusCategoriesOptions {
  /** Build just this one — the per-bubble button. */
  only?: StatusCategoryKey;
  /** Per-category ref cap. Defaults to DEFAULT_MAX_REFS_PER_CATEGORY. */
  maxRefsPerCategory?: number;
  /** Drop categories whose readings are in no recording home. */
  isHomeRecording?: (homeId: string | undefined) => boolean;
}

/**
 * Turn a live aggregation into the categories a status analytics dialog can
 * chart. Categories with no readings — or none in a recording home — are
 * left out entirely, so an empty result means "nothing to offer here".
 */
export function buildStatusCategories(
  data: AggregatedSensorData,
  options: BuildStatusCategoriesOptions = {},
): StatusHistoryCategory[] {
  const {
    only,
    maxRefsPerCategory = DEFAULT_MAX_REFS_PER_CATEGORY,
    isHomeRecording,
  } = options;

  const out: StatusHistoryCategory[] = [];

  for (const spec of SPECS) {
    if (only && spec.key !== only) continue;

    const readings = spec.readings(data) ?? [];
    const eligible = isHomeRecording
      ? readings.filter(r => isHomeRecording(r.homeId))
      : readings;
    if (eligible.length === 0) continue;

    // One ref per accessory per category. Canonicalise: the same
    // characteristic arrives as current_relative_humidity from one relay and
    // relative_humidity from another, and history is keyed by the canonical
    // name.
    const seen = new Set<string>();
    const all: StatusSeriesRef[] = [];
    for (const reading of eligible) {
      const characteristicType = canonicalHistoryType(reading.characteristicType);
      const key = `${reading.accessoryId.toUpperCase()}|${characteristicType}`;
      if (seen.has(key)) continue;
      seen.add(key);
      all.push({ homeId: reading.homeId, accessoryId: reading.accessoryId, characteristicType });
    }

    const truncated = Math.max(0, all.length - maxRefsPerCategory);
    const refs = truncated > 0 ? all.slice(0, maxRefsPerCategory) : all;

    // From the kept refs only: a home whose every sensor was cut is not
    // contributing to this chart.
    const homeIds: string[] = [];
    for (const ref of refs) {
      if (ref.homeId && !homeIds.includes(ref.homeId)) homeIds.push(ref.homeId);
    }

    out.push({
      key: spec.key,
      title: spec.title,
      kind: spec.kind,
      unit: spec.unit,
      isOn: spec.isOn,
      onLabel: spec.onLabel,
      refs,
      truncated,
      homeIds,
    });
  }

  return out;
}
