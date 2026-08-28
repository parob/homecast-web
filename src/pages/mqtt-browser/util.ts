import { useState, useEffect } from 'react';

/** True at the Tailwind `lg` breakpoint and up — where the split inspector
 *  pane renders; below it selection opens the bottom drawer instead. */
export function useIsLgUp(): boolean {
  const [isLgUp, setIsLgUp] = useState(() => typeof window !== 'undefined' && window.matchMedia('(min-width: 1024px)').matches);
  useEffect(() => {
    const mql = window.matchMedia('(min-width: 1024px)');
    const onChange = () => setIsLgUp(mql.matches);
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, []);
  return isLgUp;
}

/** True when the page is hosted on `mqtt.*` (cross-subdomain cookie auth). */
export function isMqttDomain(): boolean {
  return location.hostname.includes('mqtt.');
}

/** Homecast API base URL for the current environment. */
export function getApiBase(): string {
  return location.hostname.includes('staging') ? 'https://staging.api.homecast.cloud' : 'https://api.homecast.cloud';
}

/** Read the JWT from either the `hc_token` cookie (mqtt.* domains) or localStorage. */
export function getJWT(): string | null {
  if (isMqttDomain()) {
    const jwt = document.cookie.split('; ').find(c => c.startsWith('hc_token='))?.split('=')[1];
    return jwt ? decodeURIComponent(jwt) : null;
  }
  return localStorage.getItem('homecast-token');
}

/** Build fetch headers for an authenticated GraphQL request, or null if no token. */
export function getAuthHeaders(): Record<string, string> | null {
  const jwt = getJWT();
  return jwt ? { 'Content-Type': 'application/json', Authorization: `Bearer ${jwt}` } : null;
}

/** Write (or clear) the cross-subdomain `hc_token` cookie from the mqtt.* side.
 *  Mirrors AuthContext's syncTokenCookie — cookie only, because localStorage on
 *  mqtt.* is a different store from the main domain's and holds nothing. */
export function setJWTCookie(token: string | null): void {
  try {
    const domain = location.hostname.includes('homecast.cloud') ? '; Domain=.homecast.cloud' : '';
    const secure = location.protocol === 'https:' ? '; Secure' : '';
    const value = token ? encodeURIComponent(token) : '';
    const age = token ? 60 * 60 * 24 * 30 : 0;
    document.cookie = `hc_token=${value}${domain}; Path=/${secure}; SameSite=Lax; Max-Age=${age}`;
  } catch { /* ignore cookie errors */ }
}

/** True when a GraphQL error list is the server's auth rejection —
 *  `require_auth()` raising "Authentication required. Please sign in.". */
export function isAuthRejection(errors: Array<{ message?: string }> | undefined): boolean {
  return !!errors?.some(e => e.message?.toLowerCase().includes('authentication'));
}

/** Exchange a stale JWT for a fresh one. The server honours tokens up to 30
 *  days past expiry (auth.refresh_expired_token), which is exactly the window
 *  the 30-day cookie can outlive its 7-day token by. null = unrecoverable. */
export async function refreshJWT(staleToken: string): Promise<string | null> {
  try {
    const response = await fetch(`${getApiBase()}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: staleToken }),
    });
    if (!response.ok) return null;
    const data = await response.json();
    return data?.token ?? null;
  } catch {
    return null;
  }
}

/** Hand off to the main domain to (re)mint the cookie, or sign the user in and
 *  bounce them back here. The only route to a login form from mqtt.*, which
 *  serves no auth UI of its own. */
export function mqttSyncUrl(returnTo = location.href): string {
  const target = location.hostname.startsWith('staging.')
    ? 'https://staging.homecast.cloud/'
    : 'https://homecast.cloud/';
  return `${target}?mqtt_sync=1&return=${encodeURIComponent(returnTo)}`;
}

// One handshake per tab. Coming back from the main domain still rejected means
// the cookie is not the problem, and redirecting again would loop the user
// between two domains forever; we show them an actionable error instead.
const SYNC_ATTEMPT_KEY = 'hc_mqtt_sync_attempted';

export function markSyncAttempted(): void {
  try { sessionStorage.setItem(SYNC_ATTEMPT_KEY, '1'); } catch { /* ignore */ }
}

export function syncAlreadyAttempted(): boolean {
  try { return sessionStorage.getItem(SYNC_ATTEMPT_KEY) === '1'; } catch { return false; }
}

export function clearSyncAttempt(): void {
  try { sessionStorage.removeItem(SYNC_ATTEMPT_KEY); } catch { /* ignore */ }
}

/** Outcome of asking the server for a broker token. `signed-out` is the one the
 *  page has to act on rather than print: there is no session, so no amount of
 *  retrying helps and the user needs the sign-in handshake. */
export type MqttTokenResult =
  | { kind: 'ok'; token: string }
  | { kind: 'signed-out' }
  | { kind: 'error'; message: string };

const CREATE_MQTT_TOKEN = 'mutation { createMqttToken }';

async function postCreateMqttToken(jwt: string): Promise<{ data?: { createMqttToken?: string }, errors?: Array<{ message?: string }> }> {
  const r = await fetch(getApiBase() + '/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${jwt}` },
    body: JSON.stringify({ query: CREATE_MQTT_TOKEN }),
  });
  return r.json();
}

/** Get a broker token, recovering from a cookie that has outlived its JWT.
 *
 *  The cookie lives 30 days and the JWT inside it 7, so "there is a cookie" was
 *  never the same as "the server will accept it" — and on mqtt.* a rejected
 *  cookie used to be a dead end, because the page short-circuits its sign-in
 *  handshake on the cookie's mere presence. Trading the stale token in at
 *  /auth/refresh is what the main domain already does; doing it here too keeps
 *  the common case invisible, and tells the caller honestly when it can't. */
export async function requestMqttToken(): Promise<MqttTokenResult> {
  const jwt = getJWT();
  if (!jwt) return { kind: 'signed-out' };
  try {
    const first = await postCreateMqttToken(jwt);
    if (first?.data?.createMqttToken) return { kind: 'ok', token: first.data.createMqttToken };
    if (!isAuthRejection(first?.errors)) {
      return { kind: 'error', message: first?.errors?.[0]?.message ?? 'Could not get an MQTT token' };
    }

    const fresh = await refreshJWT(jwt);
    if (!fresh) {
      // Beyond refreshing: drop the dead cookie so the next load takes the
      // no-cookie path straight to the handshake.
      setJWTCookie(null);
      return { kind: 'signed-out' };
    }
    setJWTCookie(fresh);

    const second = await postCreateMqttToken(fresh);
    if (second?.data?.createMqttToken) return { kind: 'ok', token: second.data.createMqttToken };
    if (isAuthRejection(second?.errors)) {
      setJWTCookie(null);
      return { kind: 'signed-out' };
    }
    return { kind: 'error', message: second?.errors?.[0]?.message ?? 'Could not get an MQTT token' };
  } catch (e) {
    // A network failure is not a signed-out session — retrying is right here.
    return { kind: 'error', message: e instanceof Error ? e.message : 'Connection failed' };
  }
}
