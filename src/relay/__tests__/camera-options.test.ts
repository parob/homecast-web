import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('@/native/homekit-bridge', () => ({ HomeKit: { cameraCapabilities: vi.fn(), cameraSnapshot: vi.fn(), cameraLiveStart: vi.fn(), cameraLiveKeepalive: vi.fn(), cameraLiveStop: vi.fn() } }));
import { HomeKit } from '@/native/homekit-bridge';
import { executeHomeKitAction, setAccessoryLimit } from '../local-handler';

describe('camera options across the relay adapter', () => {
  beforeEach(() => { vi.clearAllMocks(); setAccessoryLimit(null); });

  it.each([true, false, undefined])('preserves the explicit stale-fallback choice (%s)', async allowStaleOnError => {
    await executeHomeKitAction('camera.snapshot', { accessoryId: 'cam', maxWidth: 480, maxAgeSec: 0, allowStaleOnError });
    expect(HomeKit.cameraSnapshot).toHaveBeenCalledWith('cam', {
      maxWidth: 480, maxAgeSec: 0, allowStaleOnError: allowStaleOnError === true,
    });
  });

  it('forwards the server-owned lease and destination to the native start', async () => {
    await executeHomeKitAction('camera.live.start', { accessoryId: 'cam', fps: 4, maxWidth: 960, quality: .6, viewerId: 'viewer', viewerInstance: 'pod' });
    expect(HomeKit.cameraLiveStart).toHaveBeenCalledWith('cam', { fps: 4, maxWidth: 960, quality: .6, viewerId: 'viewer', viewerInstance: 'pod' });
  });

  it('reports viewer routing separately from native lease support', async () => {
    vi.mocked(HomeKit.cameraCapabilities).mockResolvedValue({ liveLeases: false } as never);
    expect(await executeHomeKitAction('camera.capabilities', {})).toEqual({ liveLeases: false, liveViewerRouting: true });
  });

  it.each(['keepalive', 'stop'])('scopes %s to the requesting viewer', async method => {
    await executeHomeKitAction(`camera.live.${method}`, { accessoryId: 'cam', viewerId: 'viewer' });
    expect(method === 'stop' ? HomeKit.cameraLiveStop : HomeKit.cameraLiveKeepalive).toHaveBeenCalledWith('cam', 'viewer');
  });
});
