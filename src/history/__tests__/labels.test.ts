import { describe, it, expect } from 'vitest';
import { disambiguateSeriesLabels, stripRoomPrefix, type LabelInput } from '../labels';
import { getDisplayName } from '@/lib/graphql/types';

const item = (key: string, room: string | null, accessoryName: string, charLabel: string): LabelInput =>
  ({ key, room, accessoryName, charLabel });

describe('disambiguateSeriesLabels', () => {
  it('one room, many sensors, same characteristic → sensor names survive', () => {
    const labels = disambiguateSeriesLabels([
      item('a', 'Living Room', 'Living Room Sensor', 'Temperature'),
      item('b', 'Living Room', 'Bookshelf Sensor', 'Temperature'),
    ]);
    // Room prefix strips first ("Living Room Sensor" → "Sensor"), then
    // shared words drop; what survives is what distinguishes.
    expect(labels.get('a')!.short).toBe('Sensor');
    expect(labels.get('b')!.short).toBe('Bookshelf');
    expect(labels.get('a')!.full).toBe('Living Room · Sensor · Temperature');
  });

  it('one characteristic across rooms → rooms survive', () => {
    const labels = disambiguateSeriesLabels([
      item('a', 'Living Room', 'Sensor', 'Temperature'),
      item('b', 'Bedroom', 'Sensor', 'Temperature'),
    ]);
    expect(labels.get('a')!.short).toBe('Living Room');
    expect(labels.get('b')!.short).toBe('Bedroom');
  });

  it('one sensor, many characteristics → characteristics survive', () => {
    const labels = disambiguateSeriesLabels([
      item('a', 'Study', 'Desk Sensor', 'Temperature'),
      item('b', 'Study', 'Desk Sensor', 'Humidity'),
    ]);
    expect(labels.get('a')!.short).toBe('Temperature');
    expect(labels.get('b')!.short).toBe('Humidity');
  });

  it('single series keeps its full label', () => {
    const labels = disambiguateSeriesLabels([
      item('a', 'Hallway', 'Front Door', 'Contact'),
    ]);
    expect(labels.get('a')!.short).toBe('Hallway · Front Door · Contact');
  });

  it('identical shorts regain distinguishing context', () => {
    const labels = disambiguateSeriesLabels([
      item('a', 'Living Room', 'Lamp', 'Power'),
      item('b', 'Bedroom', 'Lamp', 'Power'),
      item('c', 'Bedroom', 'Fan', 'Power'),
    ]);
    const shorts = [labels.get('a')!.short, labels.get('b')!.short, labels.get('c')!.short];
    expect(new Set(shorts).size).toBe(3);
    expect(labels.get('b')!.short).toContain('Bedroom');
    expect(labels.get('b')!.short).toContain('Lamp');
  });

  it('never returns an empty short', () => {
    const labels = disambiguateSeriesLabels([
      item('a', null, 'Same', 'Same'),
      item('b', null, 'Same', 'Same'),
    ]);
    for (const label of labels.values()) {
      expect(label.short.length).toBeGreaterThan(0);
    }
  });
});

describe('stripRoomPrefix', () => {
  it('drops the room when the accessory is named after it', async () => {
    const { stripRoomPrefix } = await import('../labels');
    expect(stripRoomPrefix('Bedroom 2 Underfloor Heating', 'Bedroom 2')).toBe('Underfloor Heating');
    expect(stripRoomPrefix('Kitchen Thermostat', 'Kitchen')).toBe('Thermostat');
    expect(stripRoomPrefix('Living Room Sensor', 'Living Room')).toBe('Sensor');
  });

  it('leaves names that are not room-prefixed (or nothing but the room)', async () => {
    const { stripRoomPrefix } = await import('../labels');
    expect(stripRoomPrefix('Hue outdoor motion sensor', 'Garden')).toBe('Hue outdoor motion sensor');
    expect(stripRoomPrefix('Kitchen', 'Kitchen')).toBe('Kitchen'); // nothing left → keep
    expect(stripRoomPrefix('Bookshelf Sensor', null)).toBe('Bookshelf Sensor');
  });

  it('collapses the screenshot case inside disambiguation', async () => {
    const { disambiguateSeriesLabels } = await import('../labels');
    // The real-home failure: "Bedroom 2 · Bedroom 2 Underfloor Heating · Humidity"
    const labels = disambiguateSeriesLabels([
      { key: 'a', room: 'Bedroom 2', accessoryName: 'Bedroom 2 Underfloor Heating', charLabel: 'Humidity' },
      { key: 'b', room: 'Bedroom 3', accessoryName: 'Bedroom 3 Underfloor Heating', charLabel: 'Humidity' },
    ]);
    expect(labels.get('a')!.short).toBe('Bedroom 2');
    expect(labels.get('a')!.full).toBe('Bedroom 2 · Underfloor Heating · Humidity');
  });
});

