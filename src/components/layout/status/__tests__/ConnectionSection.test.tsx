// @vitest-environment jsdom
//
// `serverConnection.reconnect()` is not a refresh. It tears the socket down
// and builds a new one, which rejects every in-flight request and drops the
// subscriptions with it. Offering that on a healthy connection invites someone
// to break something that is working, so the button is gated on there being
// something to fix.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import type { ConnectionQuality } from '@/server/connection-quality';

vi.mock('@/server/connection', () => ({
  serverConnection: {
    getLastRttMs: () => 42,
    getLastRttAt: () => Date.now(),
  },
}));

import { ConnectionSection } from '../ConnectionSection';

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
