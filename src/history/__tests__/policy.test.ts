// The TypeScript half of the shared policy contract. The same fixture file is
// executed by pytest against the Python engine in homecast-cloud; a case that
// passes here and fails there (or vice versa) means the two runtimes have
// drifted and CE/cloud homes would record different history from the same
// event stream.

import { describe, it, expect } from 'vitest';
import cases from './policy-cases.json';
import {
  evaluate,
  getProfile,
  profiledTypes,
  type SeriesOverride,
  type SeriesRecordState,
} from '../policy';
import { canonicalHistoryType, seriesKey, parseSeriesKey } from '../keys';

interface FixtureCase {
  name: string;
  type: string;
  override?: SeriesOverride;
  events: [number, unknown][];
  recorded: [number, number][];
}

describe('history policy fixtures (shared with Python)', () => {
  for (const c of (cases as unknown as { cases: FixtureCase[] }).cases) {
    it(c.name, () => {
      let state: SeriesRecordState | undefined;
      const recorded: [number, number][] = [];
      for (const [tsMs, rawValue] of c.events) {
        const decision = evaluate(c.type, c.override, state, rawValue, tsMs);
        if (decision.record) {
          recorded.push([tsMs, decision.value]);
          state = decision.state;
        }
      }
      expect(recorded).toEqual(c.recorded);
    });
  }
});

describe('profiles', () => {
  it('every profile key is already canonical', () => {
    // A profile keyed by an alias would be unreachable: lookups canonicalise
    // first, so `on` must live under `power_state`.
    for (const type of profiledTypes()) {
      expect(canonicalHistoryType(type)).toBe(type);
    }
  });

  it('every profile has a valid kind and sane thresholds', () => {
    for (const type of profiledTypes()) {
      const profile = getProfile(type)!;
      expect(['numeric', 'bool', 'enum']).toContain(profile.kind);
      expect(profile.minIntervalS).toBeGreaterThanOrEqual(0);
      if (profile.deadband !== undefined) expect(profile.deadband).toBeGreaterThanOrEqual(0);
      if (profile.deadbandPct !== undefined) expect(profile.deadbandPct).toBeGreaterThan(0);
      // Deadbands only mean something for numerics.
      if (profile.kind !== 'numeric') {
        expect(profile.deadband).toBeUndefined();
        expect(profile.deadbandPct).toBeUndefined();
      }
    }
  });

  it('transient targets and metadata are not profiled', () => {
    for (const type of ['lock_target_state', 'target_position', 'target_door_state',
      'name', 'model', 'firmware_revision', 'serial_number',
      'eve_history_status', 'eve_history_entries', 'eve_history_request']) {
      expect(getProfile(type)).toBeUndefined();
    }
  });
});

describe('series keys', () => {
  it('normalises case and aliases', () => {
    expect(seriesKey('home-a', 'acc-1', 'on')).toBe('HOME-A|ACC-1|power_state');
    expect(seriesKey('HOME-A', 'ACC-1', 'power_state')).toBe('HOME-A|ACC-1|power_state');
    expect(seriesKey('h', 'a', 'contact_sensor_state')).toBe('H|A|contact_state');
  });

  it('round-trips through parse', () => {
    const key = seriesKey('11111111-2222', '33333333-4444', 'current_temperature');
    expect(parseSeriesKey(key)).toEqual({
      homeId: '11111111-2222',
      accessoryId: '33333333-4444',
      characteristicType: 'current_temperature',
    });
    expect(parseSeriesKey('garbage')).toBeNull();
  });
});
