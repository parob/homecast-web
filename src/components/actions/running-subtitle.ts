/**
 * How long a run waits before the card starts counting.
 *
 * Most presses answer well inside a second, and a counter that appears and
 * vanishes on every one of them is a flicker rather than information. Past a
 * second the question has changed from "did it take" to "is it stuck", which is
 * the question the number exists to answer.
 */
const QUIET_SECONDS = 1;

/**
 * What the card says under its name while an action runs.
 *
 * It used to be the verb plus `done of total`, and on a bulk-capable relay that
 * count could not move: the whole action is one `characteristics.set`, so
 * `onProgress` fires at nought and again at the end, with nothing in between.
 * In homecast-cloud#87 it read `Turning on · 0 of 41` for 6,480 ms unchanged,
 * which reads as stuck rather than as working.
 *
 * The card is 197px wide and the subtitle keeps 89.5px of it with the toggle
 * parked at an end, 70.5px with the toggle in the middle — which is what a
 * half-changed home shows for most of a run. Measured at 10px:
 *
 *   Turning on · 0 of 41      86.9px   fits only at an end
 *   Turning on · 24 of 41     92.5px   clips either way
 *   Turning on · 128 of 223  103.6px   clips either way
 *   Turning on · 6s           66.9px   fits either way
 *
 * So the count was readable in exactly the state it was stuck in, and overflowed
 * for every value it would have moved to. Elapsed both moves and fits.
 *
 * Seconds only, with no minute rollover: the relay gives up on its native bridge
 * at 15s, so a run reaching three digits is a bug in something else and a
 * prettier clock would not help it.
 */
export function runningSubtitle(verb: string, elapsedSeconds: number | null): string {
  if (elapsedSeconds === null || elapsedSeconds < QUIET_SECONDS) return verb;
  return `${verb} · ${Math.floor(elapsedSeconds)}s`;
}
