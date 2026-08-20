import { describe, it, expect } from 'vitest';
import {
  buildStatusCategories,
  describeStatusCategories,
  DEFAULT_MAX_REFS_PER_CATEGORY,
  STATUS_CATEGORY_TITLE,
} from '../status-series';
import type { AggregatedSensorData, SensorReading } from '@/hooks/useSensorAggregation';

function reading(
  accessoryId: string,
  characteristicType: string,
  extra: Partial<SensorReading> = {},
): SensorReading {
  return {
    accessoryId,
    accessoryName: accessoryId,
    value: 0,
    characteristicType,
    ...extra,
  };
}

const EMPTY: AggregatedSensorData = {
  temperature: null,
  humidity: null,
  motion: null,
  locks: null,
  contacts: null,
  lowBattery: null,
  hasData: false,
};

function numeric(readings: SensorReading[]) {
  return { avg: 0, min: 0, max: 0, readings };
}

describe('buildStatusCategories', () => {
  it('returns nothing for an empty aggregation', () => {
    expect(buildStatusCategories(EMPTY)).toEqual([]);
  });

  it('builds one category per populated bubble, in bubble order', () => {
    const out = buildStatusCategories({
      ...EMPTY,
      lowBattery: { count: 1, readings: [reading('d', 'status_low_battery')] },
      temperature: numeric([reading('a', 'current_temperature')]),
      contacts: { openCount: 0, closedCount: 1, readings: [reading('c', 'contact_state')] },
      hasData: true,
    });

    // Declaration order in the aggregation is irrelevant — the row's order wins.
    expect(out.map(c => c.key)).toEqual(['temperature', 'contacts', 'battery']);
    expect(out[0].title).toBe(STATUS_CATEGORY_TITLE.temperature);
    expect(out[0].kind).toBe('numeric');
    expect(out[1].kind).toBe('state');
  });

  it('keeps each motion reading on the type it actually reported', () => {
    const [motion] = buildStatusCategories({
      ...EMPTY,
      motion: {
        activeCount: 0,
        totalCount: 2,
        readings: [reading('a', 'motion_detected'), reading('b', 'occupancy_detected')],
      },
      hasData: true,
    });

    // Two distinct canonical types — merging them into one would silently
    // chart the wrong series for occupancy sensors.
    expect(motion.refs.map(r => [r.accessoryId, r.characteristicType])).toEqual([
      ['a', 'motion_detected'],
      ['b', 'occupancy_detected'],
    ]);
  });

  it('carries the name and room each reading came from', () => {
    // The labels a split-apart chart puts on its lines.
    const [temperature] = buildStatusCategories({
      ...EMPTY,
      temperature: numeric([
        reading('a', 'current_temperature', { accessoryName: 'Bookshelf', roomName: 'Living Room' }),
      ]),
      hasData: true,
    });

    expect(temperature.refs[0]).toMatchObject({
      accessoryName: 'Bookshelf',
      roomName: 'Living Room',
    });
  });

  it('canonicalises the alias forms older relays report', () => {
    const out = buildStatusCategories({
      ...EMPTY,
      humidity: numeric([reading('a', 'current_relative_humidity')]),
      contacts: { openCount: 0, closedCount: 1, readings: [reading('b', 'contact_sensor_state')] },
      hasData: true,
    });

    expect(out.find(c => c.key === 'humidity')!.refs[0].characteristicType).toBe('relative_humidity');
    expect(out.find(c => c.key === 'contacts')!.refs[0].characteristicType).toBe('contact_state');
  });

  it('counts a jammed lock as not locked', () => {
    const [locks] = buildStatusCategories({
      ...EMPTY,
      locks: {
        lockedCount: 1, unlockedCount: 0, jammedCount: 0,
        readings: [reading('a', 'lock_current_state')],
      },
      hasData: true,
    });

    // 0 unsecured / 1 secured / 2 jammed / 3 unknown.
    expect(locks.isOn!(0)).toBe(true);
    expect(locks.isOn!(1)).toBe(false);
    expect(locks.isOn!(2)).toBe(true);
    expect(locks.isOn!(3)).toBe(true);
  });

  it('treats non-zero as on everywhere else', () => {
    const out = buildStatusCategories({
      ...EMPTY,
      motion: { activeCount: 0, totalCount: 1, readings: [reading('a', 'motion_detected')] },
      contacts: { openCount: 0, closedCount: 1, readings: [reading('b', 'contact_state')] },
      lowBattery: { count: 1, readings: [reading('c', 'status_low_battery')] },
      hasData: true,
    });

    for (const category of out) {
      expect(category.isOn!(0)).toBe(false);
      expect(category.isOn!(1)).toBe(true);
    }
  });

  it('builds just the requested category when `only` is given', () => {
    const data: AggregatedSensorData = {
      ...EMPTY,
      temperature: numeric([reading('a', 'current_temperature')]),
      motion: { activeCount: 0, totalCount: 1, readings: [reading('b', 'motion_detected')] },
      hasData: true,
    };

    expect(buildStatusCategories(data, { only: 'motion' }).map(c => c.key)).toEqual(['motion']);
  });

  it('dedupes a repeated accessory + characteristic', () => {
    const [temperature] = buildStatusCategories({
      ...EMPTY,
      temperature: numeric([
        reading('a', 'current_temperature'),
        reading('A', 'current_temperature'),
      ]),
      hasData: true,
    });

    // UUIDs are case-insensitive, so these are the same series.
    expect(temperature.refs).toHaveLength(1);
  });

  it('caps the refs and says how many it dropped', () => {
    const readings = Array.from({ length: DEFAULT_MAX_REFS_PER_CATEGORY + 5 }, (_, i) =>
      reading(`acc-${i}`, 'current_temperature'));
    const [temperature] = buildStatusCategories({
      ...EMPTY, temperature: numeric(readings), hasData: true,
    });

    expect(temperature.refs).toHaveLength(DEFAULT_MAX_REFS_PER_CATEGORY);
    expect(temperature.truncated).toBe(5);
  });

  it('honours a larger per-category cap', () => {
    const readings = Array.from({ length: 20 }, (_, i) => reading(`acc-${i}`, 'current_temperature'));
    const [temperature] = buildStatusCategories({
      ...EMPTY, temperature: numeric(readings), hasData: true,
    }, { maxRefsPerCategory: 24 });

    expect(temperature.refs).toHaveLength(20);
    expect(temperature.truncated).toBe(0);
  });

  it('drops readings from homes that do not record, and empty categories with them', () => {
    const out = buildStatusCategories({
      ...EMPTY,
      temperature: numeric([
        reading('a', 'current_temperature', { homeId: 'REC' }),
        reading('b', 'current_temperature', { homeId: 'OFF' }),
      ]),
      humidity: numeric([reading('c', 'relative_humidity', { homeId: 'OFF' })]),
      hasData: true,
    }, { isHomeRecording: homeId => homeId === 'REC' });

    expect(out.map(c => c.key)).toEqual(['temperature']);
    expect(out[0].refs.map(r => r.accessoryId)).toEqual(['a']);
    expect(out[0].homeIds).toEqual(['REC']);
  });

  it('lists only the homes whose refs survived the cap', () => {
    const readings = [
      ...Array.from({ length: DEFAULT_MAX_REFS_PER_CATEGORY }, (_, i) =>
        reading(`acc-${i}`, 'current_temperature', { homeId: 'HOME-A' })),
      reading('late', 'current_temperature', { homeId: 'HOME-B' }),
    ];
    const [temperature] = buildStatusCategories({
      ...EMPTY, temperature: numeric(readings), hasData: true,
    });

    expect(temperature.truncated).toBe(1);
    expect(temperature.homeIds).toEqual(['HOME-A']);
  });
});

