import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('@/native/homekit-bridge', () => ({ HomeKit: { cameraSnapshot: vi.fn() } }));
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
});
