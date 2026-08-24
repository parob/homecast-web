/**
 * One write in flight per control, and the last value always wins.
 *
 * `VerticalSlider` commits on a 250ms leading-edge throttle that is purely
 * time-based — it never checks whether the previous write came back. On a
 * healthy link that is invisible, because a write settles in tens of
 * milliseconds and nothing overlaps. On a slow or flaky one a two-second drag
 * puts eight writes in flight at once, plus a ninth on release.
 *
 * That matters because the relay does not serialise them: the cloud handler
 * spawns each message so a slow request cannot block the socket, so eight
 * concurrent `characteristic.set`s can reach HomeKit in any order. **The device
 * can settle on a value that is not the last one the user chose** — and since
 * the cache holds the value they *did* choose, the tile and the bulb disagree
 * with nothing reporting an error anywhere.
 *
 * So writes for the same control are funnelled through here: at most one is
 * ever in flight, and while it is, only the newest queued value is kept. Every
 * intermediate value from the same gesture is dropped, because nobody wants
 * them — they were places a finger passed through on the way somewhere.
 *
 * ── This is not request replay ─────────────────────────────────────────────
 *
 * The rule elsewhere in this codebase is reject, don't replay: the caller knows
 * whether a request is safe to repeat and the transport does not. Nothing here
 * contradicts that. Coalescing happens *before* a request is sent, never after
 * one has failed, and a queued value is a request that has not been made yet
 * rather than one being made again. A failure still rejects, still reverts and
 * still tells the user.
 */

type Sender = (value: unknown) => Promise<unknown>;

interface Queued {
  value: unknown;
  send: Sender;
  resolve: () => void;
  reject: (error: unknown) => void;
}

interface Entry {
  inFlight: boolean;
  /** Only ever the newest. Anything it replaces is already superseded. */
  queued: Queued | null;
}

const entries = new Map<string, Entry>();

/** The registry key for one control: a characteristic on an accessory. */
export const writeKey = (accessoryId: string, characteristicType: string): string =>
  `${accessoryId}:${characteristicType}`;

/**
 * Send `value` for `key`, coalescing against anything already travelling.
 *
 * The returned promise settles the way the caller needs for its optimistic
 * update: it rejects only if a write that was actually attempted failed, so a
 * revert always reverts something real.
 *
 * **A superseded write resolves rather than rejects.** It was dropped
 * deliberately, in favour of a newer value from the same person, so there is
 * nothing to report and nothing to roll back — rejecting would revert a tile
 * the user has already moved past, which is the very confusion this exists to
 * prevent. The newest value carries the outcome for all of them.
 */
export function coalescedWrite(key: string, value: unknown, send: Sender): Promise<void> {
  const existing = entries.get(key);

  if (!existing || !existing.inFlight) {
    const entry: Entry = existing ?? { inFlight: false, queued: null };
    entries.set(key, entry);
    entry.inFlight = true;
    return settle(key, send(value));
  }

  // Something is already travelling. Replace whatever was waiting behind it.
  if (existing.queued) existing.queued.resolve();
  return new Promise<void>((resolve, reject) => {
    existing.queued = { value, send, resolve, reject };
  });
}

function settle(key: string, p: Promise<unknown>): Promise<void> {
  return p.then(
    () => { drain(key); },
    (error) => { drain(key); throw error; },
  );
}

/**
 * Send whatever is waiting, or stand down.
 *
 * A queued value is sent even when the write before it failed: it has never
 * been attempted, and it is the only version of the user's intent that is
 * still current. On a dead connection it simply fails fast in turn.
 */
function drain(key: string): void {
  const entry = entries.get(key);
  if (!entry) return;

  const next = entry.queued;
  entry.queued = null;

  if (!next) {
    entry.inFlight = false;
    entries.delete(key);
    return;
  }

  entry.inFlight = true;
  next.send(next.value).then(
    () => { next.resolve(); drain(key); },
    (error) => { next.reject(error); drain(key); },
  );
}

/** Is a write for this control travelling or waiting? Exposed for tests. */
export function hasOutstandingWrite(key: string): boolean {
  const entry = entries.get(key);
  return !!entry && (entry.inFlight || entry.queued !== null);
}

/** Tests only. */
export function __resetWriteCoalescer(): void {
  entries.clear();
}
