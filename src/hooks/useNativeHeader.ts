import { useEffect, useState } from 'react';

import {
  installNativeHeaderBridge,
  isNativeHeaderEnabled,
  publishHeaderState,
  activateHeaderControl,
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
export function useNativeHeader(state: NativeHeaderState): boolean {
  const [active, setActive] = useState(() => isNativeHeaderEnabled());

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
    });
  }, []);

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
