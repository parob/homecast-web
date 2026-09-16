// @vitest-environment jsdom
// @vitest-environment-options { "url": "https://mqtt.homecast.cloud/" }
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { ApolloClient, InMemoryCache, ApolloLink } from '@apollo/client';
import { ApolloProvider } from '@apollo/client/react';
import MQTTBrowser from '../../MQTTBrowser';
import { setJWTCookie } from '../util';
import { ingestHomeServingPush, resetHomeServing } from '@/server/home-serving';

const home = { id: 'LIVE-UUID', hcId: 'STABLE-HOME', name: 'George Street', mqttEnabled: true, role: 'owner' };
const fact = { state: 'served', by: 'mini', kind: 'cloud', since: null, graceEndsAt: null };
const client = new ApolloClient({ cache: new InMemoryCache(), link: ApolloLink.empty() });
let wire: Record<string, unknown>;
let lastQuery = '';
function show() { return render(<ApolloProvider client={client}><MemoryRouter><MQTTBrowser /></MemoryRouter></ApolloProvider>); }

beforeEach(() => {
  resetHomeServing();
  setJWTCookie('valid.test.token');
  wire = { ...home, relayConnected: true, serving: fact };
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
  vi.stubGlobal('fetch', vi.fn(async (_url, init) => {
    lastQuery = JSON.parse(init.body).query;
    // Match GraphQL selection: omitted fields do not appear by accident.
    const selected = { ...wire };
    if (!lastQuery.includes('hcId')) delete selected.hcId;
    if (!lastQuery.includes('serving')) delete selected.serving;
    return { ok: true, json: async () => ({ data: { me: { id: 'me', email: 'me@example.test', accountType: 'cloud' }, cachedHomes: [selected] } }) };
  }));
});
afterEach(() => { cleanup(); setJWTCookie(null); vi.unstubAllGlobals(); });

it('shows the server takeover state instead of synthesising offline from a boolean', async () => {
  wire = { ...home, relayConnected: false, serving: { ...fact, state: 'waiting', by: null, kind: null } };
  show();
  const chip = await screen.findByRole('button', { name: /George Street/ });
  expect(chip.textContent).toContain('Waiting for backup');
  expect(lastQuery).toContain('serving');
});

it('updates the same home when a broadcast uses its stable ID', async () => {
  show();
  const chip = await screen.findByRole('button', { name: /George Street/ });
  act(() => ingestHomeServingPush({ homeId: home.hcId, serving: { ...fact, state: 'offline', by: null, kind: null } }));
  await waitFor(() => expect(chip.textContent).toContain('Relay offline'));
});

it('does not call an unknown home online', async () => {
  wire = home;
  show();
  const chip = await screen.findByRole('button', { name: /George Street/ });
  expect(chip.getAttribute('title')).toContain('Checking relay');
  expect(chip.className).not.toContain('border-green');
});

it('expires standalone facts when a refresh fails, then recovers on the next poll', async () => {
  vi.useFakeTimers();
  try {
    await act(async () => { show(); });
    const chip = screen.getByRole('button', { name: /George Street/ });
    vi.mocked(fetch).mockRejectedValueOnce(new Error('network down'));
    await act(async () => { await vi.advanceTimersByTimeAsync(15000); });
    expect(chip.getAttribute('title')).toContain('Checking relay');
    await act(async () => { await vi.advanceTimersByTimeAsync(15000); });
    expect(chip.getAttribute('title')).toBe('Online');
  } finally { vi.useRealTimers(); }
});

it('does not let an old poll replace a newer serving push', async () => {
  vi.useFakeTimers();
  try {
    await act(async () => { show(); });
    const chip = screen.getByRole('button', { name: /George Street/ });
    let finish!: (value: unknown) => void;
    vi.mocked(fetch).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }) as Promise<Response>);
    await act(async () => { await vi.advanceTimersByTimeAsync(15000); });
    act(() => ingestHomeServingPush({ homeId: home.hcId, serving: { ...fact, state: 'waiting', by: null, kind: null } }));
    await act(async () => { finish({ ok: true, json: async () => ({ data: { cachedHomes: [{ ...home, serving: fact }] } }) }); });
    expect(chip.textContent).toContain('Waiting for backup');
  } finally { vi.useRealTimers(); }
});

it('bounds a hung status refresh and retries without leaving a stale green chip', async () => {
  vi.useFakeTimers();
  try {
    await act(async () => { show(); });
    const chip = screen.getByRole('button', { name: /George Street/ });
    vi.mocked(fetch).mockImplementationOnce((_url, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
    }));
    await act(async () => { await vi.advanceTimersByTimeAsync(25000); });
    expect(chip.getAttribute('title')).toContain('Checking relay');
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    expect(chip.getAttribute('title')).toBe('Online');
  } finally { vi.useRealTimers(); }
});
