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
 * Staging's server runs only while a server deploy is being promoted (it is
 * scaled to zero between deploys to save cost), so most of the time it is
 * not there to sign in to. `stagingServerIsUp` lets the menu check before
 * sending anyone into it.
 */

export type CloudEnvironment = 'production' | 'staging';

const PORTAL_URL: Record<CloudEnvironment, string> = {
  production: 'https://homecast.cloud/portal',
  staging: 'https://staging.homecast.cloud/portal',
};

const STAGING_API_URL = 'https://staging.api.homecast.cloud/';

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
