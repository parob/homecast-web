import { describe, it, expect } from 'vitest';
import { buildSels, labelWithoutRoom, roundRobinByRoom } from '../selBuilder';
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
