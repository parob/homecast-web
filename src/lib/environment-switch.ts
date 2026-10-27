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
 * menu check before sending anyone into it, and anyone can wake it for six
 * hours (`wakeStaging`, then `waitForStaging`).
 *
 * The wake is asked of production's API, from wherever you are: a sleeping
 * staging has no server to ask. It needs no sign-in, which is what lets the
 * staging badge do it in place — staging can't sign you in while asleep.
 */

export type CloudEnvironment = 'production' | 'staging';

const PORTAL_URL: Record<CloudEnvironment, string> = {
  production: 'https://homecast.cloud/portal',
  staging: 'https://staging.homecast.cloud/portal',
};

const STAGING_API_URL = 'https://staging.api.homecast.cloud/';
const PRODUCTION_API_URL = 'https://api.homecast.cloud/';

// A cold start schedules a pod, pulls the image and boots the server: 3m20s
// on 26 Oct. Ten minutes is the point at which something is wrong, not slow.
const WAKE_POLL_MS = 5000;
const WAKE_GIVE_UP_MS = 10 * 60 * 1000;

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

export type WakeResult = { ok: true; awakeUntil: string | null } | { ok: false; error: string };

/** Ask production to run staging for the next six hours. No sign-in needed. */
export async function wakeStaging(fetchImpl: typeof fetch = fetch): Promise<WakeResult> {
  try {
    const response = await fetchImpl(PRODUCTION_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: 'mutation WakeStaging { wakeStaging { available awakeUntil error } }' }),
    });
    const body = await response.json();
    const result = body?.data?.wakeStaging;
    if (result?.available) return { ok: true, awakeUntil: result.awakeUntil ?? null };
    return { ok: false, error: result?.error || body?.errors?.[0]?.message || `HTTP ${response.status}` };
  } catch {
    return { ok: false, error: "Couldn't reach Homecast. Check your connection and try again." };
  }
}

/** Poll until staging answers. False if it hasn't within `timeoutMs`. */
export async function waitForStaging({
  isUp = () => stagingServerIsUp(),
  pollMs = WAKE_POLL_MS,
  timeoutMs = WAKE_GIVE_UP_MS,
  sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
  now = () => Date.now(),
}: {
  isUp?: () => Promise<boolean>;
  pollMs?: number;
  timeoutMs?: number;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
} = {}): Promise<boolean> {
  const deadline = now() + timeoutMs;
  while (!(await isUp())) {
    if (now() >= deadline) return false;
    await sleep(pollMs);
  }
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
