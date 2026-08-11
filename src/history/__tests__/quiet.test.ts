import { describe, it, expect } from 'vitest';
import { isQuietRange, quietSummary, restingState } from '../quiet';

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
    expect(restingState('lock_current_state')).toBe(1); // Secured
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

describe('quietSummary', () => {
  it('counts by what the rows say, not by naming each one', () => {
    expect(quietSummary([
      { charLabel: 'Low Battery', held: 'OK' },
      { charLabel: 'Low Battery', held: 'OK' },
      { charLabel: 'Power State', held: 'Off' },
    ])).toBe('Low Battery OK (2) · Power State Off (1)');
  });

  it('says when nothing was recorded rather than inventing a state', () => {
    expect(quietSummary([{ charLabel: 'Motion', held: null }])).toBe('Motion not recorded (1)');
  });

  it('caps the kinds it lists and says how many it did not', () => {
    const summary = quietSummary([
      { charLabel: 'A', held: 'Off' },
      { charLabel: 'B', held: 'Off' },
      { charLabel: 'C', held: 'Off' },
      { charLabel: 'D', held: 'Off' },
      { charLabel: 'E', held: 'Off' },
    ]);
    expect(summary).toBe('A Off (1) · B Off (1) · C Off (1) · +2 more');
  });
});