describe('describeStatusCategories', () => {
  const build = (data: Partial<AggregatedSensorData>) =>
    buildStatusCategories({ ...EMPTY, ...data, hasData: true });

  it('counts the distinct sensors, not the series', () => {
    // One accessory reporting both temperature and humidity is one sensor.
    const categories = build({
      temperature: numeric([reading('a', 'current_temperature')]),
      humidity: numeric([reading('a', 'relative_humidity')]),
    });

    expect(describeStatusCategories(categories)).toBe('temperature and humidity · 1 sensor');
  });

  it('gives just the count for a single category', () => {
    const categories = build({
      temperature: numeric([reading('a', 'current_temperature'), reading('b', 'current_temperature')]),
    });

    expect(describeStatusCategories(categories)).toBe('2 sensors');
  });

  it('stops listing after three and says how many are left', () => {
    const categories = build({
      temperature: numeric([reading('a', 'current_temperature')]),
      humidity: numeric([reading('b', 'relative_humidity')]),
      motion: { activeCount: 0, totalCount: 1, readings: [reading('c', 'motion_detected')] },
      locks: { lockedCount: 1, unlockedCount: 0, jammedCount: 0, readings: [reading('d', 'lock_current_state')] },
      contacts: { openCount: 0, closedCount: 1, readings: [reading('e', 'contact_state')] },
    });

    expect(describeStatusCategories(categories))
      .toBe('temperature, humidity, motion and 2 more · 5 sensors');
  });

  it('says nothing about categories when there are none', () => {
    expect(describeStatusCategories([])).toBe('0 sensors');
  });
});
