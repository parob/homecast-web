// @vitest-environment jsdom
//
// One bubble for three facts that used to be three pills. The invariants below
// carried over wholesale from ConnectionBadge.test.tsx, because they are what
// makes the badge worth having and none of them changed in the merge:
//
// It is present at EVERY state, including good. An indicator that appears only
// when something is wrong cannot be told apart from one that is broken or was
// never measuring — absence means both "fine" and "nothing is checking", and
// leaves the user nowhere to look. And presence must not cost attention: at
// `good` there is no label and no motion.

import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, act, fireEvent } from '@testing-library/react';
import type { ConnectionQuality } from '@/server/connection-quality';
import { RECONNECTED_VISIBLE_MS } from '@/lib/connection-presentation';
import {
  ingestHomeServingPush,
  resetHomeServing,
  setDeviceServing,
  setThisDevice,
  type HomeServing,
} from '@/server/home-serving';

let mockQuality: ConnectionQuality = 'good';
let mockIsCommunity = false;
let mockRelayCapable = false;
let mockRelayEnabled = false;
let mockLocalMode = { active: false, identityState: 'mapped', reason: null as string | null, matched: 0, reported: 0 };

const HOME = 'D08CB174';
const ME = 'mac_d6de42ce';
const MINI = 'mac_8ca2d5a2';
const fact = (over: Partial<HomeServing>): HomeServing =>
  ({ state: 'served', by: MINI, kind: 'self_hosted', since: null, graceEndsAt: null, ...over });
/** The store is real, not mocked: the badge is fed the way the app feeds it. */
const heard = (serving: HomeServing) => ingestHomeServingPush({ homeId: HOME, serving });

vi.mock('@/contexts/WebSocketContext', () => ({
  useWebSocket: () => ({ quality: mockQuality }),
}));

vi.mock('@/hooks/useLocalMode', () => ({
  useLocalMode: () => mockLocalMode,
}));

vi.mock('@/hooks/useHomeKitData', () => ({
  useHomes: () => ({ data: [] }),
}));

vi.mock('@/server/connection', () => ({
  serverConnection: {
    getState: () => ({ relayStatus: null, relayRoles: null, connectionState: 'connected' }),
    subscribe: () => () => {},
    getLastRttMs: () => 42,
    getLastRttAt: () => Date.now(),
    // Read by ConnectionSection's reason line. Absent from this mock until the
    // popover was actually opened by a test — the badge alone never rendered
    // the section, so nothing here reached them.
    getOldestInFlightMs: () => null,
    getPendingPingMs: () => null,
    getConnectedAt: () => Date.now(),
    getLastConnectedAt: () => Date.now(),
    getSubscriberStatus: () => null,
    getActivityHistory: () => new Array(60).fill(0),
    reconnect: vi.fn(),
    claimRelay: vi.fn(),
  },
}));

vi.mock('@/lib/config', () => ({
  get isCommunity() { return mockIsCommunity; },
}));

vi.mock('@/native/homekit-bridge', () => ({
  isRelayCapable: () => mockRelayCapable,
  isRelayEnabled: () => mockRelayEnabled,
  HomeKit: { getStats: () => Promise.resolve(null) },
}));

// The reliability preview is an Apollo query of its own, tested in its own
// file; here it would only demand a provider the popover tests do not need.
vi.mock('../status/ReliabilitySection', () => ({
  ReliabilitySection: () => <div data-testid="reliability" />,
}));

import { StatusBadge } from '../StatusBadge';

beforeEach(() => {
  mockQuality = 'good';
  mockIsCommunity = false;
  mockRelayCapable = false;
  mockRelayEnabled = false;
  mockLocalMode = { active: false, identityState: 'mapped', reason: null, matched: 0, reported: 0 };
  resetHomeServing();
  setThisDevice(ME);
});
afterEach(cleanup);

const ALL: ConnectionQuality[] = ['good', 'unknown', 'connecting', 'slow', 'stalled', 'offline'];

describe('StatusBadge', () => {
  it('renders at every state, including good', () => {
    for (const q of ALL) {
      mockQuality = q;
      const { unmount } = render(<StatusBadge />);
      expect(screen.getByRole('button')).toBeTruthy();
      unmount();
    }
  });

  it('says nothing at all when the connection is good', () => {
    render(<StatusBadge />);
    expect(screen.getByRole('button').textContent).toBe('');
  });

  it('still announces the good state to a screen reader', () => {
    render(<StatusBadge />);
    expect(screen.getByRole('button').getAttribute('aria-label')).toMatch(/good/i);
  });

  it('does not label or animate the unknown state', () => {
    mockQuality = 'unknown';
    render(<StatusBadge />);
    const btn = screen.getByRole('button');
    expect(btn.textContent).toBe('');
    expect(btn.innerHTML).not.toContain('animate-pulse');
  });

  it('speaks up once something is actually wrong', () => {
    for (const q of ['slow', 'stalled', 'offline'] as const) {
      mockQuality = q;
      const { unmount } = render(<StatusBadge />);
      expect(screen.getByRole('button').textContent!.length).toBeGreaterThan(0);
      unmount();
    }
  });

  it('animates only while not responding, and only when motion is welcome', () => {
    mockQuality = 'stalled';
    render(<StatusBadge />);
    expect(screen.getByRole('button').innerHTML).toContain('motion-safe:animate-pulse');
  });
});

