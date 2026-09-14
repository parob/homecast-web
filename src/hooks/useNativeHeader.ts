import { useEffect, useRef, useState } from 'react';

import {
  installNativeHeaderBridge,
  isNativeHeaderEnabled,
  watchNativeHeaderCover,
  publishHeaderState,
  activateHeaderControl,
  NATIVE_HEADER_EVENT,
  nativeHeaderInsets,
  type NativeHeaderState,
} from '@/native/native-header';

/**
 * Own the native top chrome's side of the header (parob/homecast-cloud#120).
 *
 * Returns whether the native bar currently has the screen — which is the same
 * thing as whether the web control row should hide itself.
 *
 * ## Call this from exactly one component
 *
 * It installs `window.__homecastNativeHeader`, and a second installer would
 * silently win: the last one to mount owns the global, and the first one's
 * teardown then deletes the second's handlers. `AppHeader` is the one component
 * that renders the control row, renders once, and is therefore the owner.
 *
 * ## A native tap needs no handlers from the caller
 *
 * It is routed by clicking the real web trigger (see `NATIVE_HEADER_TARGET_ATTR`),
 * so this hook needs nothing from `Dashboard` beyond the four `data-native-header`
 * attributes already on its buttons. That is deliberate — the alternative was
 * lifting four Radix surfaces into controlled state through a 7,000-line file,
 * for a preview that may not survive review.
 */
export function useNativeHeader(
  state: NativeHeaderState,
  handlers: { onSelectHome?: (homeId: string) => void; onMenuAction?: (itemId: string) => void } = {},
): boolean {
  const [active, setActive] = useState(() => isNativeHeaderEnabled());

  // Read through a ref so the bridge is installed once and still calls the
  // newest handler; `Dashboard` recreates its callbacks as its state changes.
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  // Hide the bar under any web overlay, for as long as the bar exists.
  useEffect(() => watchNativeHeaderCover(), []);

  useEffect(() => {
    // Seed from the globals as well as subscribing: on a build that launched
    // with the preview already on, native sets `homecastNativeHeaderEnabled`
    // at document start and `setEnabled` may not fire again until a navigation.
    setActive(isNativeHeaderEnabled());
    return installNativeHeaderBridge({
      onTap: (control) => {
        activateHeaderControl(control);
      },
      onEnabledChange: setActive,
      onSelectHome: (homeId) => {
        handlersRef.current.onSelectHome?.(homeId);
      },
      onMenuAction: (itemId) => {
        handlersRef.current.onMenuAction?.(itemId);
      },
    });
  }, []);

  // While the bar is on, the page draws under it and pads itself by the bar's
  // height (`--native-header-inset`), and `--safe-area-top` is pinned to the
  // status bar alone: `env(safe-area-inset-top)` shrinks as the large title
  // collapses, and content padded by it would move under the finger. Inline
  // styles outrank the stylesheet's `env()` value and are removed again the
  // moment the bar goes. Re-applied on every enable, because the shell
  // reports fresh insets with each page load.
  const [insetsVersion, setInsetsVersion] = useState(0);
  useEffect(() => {
    const bump = () => setInsetsVersion((v) => v + 1);
    window.addEventListener(NATIVE_HEADER_EVENT, bump);
    return () => window.removeEventListener(NATIVE_HEADER_EVENT, bump);
  }, []);
  useEffect(() => {
    if (!active) return;
    const root = document.documentElement;
    const { bar, status } = nativeHeaderInsets();
    root.style.setProperty('--safe-area-top', `${status}px`);
    root.style.setProperty('--native-header-inset', `${bar}px`);
    return () => {
      root.style.removeProperty('--safe-area-top');
      root.style.removeProperty('--native-header-inset');
    };
  }, [active, insetsVersion]);

  // Published on every change, and deliberately whether or not the bar is on
  // screen: flipping the preview must not produce a bar with a blank title for
  // as long as it takes the next state change to arrive.
  //
  // Keyed on `state`'s identity, so **the caller must memoise it** — an object
  // literal is a new identity every render, which would post to the bridge on
  // every keystroke anywhere in the app. `AppHeader` does.
  useEffect(() => {
    publishHeaderState(state);
  }, [state]);

  return active;
}

/**
 * Whether the native bar has the screen, for a component that does not own
 * the bridge. `Dashboard` reads this to scroll the document instead of an
 * inner container — UIKit collapses the large title from the web view's own
 * scroll view and nothing else.
 */
export function useNativeHeaderActive(): boolean {
  const [active, setActive] = useState(() => isNativeHeaderEnabled());
  useEffect(() => {
    setActive(isNativeHeaderEnabled());
    const onChange = () => setActive(isNativeHeaderEnabled());
    window.addEventListener(NATIVE_HEADER_EVENT, onChange);
    return () => window.removeEventListener(NATIVE_HEADER_EVENT, onChange);
  }, []);
  return active;
}
