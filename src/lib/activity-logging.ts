/**
 * Whether this device may ship activity spans.
 *
 * Trace spans from the client, the relay app and the native bridge are the only
 * way to see what happens outside the server — but they are per-request, so
 * turning them on everywhere would multiply log volume for people who will never
 * look at a trace. They are therefore opt-in, and the gate is deliberately
 * narrow: three separate switches must all be on.
 *
 *   1. Analytics consent — the same `cookie-consent` key the GA snippet in
 *      index.html reads. If someone declined analytics, we send nothing.
 *   2. Developer Mode — this is a debugging feature and lives with the other
 *      developer tools.
 *   3. Send activity logs — the specific opt-in, so turning on Developer Mode
 *      to see the API tab does not silently start shipping spans.
 *
 * Defined once, here, so every emitter asks the same question. Pure and
 * unit-tested: a gate that is wrong in one direction leaks data and in the other
 * silently produces empty traces, and neither failure is visible from the UI.
 */

export const CONSENT_KEY = 'cookie-consent';

/**
 * Mirror of the two account settings.
 *
 * The settings themselves live in the account's settings blob behind GraphQL,
 * but the emitters that need this answer — the connection router, the relay's
 * WebSocket — are plain modules outside React and are asked on every request.
 * So the app pushes the flags here whenever they load or change, and this key
 * persists them for the window between a reload and the settings arriving.
 */
export const MIRROR_KEY = 'homecast-activity-logging';

export interface ActivityLoggingInputs {
  /** Value of localStorage['cookie-consent']. */
  consent: string | null;
  developerMode: boolean;
  sendActivityLogs: boolean;
}

/**
 * The decision, as a pure function of the three inputs.
 *
 * Every condition is required — this is an AND and it should stay one. If a
 * future caller wants "just developer mode", that is a different question with
 * a different name.
 */
export function shouldSendActivityLogs(inputs: ActivityLoggingInputs): boolean {
  return (
    inputs.consent === 'granted'
    && inputs.developerMode === true
    && inputs.sendActivityLogs === true
  );
}

let flags: { developerMode: boolean; sendActivityLogs: boolean } | null = null;

function readMirror(): { developerMode: boolean; sendActivityLogs: boolean } {
  if (flags) return flags;
  try {
    const raw = localStorage.getItem(MIRROR_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    flags = {
      developerMode: parsed?.developerMode === true,
      sendActivityLogs: parsed?.sendActivityLogs === true,
    };
  } catch {
    // A corrupt mirror must read as "off", never as "on".
    flags = { developerMode: false, sendActivityLogs: false };
  }
  return flags;
}

/** Push the current settings down. Called when they load and on every change. */
export function setActivityLoggingFlags(next: {
  developerMode: boolean;
  sendActivityLogs: boolean;
}): void {
  flags = {
    developerMode: next.developerMode === true,
    sendActivityLogs: next.sendActivityLogs === true,
  };
  try {
    localStorage.setItem(MIRROR_KEY, JSON.stringify(flags));
  } catch {
    // Private mode or a full quota — the in-memory value still applies.
  }
}

/** Read the three inputs from this device. Safe outside a browser. */
export function readActivityLoggingInputs(): ActivityLoggingInputs {
  if (typeof localStorage === 'undefined') {
    return { consent: null, developerMode: false, sendActivityLogs: false };
  }
  let consent: string | null = null;
  try {
    consent = localStorage.getItem(CONSENT_KEY);
  } catch {
    consent = null;
  }
  return { consent, ...readMirror() };
}

export function activityLoggingEnabled(): boolean {
  return shouldSendActivityLogs(readActivityLoggingInputs());
}

/** Drop the cached mirror — test seam, and for a hard settings reload. */
export function resetActivityLoggingCache(): void {
  flags = null;
}
