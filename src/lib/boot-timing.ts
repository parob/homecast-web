/**
 * Cold-start timing.
 *
 * The loading work so far was guided by reading the code, not by measurement —
 * web-vitals is wired but skipped in Community mode (see main.tsx), which is
 * exactly the relay Mac where "stuck on a loading screen for ages" was
 * reported. So the one environment with the problem was the one reporting
 * nothing.
 *
 * This records the boot milestones in both modes. In cloud mode the summary
 * ships to Cloud Logging with everything else; in Community mode it stays in
 * the local ring buffer, which is what the Diagnostics page reads. Either way
 * the next round of work can be aimed rather than guessed.
 *
 * All values are milliseconds since navigation start (performance.now() is
 * relative to timeOrigin), so they compose with the browser's own timings.
 */
import { browserLogger } from './browser-logger';

export type BootMark =
  | 'module'       // main.tsx evaluated — JS has parsed
  | 'mount'        // createRoot().render() called — the splash is replaced
  | 'auth'         // authLoading resolved — the gate opens
  | 'shell'        // Dashboard chrome rendered
  | 'homes'        // homes list on screen
  | 'accessories'; // first accessories on screen — the app is useful

const marks = new Map<BootMark, number>();
let reported = false;

export function markBoot(name: BootMark): void {
  if (marks.has(name)) return; // first occurrence only — re-renders must not move it
  const t = Math.round(performance.now());
  marks.set(name, t);
  try {
    // Also drop a real performance mark, so a devtools timeline recording lines
    // these up against paint and network without any extra tooling.
    performance.mark(`homecast:${name}`);
  } catch { /* not worth failing a boot over */ }
}

export function getBootMarks(): Record<string, number> {
  return Object.fromEntries(marks);
}

/**
 * Emit the summary once the app is actually usable.
 *
 * `warmCache` is the interesting dimension: a warm start paints from the
 * persisted cache and should reach 'accessories' almost immediately, while a
 * cold one is bounded by the relay. Averaging the two together would hide both.
 */
export function reportColdStart(info: { warmCache: boolean; mode: string; homes?: number; accessories?: number }): void {
  if (reported) return;
  reported = true;

  const m = getBootMarks();
  const total = m.accessories ?? m.shell ?? m.mount ?? Math.round(performance.now());

  browserLogger.logInfo(`cold-start:${total}ms`, {
    coldStart: true,
    totalMs: total,
    ...m,
    // Deltas, because the gaps are what identify the culprit — a large
    // auth→shell says the gate is the problem, a large mount→auth says the
    // retry loop is.
    d_moduleToMount: m.mount != null && m.module != null ? m.mount - m.module : undefined,
    d_mountToAuth: m.auth != null && m.mount != null ? m.auth - m.mount : undefined,
    d_authToShell: m.shell != null && m.auth != null ? m.shell - m.auth : undefined,
    d_shellToAccessories: m.accessories != null && m.shell != null ? m.accessories - m.shell : undefined,
    warmCache: info.warmCache,
    mode: info.mode,
    homes: info.homes,
    accessories: info.accessories,
  });
}
