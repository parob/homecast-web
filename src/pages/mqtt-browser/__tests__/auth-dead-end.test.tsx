// @vitest-environment jsdom
// @vitest-environment-options { "url": "https://mqtt.homecast.cloud/" }
//
// The user-visible half of the same fault: a cookie the server refuses used to
// leave the MQTT Browser showing the server's raw "Authentication required.
// Please sign in." over a `Retrying in 8s` — on a domain that serves no login
// form, with nothing on the page to press. It said to sign in and offered no
// way to do it.
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
    addListener: () => {}, removeListener: () => {},
    dispatchEvent: () => false,
  });
});

import { render, screen, waitFor, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ApolloClient, InMemoryCache, ApolloLink } from '@apollo/client';
import { ApolloProvider } from '@apollo/client/react';
import MQTTBrowser from '../../MQTTBrowser';
import { setJWTCookie, markSyncAttempted, clearSyncAttempt } from '../util';

const client = new ApolloClient({ cache: new InMemoryCache(), link: ApolloLink.empty() });

function renderBrowser() {
  return render(
    <ApolloProvider client={client}>
      <MemoryRouter initialEntries={['/mqtt']}>
        <MQTTBrowser />
      </MemoryRouter>
    </ApolloProvider>,
  );
}

/** jsdom does not fetch <script src>, so hand the page its mqtt lib the way
 *  the real onload does — otherwise connect() stops at "library not loaded". */
function loadMqttLib() {
  const script = document.querySelector('script[src*="mqtt"]') as HTMLScriptElement | null;
  expect(script, 'mqtt.js script tag should have been injected').toBeTruthy();
  (window as unknown as { mqtt: unknown }).mqtt = {
    connect: () => { throw new Error('should never reach the broker while signed out'); },
  };
  script!.dispatchEvent(new Event('load'));
}

afterEach(() => { cleanup(); vi.unstubAllGlobals(); clearSyncAttempt(); setJWTCookie(null); });

describe('a cookie the server rejects', () => {
  beforeEach(() => {
    setJWTCookie('stale.jwt.value');
    // Nothing here is recoverable: the mutation is refused and the token is
    // too far gone to refresh.
    vi.stubGlobal('fetch', vi.fn(async (url: string) =>
      String(url).endsWith('/auth/refresh')
        ? ({ ok: false, json: async () => ({}) })
        : ({ ok: true, json: async () => ({ errors: [{ message: 'Authentication required. Please sign in.' }] }) }),
    ));
  });

  it('offers a way to sign in instead of a raw server error', async () => {
    // Already bounced through the main-domain handshake once this tab and come
    // back still refused — so the page has to say so rather than loop.
    markSyncAttempted();
    renderBrowser();
    loadMqttLib();

    const signIn = await waitFor(
      () => screen.getByRole('link', { name: /sign in/i }),
      { timeout: 5000 },
    );
    expect(signIn.getAttribute('href')).toContain('mqtt_sync=1');

    // …and says something the user can act on, not the server's own wording.
    expect(screen.getByText(/session has expired/i)).toBeTruthy();
    expect(screen.queryByText('Authentication required. Please sign in.')).toBeNull();
  }, 15000);

  it('stops retrying a credential no retry can fix', async () => {
    markSyncAttempted();
    renderBrowser();
    loadMqttLib();

    await waitFor(() => screen.getByRole('link', { name: /sign in/i }), { timeout: 5000 });
    expect(screen.queryByText(/Retrying in/)).toBeNull();
  }, 15000);
});
