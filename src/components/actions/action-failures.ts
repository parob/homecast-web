/**
 * The accessories an action could not reach, held for as long as someone might
 * want to look at them.
 *
 * The toast that reports a partial run auto-dismisses, so anything it does not
 * say is gone a few seconds later — which was the whole complaint in
 * homecast-cloud#87. It can only carry one line, and the relay answers with a
 * *different* reason per accessory; a sheet is where two reasons fit.
 *
 * A module store rather than context because the opener is a toast callback,
 * which lives outside any provider by the time it fires, and the sheet itself
 * is mounted once beside `<Toaster/>` in App.tsx. Same shape as
 * `lib/debug-dock.ts`.
 */

import { useSyncExternalStore } from 'react';
import type { HomeActionWrite } from './catalog';

/** One accessory that did not take its write, and what to re-send. */
export interface ActionFailure {
  accessoryId: string;
  /** Display name, when the action carried one. Only the power actions do. */
  name?: string;
  /** One line saying what went wrong for this accessory specifically. */
  reason: string;
  /** The original write, so a retry asks for the same value again. */
  write: HomeActionWrite;
}

export interface ActionFailureReport {
  /**
   * Identifies this run, so a second partial run replaces the first rather than
   * leaving the sheet describing something that has since been superseded.
   */
  id: string;
  /** What was pressed — "All lights". */
  actionLabel: string;
  /** When it finished, for the sheet's subtitle. */
  at: number;
  failures: ActionFailure[];
  /**
   * Re-send exactly these writes. Supplied by the runner, which is the only
   * thing that knows how to reach the relay and which home to reach it for.
   */
  retry: (failures: ActionFailure[]) => void;
}

let current: ActionFailureReport | null = null;
const listeners = new Set<() => void>();

function emit(): void {
  for (const l of listeners) l();
}

export function getActionFailures(): ActionFailureReport | null {
  return current;
}

/**
 * Record a partial run and open the sheet on it.
 *
 * Called from the toast's Details button rather than when the run ends: a
 * sheet that appeared on its own would interrupt, which is precisely what the
 * toast exists to avoid.
 */
export function openActionFailures(report: ActionFailureReport): void {
  current = report;
  emit();
}

export function closeActionFailures(): void {
  if (current === null) return;
  current = null;
  emit();
}

/**
 * Drop the accessories a retry has since fixed, leaving the sheet showing only
 * what is still wrong.
 *
 * Keeps the sheet open while anything remains, and closes it when nothing does
 * — the answer to "did that work" is the row going away.
 */
export function resolveActionFailures(accessoryIds: string[]): void {
  if (current === null) return;
  const fixed = new Set(accessoryIds);
  const remaining = current.failures.filter(f => !fixed.has(f.accessoryId));
  if (remaining.length === current.failures.length) return;
  current = remaining.length === 0 ? null : { ...current, failures: remaining };
  emit();
}

export function subscribeActionFailures(fn: () => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

/**
 * The run being looked at, or null.
 *
 * The server snapshot is the same getter: nothing can have failed before
 * hydration, so it is null either way.
 */
export function useActionFailures(): ActionFailureReport | null {
  return useSyncExternalStore(subscribeActionFailures, getActionFailures, getActionFailures);
}
