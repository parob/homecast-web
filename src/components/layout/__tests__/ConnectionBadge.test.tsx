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
import { render, screen, cleanup } from '@testing-library/react';
import type { ConnectionQuality } from '@/server/connection-quality';

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
