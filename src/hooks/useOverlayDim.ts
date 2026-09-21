/**
 * Registers a scrim's dim for as long as it is on screen, and reads the total.
 *
 * Two halves of `lib/overlay-dim`: `useOverlayDim` is what a scrim calls (via
 * `EdgeSampleSlivers`, which every scrim renders), `useTotalOverlayDim` is what
 * `useCanvasTint` calls to find out how dark the page currently is.
 */

import { useEffect, useSyncExternalStore } from 'react';
import {
  addOverlayDim,
  currentOverlayDim,
  removeOverlayDim,
  subscribeOverlayDim,
} from '@/lib/overlay-dim';

/** Declares `dim` for the lifetime of the calling component. */
export function useOverlayDim(dim: number): void {
  useEffect(() => {
    const id = addOverlayDim(dim);
    return () => removeOverlayDim(id);
  }, [dim]);
}

/** The composed dim of every scrim currently on screen; 0 when there is none. */
export function useTotalOverlayDim(): number {
  return useSyncExternalStore(subscribeOverlayDim, currentOverlayDim, () => 0);
}
