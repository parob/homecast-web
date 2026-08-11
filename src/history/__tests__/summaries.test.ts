import { describe, it, expect } from 'vitest';
import {
  climateSummary,
  batterySummary,
  energySummary,
  safetySummary,
  liveFromHomeKit,
  type LiveAccessory,
} from '../summaries';
import type { HomeKitAccessory } from '@/lib/graphql/types';

const acc = (id: string, room: string | null, values: Record<string, number | string>, isVirtual = false): LiveAccessory =>
  ({ id, name: id, room, values, isVirtual });

describe('climateSummary', () => {
  it('averages every temperature and finds the outlier rooms', () => {
    const s = climateSummary([
      acc('a', 'Living', { current_temperature: 20 }),
      acc('b', 'Living', { current_temperature: 21 }),
      acc('c', 'Bedroom 2', { current_temperature: 24 }),
      acc('d', 'Kitchen', { current_temperature: 19 }),
      acc('e', 'Kitchen', { relative_humidity: 60 }), // no temp — not counted
    ]);
    expect(s.sensorCount).toBe(4);
    expect(s.avgTemp).toBeCloseTo(21, 5);
    expect(s.warmest!.room).toBe('Bedroom 2');
    expect(s.coldest!.room).toBe('Kitchen');
    expect(s.rooms.find(r => r.room === 'Living')!.temp).toBeCloseTo(20.5, 5);
  });

  it('virtual accessories never pollute the climate picture', () => {
    const s = climateSummary([
      acc('a', 'Living', { current_temperature: 20 }),
      acc('virt', null, { current_temperature: 99 }, true),
    ]);
    expect(s.sensorCount).toBe(1);
    expect(s.avgTemp).toBe(20);
  });
});

describe('batterySummary', () => {
  it('finds the lowest and counts the low ones', () => {
    const s = batterySummary([
      acc('a', 'Hall', { battery_level: 12 }),
      acc('b', 'Bed', { battery_level: 84 }),
      acc('c', 'Bed', { battery_level: 17 }),
    ]);
    expect(s.count).toBe(3);
    expect(s.lowCount).toBe(2);
    expect(s.lowest).toMatchObject({ name: 'a', level: 12 });
  });
});

describe('energySummary', () => {
  it('sums watts and counts what is on', () => {
    const s = energySummary([
      acc('a', 'Study', { power_state: 1, eve_energy_watt: 145 }),
      acc('b', 'Living', { power_state: 0 }),
      acc('c', 'Living', { active: 1 }),
    ]);
    expect(s.watts).toBe(145);
    expect(s.meteredCount).toBe(1);
    expect(s.onCount).toBe(2);
    expect(s.switchedCount).toBe(3);
  });

  it('watts is null when nothing is metered', () => {
    expect(energySummary([acc('a', null, { power_state: 1 })]).watts).toBeNull();
  });
});

describe('safetySummary', () => {
  it('all clear vs triggered', () => {
    const clear = safetySummary([acc('a', 'Hall', { smoke_detected: 0 })]);
    expect(clear.triggered).toHaveLength(0);
    expect(clear.sensorCount).toBe(1);

    const fired = safetySummary([
      acc('a', 'Hall', { smoke_detected: 0 }),
      acc('b', 'Kitchen', { carbon_monoxide_detected: 1 }),
    ]);
    expect(fired.triggered).toEqual([{ name: 'b', room: 'Kitchen', label: 'Carbon monoxide' }]);
  });
});

describe('liveFromHomeKit', () => {
  it('canonicalises and flattens characteristic values', () => {
    const hk: HomeKitAccessory = {
      id: 'ACC-1', name: 'Lamp', roomName: 'Study', isReachable: true,
      services: [{
        id: 's1', name: 'Light', serviceType: 'lightbulb',
        characteristics: [
          { id: 'c1', characteristicType: 'on', value: true, isReadable: true, isWritable: true },
          { id: 'c2', characteristicType: 'brightness', value: 40, isReadable: true, isWritable: true },
          { id: 'c3', characteristicType: 'name', value: undefined, isReadable: true, isWritable: false },
        ],
      }],
    };
    const [live] = liveFromHomeKit([hk]);
    expect(live.room).toBe('Study');
    expect(live.values['power_state']).toBe(1); // on → canonical + bool → 1
    expect(live.values['brightness']).toBe(40);
  });
});
