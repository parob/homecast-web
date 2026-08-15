/**
 * A record of what this client actually asked for, and when.
 *
 * Built because four rounds of reading source produced four wrong diagnoses of
 * "the app shows stale state on open". The question — does it fetch at startup,
 * and what comes back — is a question about a running app, and inferring it
 * from code is how you get confidently wrong answers.
 *
 * Two properties make it useful, and both are easy to lose:
 *
 *  - **Recording starts at module load, not when the panel mounts.** Startup is
 *    the interesting part, and the panel cannot exist yet while it happens.
 *    `connection.ts` imports this, and that is imported before anything issues
 *    a request, so the first entry really is the first thing the app did.
 *  - **It runs whether or not anyone is looking.** A bounded ring costs almost
 *    nothing, and it means switching the panel on shows the history that led
 *    here rather than an empty list waiting for the next event — which, for a
 *    bug that only happens at launch, would be useless.
 *
 * Deliberately holds short summaries rather than whole payloads: an accessory
 * list is megabytes, and keeping hundreds of them would trade one bug for an
 * out-of-memory one.
 */

/** Entries kept. Generous — a launch alone can be dozens. */
const MAX_ENTRIES = 600;

/** Page load, so every entry can be stamped relative to it. */
const T0 = Date.now();

export type LogKind = 'request' | 'event';
export type LogStatus = 'pending' | 'ok' | 'error';

export interface RequestLogEntry {
  id: number;
  /** Milliseconds since this page started — the axis that matters at launch. */
  at: number;
  kind: LogKind;
  /** `accessories.list`, or for events a source like `socket` / `app`. */
  action: string;
  /** Short context: a home id, a connection state, a reason. */
  detail?: string;
  /** Which transport answered — ws, local mode, or the relay's own bridge. */
  via?: string;
  status?: LogStatus;
  durationMs?: number;
  error?: string;
}

type Listener = () => void;

const entries: RequestLogEntry[] = [];
const listeners = new Set<Listener>();
let nextId = 1;
/** Coalesce notifications: a launch burst should not re-render per entry. */
let notifyScheduled = false;

function push(entry: RequestLogEntry): void {
  entries.push(entry);
  if (entries.length > MAX_ENTRIES) entries.splice(0, entries.length - MAX_ENTRIES);
  schedule();
}

function schedule(): void {
  if (notifyScheduled || listeners.size === 0) return;
  notifyScheduled = true;
  setTimeout(() => {
    notifyScheduled = false;
    for (const l of listeners) l();
  }, 100);
}

/** A point-in-time occurrence — a connection state change, a reload, a signal. */
export function logEvent(action: string, detail?: string): void {
  push({ id: nextId++, at: Date.now() - T0, kind: 'event', action, detail });
}

export interface RequestHandle {
  ok(via?: string): void;
  fail(err: unknown): void;
}

/**
 * Record a request in flight. Always returns a handle, so callers can wrap a
 * call without branching on whether logging is on.
 */
export function beginRequest(action: string, detail?: string): RequestHandle {
  const started = Date.now();
  const entry: RequestLogEntry = {
    id: nextId++,
    at: started - T0,
    kind: 'request',
    action,
    detail,
    status: 'pending',
  };
  push(entry);

  const settle = (status: LogStatus, extra?: Partial<RequestLogEntry>) => {
    entry.status = status;
    entry.durationMs = Date.now() - started;
    Object.assign(entry, extra);
    schedule();
  };

  return {
    ok: (via?: string) => settle('ok', via ? { via } : undefined),
    fail: (err: unknown) => {
      const e = err as { code?: string; message?: string } | null;
      settle('error', { error: e?.code || e?.message || String(err) });
    },
  };
}

export function getRequestLog(): readonly RequestLogEntry[] {
  return entries;
}

export function clearRequestLog(): void {
  entries.length = 0;
  schedule();
  // schedule() no-ops while a notify is already pending, so make sure an empty
  // list actually reaches the panel.
  for (const l of listeners) l();
}

export function subscribeRequestLog(fn: Listener): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

/** Plain text for pasting into a bug report. */
export function formatRequestLog(): string {
  const lines = entries.map((e) => {
    const t = `+${(e.at / 1000).toFixed(2)}s`.padStart(9);
    if (e.kind === 'event') return `${t}  ·  ${e.action}${e.detail ? ` ${e.detail}` : ''}`;
    const status = e.status === 'pending' ? '…' : e.status === 'ok' ? 'ok' : `ERR ${e.error ?? ''}`;
    const dur = e.durationMs !== undefined ? ` ${e.durationMs}ms` : '';
    return `${t}  →  ${e.action}${e.detail ? ` ${e.detail}` : ''}${dur} ${status}${e.via ? ` [${e.via}]` : ''}`;
  });
  return [
    `Homecast request log — ${entries.length} entries, t0 = page load`,
    `ua: ${typeof navigator !== 'undefined' ? navigator.userAgent : 'n/a'}`,
    '',
    ...lines,
  ].join('\n');
}

// ── the panel's own on/off, kept out of account settings on purpose ──────────

const PANEL_KEY = 'homecast-debug-request-panel';

/**
 * Read synchronously from localStorage rather than from account settings.
 *
 * The panel has to be on *before* the app starts fetching, or it misses the
 * only thing it is for. Account settings arrive over the network well after
 * that, so storing it there would mean the panel could never see a launch.
 */
export function isRequestPanelEnabled(): boolean {
  try {
    return localStorage.getItem(PANEL_KEY) === '1';
  } catch {
    return false;
  }
}

export function setRequestPanelEnabled(on: boolean): void {
  try {
    if (on) localStorage.setItem(PANEL_KEY, '1');
    else localStorage.removeItem(PANEL_KEY);
  } catch {
    // Private mode or a full quota. The toggle simply will not persist.
  }
  for (const l of panelListeners) l();
}

const panelListeners = new Set<Listener>();
export function subscribeRequestPanelEnabled(fn: Listener): () => void {
  panelListeners.add(fn);
  return () => { panelListeners.delete(fn); };
}
