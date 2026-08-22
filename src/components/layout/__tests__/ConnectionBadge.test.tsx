// @vitest-environment jsdom
//
// The contract this pins is the one the whole indicator turns on: it is present
// at EVERY state, including good.
//
// An indicator that only appears when something is wrong cannot be told apart
// from one that is broken or was never measuring — absence means both "fine"
// and "nothing is checking", and leaves the user nowhere to look. Showing the
// healthy state is what makes the degraded state legible as a change.
//
// The other half is that presence must not cost attention: at `good` there is
// no label and no motion. Escalation is carried by colour, label and movement,
// never by appearing.

import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { act } from '@testing-library/react';
import { render, screen, cleanup } from '@testing-library/react';
import type { ConnectionQuality } from '@/server/connection-quality';
import { RECONNECTED_VISIBLE_MS } from '@/lib/connection-presentation';

let mockQuality: ConnectionQuality = 'good';
let mockIsCommunity = false;
let mockRelayCapable = false;

vi.mock('@/contexts/WebSocketContext', () => ({
  useWebSocket: () => ({ quality: mockQuality }),
}));

vi.mock('@/server/connection', () => ({
  serverConnection: {
    getLastRttMs: () => 42,
    getLastRttAt: () => Date.now(),
    reconnect: vi.fn(),
  },
}));

vi.mock('@/lib/config', () => ({
  get isCommunity() { return mockIsCommunity; },
}));

vi.mock('@/native/homekit-bridge', () => ({
  isRelayCapable: () => mockRelayCapable,
}));

import { ConnectionBadge } from '../ConnectionBadge';

beforeEach(() => {
  mockQuality = 'good';
  mockIsCommunity = false;
  mockRelayCapable = false;
});
afterEach(cleanup);

const ALL: ConnectionQuality[] = ['good', 'unknown', 'slow', 'stalled', 'offline'];

describe('ConnectionBadge', () => {
  it('renders at every state, including good', () => {
    for (const q of ALL) {
      mockQuality = q;
      const { unmount } = render(<ConnectionBadge />);
      expect(screen.getByRole('button')).toBeTruthy();
      unmount();
    }
  });

  it('says nothing at all when the connection is good', () => {
    mockQuality = 'good';
    render(<ConnectionBadge />);
    // A dot and no text: it has to cost nothing to ignore, or it becomes the
    // noise it exists to cut through.
    expect(screen.getByRole('button').textContent).toBe('');
  });

  it('still announces the good state to a screen reader', () => {
    mockQuality = 'good';
    render(<ConnectionBadge />);
    expect(screen.getByRole('button').getAttribute('aria-label')).toMatch(/good/i);
  });

  it('does not label or animate the unknown state', () => {
    // A hidden tab suspends the heartbeat, so `unknown` happens on every
    // resume. Treating it as a fault would cry wolf every time.
    mockQuality = 'unknown';
    render(<ConnectionBadge />);
    const btn = screen.getByRole('button');
    expect(btn.textContent).toBe('');
    expect(btn.innerHTML).not.toContain('animate-pulse');
  });

  it('speaks up once something is actually wrong', () => {
    for (const q of ['slow', 'stalled', 'offline'] as const) {
      mockQuality = q;
      const { unmount } = render(<ConnectionBadge />);
      expect(screen.getByRole('button').textContent!.length).toBeGreaterThan(0);
      unmount();
    }
  });

  it('animates only while not responding, and only when motion is welcome', () => {
    mockQuality = 'stalled';
    render(<ConnectionBadge />);
    expect(screen.getByRole('button').innerHTML).toContain('motion-safe:animate-pulse');
  });

  it('is absent on the Community relay Mac, which has no hop to describe', () => {
    // HomeKit is served from this very process there; no socket is ever opened,
    // so quality would sit on `unknown` for ever — true, and useless.
    mockIsCommunity = true;
    mockRelayCapable = true;
    const { container } = render(<ConnectionBadge />);
    expect(container.firstChild).toBeNull();
  });

  it('is still shown in cloud mode on a relay-capable Mac', () => {
    // There the socket to the cloud is exactly the thing worth reporting.
    mockIsCommunity = false;
    mockRelayCapable = true;
    render(<ConnectionBadge />);
    expect(screen.getByRole('button')).toBeTruthy();
  });
});

describe('shape', () => {
  it('is a circle when there is no label, not a pill', () => {
    // rounded-full on a 24x16 box is a stadium. Equal height and width is what
    // makes it round, so the unlabelled state must be square.
    mockQuality = 'good';
    render(<ConnectionBadge />);
    const cls = screen.getByRole('button').className;
    expect(cls).toContain('h-6');
    expect(cls).toContain('w-6');
    expect(cls).not.toContain('px-2');
  });

  it('becomes a pill only once it has something to say', () => {
    mockQuality = 'slow';
    render(<ConnectionBadge />);
    const cls = screen.getByRole('button').className;
    expect(cls).toContain('px-2');
    expect(cls).not.toContain('w-6');
  });
});

// The connection toasts used to live in toast-bus and fired once for four
// seconds. They are now text beside the dot, which is where a condition
// belongs — but the recovery half keeps the toast's rule exactly: only confirm
// a recovery the user was warned about.
describe('the connection message, which replaced the toasts', () => {
  function renderAt(q: ConnectionQuality) {
    mockQuality = q;
    return render(<ConnectionBadge />);
  }

  it('says "Connecting…" beside the dot', () => {
    renderAt('connecting');
    expect(screen.getByRole('button').textContent).toBe('Connecting…');
  });

  it('confirms a recovery the user was warned about', () => {
    vi.useFakeTimers();
    const { rerender } = renderAt('offline');
    expect(screen.getByRole('button').textContent).toBe('Offline');

    mockQuality = 'good';
    act(() => { rerender(<ConnectionBadge />); });
    expect(screen.getByRole('button').textContent).toBe('Reconnected');
    vi.useRealTimers();
  });

  it('gets out of the way again', () => {
    vi.useFakeTimers();
    const { rerender } = renderAt('connecting');
    mockQuality = 'good';
    act(() => { rerender(<ConnectionBadge />); });
    expect(screen.getByRole('button').textContent).toBe('Reconnected');

    act(() => { vi.advanceTimersByTime(RECONNECTED_VISIBLE_MS); });
    expect(screen.getByRole('button').textContent).toBe('');
    vi.useRealTimers();
  });

  it('does not announce a recovery from a blip nobody saw', () => {
    // `unknown` shows no label, so there was nothing to recover from as far as
    // the user is concerned. This is the old toast's rule, kept.
    vi.useFakeTimers();
    const { rerender } = renderAt('unknown');
    expect(screen.getByRole('button').textContent).toBe('');

    mockQuality = 'good';
    act(() => { rerender(<ConnectionBadge />); });
    expect(screen.getByRole('button').textContent).toBe('');
    vi.useRealTimers();
  });

  it('drops the confirmation immediately if it drops again', () => {
    vi.useFakeTimers();
    const { rerender } = renderAt('offline');
    mockQuality = 'good';
    act(() => { rerender(<ConnectionBadge />); });
    expect(screen.getByRole('button').textContent).toBe('Reconnected');

    mockQuality = 'connecting';
    act(() => { rerender(<ConnectionBadge />); });
    expect(screen.getByRole('button').textContent).toBe('Connecting…');
    vi.useRealTimers();
  });
});