describe('shape', () => {
  it('is a circle when there is no label, not a pill', () => {
    // rounded-full on a 24x16 box is a stadium. Equal height and width is what
    // makes it round, so the unlabelled state must be square.
    render(<StatusBadge />);
    const cls = screen.getByRole('button').className;
    expect(cls).toContain('h-6');
    expect(cls).toContain('w-6');
    expect(cls).not.toContain('px-2');
  });

  it('becomes a pill only once it has something to say', () => {
    mockQuality = 'slow';
    render(<StatusBadge />);
    const cls = screen.getByRole('button').className;
    expect(cls).toContain('px-2');
    expect(cls).not.toContain('w-6');
  });
});

// The reason the three pills became one.
describe('the merge', () => {
  it('says Local Mode rather than Offline when both are true', () => {
    // These co-occur by design — Local Mode engages *because* the cloud is
    // unreachable. The app used to render them as a red pill and a green pill
    // on the same row, contradicting each other, separated by the Guest pill.
    mockQuality = 'offline';
    mockLocalMode = { ...mockLocalMode, active: true };
    render(<StatusBadge />);
    expect(screen.getByRole('button').textContent).toBe('Local Mode');
  });

  it('says Local Mode for the home on screen when this device serves it', () => {
    // The composed fact: the server says the relay is gone, this device says
    // it is serving the home itself, and the second outranks the first.
    mockLocalMode = { ...mockLocalMode, active: true };
    setDeviceServing((id) => ({ active: id === HOME }));
    heard(fact({ state: 'offline', by: null, kind: null }));
    render(<StatusBadge homeId={HOME} />);
    expect(screen.getByRole('button').textContent).toBe('Local Mode');
  });

  it('says Standby when another of your Macs is the relay', () => {
    mockRelayCapable = true;
    mockRelayEnabled = true;
    heard(fact({ by: MINI }));
    render(<StatusBadge homeId={HOME} />);
    expect(screen.getByRole('button').textContent).toBe('Standby');
  });

  it('stays quiet on a healthy active relay', () => {
    // The standing "Relay" word is gone deliberately: when all is well the
    // bubble says nothing, and the popover still reports Active Relay.
    mockRelayCapable = true;
    mockRelayEnabled = true;
    heard(fact({ by: ME }));
    render(<StatusBadge homeId={HOME} />);
    expect(screen.getByRole('button').textContent).toBe('');
  });

  it('says the relay is offline while the link is perfect, and follows the push', () => {
    // homecast-cloud#99. The dot used to sit on quiet emerald here.
    heard(fact({ state: 'offline', by: null, kind: null }));
    render(<StatusBadge homeId={HOME} />);
    expect(screen.getByRole('button').textContent).toBe('Relay offline');
    act(() => { heard(fact({ by: MINI })); });
    expect(screen.getByRole('button').textContent).toBe('');
  });
});

// parob/homecast-cloud#103: the popover, in the state the report was filed
// from — a cloud-plan account on an iPhone, the cloud relay gone, Local Mode
// carrying the home — said the same thing three times and ran off the bottom
// of the screen.
describe('the popover in Local Mode (#103)', () => {
  const reported = () => {
    mockLocalMode = { ...mockLocalMode, active: true, reason: 'relay-offline', identityState: 'partial', matched: 728, reported: 751 };
    setDeviceServing((id) => ({ active: id === HOME }));
    heard(fact({ state: 'offline', by: null, kind: null }));
    render(<StatusBadge homeId={HOME} homeName="County Hall" accountType="cloud" />);
    fireEvent.click(screen.getByRole('button', { name: /Local Mode/ }));
  };

  it('says why once, in the chain, and draws the relay as the broken node', () => {
    reported();
    expect(screen.getByText("The cloud relay isn't answering, so this device is talking to your home directly.")).toBeTruthy();
    // The reason line the Local Mode section used to add underneath is gone —
    // the chain has just said it — and the cloud node is not painted dead.
    expect(screen.queryByText(/Your home relay is offline/)).toBeNull();
    expect(screen.queryByText(/talking to your Apple Home directly/)).toBeNull();
    expect(screen.queryByText('no answer')).toBeNull();
    expect(screen.getByText('no relay')).toBeTruthy();
  });

  it('keeps what only it can say', () => {
    reported();
    expect(screen.getByText(/728 of 751 accessories/)).toBeTruthy();
    expect(screen.getByText(/Automations keep running on your relay/)).toBeTruthy();
  });

  it('keeps the capability list one tap away rather than eight rows tall', () => {
    reported();
    expect(screen.queryByText('Lights, switches and plugs')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /What works in Local Mode/ }));
    expect(screen.getByText('Lights, switches and plugs')).toBeTruthy();
    expect(screen.getByText('Sharing with other people')).toBeTruthy();
  });

  it('still gives the reason when the chain has not', () => {
    mockLocalMode = { ...mockLocalMode, active: true, reason: 'manual' };
    setDeviceServing((id) => ({ active: id === HOME }));
    heard(fact({ by: MINI }));
    render(<StatusBadge homeId={HOME} />);
    fireEvent.click(screen.getByRole('button', { name: /Local Mode/ }));
    expect(screen.getByText('This device is talking to your home directly.')).toBeTruthy();
    expect(screen.getByText('Local Mode is switched on in Settings.')).toBeTruthy();
  });
});

