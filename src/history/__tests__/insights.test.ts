import { describe, it, expect } from 'vitest';
import {
  computeInsights,
  selectInsightRefs,
  eventCount,
  onMs,
  onMsWith,
  type InsightsInput,
} from '../insights';
import type { LiveAccessory } from '../summaries';
import type { HistorySeriesData, HistorySeriesInfo } from '@/lib/graphql/types';

const HOUR = 3_600_000;

const acc = (id: string, room: string | null, values: Record<string, number | string>): LiveAccessory =>
  ({ id, name: id, room, values });

const seriesInfo = (accessoryId: string, characteristicType: string): HistorySeriesInfo => ({
  accessoryId, characteristicType, kind: characteristicType === 'current_temperature' || characteristicType === 'relative_humidity' ? 'numeric' : 'bool',
  unit: null, enabled: true, minIntervalS: null, deadband: null, firstTs: null, lastTs: null, sampleCount: 10,
});

const numericData = (avg: number): HistorySeriesData => ({
  accessoryId: 'X', characteristicType: 'current_temperature', kind: 'numeric', unit: '°',
  resolution: 'raw', prevValue: avg,
  points: [{ ts: 0, min: avg, avg, max: avg, last: avg, count: 1 }],
  states: [], stateBuckets: [],
});

const stateData = (transitions: number): HistorySeriesData => ({
  accessoryId: 'X', characteristicType: 'motion_detected', kind: 'bool', unit: null,
  resolution: 'raw', prevValue: 0,
  points: [],
  states: Array.from({ length: transitions }, (_, i) => ({ ts: i * 60_000, value: i % 2 })),
  stateBuckets: [],
});

const emptyInput = (live: LiveAccessory[]): InsightsInput => ({
  live,
  refs: { temperature: [], humidity: [], activity: [], power: [] },
  today: new Map(),
  yesterday: new Map(),
  window: { fromTs: 0, toTs: 12 * HOUR },
  info: new Map(),
});

describe('computeInsights', () => {
  it('flags the outlier room from live state', () => {
    const input = emptyInput([
      acc('a', 'Living', { current_temperature: 20 }),
      acc('b', 'Kitchen', { current_temperature: 20.5 }),
      acc('c', 'Study', { current_temperature: 20.2 }),
      acc('d', 'Bedroom 2', { current_temperature: 23.6 }),
    ]);
    const insights = computeInsights(input);
    const outlier = insights.find(i => i.id.startsWith('outlier:'));
    expect(outlier).toBeDefined();
    expect(outlier!.text).toContain('Bedroom 2');
    expect(outlier!.text).toContain('warmer');
    expect(outlier!.link).toEqual({ category: 'climate', room: 'Bedroom 2' });
  });

  it('triggered safety sensors outrank everything', () => {
    const input = emptyInput([
      acc('smoke', 'Kitchen', { smoke_detected: 1 }),
      acc('bat', 'Hall', { battery_level: 5 }),
    ]);
    const insights = computeInsights(input);
    expect(insights[0].icon).toBe('alert');
    expect(insights[0].text).toContain('Smoke');
  });

  it('reports low batteries with the lowest named', () => {
    const insights = computeInsights(emptyInput([
      acc('Front Door', 'Hall', { battery_level: 12 }),
      acc('Lock', 'Hall', { battery_level: 18 }),
    ]));
    const battery = insights.find(i => i.id === 'battery-low')!;
    expect(battery.text).toBe('2 batteries below 20%');
    expect(battery.detail).toContain('Front Door');
  });

  it('spots an activity anomaly vs the same window yesterday', () => {
    const ref = seriesInfo('MOT-1', 'motion_detected');
    const input: InsightsInput = {
      ...emptyInput([]),
      refs: { temperature: [], humidity: [], activity: [ref], power: [] },
      today: new Map([['MOT-1|motion_detected', stateData(40)]]),
      yesterday: new Map([['MOT-1|motion_detected', stateData(10)]]),
    };
    const anomaly = computeInsights(input).find(i => i.id === 'activity-anomaly')!;
    expect(anomaly.text).toContain('Busier than usual');
    expect(anomaly.detail).toContain('10');
  });

  it('reports climate drift vs yesterday, capped at two rooms', () => {
    const refs = ['A', 'B', 'C'].map(id => seriesInfo(id, 'current_temperature'));
    const input: InsightsInput = {
      ...emptyInput([]),
      refs: { temperature: refs, humidity: [], activity: [], power: [] },
      today: new Map(refs.map((r, i) => [`${r.accessoryId}|current_temperature`, numericData(24 + i)])),
      yesterday: new Map(refs.map(r => [`${r.accessoryId}|current_temperature`, numericData(20)])),
      info: new Map([['A', { name: 'A', room: 'Annex' }], ['B', { name: 'B', room: 'Living' }], ['C', { name: 'C', room: 'Study' }]]),
    };
    const drifts = computeInsights(input).filter(i => i.id.startsWith('drift:'));
    expect(drifts).toHaveLength(2); // capped
    expect(drifts[0].text).toMatch(/up \d/);
  });

  it('caps at six, ranked by severity', () => {
    const live = [
      acc('smoke', 'Kitchen', { smoke_detected: 1 }),
      acc('co', 'Hall', { carbon_monoxide_detected: 1 }),
      acc('co2', 'Study', { carbon_dioxide_level: 1400 }),
      acc('bat', 'Hall', { battery_level: 4 }),
      acc('t1', 'Living', { current_temperature: 20 }),
      acc('t2', 'Kitchen', { current_temperature: 20 }),
      acc('t3', 'Annex', { current_temperature: 26 }),
    ];
    const insights = computeInsights(emptyInput(live));
    expect(insights.length).toBeLessThanOrEqual(6);
    expect(insights[0].severity).toBeGreaterThanOrEqual(insights[insights.length - 1].severity);
  });
});

