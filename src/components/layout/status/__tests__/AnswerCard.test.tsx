// @vitest-environment jsdom
//
// The popover's body: the card draws what the model says and nothing else,
// and the two rows under it read the real store. What the model says about
// each state is `lib/__tests__/answer-card.test.ts`; this pins the rendering
// and the rows.

import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, act, fireEvent } from '@testing-library/react';
import {
  ingestHomeServingPush,
  resetHomeServing,
  setThisDevice,
  type HomeServing,
} from '@/server/home-serving';
import { buildAnswerCard, type AnswerCardInput } from '@/lib/answer-card';

const ME = 'mac_d6de42ce';
const CLOUD = 'mac_managed01';
const GEORGE = { id: 'A1', name: 'George Street', isCloudManaged: true, isPrimary: true, roomCount: 0, accessoryCount: 12 };
const COTTAGE = { id: 'C3', name: 'Cottage', isCloudManaged: false, isPrimary: false, roomCount: 0, accessoryCount: 3 };

let mockHomes: Array<typeof GEORGE> = [GEORGE];
let mockConnectionState = 'connected';
let mockUptime: { uptimePercent7d: number } | undefined;

vi.mock('@/hooks/useHomeKitData', () => ({ useHomes: () => ({ data: mockHomes }) }));
vi.mock('@/server/connection', () => ({
  serverConnection: {
    getState: () => ({ connectionState: mockConnectionState, relayStatus: null, relayRoles: null }),
  },
}));
vi.mock('@apollo/client/react', () => ({
  useQuery: () => ({ data: mockUptime ? { homeUptime: mockUptime } : undefined }),
}));

import { AnswerCardView, RelayRow, ReliabilityRow } from '../AnswerCard';

const fact = (over: Partial<HomeServing>): HomeServing =>
  ({ state: 'served', by: CLOUD, kind: 'cloud', since: null, graceEndsAt: null, ...over });
const heard = (homeId: string, serving: HomeServing) => ingestHomeServingPush({ homeId, serving });

const base: AnswerCardInput = {
  quality: 'good', reconnected: false, serving: fact({}), relayServing: fact({}), thisDevice: ME,
  unmapped: false, localReason: null, managed: true, community: false, rtt: '34ms',
  homeName: 'George Street', deviceNoun: 'iPhone',
};
const card = (over: Partial<AnswerCardInput> = {}) => buildAnswerCard({ ...base, ...over });

beforeEach(() => {
  mockHomes = [GEORGE];
  mockConnectionState = 'connected';
  mockUptime = undefined;
  resetHomeServing();
  setThisDevice(ME);
});
afterEach(cleanup);

describe('AnswerCardView', () => {
  it('draws the verdict and the route, and no chain, when healthy', () => {
    render(<AnswerCardView card={card()} onReconnect={vi.fn()} />);
    expect(screen.getByText('George Street is working')).toBeTruthy();
    expect(screen.getByText('via Cloud relay · 34ms')).toBeTruthy();
    expect(screen.queryByText('Homecast')).toBeNull();
    expect(screen.queryByRole('button', { name: /reconnect/i })).toBeNull();
  });

  it('draws the chain, and the one action, when the link is the fault', () => {
    const onReconnect = vi.fn();
    render(<AnswerCardView card={card({ quality: 'offline' })} evidence="No reply to the last connection check." onReconnect={onReconnect} />);
    expect(screen.getByText("This iPhone can't reach Homecast")).toBeTruthy();
    expect(screen.getByText('no answer')).toBeTruthy();
    expect(screen.getByText('No reply to the last connection check.')).toBeTruthy();
    // The route line and the chain are never both shown.
    expect(screen.queryByText(/^via /)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /reconnect/i }));
    expect(onReconnect).toHaveBeenCalledOnce();
  });

  it('offers the note, and no button, for a dead cloud relay', () => {
    render(<AnswerCardView card={card({ serving: fact({ state: 'offline', by: null, kind: null }), relayServing: fact({ state: 'offline', by: null, kind: null }) })} onReconnect={vi.fn()} />);
    expect(screen.getByText("George Street can't be reached")).toBeTruthy();
    expect(screen.getByText(/Homecast has been notified/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /reconnect/i })).toBeNull();
  });

  it('shows the unmapped caveat as its own line', () => {
    const gone = fact({ state: 'offline', by: null, kind: null });
    const serving: HomeServing = { state: 'served', by: ME, kind: 'local', since: null, graceEndsAt: null };
    render(<AnswerCardView card={card({ serving, relayServing: gone, unmapped: true })} onReconnect={vi.fn()} />);
    expect(screen.getByText(/Some devices show their Apple Home names/)).toBeTruthy();
  });
});

