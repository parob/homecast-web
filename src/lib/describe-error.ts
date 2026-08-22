// Turning a caught value into something a person can act on.
//
// The native HomeKit bridge rejects with a **plain object**, not an Error:
// Swift's sendError posts `{code, message}` and the injected shim calls
// `callback.reject(payload.error)` with it verbatim. Every `String(e)` on that
// path therefore produced the string "[object Object]" — and that is what an
// automation's execution history showed for every HomeKit failure it ever had,
// with the code and message sitting right there in the object, discarded.
//
// So: never `String(e)` a caught value. Use this.

/** Longest single-line message worth keeping; native messages can be verbose. */
const MAX_LENGTH = 300;

function truncate(s: string): string {
  return s.length > MAX_LENGTH ? `${s.slice(0, MAX_LENGTH - 1)}…` : s;
}

/**
 * Read a string property without trusting the object.
 *
 * `source[key]` can run a getter, and a getter can throw. This runs inside a
 * catch block, so throwing here would replace the original error with a
 * meaningless one — the failure mode this whole module exists to prevent.
 */
function readString(source: Record<string, unknown>, key: string): string {
  try {
    const value = source[key];
    return typeof value === 'string' ? value.trim() : '';
  } catch {
    return '';
  }
}

/** Lowercase alphanumerics only, so UNKNOWN_ACTION ≡ "Unknown action". */
function squash(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * Describe any caught value as a human-readable, non-empty string.
 *
 * Guarantees, relied on by callers and pinned by tests:
 * - never returns an empty string
 * - never returns "[object Object]"
 * - keeps the error code when there is one, since that is what a support
 *   conversation or a log search actually keys on
 */
export function describeError(e: unknown): string {
  if (e === null || e === undefined) return 'Unknown error';

  if (typeof e === 'string') return truncate(e.trim()) || 'Unknown error';
  if (typeof e === 'number' || typeof e === 'boolean' || typeof e === 'bigint') return String(e);
  if (typeof e === 'symbol') return e.toString();
  if (typeof e === 'function') return `Unknown error (${e.name || 'anonymous function'})`;

  // Errors and bridge-style {code, message} objects are the same shape as far
  // as this is concerned: a message, optionally carrying a code.
  if (typeof e === 'object') {
    const source = e as Record<string, unknown>;
    const message = readString(source, 'message');
    const code = readString(source, 'code');

    if (message && code) {
      // Don't repeat a code the message already spells out — the relay throws
      // `Error("Unknown action: x")` with `code: "UNKNOWN_ACTION"`, and
      // "Unknown action: x (UNKNOWN_ACTION)" reads worse than the message
      // alone. Compared on letters and digits only, since the code is
      // SHOUTING_SNAKE and the prose is not.
      return truncate(squash(message).includes(squash(code)) ? message : `${message} (${code})`);
    }
    if (message) return truncate(message);
    if (code) return truncate(code);

    // A thrown Error subclass with no message still has a useful name.
    if (e instanceof Error) return e.name || 'Error';

    // Anything else: show the contents rather than its type. This is the case
    // that used to become "[object Object]".
    try {
      const json = JSON.stringify(e);
      if (json && json !== '{}') return truncate(json);
    } catch {
      // Circular, or a BigInt/getter that throws — fall through.
    }
    return 'Unknown error (unrecognised object)';
  }

  return 'Unknown error';
}

/**
 * The error code, where the thrown value carries one.
 *
 * Kept separate from the message so callers that branch on a code (the
 * HomeKit edit-permission notice, retry decisions) don't have to parse prose.
 */
export function errorCode(e: unknown): string | undefined {
  if (e && typeof e === 'object') {
    const code = (e as Record<string, unknown>).code;
    if (typeof code === 'string' && code.trim()) return code.trim();
  }
  return undefined;
}

/**
 * Codes that mean the write never got a verdict, rather than being refused.
 *
 * These are the only ones worth rewording: for everything else the thrown
 * message says something specific about the accessory, and replacing it with
 * generic prose would throw away the useful half.
 */
const NO_VERDICT_CODES = new Set(['TIMEOUT', 'DEVICE_ERROR']);
const UNREACHABLE_CODES = new Set(['DISCONNECTED', 'NO_DEVICE']);

/**
 * What to tell someone whose device write did not land.
 *
 * `describeError` is right for a log and wrong for a toast. It deliberately
 * keeps the error code, so a failed tap read
 * `TIMEOUT: Request timed out: characteristic.set` — which names the transport
 * action rather than the thing the user touched, and asks them to parse a code
 * to learn that the light did not come on.
 *
 * Only transport failures are reworded, and deliberately without blaming the
 * connection: "didn't respond in time" is all we actually know. Whether the
 * connection is the cause is a separate question, now answered by the
 * connection indicator rather than guessed at here.
 */
export function describeWriteFailure(e: unknown, accessoryName?: string): string {
  const name = typeof accessoryName === 'string' ? accessoryName.trim() : '';
  const code = errorCode(e);

  if (code && NO_VERDICT_CODES.has(code)) {
    return `${name || 'The accessory'} didn't respond in time.`;
  }
  if (code && UNREACHABLE_CODES.has(code)) {
    return `Couldn't reach ${name || 'the accessory'} — your home isn't connected.`;
  }
  return describeError(e);
}
