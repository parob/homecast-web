import { useQuery } from '@apollo/client/react';
import { GET_HOME_CAMERAS_ENABLED } from '@/lib/graphql/queries';
import { isCommunity } from '@/lib/config';

interface Response { homeCamerasEnabled: boolean | null }

// Dev-only escape hatch: `?cameras=1` on the dev server treats every home as
// switched on, so the tile can be exercised against a local relay before the
// cloud carries the `homeCamerasEnabled` field. Compiled out of production
// builds (import.meta.env.DEV is false there). Sticky for the tab, like
// `?cloud=1` in config.ts, for the same reason.
function devCamerasFlag(): boolean {
  if (!import.meta.env.DEV) return false;
  try {
    const q = new URLSearchParams(window.location.search).get('cameras');
    if (q === '1') { sessionStorage.setItem('homecast-dev-cameras', '1'); return true; }
    if (q === '0') { sessionStorage.removeItem('homecast-dev-cameras'); return false; }
    if (sessionStorage.getItem('homecast-dev-cameras') === '1') return true;
    // Or set once from the dev server's environment, for a shell whose start
    // URL is composed natively and cannot carry a query string.
    return import.meta.env.VITE_DEV_CAMERAS === '1';
  } catch {
    return false;
  }
}

/**
 * Whether the owner has switched camera images on for a home.
 *
 * Off by default on the server, and never asked in Community mode, which has
 * no cloud to ask and no engine window to capture with. Apollo's cache shares
 * one answer across every tile for the home; `errorPolicy: 'ignore'` keeps a
 * server that predates the field from breaking the dashboard — the tile then
 * reads false and shows state only, as it always did.
 */
export function useHomeCamerasEnabled(homeId: string | undefined): boolean {
  const { data } = useQuery<Response>(GET_HOME_CAMERAS_ENABLED, {
    variables: { homeId: homeId ?? '' },
    skip: isCommunity || !homeId,
    errorPolicy: 'ignore',
  });
  return data?.homeCamerasEnabled === true || devCamerasFlag();
}