describe('ReliabilityRow', () => {
  it('says checking until the figure arrives, then the week', () => {
    const { rerender } = render(<ReliabilityRow homeId="A1" />);
    expect(screen.getByText('checking…')).toBeTruthy();
    mockUptime = { uptimePercent7d: 93.7 };
    rerender(<ReliabilityRow homeId="A1" />);
    expect(screen.getByText('94% this week')).toBeTruthy();
  });

  it('opens the details when it can', () => {
    mockUptime = { uptimePercent7d: 100 };
    const onOpen = vi.fn();
    render(<ReliabilityRow homeId="A1" onOpen={onOpen} />);
    fireEvent.click(screen.getByRole('button'));
    expect(onOpen).toHaveBeenCalledOnce();
    expect(screen.getByText('100% this week')).toBeTruthy();
  });
});

// The old Relay Status section, fed through the real store, reduced to one
// word. What it says about the cloud relay comes from the serving facts, not
// from the socket's per-account boolean or the roles map (homecast-cloud#99).
describe('RelayRow', () => {
  it('is standing by while the cloud relay serves the home', () => {
    heard('A1', fact({}));
    render(<RelayRow />);
    expect(screen.getByText('This Mac')).toBeTruthy();
    expect(screen.getByText('Standing by')).toBeTruthy();
  });

  it('is taking over during the grace', () => {
    heard('A1', fact({ state: 'waiting', by: null, kind: null, graceEndsAt: '2026-09-08T11:36:02Z' }));
    render(<RelayRow />);
    expect(screen.getByText('Taking over…')).toBeTruthy();
  });

  it('is standing in once this Mac holds the home, and follows the push without a re-mount', () => {
    heard('A1', fact({ state: 'waiting', by: null, kind: null, graceEndsAt: '2026-09-08T11:36:02Z' }));
    render(<RelayRow />);
    expect(screen.getByText('Taking over…')).toBeTruthy();
    act(() => { heard('A1', fact({ by: ME, kind: 'self_hosted' })); });
    expect(screen.getByText('Standing in')).toBeTruthy();
  });

  it('is standing by, muted, when the cloud relay is gone and this Mac is not in line', () => {
    heard('A1', fact({ state: 'offline', by: null, kind: null }));
    render(<RelayRow />);
    expect(screen.getByText('Standing by')).toBeTruthy();
  });

  it('is standing by when another of your Macs serves your own home, with no take-over button here', () => {
    // The button is on the page this row opens: Settings → Relay.
    mockHomes = [COTTAGE];
    heard('C3', fact({ by: 'mac_other', kind: 'self_hosted' }));
    const onOpen = vi.fn();
    render(<RelayRow onOpen={onOpen} />);
    expect(screen.getByText('Standing by')).toBeTruthy();
    expect(screen.queryByText(/Take Over/)).toBeNull();
    fireEvent.click(screen.getByRole('button'));
    expect(onOpen).toHaveBeenCalledOnce();
  });

  it('is the active relay when this Mac serves its own home', () => {
    mockHomes = [COTTAGE];
    heard('C3', fact({ by: ME, kind: 'self_hosted' }));
    render(<RelayRow />);
    expect(screen.getByText('Active relay')).toBeTruthy();
  });

  it('reports the socket first when it is down', () => {
    mockConnectionState = 'disconnected';
    heard('A1', fact({}));
    render(<RelayRow />);
    expect(screen.getByText('Disconnected')).toBeTruthy();
  });
});
