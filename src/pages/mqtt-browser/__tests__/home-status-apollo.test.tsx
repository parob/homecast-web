// @vitest-environment jsdom
// @vitest-environment-options { "url": "https://homecast.cloud/mqtt" }
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { ApolloClient, ApolloLink, InMemoryCache, Observable } from '@apollo/client';
import { ApolloProvider } from '@apollo/client/react';
import MQTTBrowser from '../../MQTTBrowser';
import { ingestHomeServingPush, resetHomeServing } from '@/server/home-serving';
import { handleGraphQL } from '@/server/local-graphql';

vi.mock('@/server/local-db', () => ({ getUsers: async () => [], getSetting: async () => null }));
vi.mock('@/relay/local-handler', () => ({ executeHomeKitAction: async () => ({ homes: [{ id: 'LIVE-HOME', name: 'George Street' }] }) }));

beforeEach(() => {
  resetHomeServing();
  localStorage.setItem('homecast-token', 'test.token');
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
});
afterEach(() => { cleanup(); localStorage.clear(); vi.unstubAllGlobals(); });

function show(respond: (operationName: string) => Promise<unknown>) {
  const client = new ApolloClient({ cache: new InMemoryCache(), link: new ApolloLink(operation => new Observable(observer => {
    void respond(operation.operationName).then(data => { observer.next(data as any); observer.complete(); });
  })) });
  render(<ApolloProvider client={client}><MemoryRouter><MQTTBrowser /></MemoryRouter></ApolloProvider>);
}

it('uses stable cloud identity and live serving updates through the main app Apollo client', async () => {
  const fact = { state: 'served', by: 'mini', kind: 'cloud', since: null, graceEndsAt: null };
  show(async () => ({ data: {
    me: { id: 'user', name: 'Owner', email: 'owner@example.test', accountType: 'cloud' },
    cachedHomes: [{ id: 'LIVE-HOME', hcId: 'STABLE-HOME', name: 'George Street', role: 'owner', ownerEmail: null, mqttEnabled: true, serving: fact }],
  } }));
  const chip = await screen.findByRole('button', { name: /George Street/ });
  expect(chip.title).toBe('Online');
  act(() => ingestHomeServingPush({ homeId: 'STABLE-HOME', serving: { ...fact, state: 'offline', by: null, kind: null } }));
  expect(chip.title).toBe('Relay offline');
});

it('keeps the homes list working through the Community GraphQL resolver', async () => {
  show(operationName => handleGraphQL({ operationName, local: true }));
  const chip = await screen.findByRole('button', { name: /George Street/ });
  expect(chip.title).toBe('Checking relay…');
  expect(chip.className).not.toContain('border-green');
});
