import { describe, it, expect } from 'vitest';
import { isQuietRange, restingState } from '../quiet';

describe('isQuietRange', () => {
  it('folds a flag that held its resting state the whole range', () => {
    // The complaint that started this: twelve "Low Battery OK" timelines.
    expect(isQuietRange('status_low_battery', [['0', 86_400_000]])).toBe(true);
    expect(isQuietRange('smoke_detected', [['0', 86_400_000]])).toBe(true);
    expect(isQuietRange('power_state', [['0', 86_400_000]])).toBe(true);
  });

  it('keeps the same flag when it is holding something worth knowing', () => {
    // Not a blacklist of boring characteristics — the low-battery flag earns
    // its row precisely when it says Low.
    expect(isQuietRange('status_low_battery', [['1', 86_400_000]])).toBe(false);
    expect(isQuietRange('contact_state', [['1', 86_400_000]])).toBe(false); // door left open
    expect(isQuietRange('power_state', [['1', 86_400_000]])).toBe(false); // left on all day
  });

  it('keeps anything that changed, whatever it settled on', () => {
    expect(isQuietRange('motion_detected', [['0', 80_000_000], ['1', 6_400_000]])).toBe(false);
  });

  it('reads resting states that are not zero', () => {
    expect(restingState('lock_current_state')).toBe(1); // Locked
    expect(isQuietRange('lock_current_state', [['1', 86_400_000]])).toBe(true);
    expect(isQuietRange('lock_current_state', [['0', 86_400_000]])).toBe(false); // unsecured all day
    expect(isQuietRange('current_door_state', [['1', 86_400_000]])).toBe(true);
  });

  it('never folds a characteristic with no resting state', () => {
    // Air quality and the security system are graded readings, not flags:
    // "Good" or "Away" held all day is a fact, not the absence of one.
    expect(restingState('air_quality')).toBeUndefined();
    expect(isQuietRange('air_quality', [['2', 86_400_000]])).toBe(false);
    expect(isQuietRange('security_system_current_state', [['3', 86_400_000]])).toBe(false);
  });

  it('folds a series with nothing recorded at all', () => {
    expect(isQuietRange('power_state', [])).toBe(true);
  });

  it('does not fold a string-kind series that held one text', () => {
    // virtual_mode keys by its text, which can never be a resting code.
    expect(isQuietRange('virtual_mode', [['Away', 86_400_000]])).toBe(false);
  });

  it('canonicalises the type before looking it up', () => {
    expect(isQuietRange('contact_sensor_state', [['0', 86_400_000]])).toBe(true);
  });
});

describe('the heater-cooler family: Off and Standby say the same nothing', () => {
  // The Annex Air Conditioner (Electriq Monoblock) reports only Inactive(0)
  // and Idle(1) — never Cooling(3) — even while pulling a room from 23° to
  // 18°. Its state strip was therefore an exact copy of its Power strip, with
  // "Idle" contradicting "On". Another AC in the same home reports Cooling
  // correctly, so this is the device, not the pipeline; the strip just has
  // nothing to add when a unit sits in that pair.
  it('folds a unit that only ever sat Off or Standby', () => {
    expect(isQuietRange('current_heater_cooler_state', [
      ['0', 65_700_000], ['1', 20_700_000],
    ])).toBe(true);
  });

  it('keeps the strip the moment it actually heats or cools', () => {
    expect(isQuietRange('current_heater_cooler_state', [
      ['0', 65_700_000], ['1', 10_700_000], ['3', 10_000_000],
    ])).toBe(false);
    expect(isQuietRange('current_heater_cooler_state', [['3', 86_400_000]])).toBe(false);
  });

  it('applies to the fans, purifiers and humidifiers with the same 1', () => {
    expect(isQuietRange('current_fan_state', [['0', 80_000_000], ['1', 6_400_000]])).toBe(true);
    expect(isQuietRange('current_fan_state', [['1', 80_000_000], ['2', 6_400_000]])).toBe(false);
    expect(isQuietRange('current_air_purifier_state', [['1', 86_400_000]])).toBe(true);
    expect(isQuietRange('current_humidifier_dehumidifier_state', [['1', 86_400_000]])).toBe(true);
  });

  it('does NOT extend the pair to a thermostat, whose 1 already means Heating', () => {
    // heating_cooling_current is ['Off', 'Heating', 'Cooling'] — no Idle.
    expect(isQuietRange('heating_cooling_current', [['0', 86_400_000]])).toBe(true);
    expect(isQuietRange('heating_cooling_current', [['1', 86_400_000]])).toBe(false);
  });

  it('does not loosen anything else: two states still mean something happened', () => {
    expect(isQuietRange('power_state', [['0', 80_000_000], ['1', 6_400_000]])).toBe(false);
    expect(isQuietRange('contact_state', [['0', 80_000_000], ['1', 6_400_000]])).toBe(false);
  });

  it('says what was never observed, not that nothing changed', async () => {
    const { quietSummary } = await import('../quiet');
    expect(quietSummary('current_heater_cooler_state')).toBe('never reported heating or cooling in this range');
    expect(quietSummary('power_state')).toBeUndefined();
  });
});
