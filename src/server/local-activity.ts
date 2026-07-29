// The relay's own account of what it is doing.
//
// On the relay Mac the dashboard *is* the relay: this WebView handles every
// request, receives every HomeKit event, calls into HomeKit and runs the
// automation engine. Sending that to the cloud so it can be sent back to the
// same machine is a round trip for information already in hand.
//
// It is also the only version that works when it matters. A cloud-sourced
// stream travels over the relay's socket, so a relay that has stopped answering
// cannot report that it has stopped answering. This one is in-process: it keeps
// describing the relay right up to the moment the relay stops running, which is
// precisely the window we have spent an evening unable to see.
//
// Recording is always on, not gated on a viewer. A fault worth reading about
// has usually happened *before* anyone opens the panel — the whole reason this
// exists is a relay that goes quiet unattended — so the buffer is kept whether
// or not anyone is looking, and both the panel and the remote dump read from it.

import type { RelayActivityEntry } from './websocket';

type Listener = (entry: RelayActivityEntry) => void;

/**
 * Entries retained. Sized for the gap between something going wrong and someone
 * looking: a busy relay produces a few entries a second, so this is roughly ten
 * minutes of history.
 */
const MAX_BUFFERED = 2000;

/**
 * Bytes retained, whichever limit is reached first.
 *
 * A count alone does not bound memory, because entry sizes differ by four
 * orders of magnitude — one `accessories.list` response measured 1.6 MB, and
 * two thousand of those is not a diagnostic buffer, it is an outage. Payloads
 * are capped individually below; this is the backstop for their sum.
 */
const MAX_BUFFER_BYTES = 4_000_000;

/** Longest JSON carried for a single payload field. */
const PAYLOAD_LIMIT = 2000;

/**
 * Fields that carry caller-supplied data of unbounded size. Everything else on
 * an entry is a scalar the recorder controls.
 */
const PAYLOAD_KEYS = ['request', 'response', 'value', 'triggerData', 'steps'] as const;

/**
 * A payload small enough to keep in a live buffer.
 *
 * `accessories.list` for three homes is over a megabyte, and a buffer of those
 * is a memory leak on the relay Mac — which is the machine this is supposed to
 * be diagnosing, not degrading. Large values collapse to a shape summary, which
 * is what you want when reading anyway: the *size* of a response is usually the
 * diagnostic, not its contents.
 */
export function summariseForActivity(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  // Scalars can't be large enough to matter, and skipping them keeps the
  // stringify off the hot path for the majority of fields.
  if (typeof value !== 'object' && typeof value !== 'string') return value;
  try {
    const json = JSON.stringify(value);
    if (json === undefined) return '[unserialisable]';
    if (json.length <= PAYLOAD_LIMIT) return value;

    if (Array.isArray(value)) return `[${value.length} items, ${json.length} bytes]`;
    if (typeof value === 'object') {
      const shape: Record<string, string> = {};
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        shape[k] = Array.isArray(v) ? `[${v.length} items]` : typeof v;
      }
      return { '…truncated': `${json.length} bytes`, ...shape };
    }
    return `${json.slice(0, PAYLOAD_LIMIT)}…`;
  } catch {
    // Circular, or a getter that throws.
    return '[unserialisable]';
  }
}

/**
 * Bound every payload on an entry.
 *
 * Done here rather than at the call sites because a call site can forget, and
 * one did: the native-bridge instrumentation stored `accessories.list`
 * responses verbatim while the identical helper sat unused two modules away.
 * Capping on the way into the buffer means a new lane cannot reintroduce it.
 */
function boundPayloads(entry: RelayActivityEntry): RelayActivityEntry {
  let bounded: RelayActivityEntry | null = null;
  for (const key of PAYLOAD_KEYS) {
    const value = (entry as Record<string, unknown>)[key];
    if (value === undefined) continue;
    const small = summariseForActivity(value);
    if (small !== value) {
      bounded = bounded ?? { ...entry };
      (bounded as Record<string, unknown>)[key] = small;
    }
  }
  return bounded ?? entry;
}

function measure(entry: RelayActivityEntry): number {
  try {
    return JSON.stringify(entry)?.length ?? 0;
  } catch {
    return 0;
  }
}

const listeners = new Set<Listener>();
/** Newest last, so the array reads in the order things happened. */
const buffer: RelayActivityEntry[] = [];
/** Serialised size of `buffer[i]`, kept in step so eviction can bound memory. */
const sizes: number[] = [];
let bufferBytes = 0;

/** Listen to this relay's own activity. Returns an unsubscribe. */
export function onLocalRelayActivity(listener: Listener): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/**
 * Should callers build an entry?
 *
 * Always true while recording is on. Kept as a function so the check stays in
 * one place and the call sites do not have to know the policy — turning
 * recording off later is one edit here rather than a dozen.
 */
export function hasLocalActivityListeners(): boolean {
  return true;
}

/**
 * Publish one entry. Never throws: this is called from the request path, and a
 * diagnostic must not be able to break the thing it describes.
 */
