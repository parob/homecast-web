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
function page(section: 'cameras' | 'mqtt', cloudManaged = true) {
  return render(<HomeDetailView home={home} section={section} sections={[section]} cloudManaged={cloudManaged} onSelectSection={() => {}} showSectionList={false} />);
}
beforeEach(() => {
  resetHomeServing(); state.homes = []; state.quality = 'good';
  state.mqtt = { serving: false, brokerConnected: true };
  state.request.mockReset().mockResolvedValue({ supported: true, engineWindow: true, captureAvailable: true });
});
afterEach(cleanup);

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

it('is one Cameras switch on a cloud-managed home', () => {
  page('cameras', true);
  const toggle = screen.getByRole('switch', { name: 'Cameras' }) as HTMLButtonElement;
  expect(toggle.getAttribute('aria-checked')).toBe('true');
  expect(toggle.disabled).toBe(false);
  expect(state.request).not.toHaveBeenCalled();
});

it('explains Cameras is a Cloud Managed feature on any other home, with the switch off', () => {
  page('cameras', false);
  const toggle = screen.getByRole('switch', { name: 'Cameras' }) as HTMLButtonElement;
  expect(toggle.getAttribute('aria-checked')).toBe('false');
  expect(toggle.disabled).toBe(true);
  expect(screen.getByText('Cameras are available with Cloud Managed.')).toBeTruthy();
});