describe('stateValueLabel', () => {
  it('names HomeKit enum states instead of printing protocol codes', async () => {
    const { stateValueLabel } = await import('../labels');
    // "2 17h 26m" in a caption was heating_cooling_target's raw code.
    expect(stateValueLabel('heating_cooling_target', 2)).toBe('Cool');
    expect(stateValueLabel('heating_cooling_current', 1)).toBe('Heating');
    expect(stateValueLabel('lock_current_state', 1)).toBe('Locked'); // not HAP's "Secured"
    expect(stateValueLabel('air_quality', 5)).toBe('Poor');
  });

  it('keeps bool vocabulary and falls back for unknown types', async () => {
    const { stateValueLabel } = await import('../labels');
    expect(stateValueLabel('contact_state', 1)).toBe('Open');
    expect(stateValueLabel('some_unmapped_enum', 3)).toBe('3');
  });
});

describe('stripRoomPrefix — the dashboard\'s rule, and only that rule', () => {
  it('strips the room when what remains reads as a name', () => {
    expect(stripRoomPrefix('Bedroom 2 Underfloor Heating', 'Bedroom 2')).toBe('Underfloor Heating');
  });

  it('strips a partial room name exactly as the sidebar does', () => {
    // Room "Living" + "Living Room Thermostat" reads "Room Thermostat" here
    // because that is what it reads everywhere else. Analytics used to keep
    // the whole name instead, which made it the one place still saying the
    // room twice — and matching the rest of the app is worth more than a
    // better answer in one panel.
    expect(stripRoomPrefix('Living Room Thermostat', 'Living')).toBe('Room Thermostat');
    expect(getDisplayName('Living Room Thermostat', 'Living')).toBe('Room Thermostat');
  });
});

describe('the two enum vocabularies agree', () => {
  // There are two tables of HomeKit enum words: ENUM_STATE_LABELS here, which
  // dresses STORED history, and ENUM_LABELS in components/automations/
  // characteristics.ts, which dresses an accessory's LIVE characteristics.
  // They meet on one screen — the accessory page prefers the live options and
  // falls back to the stored ones — so a value renamed in one and not the
  // other silently keeps the old word wherever the other table wins. That is
  // exactly what happened: 'Idle' was renamed to 'Standby' in history's table
  // while the accessory page, reading the live table, went on saying 'Idle'.
  it('gives every shared value the same word in both tables', async () => {
    const { ENUM_STATE_LABELS } = await import('../labels');
    const { ENUM_LABELS } = await import('@/components/automations/characteristics');
    const mismatches: string[] = [];
    for (const [type, live] of Object.entries(ENUM_LABELS)) {
      const stored = ENUM_STATE_LABELS[type];
      if (!stored || stored.length === 0) continue; // only one table knows it
      for (const [code, word] of Object.entries(live)) {
        const storedWord = stored[Number(code)];
        if (storedWord && storedWord !== word) {
          mismatches.push(`${type}[${code}]: live "${word}" vs stored "${storedWord}"`);
        }
      }
    }
    expect(mismatches).toEqual([]);
  });

  it('says Standby, not HAP\'s Idle, wherever a unit is on but doing nothing', async () => {
    const { stateValueLabel } = await import('../labels');
    expect(stateValueLabel('current_heater_cooler_state', 0)).toBe('Off');
    expect(stateValueLabel('current_heater_cooler_state', 1)).toBe('Standby');
    expect(stateValueLabel('current_heater_cooler_state', 3)).toBe('Cooling');
  });
});
