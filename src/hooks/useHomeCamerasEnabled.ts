import { useQuery } from '@apollo/client/react';
import { GET_HOME_CAMERAS_ENABLED } from '@/lib/graphql/queries';
import { isCommunity } from '@/lib/config';

interface Response { homeCamerasEnabled: boolean | null }

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
  return data?.homeCamerasEnabled === true;
}
