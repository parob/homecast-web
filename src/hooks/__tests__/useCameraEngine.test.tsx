// @vitest-environment jsdom
/**
 * The camera engine window belongs on a cloud-managed relay and nowhere else.
 * The Mac cannot tell which it is; this hook is the one place that tells it.
 */
import { cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const bridge = vi.hoisted(() => ({
  setCameraEngine: vi.fn(),
  isAvailable: vi.fn(),
  relayCapable: vi.fn(),
  community: { value: false },
}));
vi.mock('@/native/homekit-bridge', () => ({
  HomeKit: { setCameraEngine: bridge.setCameraEngine, isAvailable: bridge.isAvailable },
  isRelayCapable: bridge.relayCapable,
}));
vi.mock('@/lib/config', () => ({ get isCommunity() { return bridge.community.value; } }));

import { useCameraEngine, wantsCameraEngine } from '../useCameraEngine';

beforeEach(() => {
  bridge.setCameraEngine.mockReset().mockResolvedValue({ enabled: true, engineWindow: true });
  bridge.isAvailable.mockReturnValue(true);
  bridge.relayCapable.mockReturnValue(true);
  bridge.community.value = false;
});
afterEach(() => cleanup());

describe('wantsCameraEngine', () => {
  it('is the managed account and only the managed account', () => {
    expect(wantsCameraEngine('managed')).toBe(true);
    // A cloud plan is not a cloud relay: its holder can run their own Mac too.
    expect(wantsCameraEngine('cloud')).toBe(false);
    expect(wantsCameraEngine('standard')).toBe(false);
    expect(wantsCameraEngine('free')).toBe(false);
    expect(wantsCameraEngine(undefined)).toBe(false);
    expect(wantsCameraEngine(null)).toBe(false);
  });
});

describe('useCameraEngine', () => {
  it('switches the engine on for the managed relay account', () => {
    renderHook(() => useCameraEngine('managed'));
    expect(bridge.setCameraEngine).toHaveBeenCalledTimes(1);
    expect(bridge.setCameraEngine).toHaveBeenCalledWith(true);
  });

  it("switches it off for a customer's own Mac, whatever plan they are on", () => {
    renderHook(() => useCameraEngine('cloud'));
    expect(bridge.setCameraEngine).toHaveBeenCalledWith(false);
  });

  it('says nothing while signed out — a null user at startup is not a verdict', () => {
    const { rerender } = renderHook(({ t }: { t: string | null }) => useCameraEngine(t), { initialProps: { t: null } });
    expect(bridge.setCameraEngine).not.toHaveBeenCalled();
    rerender({ t: 'managed' });
    expect(bridge.setCameraEngine).toHaveBeenCalledWith(true);
  });

  it('reports once per account, not once per render', () => {
    const { rerender } = renderHook(({ t }: { t: string }) => useCameraEngine(t), { initialProps: { t: 'managed' } });
    rerender({ t: 'managed' });
    rerender({ t: 'managed' });
    expect(bridge.setCameraEngine).toHaveBeenCalledTimes(1);
  });

  it('is a Mac-only conversation: phones, browsers and Community never call it', () => {
    bridge.relayCapable.mockReturnValue(false);
    renderHook(() => useCameraEngine('managed'));
    expect(bridge.setCameraEngine).not.toHaveBeenCalled();

    bridge.relayCapable.mockReturnValue(true);
    bridge.isAvailable.mockReturnValue(false);
    renderHook(() => useCameraEngine('managed'));
    expect(bridge.setCameraEngine).not.toHaveBeenCalled();

    bridge.isAvailable.mockReturnValue(true);
    bridge.community.value = true;
    renderHook(() => useCameraEngine('managed'));
    expect(bridge.setCameraEngine).not.toHaveBeenCalled();
  });

  it('survives an older app that has no such method', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    bridge.setCameraEngine.mockRejectedValue(new Error('Unknown method: camera.engine.set'));
    renderHook(() => useCameraEngine('managed'));
    await Promise.resolve();
    await Promise.resolve();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
