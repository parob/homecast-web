// What counts as a template, decided once.
//
// The engine resolves any string containing `{{` and passes everything else
// through untouched. The editor has to agree exactly — it decides from the same
// test whether a stored value is shown as a fixed control or as an expression —
// so both read it from here rather than each spelling out its own check.

/** True for a value the engine will resolve as a `{{ … }}` template. */
export function isTemplate(value: unknown): value is string {
  return typeof value === 'string' && value.includes('{{');
}

const NUMERIC_TEXT = /^\s*-?\d+(\.\d+)?\s*$/;

/**
 * A template that rendered a number as text, read back as that number.
 *
 * A lone `{{ expr }}` keeps its type, but a partial template always renders a
 * string, and an HTTP body often carries its numbers quoted ("55"). HomeKit's
 * write coerces either way; the relay's announcement of the write to every app
 * and to MQTT does not, so they would show a brightness of "55" — a string —
 * until something else rewrote it.
 *
 * Only template output is touched: a literal string is left exactly as typed.
 */
export function numberIfRenderedNumeric(raw: unknown, resolved: unknown): unknown {
  if (!isTemplate(raw) || typeof resolved !== 'string') return resolved;
  return NUMERIC_TEXT.test(resolved) ? Number(resolved) : resolved;
}
