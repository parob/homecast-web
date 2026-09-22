// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { HomeDetailView } from '../../HomeDetailView';
import { ingestHomeServingPush, resetHomeServing, setDeviceServing } from '@/server/home-serving';
import type { HomeKitHome } from '@/lib/graphql/types';

const state = vi.hoisted(() => ({
  request: vi.fn(), refetch: vi.fn(), quality: 'good',
  homes: [] as unknown[], mqtt: { serving: false, brokerConnected: true },
}));
vi.mock('@/server/connection', () => ({ serverConnection: { request: state.request } }));
vi.mock('@/hooks/useHomeKitData', () => ({ useHomes: () => ({ data: state.homes, refetch: state.refetch }) }));
vi.mock('@/contexts/WebSocketContext', () => ({ useWebSocket: () => ({ quality: state.quality }) }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { accountType: 'cloud' } }) }));
vi.mock('@/hooks/useLocalMode', () => ({ useLocalMode: () => ({ active: true, reason: 'manual', identityState: 'mapped' }) }));
vi.mock('@/lib/config', () => ({ isCommunity: false, config: { apiBase: 'https://api.test', graphqlUrl: 'https://api.test/' } }));
vi.mock('@/lib/browser-logger', () => ({ browserLogger: { logInfo: vi.fn() } }));
vi.mock('@apollo/client/react', () => ({
  useQuery: () => ({ data: { homeCamerasEnabled: true, homeMqttEnabled: true,
    homeMqttStatus: state.mqtt, homeMqttBrokers: [] }, refetch: state.refetch }),
  useMutation: () => [vi.fn(), { loading: false }],
}));
const home = { id: 'HOME-A', name: 'Test Home', relayConnected: false } as HomeKitHome;
function fact(status: string, by = 'mini') {
  ingestHomeServingPush({ homeId: home.id, serving: { state: status,
    by: status === 'served' ? by : null, kind: status === 'served' ? 'cloud' : null,
    graceEndsAt: status === 'waiting' ? new Date(Date.now() + 180_000).toISOString() : null } });
}
function page(section: 'cameras' | 'mqtt') {
  return render(<HomeDetailView home={home} section={section} sections={[section]} onSelectSection={() => {}} showSectionList={false} />);
}
beforeEach(() => {
  resetHomeServing(); state.homes = []; state.quality = 'good';
  state.mqtt = { serving: false, brokerConnected: true };
  state.request.mockReset().mockResolvedValue({ supported: true, engineWindow: true, captureAvailable: true });
});
afterEach(cleanup);

it('checks camera access after a serving push despite a stale offline homes row', async () => {
  fact('served');
  page('cameras');
  await screen.findByText('Ready');
  expect(state.request).toHaveBeenCalledWith('camera.capabilities', { homeId: home.id });
  expect(screen.queryByText('Relay offline')).toBeNull();
});

it('keeps unknown camera routing neutral instead of declaring the relay offline', () => {
  page('cameras');
  expect(screen.getByText('Checking the route to Test Home…')).toBeTruthy();
  expect(screen.queryByText('Relay offline')).toBeNull();
  expect(state.request).not.toHaveBeenCalled();
});

it('explains a camera takeover wait even when the old home row still says connected', () => {
  state.homes = [{ ...home, relayConnected: true }];
  fact('waiting');
  page('cameras');
  expect(screen.getByText('Waiting for backup')).toBeTruthy();
  expect(state.request).not.toHaveBeenCalled();
});

it('does not treat Local Mode as evidence that the cloud MQTT path is available', () => {
  setDeviceServing(() => ({ active: true }));
  fact('waiting');
  page('mqtt');
  expect(screen.getByText('Waiting for backup')).toBeTruthy();
  expect(screen.queryByText('Local Mode')).toBeNull();
  expect(screen.queryByText('Awaiting relay')).toBeNull();
});

it('drops stale MQTT Active when the cloud route becomes unavailable', () => {
  fact('served'); state.mqtt = { serving: true, brokerConnected: true };
  page('mqtt');
  expect(screen.getByText('Active')).toBeTruthy();
  act(() => fact('waiting'));
  expect(screen.queryByText('Active')).toBeNull();
  expect(screen.getByText('Waiting for backup')).toBeTruthy();
});

it('checks the replacement relay and ignores the old relay’s delayed camera result', async () => {
  let finishOld!: (value: unknown) => void;
  state.request.mockImplementationOnce(() => new Promise(resolve => { finishOld = resolve; }));
  fact('served', 'old-relay');
  page('cameras');
  act(() => fact('served', 'new-relay'));
  await screen.findByText('Ready');
  expect(state.request).toHaveBeenCalledTimes(2);
  await act(async () => { finishOld({ supported: false, engineWindow: false }); });
  expect(screen.getByText('Ready')).toBeTruthy();
  expect(screen.queryByText('Capture unavailable')).toBeNull();
});

it('keeps a camera application error separate from home availability', async () => {
  fact('served');
  state.request.mockRejectedValue({ code: 'UNKNOWN_METHOD', message: 'Not supported on this relay' });
  page('cameras');
  await screen.findByText('Relay update needed');
  expect(screen.getByText('Test Home is working')).toBeTruthy();
  expect(screen.queryByText('Relay offline')).toBeNull();
});

it('clears stale camera readiness when this client disconnects', async () => {
  fact('served');
  const view = page('cameras');
  await screen.findByText('Ready');
  state.quality = 'offline';
  view.rerender(<HomeDetailView home={home} section="cameras" sections={['cameras']} onSelectSection={() => {}} showSectionList={false} />);
  expect(screen.queryByText('Ready')).toBeNull();
  expect(screen.getByText('Not checked')).toBeTruthy();
  expect((screen.getByRole('button', { name: 'Refresh' }) as HTMLButtonElement).disabled).toBe(true);
});
