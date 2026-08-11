import { describe, it, expect } from 'vitest';
import {
  CATEGORY_OF,
  categoryOf,
  vizFor,
  organizeRecorded,
  profiledTypes,
  type AccessoryInfoEntry,
} from '../categories';
import type { HistorySeriesInfo } from '@/lib/graphql/types';

const series = (accessoryId: string, type: string, enabled = true): HistorySeriesInfo => ({
  accessoryId,
  characteristicType: type,
  kind: 'numeric',
  unit: null,
  enabled,
  minIntervalS: null,
  deadband: null,
  firstTs: null,
  lastTs: null,
  sampleCount: 10,
});

describe('CATEGORY_OF totality', () => {
  it('assigns every profiled type to a category — no orphans, no strays', () => {
    // The invariant that killed the preset era's 41 unreachable types: a new
    // profile MUST pick a category or this fails CI.
    expect(Object.keys(CATEGORY_OF).sort()).toEqual(profiledTypes().sort());
  });

  it('routes aliases through canonicalisation', () => {
    expect(categoryOf('on')).toBe('energy'); // → power_state
    expect(categoryOf('contact_sensor_state')).toBe('activity'); // → contact_state
  });

  it('virtual accessories land in virtual regardless of characteristic', () => {
    expect(categoryOf('power_state')).toBe('energy');
    expect(categoryOf('power_state', { isVirtualAccessory: true })).toBe('virtual');
  });

  it('unknown types fall to other', () => {
    expect(categoryOf('mystery_characteristic')).toBe('other');
  });
});

describe('vizFor', () => {
  it('numeric → line, states → strip', () => {
    expect(vizFor('current_temperature')).toBe('line');
    expect(vizFor('power_state')).toBe('strip');
    expect(vizFor('lock_current_state')).toBe('strip');
  });
});

describe('organizeRecorded', () => {
  const info = new Map<string, AccessoryInfoEntry>([
    ['ACC-LR', { name: 'Living Room Sensor', room: 'Living Room' }],
    ['ACC-BED', { name: 'Bedroom Sensor', room: 'Bedroom' }],
    ['ACC-SMOKE', { name: 'Hall Smoke Alarm', room: 'Hallway' }],
    ['ACC-VIRT', { name: 'House Mode', room: null, isVirtual: true }],
  ]);

  it('groups series by category and room', () => {
    const cats = organizeRecorded([
      series('ACC-LR', 'current_temperature'),
      series('ACC-LR', 'relative_humidity'),
      series('ACC-BED', 'current_temperature'),
      series('ACC-LR', 'motion_detected'),
    ], info);

    const climate = cats.find(c => c.id === 'climate')!;
    expect(climate.series).toHaveLength(3);
    expect(climate.byRoom.get('Living Room')).toHaveLength(2);
    expect(climate.byRoom.get('Bedroom')).toHaveLength(1);
    expect(climate.roomCount).toBe(2);
    expect(climate.accessoryCount).toBe(2);

    const activity = cats.find(c => c.id === 'activity')!;
    expect(activity.series).toHaveLength(1);
    // Category order: climate before activity.
    expect(cats.indexOf(climate)).toBeLessThan(cats.indexOf(activity));
  });

  it('disabled series are excluded', () => {
    const cats = organizeRecorded([series('ACC-LR', 'current_temperature', false)], info);
    expect(cats).toHaveLength(0);
  });

  it('surfaces recordable-but-silent characteristics as monitoring', () => {
    const cats = organizeRecorded(
      [series('ACC-LR', 'current_temperature')],
      info,
      undefined,
      new Map([
        ['ACC-SMOKE', ['smoke_detected']],
        ['ACC-LR', ['current_temperature', 'motion_detected']],
      ]),
    );
    const safety = cats.find(c => c.id === 'safety')!;
    expect(safety.series).toHaveLength(0);
    expect(safety.monitoring).toEqual([{
      accessoryId: 'ACC-SMOKE',
      accessoryName: 'Hall Smoke Alarm',
      room: 'Hallway',
      characteristicType: 'smoke_detected',
    }]);
    // Recorded temperature isn't double-listed as monitoring; silent motion is.
    const activity = cats.find(c => c.id === 'activity')!;
    expect(activity.monitoring.map(m => m.characteristicType)).toEqual(['motion_detected']);
  });

  it('virtual accessories route to the virtual category', () => {
    const cats = organizeRecorded([series('ACC-VIRT', 'power_state')], info);
    expect(cats.find(c => c.id === 'virtual')!.series).toHaveLength(1);
    expect(cats.find(c => c.id === 'energy')).toBeUndefined();
  });

  it('builds the groups category and keeps group series out of type categories', () => {
    const cats = organizeRecorded(
      [series('GROUP-1', 'power_state'), series('ACC-LR', 'power_state')],
      info,
      [{ id: 'GROUP-1', name: 'Kitchen Lights', memberIds: ['ACC-LR'] }],
    );
    const groups = cats.find(c => c.id === 'groups')!;
    expect(groups.groups![0]).toMatchObject({ name: 'Kitchen Lights' });
    expect(groups.groups![0].series).toHaveLength(1);
    const energy = cats.find(c => c.id === 'energy')!;
    expect(energy.series.map(s => s.accessoryId)).toEqual(['ACC-LR']);
  });
});

describe('MEASURES', () => {
  it('every numeric profiled type maps to exactly one measure', async () => {
    const { MEASURES, measureOf, profiledTypes } = await import('../categories');
    const { getProfile } = await import('../policy');
    const listed = MEASURES.flatMap(m => m.types);
    expect(new Set(listed).size).toBe(listed.length); // no type in two measures
    for (const type of profiledTypes()) {
      if (getProfile(type)!.kind !== 'numeric') continue;
      const measure = measureOf(type);
      expect(measure.id).toBeTruthy();
      expect(measure.types).toContain(type);
    }
  });

  it('measuresIn returns distinct measures in registry order', async () => {
    const { measuresIn } = await import('../categories');
    const info = (accessoryId: string, characteristicType: string, kind = 'numeric' as const) => ({
      accessoryId, characteristicType, kind, unit: null, enabled: true,
      minIntervalS: null, deadband: null, firstTs: null, lastTs: null, sampleCount: 1,
    });
    const measures = measuresIn([
      info('A', 'relative_humidity'),
      info('B', 'current_temperature'),
      info('C', 'target_temperature'),
      info('D', 'motion_detected', 'bool' as never),
    ]);
    expect(measures.map(m => m.id)).toEqual(['temperature', 'humidity']);
  });
});
