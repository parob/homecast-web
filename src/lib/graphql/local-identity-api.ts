// The one network call Local Mode makes on its own behalf.
//
// Kept out of mutations.ts and called through the Apollo client directly
// because it is issued by the connection layer rather than by a component, and
// because it is deliberately fire-and-forget: a failure here degrades Local
// Mode to raw HomeKit naming, it does not break it.

import { gql } from '@apollo/client';
import { apolloClient } from '../apollo';
import type { TopologyReport } from '../../server/local-identity';

export const RECONCILE_LOCAL_TOPOLOGY = gql`
  mutation ReconcileLocalTopology($topologyJson: String!) {
    reconcileLocalTopology(topologyJson: $topologyJson) {
      success
      mapJson
      unmatchedJson
      matchedCount
      reportedCount
      error
    }
  }
`;

export interface ReconcileResult {
  /** {kind: {UPPERCASE live uuid: hc_id}} */
  map: Record<string, Record<string, string>>;
  unmatched: Record<string, string[]>;
  matched: number;
  reported: number;
}

export async function reconcileLocalTopology(topology: TopologyReport): Promise<ReconcileResult | null> {
  const { data } = await apolloClient.mutate<{
    reconcileLocalTopology: {
      success: boolean;
      mapJson: string;
      unmatchedJson: string;
      matchedCount: number;
      reportedCount: number;
      error?: string | null;
    };
  }>({
    mutation: RECONCILE_LOCAL_TOPOLOGY,
    variables: { topologyJson: JSON.stringify(topology) },
    // Never cached: it is a report, and the answer depends on server state that
    // this client cannot see.
    fetchPolicy: 'no-cache',
  });

  const r = data?.reconcileLocalTopology;
  if (!r?.success) {
    if (r?.error) console.warn('[LocalIdentity] Server refused the topology report:', r.error);
    return null;
  }

  return {
    map: JSON.parse(r.mapJson || '{}'),
    unmatched: JSON.parse(r.unmatchedJson || '{}'),
    matched: r.matchedCount,
    reported: r.reportedCount,
  };
}
