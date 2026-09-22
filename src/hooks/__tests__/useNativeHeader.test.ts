// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import { useNativeHeader } from '../useNativeHeader';

const nativeWindow = window as Window & {
  homecastNativeHeaderAvailable?: boolean;
  homecastNativeHeaderEnabled?: boolean;
  __homecastNativeHeader?: { setEnabled: (enabled: boolean, bar?: number, status?: number) => void };
};

afterEach(() => {
  cleanup();
  delete nativeWindow.homecastNativeHeaderAvailable;
  delete nativeWindow.homecastNativeHeaderEnabled;
  document.documentElement.removeAttribute('style');
});

describe('native header document scrolling', () => {
  it('allows vertical overscroll only while the native header is active', () => {
    nativeWindow.homecastNativeHeaderAvailable = true;
    const root = document.documentElement;
    root.style.setProperty('overscroll-behavior', 'none');
    const { result, unmount } = renderHook(() => useNativeHeader({ title: 'Home' }));
    expect(result.current).toBe(false);
    expect(root.style.overscrollBehaviorY).not.toBe('auto');

    act(() => nativeWindow.__homecastNativeHeader?.setEnabled(true, 160, 60));
    expect(result.current).toBe(true);
    expect(root.style.overscrollBehaviorY).toBe('auto');
    expect(root.style.overscrollBehaviorX).not.toBe('auto');

    act(() => nativeWindow.__homecastNativeHeader?.setEnabled(false));
    expect(root.style.overscrollBehaviorY).not.toBe('auto');

    act(() => nativeWindow.__homecastNativeHeader?.setEnabled(true));
    unmount();
    expect(root.style.overscrollBehaviorY).not.toBe('auto');
  });

  it('restores an existing vertical overscroll rule when the header unmounts', () => {
    nativeWindow.homecastNativeHeaderAvailable = true;
    nativeWindow.homecastNativeHeaderEnabled = true;
    const root = document.documentElement;
    root.style.setProperty('overscroll-behavior-y', 'contain');
    const { unmount } = renderHook(() => useNativeHeader({ title: 'Home' }));
    expect(root.style.overscrollBehaviorY).toBe('auto');
    unmount();
    expect(root.style.overscrollBehaviorY).toBe('contain');
  });
});
