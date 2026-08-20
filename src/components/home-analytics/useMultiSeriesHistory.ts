import { useEffect, useState } from 'react';
import { useApolloClient } from '@apollo/client/react';
import { GET_HISTORY } from '@/lib/graphql/queries';
import { mockHistoryData } from '@/history/mock';
import type { HistorySeriesData, HistorySeriesRefInput } from '@/lib/graphql/types';

export interface MultiSeriesEntry {
  main: HistorySeriesData;
}

/**
 * A ref that may name its own home. A collection's accessories can come from
 * several homes at once, and GetHistory is per-home — so the home travels
 * with the ref rather than being one value for the whole call. Omitted means
 * the hook's `homeId`, which is every existing caller.
 */
export type ScopedSeriesRef = HistorySeriesRefInput & { homeId?: string };

/**
 * Chunked multi-series fetch: the wire caps GetHistory at 6 refs, so wider
 * views issue several queries. Keyed by UPPERCASE accessory id +
 * characteristic — the case-insensitive UUID rule. Accessory UUIDs are
 * globally unique, so that key stays right across homes.
 */
export function useMultiSeriesHistory(
  homeId: string | null,
  refs: ScopedSeriesRef[],
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
  const refsKey = refs.map(r => `${r.homeId ?? ''}|${r.accessoryId}|${r.characteristicType}`).join(',');
  const maxPoints = opts?.maxPoints ?? 500;
  const enabled = opts?.enabled ?? true;

  useEffect(() => {
    // A per-ref home is enough on its own — the hook-level one is the default,
    // not a requirement.
    const anyHome = homeId || refs.some(r => r.homeId);
    if (!enabled || !anyHome || refs.length === 0) {
      setData(new Map());
      return;
    }
    let cancelled = false;

    const fetchAll = async (from: number, to: number): Promise<HistorySeriesData[]> => {
      if (mock) return mockHistoryData(refs, from, to, maxPoints);
      // Group by home first — GetHistory takes one home — then into the
      // 6-ref wire batches. The homeId never travels in the variables.
      const byHome = new Map<string, HistorySeriesRefInput[]>();
      for (const ref of refs) {
        const home = ref.homeId ?? homeId;
        if (!home) continue;
        const list = byHome.get(home) ?? [];
        list.push({ accessoryId: ref.accessoryId, characteristicType: ref.characteristicType });
        byHome.set(home, list);
      }
      const chunks: Array<{ homeId: string; refs: HistorySeriesRefInput[] }> = [];
      for (const [home, homeRefs] of byHome) {
        for (let i = 0; i < homeRefs.length; i += 6) {
          chunks.push({ homeId: home, refs: homeRefs.slice(i, i + 6) });
        }
      }

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
            variables: { homeId: chunk.homeId, series: chunk.refs, fromTs: from, toTs: to, maxPoints },
            fetchPolicy: 'network-only',
          });
          out.push(...(result.data?.history ?? []));
          done += chunk.refs.length;
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
