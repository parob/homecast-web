// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react';
import { MockedProvider } from '@apollo/client/testing/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { HomeOverviewSection } from '../HomeOverviewSection';
import { SelfHostedHomeCard } from '../../HomesSection';
import { ingestHomeServingPush, resetHomeServing, setDeviceServing, setThisDevice } from '@/server/home-serving';
import type { HomeKitHome } from '@/lib/graphql/types';

const state = vi.hoisted(() => ({ quality: 'good', local: { active: false, reason: null as string | null, identityState: 'mapped' } }));
vi.mock('@/lib/config', () => ({ isCommunity: false, config: { apiBase: 'https://api.test', graphqlUrl: 'https://api.test/' } }));
vi.mock('@/contexts/WebSocketContext', () => ({ useWebSocket: () => ({ quality: state.quality }) }));
vi.mock('@/hooks/useLocalMode', () => ({ useLocalMode: () => state.local }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { accountType: 'cloud' } }) }));
vi.mock('@/lib/browser-logger', () => ({ browserLogger: { logInfo: vi.fn() } }));

const home: HomeKitHome = { id: 'HOME-A', name: 'Test Home', isPrimary: true, roomCount: 2,
  accessoryCount: 4, relayConnected: true, isAdmin: true };
function fact(state: string, by: string | null = null, kind: string | null = null) {
  ingestHomeServingPush({ homeId: home.id, serving: { state, by, kind, since: null,
    graceEndsAt: state === 'waiting' ? new Date(Date.now() + 180_000).toISOString() : null } });
}
function renderBoth() {
  return render(<MockedProvider mocks={[]}><>
    <SelfHostedHomeCard home={home} />
    <HomeOverviewSection home={home} />
  </></MockedProvider>);
}

beforeEach(() => { resetHomeServing(); setThisDevice('this-device'); state.quality = 'good'; state.local = { active: false, reason: null, identityState: 'mapped' }; });
afterEach(() => { cleanup(); vi.useRealTimers(); });

it('shows checking in both settings surfaces when no routing fact is known', () => {
  renderBoth();
  expect(screen.getAllByText('Checking the route to Test Home…')).toHaveLength(2);
  expect(screen.queryByText('Offline')).toBeNull();
  expect(screen.queryByText(/^Online/)).toBeNull();
});

it('keeps a known takeover wait clear through slow client traffic', () => {
  fact('waiting');
  state.quality = 'slow';
  renderBoth();
  expect(screen.getAllByText('Waiting for backup')).toHaveLength(2);
  expect(screen.getAllByText(/takes over in 3 min/)).toHaveLength(2);
  expect(screen.queryByText('Offline')).toBeNull();
});

it('updates both surfaces when a backup starts serving', () => {
  fact('waiting');
  renderBoth();
  act(() => fact('served', 'backup', 'self_hosted'));
  expect(screen.getAllByText(/Your backup relay is serving this home/)).toHaveLength(2);
  expect(screen.queryByText('Waiting for backup')).toBeNull();
});

it('describes direct Local Mode without claiming the cloud relay supplies it', () => {
  fact('served', 'mini', 'cloud');
  state.local = { active: true, reason: 'manual', identityState: 'mapped' };
  setDeviceServing(() => ({ active: true }));
  renderBoth();
  expect(screen.getAllByText('Local Mode')).toHaveLength(2);
  expect(screen.getAllByText(/Local Mode is switched on in Settings/)).toHaveLength(2);
});

it('keeps another home’s working route when one home goes offline', () => {
  fact('offline');
  ingestHomeServingPush({ homeId: 'HOME-B', serving: { state: 'served', by: 'mini', kind: 'cloud', since: null, graceEndsAt: null } });
  render(<MockedProvider mocks={[]}><>
    <SelfHostedHomeCard home={home} />
    <HomeOverviewSection home={{ ...home, id: 'HOME-B', name: 'Other Home' }} />
  </></MockedProvider>);
  expect(screen.getByText('Other Home is working')).toBeTruthy();
  expect(screen.getByText('Relay offline')).toBeTruthy();
});

it('updates the takeover countdown without requiring another server message', () => {
  vi.useFakeTimers();
  fact('waiting');
  renderBoth();
  expect(screen.getAllByText(/takes over in 3 min/)).toHaveLength(2);
  act(() => { vi.advanceTimersByTime(61_000); });
  expect(screen.getAllByText(/takes over in 2 min/)).toHaveLength(2);
});

it('shows the serving device in detail instead of the cached preferred relay', () => {
  fact('served', 'backup-device', 'self_hosted');
  render(<MockedProvider mocks={[]}><HomeOverviewSection home={{ ...home, relayId: 'old-preferred-relay' }} developerMode /></MockedProvider>);
  expect(screen.getByText('backup-device')).toBeTruthy();
  expect(screen.queryByText('old-preferred-relay')).toBeNull();
});
