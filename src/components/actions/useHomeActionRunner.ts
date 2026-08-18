import { useRef, useState } from 'react';
import type { HomeAction } from './catalog';
import type { RunHomeActionOverrides } from './useRunHomeAction';

/**
 * The run state behind the shortcut cards: what is running, how far it has got,
 * and which way it is going.
 *
 * Lifted out of ActionsSection when Scenes and Actions merged into one section.
 * The cards moved; this did not change.
 */
export function useHomeActionRunner(
  onRunAction: (action: HomeAction, opts?: RunHomeActionOverrides) => Promise<void>,
) {
  const [runningId, setRunningId] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [confirming, setConfirming] = useState<HomeAction | null>(null);
  // Which way the run in flight is going, so it can be narrated. A two-way
  // action's own runningLabel follows the direction the *catalog* picked, which
  // is the opposite of what the user chose exactly when they overrode it.
  const [runningDirection, setRunningDirection] = useState<boolean | undefined>(undefined);

  /**
   * The run in flight, so the next press can call it off.
   *
   * A two-way action stays live while it works: half a house changing its mind
   * is exactly when you want the control back, and blocking the press until the
   * last bulb answers is how "I pressed it twice" happens. The replacement run
   * aborts this one, which drops every write still queued — and because an
   * interruptible run only moves accessories it has confirmed, the reversal is
   * computed from what actually changed rather than from what was intended.
   */
  const inFlight = useRef<AbortController | null>(null);

  const run = async (action: HomeAction, direction?: boolean) => {
    const total = direction === undefined || !action.toggle
      ? action.targetCount
      : (direction ? action.toggle.onSteps : action.toggle.offSteps).flatMap(s => s.writes).length;

    // Taking over from a live run changes what the replacement has to write:
    // the cached readings it would otherwise filter on are mid-change, so it
    // asserts the wanted value on every member instead.
    const supersedes = inFlight.current !== null;
    inFlight.current?.abort();
    const controller = new AbortController();
    inFlight.current = controller;

    setRunningId(action.id);
    setRunningDirection(direction);
    setProgress({ done: 0, total });
    try {
      await onRunAction(action, {
        direction,
        supersedes,
        signal: action.toggle ? controller.signal : undefined,
        onProgress: (done, t) => {
          // A superseded run keeps settling its issued writes; its counts are
          // no longer what the card is reporting on.
          if (inFlight.current === controller) setProgress({ done, total: t });
        },
      });
    } finally {
      // Only the current run owns the running state. An aborted one finishes
      // late, and clearing here would wipe its replacement's.
      if (inFlight.current === controller) {
        inFlight.current = null;
        setRunningId(null);
        setRunningDirection(undefined);
        setProgress(null);
      }
    }
  };

  /**
   * What is happening, for the subtitle. The title stays put.
   *
   * Swapping the title for "Turning the lights off" made the card rename itself
   * mid-press and, being half again as long, wrap and clip against the two-line
   * clamp. A name that changes under you is hard to scan and hard to aim at, so
   * the name is the name and the verb goes underneath, where the count already
   * lives.
   */
  const runningTextOf = (action: HomeAction) => {
    if (action.toggle && runningDirection !== undefined) {
      return runningDirection ? action.toggle.onRunning : action.toggle.offRunning;
    }
    return action.runningLabel;
  };

  const press = (action: HomeAction) => {
    if (action.confirm) setConfirming(action);
    else run(action);
  };

  return { runningId, progress, runningTextOf, run, press, confirming, setConfirming };
}
