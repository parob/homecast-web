// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ connectionState: 'connected', quality: 'good' }));
const probe = vi.hoisted(() => vi.fn());
vi.mock('@/lib/config', () => ({ isCommunity: true, getRelayAddress: () => 'http://192.168.1.20:5656' }));
vi.mock('@/server/connection', () => ({ serverConnection: { getState: () => state } }));
vi.mock('@/contexts/WebSocketContext', () => ({ useWebSocket: () => state }));
vi.mock('@/lib/relay-probe', async importOriginal => ({
  ...await importOriginal<typeof import('@/lib/relay-probe')>(), probeRelay: probe,
}));
import { RelayInfoCard } from '../RelayInfoCard';

beforeEach(() => {
  state.connectionState = 'connected'; state.quality = 'good';
  probe.mockResolvedValue({ name: 'Test relay', addresses: [], authEnabled: true });
});
afterEach(cleanup);

it('shows measured stalls and recovery while the socket stays open', async () => {
  const { rerender } = render(<RelayInfoCard />);
  await screen.findByText('Test relay');
  expect(screen.getByText('Connected')).toBeTruthy();
  state.quality = 'stalled';
  rerender(<RelayInfoCard />);
  expect(screen.getByText('Not responding')).toBeTruthy();
  expect(screen.queryByText('Connected')).toBeNull();
  state.quality = 'good';
  rerender(<RelayInfoCard />);
  expect(screen.getByText('Connected')).toBeTruthy();
});

it('keeps an unmeasured connection neutral even after the address probe answers', async () => {
  state.quality = 'unknown';
  const { container } = render(<RelayInfoCard />);
  await screen.findByText('Test relay');
  expect(screen.getByText('Checking connection…')).toBeTruthy();
  expect(container.querySelector('.bg-green-500')).toBeNull();
});

it('reports a failed details request without claiming the working socket stopped answering', async () => {
  probe.mockResolvedValue(null);
  render(<RelayInfoCard />);
  expect(await screen.findByText('Could not refresh relay details at this address.')).toBeTruthy();
  expect(screen.getByText('Connected')).toBeTruthy();
  expect(screen.queryByText('Not answering at this address right now.')).toBeNull();
});
