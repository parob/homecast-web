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
