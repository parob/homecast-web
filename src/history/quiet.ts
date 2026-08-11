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
  lock_current_state: 1, // Secured
};

/** The resting value for a characteristic, or undefined if it has no notion of one. */
export function restingState(type: string): number | undefined {
  return RESTING_STATE[canonicalHistoryType(type)];
}

/**
 * Did this series have nothing to say across the range?
 *
 * Judged from the time-in-state totals rather than the transition count: a
 * series whose first sample lands inside the window counts as a transition
 * without anything having changed, and a series carried in from before it
 * counts as none. What matters is that exactly one state occupied the whole
 * range and that state is the resting one.
 */
export function isQuietRange(type: string, totals: Array<[string, number]>): boolean {
  if (totals.length === 0) return true; // nothing recorded at all — an empty strip
  if (totals.length > 1) return false;
  const resting = restingState(type);
  if (resting === undefined) return false;
  const key = totals[0][0];
  // String-kind series (a virtual mode) key by their text and never match.
  if (key.trim() === '') return false;
  const value = Number(key);
  return Number.isFinite(value) && Math.round(value) === resting;
}

export interface QuietItem {
  /** What the row would have been titled ("Low Battery"). */
  charLabel: string;
  /** The state it held all range ("OK"), or null when nothing was recorded. */
  held: string | null;
}

/**
 * The one line that replaces the folded rows — "Low Battery OK (8) · Power
 * State Off (4)". Counted by what they say rather than listed by name: eight
 * batteries all reading OK is one fact eight times over, and naming each one
 * would rebuild the wall this exists to remove.
 */
export function quietSummary(items: QuietItem[], max = 3): string {
  const counts = new Map<string, number>();
  for (const item of items) {
    const phrase = item.held ? `${item.charLabel} ${item.held}` : `${item.charLabel} not recorded`;
    counts.set(phrase, (counts.get(phrase) ?? 0) + 1);
  }
  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const shown = sorted.slice(0, max).map(([phrase, n]) => `${phrase} (${n})`);
  const rest = sorted.length - shown.length;
  return [...shown, rest > 0 ? `+${rest} more` : null].filter(Boolean).join(' · ');
}