export function emitLocalRelayActivity(entry: RelayActivityEntry): void {
  const bounded = boundPayloads(entry);
  const size = measure(bounded);

  // An outcome replaces its pending entry rather than adding a second one, so
  // one request is one row here as well as on screen — otherwise a remote dump
  // would show every completed request twice, once as "still waiting".
  if (bounded.id && bounded.phase && bounded.phase !== 'sent') {
    const pending = buffer.findIndex((e) => e.id === bounded.id);
    if (pending !== -1) {
      bufferBytes += size - sizes[pending];
      buffer[pending] = bounded;
      sizes[pending] = size;
    } else {
      buffer.push(bounded);
      sizes.push(size);
      bufferBytes += size;
    }
  } else {
    buffer.push(bounded);
    sizes.push(size);
    bufferBytes += size;
  }

  // Evict oldest-first until under both limits — whichever binds first wins.
  // Never evicts the newest entry: a single oversized one should cost history,
  // not the record of the thing that just happened.
  let drop = 0;
  while (
    (buffer.length - drop > MAX_BUFFERED || bufferBytes > MAX_BUFFER_BYTES) &&
    drop < buffer.length - 1
  ) {
    bufferBytes -= sizes[drop];
    drop++;
  }
  if (drop > 0) {
    buffer.splice(0, drop);
    sizes.splice(0, drop);
  }
  if (bufferBytes < 0) bufferBytes = 0;

  for (const listener of listeners) {
    try {
      listener(bounded);
    } catch (e) {
      console.error('[LocalActivity] listener failed', e);
    }
  }
}

export interface ActivityDumpOptions {
  /** Entries to return. Bounded so one call cannot try to ship the whole ring. */
  limit?: number;
  /** Page backwards: return entries strictly older than this timestamp. */
  before?: number;
  /** Restrict to one lane. */
  lane?: RelayActivityEntry['lane'];
}

export interface ActivityDump {
  entries: RelayActivityEntry[];
  /** Total held, so a caller knows whether it is seeing everything. */
  buffered: number;
  /** Pass as `before` to fetch the next page; absent when there is no more. */
  nextBefore?: number;
  /** Oldest entry retained, so a caller can tell history was dropped. */
  oldestAt?: number;
}

const MAX_DUMP_LIMIT = 500;
/** Ceiling on one page, so a dump can never be the thing that breaks a relay. */
const MAX_DUMP_BYTES = 512_000;

/**
 * A page of history, newest first.
 *
 * Paginated because a full buffer with payloads is megabytes, and this is
 * fetched over the relay socket — the same socket whose health is often the
 * thing in question. Shipping it in one response would be the diagnostic
 * causing the symptom.
 */
export function getActivityDump(options: ActivityDumpOptions = {}): ActivityDump {
  const limit = Math.min(Math.max(options.limit ?? 100, 1), MAX_DUMP_LIMIT);

  let candidates = options.lane ? buffer.filter((e) => e.lane === options.lane) : buffer;
  if (options.before !== undefined) {
    candidates = candidates.filter((e) => e.at < options.before!);
  }

  // Newest first, matching the panel, so a dump reads the same way.
  const newestFirst = [...candidates].reverse();

  // Bound the response by bytes as well as by count. Entries are capped
  // individually on the way in, but a page of the large ones still adds up, and
  // this travels over the relay's own socket — a 300-entry page disconnected a
  // live relay before the per-entry cap existed. Always returns at least one
  // entry, so paging can never stall on an oversized row.
  const entries: RelayActivityEntry[] = [];
  let bytes = 0;
  for (const entry of newestFirst) {
    if (entries.length >= limit) break;
    const size = measure(entry);
    if (entries.length > 0 && bytes + size > MAX_DUMP_BYTES) break;
    entries.push(entry);
    bytes += size;
  }
  const more = newestFirst.length > entries.length;

  return {
    entries,
    buffered: buffer.length,
    ...(more && entries.length > 0 ? { nextBefore: entries[entries.length - 1].at } : {}),
    ...(buffer.length > 0 ? { oldestAt: buffer[0].at } : {}),
  };
}

/** Everything held, newest first — for seeding a freshly opened panel. */
export function getBufferedActivity(): RelayActivityEntry[] {
  return [...buffer].reverse();
}

export interface ActivityStats {
  /** Entries held. Non-zero is proof that recording ran while nobody watched. */
  buffered: number;
  /** Requests sent and still unanswered past `stuckAfterMs`. */
  stuck: number;
  /** When the newest entry landed, or 0 if nothing has been recorded yet. */
  lastAt: number;
}

/**
 * A summary cheap enough to poll from somewhere the stream itself isn't shown.
 *
 * The buffer fills whether or not the activity view is open, but from another
 * screen there is no way to know that — so this is what a tab badge reads to
 * show a relay is recording, and to surface a stuck request without anyone
 * having to go looking for it.
 */
export function getActivityStats(stuckAfterMs = 10_000): ActivityStats {
  const cutoff = activityNow() - stuckAfterMs / 1000;
  let stuck = 0;
  for (const entry of buffer) {
    if (entry.phase === 'sent' && entry.at <= cutoff) stuck++;
  }
  return {
    buffered: buffer.length,
    stuck,
    lastAt: buffer.length > 0 ? buffer[buffer.length - 1].at : 0,
  };
}

/** Seconds since the epoch, matching every other timestamp in the stream. */
export function activityNow(): number {
  return Date.now() / 1000;
}
