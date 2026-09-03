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
 *
 * `DEVICE_ERROR` used to be in here, and it was the wrong side of the line.
 * The two codes come from adjacent branches of the same handler
 * (`websocket/handler.py`): `TIMEOUT` is the *cloud* giving up on the relay —
 * genuinely no verdict — while `DEVICE_ERROR` is raised when the relay
 * **answered** and the answer was an error. It is the verdict, and its message
 * is the only place the reason exists.
 *
 * parob/homecast-cloud#28: a lock answered in 87ms and the user was told
 * "didn't respond in time", five times running. Both halves of that sentence
 * were false, and the real reason had already been discarded.
 */
const NO_VERDICT_CODES = new Set(['TIMEOUT']);
const UNREACHABLE_CODES = new Set(['DISCONNECTED', 'NO_DEVICE', 'LOCAL_ONLY']);

/**
 * The one `DEVICE_ERROR` whose verdict is that there is no verdict.
 *
 * The line #28 drew is right and this sits on the far side of it: the relay
 * answered, so the message is real, but what it says is that it asked the
 * native bridge and the bridge never came back —
 * `BRIDGE_TIMEOUT: HomeKit bridge did not answer characteristics.set within
 * 15s`. `native/homekit-bridge.ts` raises it and leaves the underlying call in
 * flight *on purpose*, because it cannot be cancelled and may still land. It
 * routinely does: in parob/homecast-cloud#62 every light in the house went off
 * and the relay was still broadcasting the changes half a minute later.
 *
 * Matched on the relay's own code prefix rather than on prose, so it survives
 * a reworded message and cannot catch a bulb whose name happens to say it.
 */
const NO_VERDICT_RELAY_PREFIX = /^BRIDGE_TIMEOUT\b/;

/**
 * Whether this failure leaves the write's outcome genuinely unknown.
 *
 * The distinction a caller needs before it decides what to show: a refused
 * write is a fact and can be put back, while an unanswered one is a question,
 * and answering it with the old value is how a house that is already dark ends
 * up drawn as fully lit.
 */
export function isUndecidedWrite(e: unknown): boolean {
  const code = errorCode(e);
  if (code && NO_VERDICT_CODES.has(code)) return true;
  if (!e || typeof e !== 'object') return false;
  return NO_VERDICT_RELAY_PREFIX.test(readString(e as Record<string, unknown>, 'message'));
}

/**
 * The relay's stable code, prepended to its own prose by the transport.
 *
 * A toast that opens "WRITE_FAILED: " asks the reader to skip a token before
 * the sentence starts, and `errorCode()` already carries the code for callers
 * that branch on it. Stripped for display only — `describeError` still keeps
 * it, because a log search is exactly what it is for.
 */
const RELAY_CODE_PREFIX = /^[A-Z][A-Z0-9_]{2,}:\s+/;

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
 *
 * Everything else answered, so it gets said rather than summarised. Only the
 * machine prefix comes off: the sentence itself is the relay's to write, and
 * inventing prose over the top of it is how #28 happened.
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

  if (e && typeof e === 'object') {
    const message = readString(e as Record<string, unknown>, 'message').replace(RELAY_CODE_PREFIX, '');
    if (message) return truncate(message);
  }
  return describeError(e);
}
