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
  type NativeHeaderRefreshKind,
  nativeHeaderContentInset,
  isNativePageHeading,
  publishPaintedAfterNextFrame,
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
  handlers: {
    onSelectHome?: (homeId: string) => void;
    onMenuAction?: (itemId: string) => void;
    onNavigate?: (itemId: string) => void;
    onRefresh?: (kind: NativeHeaderRefreshKind) => void;
  } = {},
): boolean {
  const [active, setActive] = useState(() => isNativeHeaderEnabled());

  // The native refresh control lives on WKWebView's document scroller.
  // The web layout normally suppresses root overscroll, which also disables
  // WebKit's vertical bounce even when UIKit has `bounces` enabled.
  useEffect(() => {
    if (!active) return;
    const root = document.documentElement;
    const previous = root.style.getPropertyValue('overscroll-behavior-y');
    root.style.setProperty('overscroll-behavior-y', 'auto');
    return () => {
      if (previous) root.style.setProperty('overscroll-behavior-y', previous);
      else root.style.removeProperty('overscroll-behavior-y');
    };
  }, [active]);

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
      onNavigate: (itemId) => {
        handlersRef.current.onNavigate?.(itemId);
      },
      onRefresh: (kind) => {
        handlersRef.current.onRefresh?.(kind);
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
  // The band is taller on a room page (the home's name above the room's),
  // and the page adds that line itself as it changes heading — see
  // `nativeHeaderContentInset` — so the padding changes in the same render
  // as the content, not a round trip later.
  const onPage = isNativePageHeading(state.heading, state.title);
  useEffect(() => {
    if (!active) return;
    const root = document.documentElement;
    const { status } = nativeHeaderInsets();
    root.style.setProperty('--safe-area-top', `${status}px`);
    root.style.setProperty('--native-header-inset', `${nativeHeaderContentInset(onPage)}px`);
    return () => {
      root.style.removeProperty('--safe-area-top');
      root.style.removeProperty('--native-header-inset');
    };
  }, [active, insetsVersion, onPage]);

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
  // And, when the heading changes (a room opened, the home come back to),
  // a word once the new view is on screen — the shell's slide waits for it.
  const pageKey = `${state.title ?? ''}\u0000${state.heading ?? ''}`;
  const lastPageKeyRef = useRef(pageKey);
  useEffect(() => {
    if (lastPageKeyRef.current === pageKey) return;
    lastPageKeyRef.current = pageKey;
    return publishPaintedAfterNextFrame();
  }, [pageKey]);

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
