// Comparing a HomeKit characteristic value against a value stored in an
// automation.
//
// These two rarely have the same JavaScript type. HomeKit reports a light's
// power_state as a boolean (`true`), while the editor stores the trigger as
// `to: 1` — so a plain `===`, or even a String() comparison ("true" vs "1"),
// never matches and the automation silently never fires. On/off is the most
// common automation there is, so this one comparison decides whether most
// automations work at all.
//
// HomeKit is not self-consistent either: some characteristics report booleans,
// some 0/1, and values occasionally arrive as strings over the bridge. Rather
// than guess per characteristic, normalise the handful of spellings of true and
// false to a single form and compare that.

function normalise(value: unknown): string {
  if (typeof value === 'boolean') return value ? '1' : '0';
  if (value === 'true' || value === 'True') return '1';
  if (value === 'false' || value === 'False') return '0';
  return String(value);
}

/**
 * Loose equality for characteristic values: true ≡ 1 ≡ "1" ≡ "true", and
 * false ≡ 0 ≡ "0" ≡ "false". Everything else falls back to string comparison,
 * which keeps numeric-as-string values (brightness "50" vs 50) matching.
 */
export function valuesMatch(actual: unknown, expected: unknown): boolean {
  if (actual === expected) return true;
  return normalise(actual) === normalise(expected);
}

/**
 * The boolean reading of a characteristic value, under the same normalisation
 * as valuesMatch, or undefined for anything that isn't a spelling of a boolean
 * (a brightness of 50, a mode string). Callers use undefined to mean "this
 * value has no on/off interpretation" rather than guessing.
 */
export function booleanish(value: unknown): boolean | undefined {
  const n = normalise(value);
  if (n === '1') return true;
  if (n === '0') return false;
  return undefined;
}
