// @vitest-environment jsdom
// @vitest-environment-options { "url": "https://mqtt.homecast.cloud/" }
//
// The `hc_token` cookie lives 30 days; the JWT inside it lives 7. For the 23
// days in between, the cookie is present and dead — and the page keyed its
// whole sign-in handshake on the cookie's *presence*, so mqtt.* answered a
// rejected credential with the server's raw "Authentication required. Please
// sign in.", no way to sign in, and a retry loop that could never clear it.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.hoisted(() => {
  const store = new Map<string, string>();
  (globalThis as Record<string, unknown>).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => { store.set(k, String(v)); },
    removeItem: (k: string) => { store.delete(k); },
    clear: () => store.clear(),
    key: () => null,
    length: 0,
  };
  (globalThis as Record<string, unknown>).matchMedia = (query: string) => ({
    matches: false, media: query, onchange: null,
    addEventListener: () => {}, removeEventListener: () => {},
    addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false,
  });
});

import {
  requestMqttToken, isAuthRejection, getJWT, setJWTCookie,
  markSyncAttempted, syncAlreadyAttempted, clearSyncAttempt,
} from '../util';

/** Exactly what api.homecast.cloud answers when require_auth() refuses. */
const AUTH_REJECTION = { errors: [{ message: 'Authentication required. Please sign in.' }] };

function jsonResponse(body: unknown, ok = true) {
  return { ok, json: async () => body } as unknown as Response;
}

// Set up through the same writer the app uses, so the test never leaves a
// second host-only `hc_token` next to the Domain=.homecast.cloud one.
const setCookie = (value: string | null) => setJWTCookie(value);

afterEach(() => { vi.unstubAllGlobals(); clearSyncAttempt(); setCookie(null); });

describe('requestMqttToken', () => {
  beforeEach(() => setCookie('stale.jwt.value'));

  it('refreshes a cookie that outlived its JWT and comes back with a token', async () => {
    const calls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
      calls.push(url);
      if (url.endsWith('/auth/refresh')) {
        expect(JSON.parse(String(init.body)).token).toBe('stale.jwt.value');
        return jsonResponse({ token: 'fresh.jwt.value' });
      }
      const auth = (init.headers as Record<string, string>).Authorization;
      if (auth === 'Bearer stale.jwt.value') return jsonResponse(AUTH_REJECTION);
      return jsonResponse({ data: { createMqttToken: 'mqtt-token' } });
    }));

    const result = await requestMqttToken();

    expect(result).toEqual({ kind: 'ok', token: 'mqtt-token' });
    expect(calls.some(u => u.endsWith('/auth/refresh'))).toBe(true);
    // The refreshed token is kept, so the next page load starts clean.
    expect(getJWT()).toBe('fresh.jwt.value');
  });

  it('reports signed-out (not a raw server error) when the token is past saving', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) =>
      url.endsWith('/auth/refresh')
        ? jsonResponse({}, false)
        : jsonResponse(AUTH_REJECTION),
    ));

    expect(await requestMqttToken()).toEqual({ kind: 'signed-out' });
    // The dead cookie is dropped, so the next load takes the no-cookie path
    // straight to the handshake instead of repeating this.
    expect(getJWT()).toBeNull();
  });

  it('calls a network failure an error, so the retry loop keeps retrying it', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('Failed to fetch'); }));

    expect(await requestMqttToken()).toEqual({ kind: 'error', message: 'Failed to fetch' });
    // A network blip must not be mistaken for a dead session.
    expect(getJWT()).toBe('stale.jwt.value');
  });

  it('passes a non-auth server error through untouched', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ errors: [{ message: 'Home not found' }] })));

    expect(await requestMqttToken()).toEqual({ kind: 'error', message: 'Home not found' });
  });

  it('is signed-out with no cookie at all, without calling the API', async () => {
    setCookie(null);
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    expect(await requestMqttToken()).toEqual({ kind: 'signed-out' });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('the one-shot handshake guard', () => {
  it('remembers an attempt and forgets it on demand', () => {
    expect(syncAlreadyAttempted()).toBe(false);
    markSyncAttempted();
    expect(syncAlreadyAttempted()).toBe(true);
    clearSyncAttempt();
    expect(syncAlreadyAttempted()).toBe(false);
  });
});

describe('isAuthRejection', () => {
  it('recognises the server auth error and nothing else', () => {
    expect(isAuthRejection(AUTH_REJECTION.errors)).toBe(true);
    expect(isAuthRejection([{ message: 'Home not found' }])).toBe(false);
    expect(isAuthRejection(undefined)).toBe(false);
    expect(isAuthRejection([])).toBe(false);
  });
});

describe('setJWTCookie', () => {
  it('round-trips a token and clears it', () => {
    setJWTCookie('round.trip.token');
    expect(getJWT()).toBe('round.trip.token');
    setJWTCookie(null);
    expect(getJWT()).toBeNull();
  });
});
