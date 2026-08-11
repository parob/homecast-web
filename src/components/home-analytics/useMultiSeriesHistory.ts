import { useEffect, useState } from 'react';
import { useApolloClient } from '@apollo/client/react';
import { GET_HISTORY } from '@/lib/graphql/queries';
import { mockHistoryData } from '@/history/mock';
import type { HistorySeriesData, HistorySeriesRefInput } from '@/lib/graphql/types';

export interface MultiSeriesEntry {
  main: HistorySeriesData;
  ghost?: HistorySeriesData;
}

/**
 * Chunked multi-series fetch: the wire caps GetHistory at 6 refs, so wider
 * views issue sequential chunks. `compareOffsetMs` fetches the same window
 * shifted back and re-stamps it onto the current axis (the "ghost" series).
 * Keyed by UPPERCASE accessory id + characteristic — the case-insensitive
 * UUID rule.
 */
export function useMultiSeriesHistory(
  homeId: string | null,
  refs: HistorySeriesRefInput[],
  fromTs: number,
  toTs: number,
  compareOffsetMs: number,
  mock: boolean,
  opts?: { maxPoints?: number; enabled?: boolean },
) {
  const client = useApolloClient();
  const [data, setData] = useState<Map<string, MultiSeriesEntry>>(new Map());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retryNonce, setRetryNonce] = useState(0);
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
      const out: HistorySeriesData[] = [];
      for (let i = 0; i < refs.length; i += 6) {
        const chunk = refs.slice(i, i + 6);
        const result = await client.query<{ history: HistorySeriesData[] }>({
          query: GET_HISTORY,
          variables: { homeId, series: chunk, fromTs: from, toTs: to, maxPoints },
          fetchPolicy: 'network-only',
        });
        out.push(...(result.data?.history ?? []));
      }
      return out;
    };

    setLoading(true);
    setError(null);
    void (async () => {
      try {
        const main = await fetchAll(fromTs, toTs);
        const ghost = compareOffsetMs > 0
          ? await fetchAll(fromTs - compareOffsetMs, toTs - compareOffsetMs)
          : [];
        if (cancelled) return;
        const map = new Map<string, MultiSeriesEntry>();
        for (const s of main) {
          map.set(`${s.accessoryId.toUpperCase()}|${s.characteristicType}`, { main: s });
        }
        for (const g of ghost) {
          const entry = map.get(`${g.accessoryId.toUpperCase()}|${g.characteristicType}`);
          if (entry) {
            entry.ghost = {
              ...g,
              points: g.points.map(p => ({ ...p, ts: p.ts + compareOffsetMs })),
              states: g.states.map(s2 => ({ ...s2, ts: s2.ts + compareOffsetMs })),
              stateBuckets: g.stateBuckets.map(b => ({ ...b, ts: b.ts + compareOffsetMs })),
            };
          }
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
  }, [enabled, homeId, refsKey, fromTs, toTs, compareOffsetMs, mock, client, retryNonce, maxPoints]);

  return { data, loading, error, retry: () => setRetryNonce(n => n + 1) };
}