describe('the Community relay Mac', () => {
  it('does not report a hop that does not exist', () => {
    // Apple Home is served in-process there and no socket is ever opened, so
    // quality sits on `unknown` for ever. Reporting the truth of that setup —
    // the home is reachable, because this machine is its server — beats a dot
    // permanently saying "checking".
    mockIsCommunity = true;
    mockRelayCapable = true;
    mockRelayEnabled = true;
    mockQuality = 'unknown';
    render(<StatusBadge />);
    expect(screen.getByRole('button').getAttribute('aria-label')).toMatch(/good/i);
  });

  it('disappears entirely when the relay is switched off too', () => {
    mockIsCommunity = true;
    mockRelayCapable = true;
    mockRelayEnabled = false;
    const { container } = render(<StatusBadge />);
    expect(container.firstChild).toBeNull();
  });

  it('opens on the chain rather than an empty box', () => {
    // The Community path shape — This Mac -> Local server -> Home, no cloud
    // node — existed, was tested, shipped in the bundle, and was the one shape
    // that never reached a screen: the whole connection section was gated out
    // here. A Community user tapping the badge got an empty box, and the one
    // fact no other surface states went unsaid.
    mockIsCommunity = true;
    mockRelayCapable = true;
    mockRelayEnabled = true;
    mockQuality = 'unknown';
    render(<StatusBadge />);
    fireEvent.click(screen.getByRole('button'));
    expect(screen.getByText(/Nothing is going through the cloud/i)).toBeTruthy();
  });

  it('names the local hops, and no cloud hop', () => {
    mockIsCommunity = true;
    mockRelayCapable = true;
    mockRelayEnabled = true;
    render(<StatusBadge />);
    fireEvent.click(screen.getByRole('button'));
    expect(screen.getByText('Local server')).toBeTruthy();
    // The point of the branch: there is no cloud node to name.
    expect(screen.queryByText(/Homecast cloud/i)).toBeNull();
  });

  it('is still shown in cloud mode on a relay-capable Mac', () => {
    mockIsCommunity = false;
    mockRelayCapable = true;
    render(<StatusBadge />);
    expect(screen.getByRole('button')).toBeTruthy();
  });
});

// The connection toasts used to live in toast-bus and fired once for four
// seconds. They are now text beside the dot, which is where a condition
// belongs — but the recovery half keeps the toast's rule exactly: only confirm
// a recovery the user was warned about.
describe('the connection message, which replaced the toasts', () => {
  it('says "Connecting…" beside the dot', () => {
    mockQuality = 'connecting';
    render(<StatusBadge />);
    expect(screen.getByRole('button').textContent).toBe('Connecting…');
  });

  it('confirms a recovery the user was warned about', () => {
    vi.useFakeTimers();
    mockQuality = 'offline';
    const { rerender } = render(<StatusBadge />);
    expect(screen.getByRole('button').textContent).toBe('Offline');

    mockQuality = 'good';
    act(() => { rerender(<StatusBadge />); });
    expect(screen.getByRole('button').textContent).toBe('Reconnected');
    vi.useRealTimers();
  });

  it('gets out of the way again', () => {
    vi.useFakeTimers();
    mockQuality = 'connecting';
    const { rerender } = render(<StatusBadge />);
    mockQuality = 'good';
    act(() => { rerender(<StatusBadge />); });
    expect(screen.getByRole('button').textContent).toBe('Reconnected');

    act(() => { vi.advanceTimersByTime(RECONNECTED_VISIBLE_MS); });
    expect(screen.getByRole('button').textContent).toBe('');
    vi.useRealTimers();
  });

  it('does not announce a recovery from a blip nobody saw', () => {
    vi.useFakeTimers();
    mockQuality = 'unknown';
    const { rerender } = render(<StatusBadge />);
    expect(screen.getByRole('button').textContent).toBe('');

    mockQuality = 'good';
    act(() => { rerender(<StatusBadge />); });
    expect(screen.getByRole('button').textContent).toBe('');
    vi.useRealTimers();
  });

  it('drops the confirmation immediately if it drops again', () => {
    vi.useFakeTimers();
    mockQuality = 'offline';
    const { rerender } = render(<StatusBadge />);
    mockQuality = 'good';
    act(() => { rerender(<StatusBadge />); });
    expect(screen.getByRole('button').textContent).toBe('Reconnected');

    mockQuality = 'connecting';
    act(() => { rerender(<StatusBadge />); });
    expect(screen.getByRole('button').textContent).toBe('Connecting…');
    vi.useRealTimers();
  });
});
