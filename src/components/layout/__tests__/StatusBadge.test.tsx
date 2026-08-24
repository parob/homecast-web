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
import { render, screen, cleanup, act } from '@testing-library/react';
import type { ConnectionQuality } from '@/server/connection-quality';
import { RECONNECTED_VISIBLE_MS } from '@/lib/connection-presentation';

let mockQuality: ConnectionQuality = 'good';
let mockIsCommunity = false;
let mockRelayCapable = false;
let mockRelayEnabled = false;
let mockLocalMode = { active: false, identityState: 'mapped', reason: null, matched: 0, reported: 0 };
let mockRelayStatus: boolean | null = null;

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
    getState: () => ({ relayStatus: mockRelayStatus, connectionState: 'connected' }),
    subscribe: () => () => {},
    getLastRttMs: () => 42,
    getLastRttAt: () => Date.now(),
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

import { StatusBadge } from '../StatusBadge';

beforeEach(() => {
  mockQuality = 'good';
  mockIsCommunity = false;
  mockRelayCapable = false;
  mockRelayEnabled = false;
  mockLocalMode = { active: false, identityState: 'mapped', reason: null, matched: 0, reported: 0 };
  mockRelayStatus = null;
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

  it('says Standby when this Mac is not the active relay', () => {
    mockRelayStatus = false;
    render(<StatusBadge />);
    expect(screen.getByRole('button').textContent).toBe('Standby');
  });

  it('stays quiet on a healthy active relay', () => {
    // The standing "Relay" word is gone deliberately: when all is well the
    // bubble says nothing, and the popover still reports Active Relay.
    mockRelayStatus = true;
    mockRelayEnabled = true;
    render(<StatusBadge />);
    expect(screen.getByRole('button').textContent).toBe('');
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
