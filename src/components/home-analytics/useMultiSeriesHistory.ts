import { useEffect, useState } from 'react';
import { useApolloClient } from '@apollo/client/react';
import { GET_HISTORY } from '@/lib/graphql/queries';
import { mockHistoryData } from '@/history/mock';
import type { HistorySeriesData, HistorySeriesRefInput } from '@/lib/graphql/types';

export interface MultiSeriesEntry {
  main: HistorySeriesData;
}

/**
 * Chunked multi-series fetch: the wire caps GetHistory at 6 refs, so wider
 * views issue several queries. Keyed by UPPERCASE accessory id +
 * characteristic — the case-insensitive UUID rule.
 */
export function useMultiSeriesHistory(
  homeId: string | null,
  refs: HistorySeriesRefInput[],
  fromTs: number,
  toTs: number,
  mock: boolean,
  opts?: { maxPoints?: number; enabled?: boolean },
) {
  const client = useApolloClient();
  const [data, setData] = useState<Map<string, MultiSeriesEntry>>(new Map());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retryNonce, setRetryNonce] = useState(0);
  // Real progress, not a guessed ETA: the wire caps a query at 6 series, so a
  // wide view is a known number of sequential chunks and "18 of 30" is a fact.
  const [progress, setProgress] = useState<{ done: number; total: number }>({ done: 0, total: 0 });
  const refsKey = refs.map(r => `${r.accessoryId}|${r.characteristicType}`).join(',');
  const maxPoints = opts?.maxPoints ?? 500;
  const enabled = opts?.enabled ?? true;

  useEffect(() => {
    if (!enabled || !homeId || refs.length === 0) {
      setData(new Map());
      return;
    }
    let cancelled = false;

    const fetchAll = async (from: number, to: number): Promise<HistorySeriesData[]> => {
      if (mock) return mockHistoryData(refs, from, to, maxPoints);
      const chunks: HistorySeriesRefInput[][] = [];
      for (let i = 0; i < refs.length; i += 6) chunks.push(refs.slice(i, i + 6));

      // Sequentially, a home of 688 series is 115 round trips end to end —
      // half a minute of waiting for a relay that could have answered several
      // at once. Six in flight keeps it well inside what a relay and the
      // browser's connection limit will take.
      const out: HistorySeriesData[] = [];
      let done = 0;
      let next = 0;
      const worker = async () => {
        for (;;) {
          const index = next++;
          if (index >= chunks.length || cancelled) return;
          const chunk = chunks[index];
          const result = await client.query<{ history: HistorySeriesData[] }>({
            query: GET_HISTORY,
            variables: { homeId, series: chunk, fromTs: from, toTs: to, maxPoints },
            fetchPolicy: 'network-only',
          });
          out.push(...(result.data?.history ?? []));
          done += chunk.length;
          if (!cancelled) setProgress(p => ({ ...p, done: Math.min(done, p.total) }));
        }
      };
      await Promise.all(Array.from({ length: Math.min(6, chunks.length) }, worker));
      return out;
    };

    setProgress({ done: 0, total: refs.length });
    setLoading(true);
    setError(null);
    void (async () => {
      try {
        const main = await fetchAll(fromTs, toTs);
        if (cancelled) return;
        const map = new Map<string, MultiSeriesEntry>();
        for (const s of main) {
          map.set(`${s.accessoryId.toUpperCase()}|${s.characteristicType}`, { main: s });
        }
        setData(map);
      } catch (e) {
        // Surface it — a silent console.error read as "the Explorer is buggy".
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load history');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, homeId, refsKey, fromTs, toTs, mock, client, retryNonce, maxPoints]);

  return { data, loading, error, progress, retry: () => setRetryNonce(n => n + 1) };
}
