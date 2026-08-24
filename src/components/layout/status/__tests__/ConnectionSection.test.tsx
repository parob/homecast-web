// @vitest-environment jsdom
//
// `serverConnection.reconnect()` is not a refresh. It tears the socket down
// and builds a new one, which rejects every in-flight request and drops the
// subscriptions with it. Offering that on a healthy connection invites someone
// to break something that is working, so the button is gated on there being
// something to fix.

import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import type { ConnectionQuality } from '@/server/connection-quality';

let mockRtt: number | null = 42;
let mockInFlightMs: number | null = null;
let mockPendingPingMs: number | null = null;

vi.mock('@/server/connection', () => ({
  serverConnection: {
    getLastRttMs: () => mockRtt,
    getLastRttAt: () => Date.now(),
    getOldestInFlightMs: () => mockInFlightMs,
    getPendingPingMs: () => mockPendingPingMs,
  },
}));

import { ConnectionSection } from '../ConnectionSection';

beforeEach(() => {
  mockRtt = 42;
  mockInFlightMs = null;
  mockPendingPingMs = null;
});
afterEach(cleanup);

function setup(quality: ConnectionQuality) {
  const onReconnect = vi.fn();
  render(<ConnectionSection quality={quality} headline="x" onReconnect={onReconnect} />);
  return onReconnect;
}

const reconnectButton = () => screen.queryByRole('button', { name: /reconnect/i });

describe('the Reconnect action', () => {
  it('is absent when the connection is good', () => {
    setup('good');
    expect(reconnectButton()).toBeNull();
  });

  it('is absent when we have simply not measured yet', () => {
    // `unknown` happens on every return from a backgrounded tab. Nothing is
    // wrong, so there is nothing to offer.
    setup('unknown');
    expect(reconnectButton()).toBeNull();
  });

  it('appears for exactly the states we told the user about', () => {
    // Same predicate that decides whether the badge shows a label, so we can
    // never report a problem without offering the remedy, or vice versa.
    for (const q of ['connecting', 'slow', 'stalled', 'offline'] as const) {
      const { unmount } = render(
        <ConnectionSection quality={q} headline="x" onReconnect={vi.fn()} />,
      );
      expect(reconnectButton()).not.toBeNull();
      unmount();
    }
  });

  it('still works when it is offered', () => {
    const onReconnect = setup('offline');
    fireEvent.click(reconnectButton()!);
    expect(onReconnect).toHaveBeenCalledOnce();
  });
});

describe('the round-trip line', () => {
  it('warns about writes only while something is wrong', () => {
    const { unmount } = render(<ConnectionSection quality="good" headline="x" onReconnect={vi.fn()} />);
    expect(screen.queryByText(/may take a while to apply/i)).toBeNull();
    unmount();

    render(<ConnectionSection quality="stalled" headline="x" onReconnect={vi.fn()} />);
    expect(screen.queryByText(/may take a while to apply/i)).not.toBeNull();
  });
});

// Throttled testing against production produced both of these, and both read
// as the app contradicting itself:
//
//   "Your connection is slow"     / "Round trip 12ms"
//   "Your home is not responding" / "Round trip 30.0s · just now"
//
// The first was the classifier working correctly — the verdict came from a
// request outstanding for seconds while the round trip was genuinely fine —
// but the evidence shown was the half that was not the reason.
describe('the reason line', () => {
  const line = () => screen.getByText(/waiting|round trip|no reply|not measured/i).textContent!;

  it('names the waiting request rather than a healthy round trip', () => {
    mockInFlightMs = 6000;
    mockRtt = 12;
    render(<ConnectionSection quality="slow" headline="Your connection is slow" onReconnect={vi.fn()} />);
    expect(line()).toBe('A request has been waiting 6s.');
    expect(line()).not.toMatch(/12ms/);
  });

  it('does not present a missed pong as a measured round trip', () => {
    // The 30s sample is a deliberate lower bound that correctly drives the
    // verdict to stalled. It is not something that came back.
    mockPendingPingMs = 30000;
    mockRtt = 30000;
    render(<ConnectionSection quality="stalled" headline="x" onReconnect={vi.fn()} />);
    expect(line()).toBe('No reply to the last connection check.');
  });

  it('reports the round trip when the round trip really is the story', () => {
    mockRtt = 45;
    render(<ConnectionSection quality="good" headline="x" onReconnect={vi.fn()} />);
    expect(line()).toMatch(/Round trip 45ms/);
  });

  it('ignores a request that has not been waiting long enough to matter', () => {
    // Something is always briefly in flight on a healthy connection.
    mockInFlightMs = 200;
    mockRtt = 45;
    render(<ConnectionSection quality="good" headline="x" onReconnect={vi.fn()} />);
    expect(line()).toMatch(/Round trip 45ms/);
  });

  it('still says something when nothing has been measured at all', () => {
    mockRtt = null;
    render(<ConnectionSection quality="unknown" headline="x" onReconnect={vi.fn()} />);
    expect(line()).toBe('No round trip measured yet.');
  });
});
