/**
 * The pod the server last told us to use, remembered across launches.
 *
 * The server answers a connection that landed on the wrong pod with a
 * `redirect (home_affinity)` and tears it down. That is a whole second
 * WebSocket connection — measured at 1.2s and 4.6s on two consecutive iPhone
 * launches — and because the client always starts from the generic endpoint it
 * happens on *every* connect, forever.
 *
 * The server does not redirect a connection that already carries the affinity
 * it would have assigned, so starting from the last known target skips the
 * handoff entirely.
 *
 * Deliberately conservative, because a wrong value here costs a launch rather
 * than a request:
 *  - only remembered after the redirected connection actually worked;
 *  - forgotten the moment a connection to it fails to get a word out of the
 *    server, so a retired pod costs one attempt and never two;
 *  - expires, so a long-dormant install starts from the front door.
 */

const KEY = 'homecast-ws-affinity';
/** Long enough to cover normal use, short enough that a stale ring resets. */
const MAX_AGE_MS = 12 * 60 * 60 * 1000;

interface Remembered {
  url: string;
  at: number;
}

/**
 * Only ever accept somewhere we could have been sent. A value read back from
 * storage becomes a connection target, so it is treated as untrusted input:
 * same-origin-family wss:// only, never an arbitrary host.
 */
function isPlausible(url: string, expectedHost: string): boolean {
  try {
    const u = new URL(url);
    if (u.protocol !== 'wss:' && u.protocol !== 'ws:') return false;
    return u.host === expectedHost;
  } catch {
    return false;
  }
}

export function rememberAffinityTarget(url: string): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ url, at: Date.now() } satisfies Remembered));
  } catch {
    // No storage — the handoff simply happens every launch, as before.
  }
}

export function forgetAffinityTarget(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // Nothing to do; a stale value expires on its own.
  }
}

/**
 * The URL to open, given the configured default. Returns the default whenever
 * there is nothing trustworthy to improve on.
 */
export function preferredWsUrl(defaultUrl: string): string {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return defaultUrl;

    const saved = JSON.parse(raw) as Remembered;
    if (!saved?.url || typeof saved.at !== 'number') return defaultUrl;
    if (Date.now() - saved.at > MAX_AGE_MS) {
      forgetAffinityTarget();
      return defaultUrl;
    }

    // The host must still be the one we are configured to talk to — a saved
    // target from another environment (staging vs production) must never be
    // able to redirect a session somewhere it does not belong.
    const expectedHost = new URL(defaultUrl).host;
    if (!isPlausible(saved.url, expectedHost)) {
      forgetAffinityTarget();
      return defaultUrl;
    }

    return saved.url;
  } catch {
    return defaultUrl;
  }
}
