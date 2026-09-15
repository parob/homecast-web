// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { HomeCamerasSection } from '../HomeCamerasSection';
import type { HomeKitHome } from '@/lib/graphql/types';

const request = vi.hoisted(() => vi.fn());
vi.mock('@/server/connection', () => ({ serverConnection: { request } }));
vi.mock('@apollo/client/react', () => ({
  useQuery: () => ({ data: { homeCamerasEnabled: true }, refetch: vi.fn() }),
  useMutation: () => [vi.fn(), { loading: false }],
}));
const home = { id: 'home', name: 'Home' } as HomeKitHome;
beforeEach(() => request.mockReset());
afterEach(cleanup);

describe('home camera capture status', () => {
  it.each([
    { supported: true, engineWindow: true, screenRecording: 'granted' },
    { supported: true, engineWindow: true, captureAvailable: true, screenRecordingAuthorization: 'denied' },
  ])('shows capture readiness without claiming permission was granted', async (caps) => {
    request.mockResolvedValue(caps);
    render(<HomeCamerasSection home={home} relayOnline isAdmin />);
    await screen.findByText('Available');
    expect(screen.queryByText('Granted')).toBeNull();
    expect(screen.queryByRole('button', { name: /Screen Recording/ })).toBeNull();
    expect(request).toHaveBeenCalledWith('camera.capabilities', { homeId: 'home' });
  });

  it('honours explicit capture failure even when the legacy field says granted', async () => {
    request.mockResolvedValue({ supported: true, engineWindow: true, captureAvailable: false, screenRecording: 'granted' });
    render(<HomeCamerasSection home={home} relayOnline isAdmin />);
    await screen.findByText('Unavailable');
    expect(screen.getByText(/Restart Homecast/)).toBeTruthy();
  });
});
