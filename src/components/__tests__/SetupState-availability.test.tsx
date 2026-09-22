// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { SetupState } from '../SetupState';
import { ingestHomeServingPush, resetHomeServing } from '@/server/home-serving';
import type { HomeKitHome } from '@/lib/graphql/types';

vi.mock('@/contexts/WebSocketContext', () => ({ useWebSocket: () => ({ quality: 'good' }) }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { accountType: 'cloud' } }) }));
vi.mock('@/lib/pricing', () => ({ usePricing: () => ({ cloud: { formatted: '£5' } }) }));
vi.mock('@/lib/relay-diagnostics', () => ({ buildRelayOfflineSnapshot: vi.fn(), logRelayOfflineBanner: vi.fn(), buildDiagnosticsBundle: vi.fn() }));
const home = { id: 'HOME-A', name: 'Test Home', isCloudManaged: true, role: 'owner' } as HomeKitHome;
function fact(id: string, state: string) {
  ingestHomeServingPush({ homeId: id, serving: { state, by: state === 'served' ? 'mini' : null,
    kind: state === 'served' ? 'cloud' : null,
    graceEndsAt: state === 'waiting' ? new Date(Date.now() + 180_000).toISOString() : null } });
}
function page(homes = [home]) {
  return render(<SetupState homes={homes} selectedHomeId={home.id} accountType="cloud" isDarkBackground={false} isInMacApp={false} />);
}
beforeEach(resetHomeServing);
afterEach(() => { cleanup(); vi.useRealTimers(); });

it('explains a takeover wait rather than declaring the cloud relay offline', () => {
  fact(home.id, 'waiting');
  page();
  expect(screen.getByText('Waiting for backup')).toBeTruthy();
  expect(screen.getByText(/takes over in 3 min/)).toBeTruthy();
  expect(screen.queryByText('Cloud relay offline')).toBeNull();
  expect(screen.queryByText(/been notified/)).toBeNull();
});

it('does not assign another home’s outage to the selected working home', () => {
  fact(home.id, 'served'); fact('HOME-B', 'offline');
  page([home, { ...home, id: 'HOME-B', name: 'Other Home' }]);
  expect(screen.getByText('Test Home is working')).toBeTruthy();
  expect(screen.queryByText('Cloud relay offline')).toBeNull();
});

it('keeps a known home with no current route fact checking instead of claiming a past relay outage', () => {
  page();
  expect(screen.getByText('Checking the route to Test Home…')).toBeTruthy();
  expect(screen.queryByText(/offline now/)).toBeNull();
});

it('updates the waiting countdown and route without remounting the card', () => {
  vi.useFakeTimers(); fact(home.id, 'waiting'); page();
  act(() => { vi.advanceTimersByTime(61_000); });
  expect(screen.getByText(/takes over in 2 min/)).toBeTruthy();
  act(() => fact(home.id, 'served'));
  expect(screen.getByText('Test Home is working')).toBeTruthy();
  expect(screen.queryByText('Waiting for backup')).toBeNull();
});

it('keeps the first-run chooser for an account that has no homes', () => {
  render(<SetupState homes={[]} accountType="standard" isDarkBackground={false} isInMacApp={false} />);
  expect(screen.getByRole('heading', { name: 'Welcome to Homecast' })).toBeTruthy();
  expect(screen.getByText('Self-hosted relay')).toBeTruthy();
});
