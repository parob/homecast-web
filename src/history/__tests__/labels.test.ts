import { describe, it, expect } from 'vitest';
import { disambiguateSeriesLabels, type LabelInput } from '../labels';

const item = (key: string, room: string | null, accessoryName: string, charLabel: string): LabelInput =>
  ({ key, room, accessoryName, charLabel });

describe('disambiguateSeriesLabels', () => {
  it('one room, many sensors, same characteristic → sensor names survive', () => {
    const labels = disambiguateSeriesLabels([
      item('a', 'Living Room', 'Living Room Sensor', 'Temperature'),
      item('b', 'Living Room', 'Bookshelf Sensor', 'Temperature'),
    ]);
    // Room and shared words drop; "Sensor" and "Temperature" are shared too.
    expect(labels.get('a')!.short).toBe('Living Room');
    expect(labels.get('b')!.short).toBe('Bookshelf');
    expect(labels.get('a')!.full).toBe('Living Room · Living Room Sensor · Temperature');
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
