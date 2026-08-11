// The Swift mapper is the ONLY naming path between HomeKit and everything
// else: accessory dumps and observer events both go through
// CharacteristicMapper.fromHomeKitType, and an unmapped constant falls
// through as a raw UUID that no profile, widget, or automation can match.
// Four history-profiled characteristics (lux, air quality, leak, door
// state) were undeliverable for exactly that reason, a fifth
// (eve_energy_watt) lost an alias coin-toss, and label_index pointed at
// CarbonMonoxideLevel's UUID outright.
//
// The Mac app has no test target, so the pin lives here: this test reads
// the Swift source and fails if a profiled type loses its mapping again.

import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { profiledTypes } from '../policy';

const MAPPER_PATH = join(
  __dirname, '..', '..', '..', '..',
  'app-ios-macos', 'Sources', 'HomeKit', 'CharacteristicMapper.swift',
);

// Standalone checkouts of the app-web repo don't have the Mac app sources.
const hasMapper = existsSync(MAPPER_PATH);

describe.skipIf(!hasMapper)('Swift CharacteristicMapper pins', () => {
  const source = hasMapper ? readFileSync(MAPPER_PATH, 'utf8') : '';
  const mapStart = source.indexOf('characteristicMap: [String: String] = [');
  const mapEnd = source.indexOf(']', source.indexOf('"product_data"'));
  const characteristicMap = source.slice(mapStart, mapEnd);

  it('maps every profiled HomeKit characteristic by name', () => {
    // Eve types live in the same map; virtual_* never touch HomeKit.
    const missing = profiledTypes()
      .filter(type => !type.startsWith('virtual_'))
      .filter(type => !characteristicMap.includes(`"${type}"`));
    expect(missing).toEqual([]);
  });

  it('pins the exact UUIDs of the environment-sensor entries', () => {
    for (const [name, uuid] of [
      ['current_ambient_light_level', '0000006B'],
      ['air_quality', '00000095'],
      ['leak_detected', '00000070'],
      ['current_door_state', '0000000E'],
      ['carbon_monoxide_level', '00000090'],
      ['carbon_dioxide_level', '00000093'],
      ['carbon_dioxide_peak_level', '00000094'],
      ['pm2_5_density', '000000C6'],
      ['pm10_density', '000000C7'],
      ['voc_density', '000000C8'],
    ]) {
      expect(characteristicMap).toContain(`"${name}": "${uuid}-0000-1000-8000-0026BB765291"`);
    }
  });

  it('keeps label_index on ServiceLabelIndex (0xCB), not CarbonMonoxideLevel (0x90)', () => {
    expect(characteristicMap).toContain('"label_index": "000000CB-0000-1000-8000-0026BB765291"');
  });

  it('pins the alias winners for power and Eve wattage', () => {
    const overrides = source.slice(source.indexOf('canonicalCharacteristicName'));
    expect(overrides).toContain('map[HMCharacteristicTypePowerState] = "power_state"');
    expect(overrides).toContain('map["E863F10D-079E-48FF-8F27-9C2605A29F52"] = "eve_energy_watt"');
  });
});

// Naming a characteristic is only half of delivering it. HomeKitManager
// subscribes to HAP notifications, and periodically re-reads, exactly the
// types in `keyCharacteristicTypes` — so a profiled type missing from that set
// never fires an event and never gets re-read. It changes only when the whole
// accessory list reloads, which for history means it effectively never
// changes. That is why a Nest Protect reported its low-battery flag (in the
// set) and nothing about smoke or CO (not in the set) for months.
const MANAGER_PATH = join(
  __dirname, '..', '..', '..', '..',
  'app-ios-macos', 'Sources', 'HomeKit', 'HomeKitManager.swift',
);

const hasManager = existsSync(MANAGER_PATH);

describe.skipIf(!hasManager)('Swift HomeKitManager subscription pins', () => {
  const source = hasManager ? readFileSync(MANAGER_PATH, 'utf8') : '';

  /** Both halves of the set: the HM constants and the names added by mapper lookup. */
  const subscribed = (() => {
    // Ends at the literal's own closing bracket — `indexOf(']')` would stop
    // at the `]` inside `[String]` and slice away the whole list.
    const sliceList = (marker: string) => {
      const start = source.indexOf(marker);
      return start < 0 ? '' : source.slice(start, source.indexOf('\n    ]', start));
    };
    const derived = sliceList('historyBackedTypes: [String] = [');
    const base = sliceList('baseKeyCharacteristicTypes: [String] = [');
    return { derived, base };
  })();

  // The HM constant that carries each type the base list names by constant.
  const HM_CONSTANTS: Record<string, string> = {
    power_state: 'HMCharacteristicTypePowerState',
    brightness: 'HMCharacteristicTypeBrightness',
    hue: 'HMCharacteristicTypeHue',
    saturation: 'HMCharacteristicTypeSaturation',
    color_temperature: 'HMCharacteristicTypeColorTemperature',
    current_temperature: 'HMCharacteristicTypeCurrentTemperature',
    target_temperature: 'HMCharacteristicTypeTargetTemperature',
    relative_humidity: 'HMCharacteristicTypeCurrentRelativeHumidity',
    target_humidity: 'HMCharacteristicTypeTargetRelativeHumidity',
    current_position: 'HMCharacteristicTypeCurrentPosition',
    current_door_state: 'HMCharacteristicTypeCurrentDoorState',
    active: 'HMCharacteristicTypeActive',
    in_use: 'HMCharacteristicTypeInUse',
    rotation_speed: 'HMCharacteristicTypeRotationSpeed',
    heating_cooling_current: 'HMCharacteristicTypeCurrentHeatingCooling',
    heating_cooling_target: 'HMCharacteristicTypeTargetHeatingCooling',
    heating_threshold: 'HMCharacteristicTypeHeatingThreshold',
    cooling_threshold: 'HMCharacteristicTypeCoolingThreshold',
    target_heater_cooler_state: '000000B2-0000-1000-8000-0026BB765291',
    contact_state: 'HMCharacteristicTypeContactState',
    motion_detected: 'HMCharacteristicTypeMotionDetected',
    occupancy_detected: 'HMCharacteristicTypeOccupancyDetected',
    battery_level: 'HMCharacteristicTypeBatteryLevel',
    status_low_battery: 'HMCharacteristicTypeStatusLowBattery',
    outlet_in_use: 'HMCharacteristicTypeOutletInUse',
  };

  it('subscribes to every characteristic history can record', () => {
    const missing = profiledTypes()
      .filter(type => !type.startsWith('virtual_'))
      .filter(type => {
        if (subscribed.derived.includes(`"${type}"`)) return false;
        const constant = HM_CONSTANTS[type];
        return !(constant && subscribed.base.includes(constant));
      });
    expect(missing).toEqual([]);
  });

  it('keeps the alarm sensors in the set — the Nest Protect case', () => {
    for (const type of ['smoke_detected', 'carbon_monoxide_detected', 'carbon_dioxide_detected', 'leak_detected']) {
      expect(subscribed.derived).toContain(`"${type}"`);
    }
  });
});
