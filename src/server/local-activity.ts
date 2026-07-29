// The relay's own account of what it is doing.
//
// On the relay Mac the dashboard *is* the relay: this WebView handles every
// request, receives every HomeKit event and runs the automation engine. Sending
// that to the cloud so it can be sent back to the same machine is a round trip
// for information already in hand.
//
// It is also the only version that works when it matters. The cloud-sourced
// stream travels over the relay's socket, so a relay that has stopped answering
// cannot report that it has stopped answering. This one is in-process: it keeps
// describing the relay right up to the moment the relay stops running, which is
// precisely the window we have spent an evening unable to see.
//
// Remote viewers still need the server-sourced stream (see handler.py); this is
// the local fast path, preferred whenever the screen and the relay are the same
// process.

import type { RelayActivityEntry } from './websocket';

type Listener = (entry: RelayActivityEntry) => void;

const listeners = new Set<Listener>();

/** Listen to this relay's own activity. Returns an unsubscribe. */
export function onLocalRelayActivity(listener: Listener): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** Is anyone watching? Callers check this to avoid building entries for nobody. */
export function hasLocalActivityListeners(): boolean {
  return listeners.size > 0;
}

/**
 * Publish one entry. Never throws: this is called from the request path, and a
 * diagnostic must not be able to break the thing it describes.
 */
export function emitLocalRelayActivity(entry: RelayActivityEntry): void {
  if (listeners.size === 0) return;
  for (const listener of listeners) {
    try {
      listener(entry);
    } catch (e) {
      console.error('[LocalActivity] listener failed', e);
    }
  }
}

/** Seconds since the epoch, matching the server-sourced entries. */
export function activityNow(): number {
  return Date.now() / 1000;
}
