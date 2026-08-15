// Subscribe a component to Local Mode's state.
//
// The controller is a singleton with its own tick; this is the only way React
// should read it, so a transition re-renders the badge and re-runs the effects
// that depend on which transport is serving.

import { useEffect, useState } from 'react';
import { isLocalCapable } from '../native/homekit-bridge';
import type { LocalModeState } from '../server/local-mode-controller';

// `blocked: 'loading'` rather than null: before the controller has answered we
// genuinely don't know, and claiming a definite blocker (or none) would flash
// the wrong explanation on the Settings screen for a frame.
const INACTIVE: LocalModeState = {
  active: false, reason: null, identityState: 'unmapped', matched: 0, reported: 0,
  bridgeReady: false, blocked: 'loading', status: null,
};

export function useLocalMode(): LocalModeState {
  const [state, setState] = useState<LocalModeState>(INACTIVE);

  useEffect(() => {
    // Nothing to subscribe to in a browser, and importing the controller there
    // would pull the native bridge and the identity layer into a chunk that
    // can never use them.
    if (!isLocalCapable()) return;

    let unsubscribe: (() => void) | undefined;
    let cancelled = false;

    void import('../server/local-mode-controller').then(({ controller }) => {
      if (cancelled) return;
      unsubscribe = controller.subscribe(setState);
    });

    return () => { cancelled = true; unsubscribe?.(); };
  }, []);

  return state;
}
