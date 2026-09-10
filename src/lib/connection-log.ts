/**
 * What a connection-state change gets written down as.
 *
 * The socket's transitions were shipped as `connection: reconnecting` with
 * `details = "prev=connected"` and nothing else — the same eleven characters
 * whether the pod redirected us, the relay's address changed, the server asked
 * for a reconnect, the token expired, or the socket was cut by a proxy on an
 * idle timeout. There is a good `ws_close` entry carrying the close code, but
 * it is a *separate* entry that exists only for closes, so reading a drop meant
 * correlating two lines and every non-close transition had no reason at all.
 * That is parob/homecast-cloud#113: the reporter's whole 404-entry buffer held
 * two connection lines, neither of which said why.
 *
 * This is the formatting half, kept pure and away from the socket so it can be
 * tested without one. `websocket.ts` names the reason at each transition and
 * hands the evidence over; `connection.ts` turns it into the log entry.
 */

/** Why a transition happened. Short, stable tokens — they get grouped on. */
export type TransitionReason =
  | 'connect'              // connect() — the app asked for a socket
  | 'manual'               // disconnect() — the app asked for it to stop
  | 'pod-redirect'         // the server handed us to a different pod
  | 'relay-address-changed'// same relay, different address (left/rejoined the LAN)
  | 'server-requested'     // the server asked us to reconnect
  | 'server-ready'         // the server greeted us
  | 'ready-fallback'       // no greeting came; assumed usable after the timeout
  | 'auth-expired'         // 4001, refreshing the token
  | 'auth-refreshed'       // the refresh worked, reconnecting with a new token
  | 'refresh-failed'       // the refresh was rejected
  | 'replaced'             // 4002, another connection took over
  | 'session-expired'      // 4003
  | `close:${number}`;     // any other close, by code

export interface TransitionFacts {
  /** The state being left. */
  prev: string;
  /** How long it was in that state, ms. Null when it was never entered here. */
  prevMs?: number | null;
  reason?: TransitionReason | null;
  /**
   * Whatever the call site knows that bears on the reason: `clean`, `visibility`,
   * `online`, `attempt`, `delay_ms`, `target`. Flat, primitive values only —
   * these are rendered into one log line and shipped as queryable fields.
   */
  evidence?: Record<string, string | number | boolean | null | undefined> | null;
}

/** `41s`, `950ms`, `2m 5s` — a duration someone is reading in a log. */
export function duration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)}s`;
  const m = Math.floor(ms / 60_000);
  const s = Math.round((ms % 60_000) / 1000);
  return s ? `${m}m ${s}s` : `${m}m`;
}

/**
 * The `details` string on the shipped entry.
 *
 * `prev=connected for 41s · close:1006 · clean=false visibility=hidden online=true`
 *
 * Deliberately flat `k=v` rather than prose: it is read next to four hundred
 * other lines, and it is grepped far more often than it is read.
 */
export function describeTransition(f: TransitionFacts): string {
  const parts: string[] = [`prev=${f.prev}`];
  if (typeof f.prevMs === 'number' && f.prevMs >= 0) parts[0] += ` for ${duration(f.prevMs)}`;
  if (f.reason) parts.push(f.reason);
  const ev = Object.entries(f.evidence ?? {})
    .filter(([, v]) => v !== undefined && v !== null)
    .map(([k, v]) => `${k}=${v}`);
  if (ev.length) parts.push(ev.join(' '));
  return parts.join(' · ');
}

/**
 * The same facts as fields, for Cloud Logging.
 *
 * Prefixed `conn_` so a transition can be picked out of a mixed log stream
 * without matching on the message text, which is a formatting concern and will
 * change again.
 */
export function transitionMetadata(
  state: string,
  f: TransitionFacts,
): Record<string, string | number | boolean | null> {
  const meta: Record<string, string | number | boolean | null> = {
    conn_state: state,
    conn_prev: f.prev,
    conn_reason: f.reason ?? null,
    conn_prev_ms: typeof f.prevMs === 'number' ? Math.round(f.prevMs) : null,
  };
  for (const [k, v] of Object.entries(f.evidence ?? {})) {
    if (v === undefined || v === null) continue;
    meta[`conn_${k}`] = v;
  }
  return meta;
}

/**
 * The environment facts that decide most "why did it drop" questions, sampled
 * at the moment of the transition.
 *
 * On iOS Safari a suspended WebView is the likeliest explanation for a socket
 * that looks flaky, and nothing in the buffer recorded that the page had been
 * put away. Sampled rather than remembered: what matters is the state when the
 * socket went, not when we last happened to look.
 */
export function environmentFacts(): Record<string, string | boolean> {
  const facts: Record<string, string | boolean> = {};
  if (typeof document !== 'undefined') facts.visibility = document.visibilityState;
  if (typeof navigator !== 'undefined' && typeof navigator.onLine === 'boolean') {
    facts.online = navigator.onLine;
  }
  return facts;
}

/** What a breadcrumb writes, so the caller does not have to know about the logger. */
export interface BreadcrumbSink {
  (summary: string, metadata: Record<string, string | number | boolean>): void;
}

let breadcrumbsInstalled = false;

/**
 * Record the two things that move underneath a socket without it being told.
 *
 * A transition carries the visibility and online state *at the moment it
 * happened*, which answers "was the app away when this dropped". It cannot
 * answer "how long was it away", or show a suspend that produced no transition
 * at all — and on iOS Safari, which is where the flakiness is reported, the
 * WebView being put away is the single likeliest explanation. Two listeners,
 * firing only on a real change, are enough to make the timeline readable.
 *
 * Idempotent: called from `ServerConnection`, which is a singleton today but
 * has been constructed more than once in tests.
 *
 * @returns a teardown, for tests. Production never calls it.
 */
export function installEnvironmentBreadcrumbs(write: BreadcrumbSink): () => void {
  if (breadcrumbsInstalled || typeof document === 'undefined') return () => {};
  breadcrumbsInstalled = true;

  let hiddenSince: number | null = document.visibilityState === 'hidden' ? Date.now() : null;

  const onVisibility = () => {
    const hidden = document.visibilityState === 'hidden';
    if (hidden) {
      hiddenSince = Date.now();
      write('app: hidden', { visibility: 'hidden' });
    } else {
      const away = hiddenSince ? Date.now() - hiddenSince : null;
      hiddenSince = null;
      write('app: visible', away === null
        ? { visibility: 'visible' }
        : { visibility: 'visible', away_ms: Math.round(away) });
    }
  };
  const onOnline = () => write('network: online', { online: true });
  const onOffline = () => write('network: offline', { online: false });

  document.addEventListener('visibilitychange', onVisibility);
  window.addEventListener('online', onOnline);
  window.addEventListener('offline', onOffline);

  return () => {
    document.removeEventListener('visibilitychange', onVisibility);
    window.removeEventListener('online', onOnline);
    window.removeEventListener('offline', onOffline);
    breadcrumbsInstalled = false;
  };
}

/** Test seam — production installs once and never uninstalls. */
export function resetEnvironmentBreadcrumbs(): void {
  breadcrumbsInstalled = false;
}
