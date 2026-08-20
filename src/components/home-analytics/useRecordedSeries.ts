import { useQuery } from '@apollo/client/react';
import { GET_HISTORY_SERIES, GET_PUBLIC_ENTITY_HISTORY_SERIES } from '@/lib/graphql/queries';
import { useHistory } from '@/contexts/HistoryContext';
import { mockRecordedSeries } from '@/history/mock';
import type { HistorySeriesInfo } from '@/lib/graphql/types';

/**
 * The home's recorded-series listing — the data spine every Analytics level
 * organises. Mock mode serves the deterministic catalogue from history/mock
 * so ?mockHistory=1 exercises the whole surface offline.
 *
 * On a share page the same listing comes from the public document instead,
 * already scope-filtered by the server. This hook and useMultiSeriesHistory
 * are the ONLY two places in the whole Analytics surface that fetch, which is
 * why swapping the transport here covers the entire screen.
 */
export function useRecordedSeries(homeId: string | null, mock: boolean) {
  const { transport } = useHistory();
  const shared = transport?.kind === 'share' ? transport : null;

  const { data, loading, error, refetch } = useQuery<{
    historySeries?: HistorySeriesInfo[];
    publicEntityHistorySeries?: HistorySeriesInfo[];
  }>(shared ? GET_PUBLIC_ENTITY_HISTORY_SERIES : GET_HISTORY_SERIES, {
    variables: shared
      ? { shareHash: shared.shareHash, passcode: shared.passcode ?? null }
      : { homeId },
    // A share needs no homeId — the hash names the scope.
    skip: mock || (!shared && !homeId),
    fetchPolicy: 'cache-and-network',
  });

  const recorded = mock
    ? mockRecordedSeries()
    : (data?.publicEntityHistorySeries ?? data?.historySeries ?? []);

  return {
    recorded,
    loading: !mock && loading,
    error: mock ? undefined : error,
    refetch,
  };
}
