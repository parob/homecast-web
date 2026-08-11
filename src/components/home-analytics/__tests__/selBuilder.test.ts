import { describe, it, expect } from 'vitest';
import { accessoryDisplayNames, buildSels, labelWithRoom, labelWithoutRoom, roundRobinByRoom } from '../selBuilder';
import type { AccessoryInfoEntry } from '@/history/categories';
import type { HistorySeriesInfo } from '@/lib/graphql/types';

const info = (accessoryId: string, characteristicType: string): HistorySeriesInfo => ({
  accessoryId,
  characteristicType,
  kind: 'numeric',
  unit: '°',
} as HistorySeriesInfo);

const infoMap = (entries: [string, AccessoryInfoEntry][]) => new Map(entries);

describe('buildSels', () => {
  it('splits the accessory name from the characteristic, room prefix removed', () => {
    const sels = buildSels(
      [info('A1', 'current_temperature'), info('A1', 'target_temperature')],
      infoMap([['A1', { name: 'Bedroom 2 Underfloor Heating', room: 'Bedroom 2' } as AccessoryInfoEntry]]),
    );
    expect(sels.map(s => s.accessoryName)).toEqual(['Underfloor Heating', 'Underfloor Heating']);
    expect(sels.map(s => s.charLabel)).toEqual(['Temperature', 'Target Temperature']);
  });
});

describe('labelWithoutRoom', () => {
  it('names the accessory and characteristic only — the view already said the room', () => {
    const [sel] = buildSels(
      [info('A1', 'motion_detected')],
      infoMap([['A1', { name: 'Kitchen Motion Sensor', room: 'Kitchen' } as AccessoryInfoEntry]]),
    );
    expect(labelWithoutRoom(sel)).toBe('Motion Sensor · Motion Detected');
    // The disambiguated label still carries the room for cross-room views.
    expect(sel.label).toContain('Kitchen');
  });

  it('falls back to the full label when the parts are missing', () => {
    expect(labelWithoutRoom({
      accessoryId: 'A1',
      characteristicType: 'x',
      label: 'Fallback',
      room: null,
      unit: '',
      kind: 'numeric',
    })).toBe('Fallback');
  });
});

describe('roundRobinByRoom', () => {
  it('takes one per room before a second, so no room drops out entirely', () => {
    const sels = ['A', 'A', 'A', 'B', 'C'].map((room, i) => ({
      accessoryId: `id${i}`,
      characteristicType: 'current_temperature',
      label: `${room}${i}`,
      room,
      unit: '°',
      kind: 'numeric' as const,
    }));
    const { taken, dropped } = roundRobinByRoom(sels, 3);
    expect(taken.map(s => s.room)).toEqual(['A', 'B', 'C']);
    expect(dropped).toBe(2);
  });
});

describe('accessoryDisplayNames', () => {
  it('keeps the short name when it is unambiguous in this view', () => {
    const names = accessoryDisplayNames([
      { accessoryId: 'A1', room: 'Kitchen', accessoryName: 'Underfloor Heating' },
      { accessoryId: 'A2', room: 'Study', accessoryName: 'Ensuite Radiator' },
    ]);
    expect(names.get('A1')).toBe('Underfloor Heating');
    expect(names.get('A2')).toBe('Ensuite Radiator');
  });

  it('puts the room back when several accessories share a short name', () => {
    // Six rooms' worth of "Underfloor Heating" are six accessories; grouping
    // them by name collapsed them into one box of identical chips.
    const names = accessoryDisplayNames([
      { accessoryId: 'A1', room: 'Kitchen', accessoryName: 'Underfloor Heating' },
      { accessoryId: 'A2', room: 'Study', accessoryName: 'Underfloor Heating' },
      { accessoryId: 'A3', room: 'Hallway', accessoryName: 'Ensuite Radiator' },
    ]);
    expect(names.get('A1')).toBe('Kitchen · Underfloor Heating');
    expect(names.get('A2')).toBe('Study · Underfloor Heating');
    expect(names.get('A3')).toBe('Ensuite Radiator');
  });

  it('keys on identity, so one accessory with many characteristics stays one', () => {
    const names = accessoryDisplayNames([
      { accessoryId: 'A1', room: 'Kitchen', accessoryName: 'Underfloor Heating' },
      { accessoryId: 'a1', room: 'Kitchen', accessoryName: 'Underfloor Heating' },
    ]);
    expect(names.size).toBe(1);
    expect(names.get('A1')).toBe('Underfloor Heating');
  });
});

describe('labelWithRoom', () => {
  const sel = (accessoryName: string, room: string | null) =>
    buildSels(
      [info('A1', 'power_state')],
      new Map([['A1', { name: accessoryName, room } as AccessoryInfoEntry]]),
    )[0];

  it('puts the room back for a list that spans rooms', () => {
    expect(labelWithRoom(sel('Hue ambiance spot 3', 'Living'))).toBe('Living · Hue ambiance spot 3 · Power State');
  });

  it('does not say the room twice when the name already carries it', () => {
    // HomeKit names are inconsistent; strip-then-re-add makes both shapes
    // come out the same rather than "Living · Living Hue spot 3".
    expect(labelWithRoom(sel('Living Hue spot 3', 'Living'))).toBe('Living · Hue spot 3 · Power State');
  });

  it('calls a roomless accessory Elsewhere, as the tree does', () => {
    expect(labelWithRoom(sel('Holiday Mode', null))).toBe('Elsewhere · Holiday Mode · Power State');
  });
});
