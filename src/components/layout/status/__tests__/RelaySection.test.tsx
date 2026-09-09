// @vitest-environment jsdom
//
// The Relay Status section, fed through the real store. What it says about
// the cloud relay comes from the serving facts, not from the socket's
// per-account boolean or the roles map (homecast-cloud#99), and the takeover
// grace has a countdown rather than reading as "Standby".

import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, act } from '@testing-library/react';
import {
  ingestHomeServingPush,
  resetHomeServing,
  setThisDevice,
  type HomeServing,
} from '@/server/home-serving';

const ME = 'mac_d6de42ce';
const CLOUD = 'mac_managed01';
const GEORGE = { id: 'A1', name: 'George Street', isCloudManaged: true, isPrimary: true, roomCount: 0, accessoryCount: 12 };
const COTTAGE = { id: 'C3', name: 'Cottage', isCloudManaged: false, isPrimary: false, roomCount: 0, accessoryCount: 3 };

let mockHomes: Array<typeof GEORGE> = [GEORGE];
let mockConnectionState = 'connected';

vi.mock('@/hooks/useHomeKitData', () => ({ useHomes: () => ({ data: mockHomes }) }));
vi.mock('@/lib/config', () => ({ isCommunity: false }));
vi.mock('@/native/homekit-bridge', () => ({
  isRelayCapable: () => true,
  HomeKit: { getStats: () => Promise.resolve(null) },
}));
vi.mock('@/server/connection', () => ({
  serverConnection: {
    getState: () => ({ connectionState: mockConnectionState, relayStatus: null, relayRoles: null }),
    getConnectedAt: () => Date.now() - 60_000,
    getLastConnectedAt: () => Date.now() - 60_000,
    getSubscriberStatus: () => null,
    getActivityHistory: () => new Array(60).fill(0),
    claimRelay: vi.fn(),
  },
}));

import { RelaySection } from '../RelaySection';

const fact = (over: Partial<HomeServing>): HomeServing =>
  ({ state: 'served', by: CLOUD, kind: 'cloud', since: null, graceEndsAt: null, ...over });
const heard = (homeId: string, serving: HomeServing) => ingestHomeServingPush({ homeId, serving });

beforeEach(() => {
  mockHomes = [GEORGE];
  mockConnectionState = 'connected';
  resetHomeServing();
  setThisDevice(ME);
});
afterEach(cleanup);

describe('RelaySection', () => {
  it('is on standby while the cloud relay serves the home', () => {
    heard('A1', fact({}));
    render(<RelaySection />);
    expect(screen.getByText('Standby')).toBeTruthy();
    expect(screen.getByText(/served by Homecast Cloud/)).toBeTruthy();
  });

  it('counts down the takeover during the grace', () => {
    vi.useFakeTimers();
    vi.setSystemTime(Date.parse('2026-09-08T11:33:02Z'));
    heard('A1', fact({ state: 'waiting', by: null, kind: null, graceEndsAt: '2026-09-08T11:36:02Z' }));
    render(<RelaySection />);
    expect(screen.getByText('Taking over')).toBeTruthy();
    expect(screen.getByText(/The cloud relay for George Street is offline\. This Mac takes over in 3 min\./)).toBeTruthy();
    // The popover's own tick carries the countdown.
    act(() => { vi.advanceTimersByTime(2 * 60_000 + 30_000); });
    expect(screen.getByText(/takes over in 30s/)).toBeTruthy();
    vi.useRealTimers();
  });

  it('says standby active once this Mac holds the home', () => {
    heard('A1', fact({ by: ME, kind: 'self_hosted' }));
    render(<RelaySection />);
    expect(screen.getByText('Standby active')).toBeTruthy();
    expect(screen.getByText(/This Mac is serving George Street until it is back/)).toBeTruthy();
  });

  it('follows a push from waiting to serving without a re-mount', () => {
    heard('A1', fact({ state: 'waiting', by: null, kind: null, graceEndsAt: '2026-09-08T11:36:02Z' }));
    render(<RelaySection />);
    expect(screen.getByText('Taking over')).toBeTruthy();
    act(() => { heard('A1', fact({ by: ME, kind: 'self_hosted' })); });
    expect(screen.getByText('Standby active')).toBeTruthy();
  });

  it('says when the cloud relay is gone and this Mac is not in line', () => {
    heard('A1', fact({ state: 'offline', by: null, kind: null }));
    render(<RelaySection />);
    expect(screen.getByText(/isn't standing in for it/)).toBeTruthy();
  });

  it('offers the takeover when another of your Macs serves your own home', () => {
    mockHomes = [COTTAGE];
    heard('C3', fact({ by: 'mac_other', kind: 'self_hosted' }));
    render(<RelaySection />);
    expect(screen.getByText('Take Over as Relay')).toBeTruthy();
  });

  it('is the active relay when this Mac serves its own home', () => {
    mockHomes = [COTTAGE];
    heard('C3', fact({ by: ME, kind: 'self_hosted' }));
    render(<RelaySection />);
    expect(screen.getByText('Active Relay')).toBeTruthy();
  });

  it('reports the socket first when it is down', () => {
    mockConnectionState = 'disconnected';
    heard('A1', fact({}));
    render(<RelaySection />);
    expect(screen.getByText('Disconnected')).toBeTruthy();
  });
});
