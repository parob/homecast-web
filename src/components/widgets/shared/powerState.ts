/**
 * Whether a set of accessories is on, off, or somewhere in between.
 *
 * Both halves of this were written out by hand in four places — the group
 * widget twice, the Actions catalog, and the collection detail view — and the
 * copies had already begun to disagree about what counts as on. One copy here,
 * because a group tile and the Actions card describing the same eight lights
 * must never reach different answers.
 */

export type TriState = 'off' | 'mixed' | 'on';

/**
 * Is this characteristic value on?
 *
 * Hand-rolled rather than a cast: cache values arrive JSON-stringified, and
 * devices disagree about the encoding — a switch reports a boolean, an air
 * purifier's `active` reports 1, and either can come back as a string.
 */
export function isOn(value: unknown): boolean {
  return value === true || value === 1 || value === '1' || value === 'true';
}

/**
 * Collapse a count of on members into the state a toggle should show.
 *
 * An empty set is off, never mixed: a group whose members have all gone away
 * has nothing to be partly anything about, and a half-filled track there would
 * invite a press that writes to nobody.
 */
export function triState(onCount: number, total: number): TriState {
  if (total <= 0 || onCount <= 0) return 'off';
  if (onCount >= total) return 'on';
  return 'mixed';
}

/** The phrase the toggle hands to a screen reader: "3 of 8 on". */
export function powerCountDescription(onCount: number, total: number): string {
  return `${onCount} of ${total} on`;
}
