import { useQuery } from '@apollo/client/react';
import { GET_HISTORY_SERIES } from '@/lib/graphql/queries';
import { mockRecordedSeries } from '@/history/mock';
import type { HistorySeriesInfo } from '@/lib/graphql/types';

/**
 * The home's recorded-series listing — the data spine every Analytics level
 * organises. Mock mode serves the deterministic catalogue from history/mock
 * so ?mockHistory=1 exercises the whole surface offline.
 */
export function useRecordedSeries(homeId: string | null, mock: boolean) {
  const { data, loading, error, refetch } = useQuery<{ historySeries: HistorySeriesInfo[] }>(GET_HISTORY_SERIES, {
    variables: { homeId },
    skip: !homeId || mock,
    fetchPolicy: 'cache-and-network',
  });
  return {
    recorded: mock ? mockRecordedSeries() : (data?.historySeries ?? []),
    loading: !mock && loading,
    error: mock ? undefined : error,
    refetch,
  };
}
