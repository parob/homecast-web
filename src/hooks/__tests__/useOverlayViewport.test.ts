// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import { useOverlayViewport } from '../useOverlayViewport';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  document.documentElement.style.removeProperty('--safe-area-top');
  document.documentElement.style.removeProperty('--safe-area-bottom');
});

describe('expanded panel viewport', () => {
  it('tracks the visible height, offset and safe areas while open', () => {
    const visible = Object.assign(new EventTarget(), { height: 600, offsetTop: 20, scale: 1 });
    vi.stubGlobal('visualViewport', visible);
    document.documentElement.style.setProperty('--safe-area-top', '24px');
    document.documentElement.style.setProperty('--safe-area-bottom', '34px');
    const { result, rerender } = renderHook(({ active }) => useOverlayViewport(active), { initialProps: { active: true } });
    expect(result.current).toMatchObject({ height: 600, top: 20, safeTop: 24, safeBottom: 34 });
    act(() => { visible.height = 420; visible.offsetTop = 40; visible.dispatchEvent(new Event('resize')); });
    expect(result.current).toMatchObject({ height: 420, top: 40 });
    act(() => { visible.offsetTop = 50; visible.dispatchEvent(new Event('scroll')); });
    expect(result.current.top).toBe(50);
    rerender({ active: false });
    act(() => { visible.height = 300; visible.dispatchEvent(new Event('resize')); });
    expect(result.current.height).toBe(420);
  });

  it('does not resize the content underneath a pinch zoom', () => {
    const visible = Object.assign(new EventTarget(), { height: 600, offsetTop: 0, scale: 1 });
    vi.stubGlobal('visualViewport', visible);
    const { result } = renderHook(() => useOverlayViewport(true));
    act(() => { visible.height = 300; visible.scale = 2; visible.dispatchEvent(new Event('resize')); });
    expect(result.current.height).toBe(600);
  });

  it('uses window resize when VisualViewport is absent', () => {
    vi.stubGlobal('visualViewport', undefined);
    vi.stubGlobal('innerHeight', 800);
    const { result } = renderHook(() => useOverlayViewport(true));
    act(() => { vi.stubGlobal('innerHeight', 400); window.dispatchEvent(new Event('resize')); });
    expect(result.current.height).toBe(400);
  });
});
