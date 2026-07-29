// Live relay activity, buffered for display.
//
// The stream can be fast — a busy home produces a HomeKit event per accessory
// per change — so this holds a bounded ring rather than growing without limit,
// and batches renders instead of setting state per entry.
//
// Pausing stops the *display* advancing, not the subscription: entries still
// arrive and fill the buffer, so resuming shows what happened while you were
// reading rather than a gap. That is the whole reason to pause a live log.

import { useCallback, useEffect, useRef, useState } from 'react';
import { onLocalRelayActivity } from '@/server/local-activity';
import type { RelayActivityEntry } from '@/server/websocket';

/** Entries kept. Roughly a few minutes of a busy relay. */
const MAX_ENTRIES = 500;
/** Render at most this often; a burst should not schedule a render per entry. */
const FLUSH_MS = 120;

export interface RelayActivity {
  entries: RelayActivityEntry[];
  paused: boolean;
  setPaused: (paused: boolean) => void;
  clear: () => void;
  /** Entries received while paused, so the resume affordance can say so. */
  pendingWhilePaused: number;
}

export function useRelayActivity(deviceId: string | undefined): RelayActivity {
  const [entries, setEntries] = useState<RelayActivityEntry[]>([]);
  const [paused, setPaused] = useState(false);
  const [pendingWhilePaused, setPendingWhilePaused] = useState(0);

  // The authoritative buffer. State is a snapshot of it, published on a timer.
  const buffer = useRef<RelayActivityEntry[]>([]);
  const flushTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Read inside the subscription callback, which is registered once.
  const pausedRef = useRef(paused);
  pausedRef.current = paused;

  const publish = useCallback(() => {
    flushTimer.current = null;
    if (pausedRef.current) return;
    setEntries([...buffer.current]);
    setPendingWhilePaused(0);
  }, []);

  useEffect(() => {
    if (!deviceId) return;

    const unwatch = onLocalRelayActivity((entry) => {
      // Newest first: a live log is read from the top.
      buffer.current.unshift(entry);
      if (buffer.current.length > MAX_ENTRIES) {
        buffer.current.length = MAX_ENTRIES;
      }

      if (pausedRef.current) {
        setPendingWhilePaused((n) => n + 1);
        return;
      }
      if (flushTimer.current === null) {
        flushTimer.current = setTimeout(publish, FLUSH_MS);
      }
    });

    return () => {
      unwatch();
      if (flushTimer.current !== null) {
        clearTimeout(flushTimer.current);
        flushTimer.current = null;
      }
    };
  }, [deviceId, publish]);

  // Resuming shows everything that arrived while paused, not just what is next.
  useEffect(() => {
    if (!paused) publish();
  }, [paused, publish]);

  const clear = useCallback(() => {
    buffer.current = [];
    setEntries([]);
    setPendingWhilePaused(0);
  }, []);

  return { entries, paused, setPaused, clear, pendingWhilePaused };
}
