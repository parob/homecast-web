import { useEffect, useState } from 'react';
import { useApolloClient } from '@apollo/client/react';
import { GET_HISTORY, GET_PUBLIC_ENTITY_HISTORY } from '@/lib/graphql/queries';
import { useHistory } from '@/contexts/HistoryContext';
import { mockHistoryData } from '@/history/mock';
import {
  getCachedSeries,
  inflight,
  seriesCacheGeneration,
  seriesCacheKey,
  setCachedSeries,
} from '@/history/seriesCache';
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

/** The map key every consumer looks a series up by. */
const entryKey = (accessoryId: string, characteristicType: string) =>
  `${accessoryId.toUpperCase()}|${characteristicType}`;

/**
 * Chunked multi-series fetch: the wire caps GetHistory at 6 refs, so wider
 * views issue several queries. Keyed by UPPERCASE accessory id +
 * characteristic — the case-insensitive UUID rule. Accessory UUIDs are
 * globally unique, so that key stays right across homes.
 *
 * Answers are cached one series at a time (history/seriesCache), which is what
 * makes a room and the whole house share work: the house's refs are a superset
 * of the room's, so only what is genuinely new is fetched. Caching at the
 * response level could not do that — the refs are re-chunked six at a time and
 * two views never produce the same batches.
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
  const { transport } = useHistory();
  const shared = transport?.kind === 'share' ? transport : null;
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retryNonce, setRetryNonce] = useState(0);
  // Real progress, not a guessed ETA: the wire caps a query at 6 series, so a
  // wide view is a known number of sequential chunks and "18 of 30" is a fact.
  const [progress, setProgress] = useState<{ done: number; total: number }>({ done: 0, total: 0 });
  const refsKey = refs.map(r => `${r.homeId ?? ''}|${r.accessoryId}|${r.characteristicType}`).join(',');
  const maxPoints = opts?.maxPoints ?? 500;
  const enabled = opts?.enabled ?? true;

  /**
   * A share never spans homes (the hash names one entity) and must never read
   * an entry a signed-in view wrote — its scope is re-verified server-side on
   * every call.
   */
  const nsOf = (ref: ScopedSeriesRef): string =>
    shared ? `share:${shared.shareHash}` : (ref.homeId ?? homeId ?? '');

  const cacheKeyOf = (ref: ScopedSeriesRef): string =>
    seriesCacheKey(nsOf(ref), ref.accessoryId, ref.characteristicType, fromTs, toTs, maxPoints);

  /** Whatever is already held for the current refs, right now. */
  const readCache = (): Map<string, MultiSeriesEntry> => {
    const map = new Map<string, MultiSeriesEntry>();
    if (mock || !enabled) return map;
    for (const ref of refs) {
      const hit = getCachedSeries(cacheKeyOf(ref));
      if (hit) map.set(entryKey(hit.accessoryId, hit.characteristicType), { main: hit });
    }
    return map;
  };

  // Seeded during render, not in the effect. A scope change remounts this hook
  // (ScopeDashboard keys its child on the scope), so an effect-time seed would
  // still show one frame of skeleton over data the browser already holds.
  const [data, setData] = useState<Map<string, MultiSeriesEntry>>(readCache);

  useEffect(() => {
    // A per-ref home is enough on its own — the hook-level one is the default,
    // not a requirement. A share needs neither: the hash names the scope, and
    // a shared accessory does not always arrive carrying a homeId.
    const anyHome = shared || homeId || refs.some(r => r.homeId);
    if (!enabled || !anyHome || refs.length === 0) {
      setData(new Map());
      return;
    }
    let cancelled = false;
    const gen = seriesCacheGeneration();

    // Split before anything else: whatever is cached is already an answer.
    const cached = readCache();
    const misses = mock
      ? refs
      : refs.filter(r => !cached.has(entryKey(r.accessoryId, r.characteristicType)));

    if (misses.length === 0) {
      setData(cached);
      setError(null);
      setProgress({ done: refs.length, total: refs.length });
      setLoading(false);
      return;
    }

    const fetchAll = async (from: number, to: number): Promise<HistorySeriesData[]> => {
      if (mock) return mockHistoryData(refs, from, to, maxPoints);
      // Group by home first — GetHistory takes one home — then into the
      // 6-ref wire batches. The homeId never travels in the variables.
      //
      // A share never spans homes (the hash names one entity), so in share
      // mode the per-ref home is dropped and everything batches together; the
      // chunk's homeId is then unused by the query variables.
      const byHome = new Map<string, HistorySeriesRefInput[]>();
      for (const ref of misses) {
        const home = shared ? '@share' : (ref.homeId ?? homeId);
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
      let done = cached.size;
      let next = 0;
      const worker = async () => {
        for (;;) {
          const index = next++;
          if (index >= chunks.length || cancelled) return;
          const chunk = chunks[index];
          const dedupeKey = [
            chunk.homeId, from, to, maxPoints,
            chunk.refs.map(r => `${r.accessoryId}|${r.characteristicType}`).join(','),
          ].join('#');
          const result = await inflight(dedupeKey, () => client.query<{
            history?: HistorySeriesData[];
            publicEntityHistory?: HistorySeriesData[];
          }>({
            query: shared ? GET_PUBLIC_ENTITY_HISTORY : GET_HISTORY,
            variables: shared
              ? {
                  shareHash: shared.shareHash, passcode: shared.passcode ?? null,
                  series: chunk.refs, fromTs: from, toTs: to, maxPoints,
                }
              : { homeId: chunk.homeId, series: chunk.refs, fromTs: from, toTs: to, maxPoints },
            fetchPolicy: 'network-only',
          }));
          const series = result.data?.publicEntityHistory ?? result.data?.history ?? [];
          for (const s of series) {
            // Keyed by what was ASKED for, so the next view asking the same
            // question finds it — the answer carries its own ids, which a
            // caller has no way to guess in advance.
            setCachedSeries(
              seriesCacheKey(
                shared ? `share:${shared.shareHash}` : chunk.homeId,
                s.accessoryId, s.characteristicType, from, to, maxPoints,
              ),
              s,
              gen,
            );
          }
          out.push(...series);
          done += chunk.refs.length;
          if (!cancelled) setProgress(p => ({ ...p, done: Math.min(done, p.total) }));
        }
      };
      await Promise.all(Array.from({ length: Math.min(6, chunks.length) }, worker));
      return out;
    };

    setProgress({ done: mock ? 0 : cached.size, total: refs.length });
    setLoading(true);
    setError(null);
    void (async () => {
      try {
        const main = await fetchAll(fromTs, toTs);
        if (cancelled) return;
        // Held series stay on screen alongside the new ones; on a chip toggle
        // that is the difference between one fetch and a whole redraw.
        const map = mock ? new Map<string, MultiSeriesEntry>() : new Map(cached);
        for (const s of main) {
          map.set(entryKey(s.accessoryId, s.characteristicType), { main: s });
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
  }, [enabled, homeId, refsKey, fromTs, toTs, mock, client, retryNonce, maxPoints,
      shared?.shareHash, shared?.passcode]);

  return { data, loading, error, progress, retry: () => setRetryNonce(n => n + 1) };
}
