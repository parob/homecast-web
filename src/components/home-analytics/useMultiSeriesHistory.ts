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
 * Chunked multi-series fetch: the wire caps GetHistory at 60 refs, so wider
 * views issue several queries. Keyed by UPPERCASE accessory id +
 * characteristic — the case-insensitive UUID rule. Accessory UUIDs are
 * globally unique, so that key stays right across homes.
 *
 * Answers are cached one series at a time (history/seriesCache), which is what
 * makes a room and the whole house share work: the house's refs are a superset
 * of the room's, so only what is genuinely new is fetched. Caching at the
 * response level could not do that — the refs are re-chunked between views and
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
  // Progress counts answered series, including cache hits, as batches arrive.
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
    shared ? JSON.stringify(['share', shared.shareHash, shared.passcode ?? null]) : (ref.homeId ?? homeId ?? '');

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
      setLoading(false);
      setError(null);
      setProgress({ done: 0, total: 0 });
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
      // 60-ref wire batches. The homeId never travels in the variables.
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
        for (let i = 0; i < homeRefs.length; i += 60) {
          chunks.push({ homeId: home, refs: homeRefs.slice(i, i + 60) });
        }
      }

      // Larger batches amortise auth and database round trips. Three workers
      // bound response memory and leave connections for device controls.
      const out: HistorySeriesData[] = [];
      let done = cached.size;
      let next = 0;
      const worker = async () => {
        for (;;) {
          const index = next++;
          if (index >= chunks.length || cancelled) return;
          const chunk = chunks[index];
          const dedupeKey = [
            shared ? JSON.stringify([shared.shareHash, shared.passcode]) : chunk.homeId,
            gen, from, to, maxPoints,
            chunk.refs.map(r => `${r.accessoryId}|${r.characteristicType}`).join(','),
          ].join('#');
          const fetchChunk = (chunkRefs: HistorySeriesRefInput[]) => client.query<{
            history?: HistorySeriesData[];
            publicEntityHistory?: HistorySeriesData[];
          }>({
            query: shared ? GET_PUBLIC_ENTITY_HISTORY : GET_HISTORY,
            variables: shared
              ? {
                  shareHash: shared.shareHash, passcode: shared.passcode ?? null,
                  series: chunkRefs, fromTs: from, toTs: to, maxPoints,
                }
              : { homeId: chunk.homeId, series: chunkRefs, fromTs: from, toTs: to, maxPoints },
            // The per-series cache owns reuse. Apollo normalising every point
            // adds work and retains a second copy of these large payloads.
            fetchPolicy: 'no-cache',
          });
          const series = await inflight(dedupeKey, async () => {
            try {
              const result = await fetchChunk(chunk.refs);
              return result.data?.publicEntityHistory ?? result.data?.history ?? [];
            } catch (error) {
              // Old cloud servers and bundled Community relays still cap at
              // six. A rolling deployment must keep their charts working.
              if (chunk.refs.length <= 6 || !(error instanceof Error)
                || !error.message.includes('history queries take 1-6 series')) throw error;
              const fallback: HistorySeriesData[] = [];
              for (let i = 0; i < chunk.refs.length; i += 6) {
                const result = await fetchChunk(chunk.refs.slice(i, i + 6));
                fallback.push(...(result.data?.publicEntityHistory ?? result.data?.history ?? []));
              }
              return fallback;
            }
          });
          for (const s of series) {
            // Keyed by what was ASKED for, so the next view asking the same
            // question finds it — the answer carries its own ids, which a
            // caller has no way to guess in advance.
            setCachedSeries(
              seriesCacheKey(
                shared ? JSON.stringify(['share', shared.shareHash, shared.passcode ?? null]) : chunk.homeId,
                s.accessoryId, s.characteristicType, from, to, maxPoints,
              ),
              s,
              gen,
            );
          }
          out.push(...series);
          done += chunk.refs.length;
          if (!cancelled) {
            const ready = new Map(cached);
            for (const s of out) ready.set(entryKey(s.accessoryId, s.characteristicType), { main: s });
            setData(ready);
            setProgress(p => ({ ...p, done: Math.min(done, p.total) }));
          }
        }
      };
      await Promise.all(Array.from({ length: Math.min(3, chunks.length) }, worker));
      return out;
    };

    setData(cached);
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
