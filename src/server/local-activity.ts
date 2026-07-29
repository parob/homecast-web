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
 * minutes of history, and about a megabyte with payloads.
 */
const MAX_BUFFERED = 2000;

const listeners = new Set<Listener>();
/** Newest last, so the array reads in the order things happened. */
const buffer: RelayActivityEntry[] = [];

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
  // An outcome replaces its pending entry rather than adding a second one, so
  // one request is one row here as well as on screen — otherwise a remote dump
  // would show every completed request twice, once as "still waiting".
  if (entry.id && entry.phase && entry.phase !== 'sent') {
    const pending = buffer.findIndex((e) => e.id === entry.id);
    if (pending !== -1) buffer[pending] = entry;
    else buffer.push(entry);
  } else {
    buffer.push(entry);
  }
  if (buffer.length > MAX_BUFFERED) buffer.splice(0, buffer.length - MAX_BUFFERED);

  for (const listener of listeners) {
    try {
      listener(entry);
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
  const entries = newestFirst.slice(0, limit);
  const more = newestFirst.length > limit;

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
