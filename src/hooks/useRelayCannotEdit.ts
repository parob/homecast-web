/**
 * Whether the relay's Apple ID is view-only in a home, so the UI can say so
 * *before* the user builds something HomeKit will refuse to save.
 *
 * `isAdmin` comes from HMHome.homeAccessControl on the relay Mac and rides
 * homes.list → GET_HOMES. Relays older than 1.1.2 never reported it, so it
 * arrives undefined there — genuinely unknown rather than restricted, which is
 * why `=== false` is the only safe test. Guessing would put a permission
 * warning in front of users who have full access.
 */

import { useQuery } from '@apollo/client/react';
import { GET_HOMES } from '@/lib/graphql/queries';
import { useHomes } from '@/hooks/useHomeKitData';
import type { RelayKind } from '@/lib/homekit-errors';
import type { HomeKitHome } from '@/lib/graphql/types';

export function useRelayCannotEdit(homeId?: string | null): boolean {
  // cache-first because the callers are render-path checks, not fetches, and
  // several of them sit on the same screen; errorPolicy ignore because a homes
  // query that fails must not escalate into a permission warning.
  const { data } = useQuery<{ homes: HomeKitHome[] }>(GET_HOMES, {
    skip: !homeId,
    fetchPolicy: 'cache-first',
    errorPolicy: 'ignore',
  });

  if (!homeId) return false;
  return data?.homes?.find(h => h.id === homeId)?.isAdmin === false;
}

/**
 * Whether this home is served by a Cloud Relay or a self-hosted one, which
 * decides who the user has to grant access to in Apple Home.
 *
 * Deliberately a second hook on a second data layer: `isCloudManaged` rides the
 * WebSocket `homes.list` payload and is on no GraphQL selection set, while
 * `isAdmin` above comes from Apollo. `useHomes` is cached under a shared key,
 * so this costs one fetch no matter how many callers, and it swallows its own
 * errors rather than throwing.
 *
 * Returns undefined while the payload is missing — the caller then uses the
 * relay-agnostic wording. Guessing a kind here would name the wrong one for
 * half of users on a screen whose whole point is telling them where to go.
 */
export function useHomeRelayKind(homeId?: string | null): RelayKind | undefined {
  const { data: homes } = useHomes({ skip: !homeId });
  if (!homeId) return undefined;
  const home = homes?.find(h => h.id === homeId);
  if (!home) return undefined;
  return home.isCloudManaged === true ? 'cloud' : 'self-hosted';
}