describe('selectInsightRefs', () => {
  it('takes one temperature per room and caps activity', () => {
    const recorded = [
      seriesInfo('A1', 'current_temperature'),
      seriesInfo('A2', 'current_temperature'), // same room — skipped
      seriesInfo('B1', 'current_temperature'),
      seriesInfo('M1', 'motion_detected'),
      seriesInfo('D1', 'contact_state'),
    ];
    const info = new Map([
      ['A1', { name: 'A1', room: 'Living' }],
      ['A2', { name: 'A2', room: 'Living' }],
      ['B1', { name: 'B1', room: 'Kitchen' }],
      ['M1', { name: 'M1', room: 'Living' }],
      ['D1', { name: 'D1', room: 'Hall' }],
    ]);
    const refs = selectInsightRefs(recorded, info);
    expect(refs.temperature.map(r => r.accessoryId)).toEqual(['A1', 'B1']);
    expect(refs.activity).toHaveLength(2);
  });
});

describe('series helpers', () => {
  it('eventCount reads spans or buckets', () => {
    expect(eventCount(stateData(7))).toBe(7);
    expect(eventCount({
      ...stateData(0),
      states: [],
      stateBuckets: [{ ts: 0, dominant: 1, stateMsJson: '{}', transitions: 4 }, { ts: 1, dominant: 0, stateMsJson: '{}', transitions: 2 }],
    })).toBe(6);
  });

  it('onMs walks raw spans LOCF', () => {
    const data: HistorySeriesData = {
      ...stateData(0),
      prevValue: 1, // on as the window opens
      states: [{ ts: 2 * HOUR, value: 0 }, { ts: 5 * HOUR, value: 1 }],
    };
    // on 0→2h, off 2→5h, on 5→12h = 9h
    expect(onMs(data, 0, 12 * HOUR)).toBe(9 * HOUR);
  });

  it('onMsWith takes the caller\'s definition of on', () => {
    // A lock: 1 secured, 0 unsecured, 2 jammed. Time UNlocked is v !== 1, so
    // the jam counts — the default non-zero rule would answer the opposite.
    const data: HistorySeriesData = {
      ...stateData(0),
      prevValue: 1,
      states: [{ ts: 2 * HOUR, value: 0 }, { ts: 5 * HOUR, value: 2 }, { ts: 6 * HOUR, value: 1 }],
    };
    // unlocked 2→5h, jammed 5→6h = 4h
    expect(onMsWith(data, 0, 12 * HOUR, v => v !== 1)).toBe(4 * HOUR);
    // The default rule answers a different question: non-zero is
    // 0→2h plus 5h→12h = 9h, i.e. mostly time spent LOCKED.
    expect(onMs(data, 0, 12 * HOUR)).toBe(9 * HOUR);
  });

  it('onMsWith applies the predicate to rolled bucket keys', () => {
    const data: HistorySeriesData = {
      ...stateData(0),
      states: [],
      stateBuckets: [{ ts: 0, dominant: 1, stateMsJson: '{"0":25,"1":60,"2":15}', transitions: 2 }],
    };
    expect(onMsWith(data, 0, 100, v => v !== 1)).toBe(40);
    expect(onMs(data, 0, 100)).toBe(75);
  });
});
