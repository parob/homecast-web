// Subscribe a component to one home's serving fact.
//
// `effectiveServing` is a plain read of the store; this is how React reads
// it, so a `home_serving` push — which touches no query cache and so re-renders
// nothing on its own — reaches the surface that is showing the home.

import { useEffect, useState } from 'react';
import { effectiveServing, subscribeHomeServing, type HomeServing } from '@/server/home-serving';

export function useHomeServing(homeId: string | null | undefined): HomeServing | null {
  const [, bump] = useState(0);
  useEffect(() => subscribeHomeServing((id) => {
    if (!homeId || id === homeId.toUpperCase()) bump((n) => n + 1);
  }), [homeId]);
  return homeId ? effectiveServing(homeId) : null;
}

/**
 * Re-render on any home's transition. For a surface that reads the fact for
 * a *list* of homes through `isHomeServed` / `isHomeUnserved`: put the
 * returned number in the memo's deps and the memo recomputes on a push.
 */
export function useHomeServingVersion(): number {
  const [v, bump] = useState(0);
  useEffect(() => subscribeHomeServing(() => bump((n) => n + 1)), []);
  return v;
}
