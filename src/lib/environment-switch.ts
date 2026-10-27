/**
 * Moving between the production and staging cloud environments.
 *
 * Two places offer it: the dashboard menu (both directions, for staff) and
 * the Staging badge (back to production only, for anyone on staging). The
 * badge is the one that matters when staging is broken: it shows on the
 * login page too, so a staging environment that can't sign you in can no
 * longer trap you there. The menu needs a signed-in dashboard, which is
 * exactly what a dead staging server can't give you.
 *
 * Staging's server is scaled to zero between deploys to save cost, so most
 * of the time it is not there to sign in to. `stagingServerIsUp` lets the
 * menu check before sending anyone into it, and a person with staging access
 * can wake it for six hours (`wakeStaging`).
 *
 * Waking has to happen on production: a sleeping staging can't sign you in,
 * so it can't tell who is asking. The staging badge therefore hands the
 * request to production in a short-lived cookie on `.homecast.cloud` — the
 * one thing both origins, and the native apps' WebView, share — switches
 * there, and production wakes staging and brings you back once it answers.
 */

export type CloudEnvironment = 'production' | 'staging';

const PORTAL_URL: Record<CloudEnvironment, string> = {
  production: 'https://homecast.cloud/portal',
  staging: 'https://staging.homecast.cloud/portal',
};

const STAGING_API_URL = 'https://staging.api.homecast.cloud/';

const WAKE_REQUEST_COOKIE = 'homecast-wake-staging';
// Long enough to sign in on production first, short enough that a stale
// request can't fire on some later visit.
const WAKE_REQUEST_MAX_AGE = 15 * 60;

interface BridgeWindow {
  homekit?: { call: (method: string, payload: Record<string, unknown>, callbackId: string) => void };
  location: { href: string };
}

/**
 * Point this device at `target` and go there.
 *
 * The iOS/Mac app keeps the choice natively and reloads its WebView itself.
 * A browser or the Tauri app keeps it in a cookie on `.homecast.cloud` —
 * shared by both origins, unlike localStorage — which the Tauri shell reads
 * to decide where to land on launch.
 */
export function switchEnvironment(
  target: CloudEnvironment,
  win: BridgeWindow = window as unknown as BridgeWindow,
  doc: { cookie: string } = document,
  storage: Pick<Storage, 'setItem'> | undefined = typeof localStorage === 'undefined' ? undefined : localStorage,
): void {
  if (win.homekit?.call) {
    win.homekit.call('settings.setEnvironment', { environment: target }, `env-switch-${Date.now()}`);
    return;
  }
  doc.cookie = `homecast-env=${target};domain=.homecast.cloud;path=/;max-age=31536000;secure;samesite=lax`;
  try {
    storage?.setItem('homecast-environment', target); // older Tauri builds read this
  } catch {
    // Storage can be unavailable; the cookie is what counts.
  }
  win.location.href = PORTAL_URL[target];
}

/**
 * From a sleeping staging: ask production to wake it, and go there to do it.
 * Production picks the request up once signed in (`takeStagingWakeRequest`).
 */
export function requestStagingWake(
  win: BridgeWindow = window as unknown as BridgeWindow,
  doc: { cookie: string } = document,
  storage: Pick<Storage, 'setItem'> | undefined = typeof localStorage === 'undefined' ? undefined : localStorage,
): void {
  doc.cookie = `${WAKE_REQUEST_COOKIE}=1;domain=.homecast.cloud;path=/;max-age=${WAKE_REQUEST_MAX_AGE};secure;samesite=lax`;
  switchEnvironment('production', win, doc, storage);
}

/** On production: whether a wake was asked for, consuming the request. */
export function takeStagingWakeRequest(doc: { cookie: string } = document): boolean {
  if (!new RegExp(`(?:^|;\\s*)${WAKE_REQUEST_COOKIE}=1(?:;|$)`).test(doc.cookie)) return false;
  doc.cookie = `${WAKE_REQUEST_COOKIE}=;domain=.homecast.cloud;path=/;max-age=0;secure;samesite=lax`;
  return true;
}

/** Whether staging's API answers at all. False when it is scaled to zero. */
export async function stagingServerIsUp(
  fetchImpl: typeof fetch = fetch,
  timeoutMs = 5000,
): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(STAGING_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: '{ version }' }),
      signal: controller.signal,
    });
    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}
