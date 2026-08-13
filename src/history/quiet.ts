// Which state timelines are worth drawing.
//
// "Activity & states" answers one question: what happened here. Its membership
// rule was purely structural — every recorded series that isn't a number — so
// a home's smoke alarms, low-battery flags and never-touched lamps each drew a
// full-width timeline to say, at length, that nothing happened. Twelve alarms
// reading "Clear 24h · 0 changes" is twelve rows carrying one fact.
//
// The rule here is about the DATA, not the characteristic. A series that spent
// the whole range sitting in its resting state folds into a summary line; one
// that changed, or that is holding something worth knowing — a door left open,
// a battery actually low, a lamp on since Tuesday — keeps its row. That is why
// this is not a blacklist of boring characteristics: the same low-battery flag
// is folded away when it says OK and drawn when it says Low, which is the only
// time anyone wanted to see it.

import { canonicalHistoryType } from './keys';

/**
 * The value each state characteristic sits at when there is nothing to report.
 *
 * Deliberately incomplete. A characteristic with no entry here is never folded
 * away, which is the safe direction: air quality and the security system are
 * graded readings rather than flags, and "Good" or "Away" held all day is a
 * fact about the home, not an absence of one.
 */
export const RESTING_STATE: Record<string, number> = {
  // Switched off / idle.
  power_state: 0,
  active: 0,
  in_use: 0,
  outlet_in_use: 0,
  mute: 0,
  heating_cooling_current: 0, // Off
  current_heater_cooler_state: 0, // Inactive
  current_humidifier_dehumidifier_state: 0, // Inactive
  current_fan_state: 0, // Inactive
  current_air_purifier_state: 0, // Inactive
  charging_state: 0, // Not charging

  // Nothing detected.
  motion_detected: 0,
  occupancy_detected: 0,
  smoke_detected: 0,
  carbon_monoxide_detected: 0,
  carbon_dioxide_detected: 0,
  leak_detected: 0,
  obstruction_detected: 0,
  status_low_battery: 0, // OK

  // Shut and secure.
  contact_state: 0, // Closed
  current_door_state: 1, // Closed
  lock_current_state: 1, // Locked
};

/** The resting value for a characteristic, or undefined if it has no notion of one. */
export function restingState(type: string): number | undefined {
  return RESTING_STATE[canonicalHistoryType(type)];
}

/**
 * Further states that are ALSO nothing to report.
 *
 * A heater-cooler separates Off (no power) from Standby (powered, but neither
 * heating nor cooling). Both answer "it did not heat or cool", so a series
 * that only ever visits the two says nothing its Power strip has not already
 * said, in worse words — which is precisely where a unit that under-reports
 * its compressor sits all day. The same shape holds for fans, purifiers and
 * humidifiers, whose 1 is the identical "on but not doing the thing".
 */
const ALSO_QUIET: Record<string, number[]> = {
  current_heater_cooler_state: [1], // Standby
  current_humidifier_dehumidifier_state: [1],
  current_fan_state: [1],
  current_air_purifier_state: [1],
};

/** Every value that counts as nothing-to-report, or undefined if none do. */
function quietValues(type: string): Set<number> | undefined {
  const canonical = canonicalHistoryType(type);
  const resting = RESTING_STATE[canonical];
  if (resting === undefined) return undefined;
  return new Set([resting, ...(ALSO_QUIET[canonical] ?? [])]);
}

/**
 * What to say in place of a strip that never left its quiet states. Named per
 * characteristic, because the generic "nothing changed" is not the finding: a
 * compressor that ran all night behind a unit which never reports Cooling did
 * change something, and the honest line is what was never OBSERVED.
 */
const QUIET_SUMMARY: Record<string, string> = {
  current_heater_cooler_state: 'never reported heating or cooling in this range',
  current_humidifier_dehumidifier_state: 'never reported humidifying or dehumidifying in this range',
  current_fan_state: 'never reported blowing in this range',
  current_air_purifier_state: 'never reported purifying in this range',
};

export function quietSummary(type: string): string | undefined {
  return QUIET_SUMMARY[canonicalHistoryType(type)];
}

/**
 * Did this series have nothing to say across the range?
 *
 * Judged from the time-in-state totals rather than the transition count: a
 * series whose first sample lands inside the window counts as a transition
 * without anything having changed, and a series carried in from before it
 * counts as none. What matters is that every state it occupied was a quiet
 * one — for most characteristics that means the single resting value, and
 * for the heater-cooler family it means Off or Standby, which say the same
 * nothing.
 */
export function isQuietRange(type: string, totals: Array<[string, number]>): boolean {
  if (totals.length === 0) return true; // nothing recorded at all — an empty strip
  const quiet = quietValues(type);
  if (!quiet) return false;
  return totals.every(([key]) => {
    // String-kind series (a virtual mode) key by their text and never match.
    if (key.trim() === '') return false;
    const value = Number(key);
    return Number.isFinite(value) && quiet.has(Math.round(value));
  });
}
