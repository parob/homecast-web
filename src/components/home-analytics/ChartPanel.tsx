import { useMemo, useState } from 'react';
import { AlertTriangle, Loader2 } from 'lucide-react';
import { aggregateNumericSeries, aggregateToSeries, type AggregatePoint } from '@/history/aggregate';
import { canonicalHistoryType } from '@/history/keys';
import ExplorerChart, { seriesColor, type ChartSeries } from './ExplorerChart';
import ChartLegend from './ChartLegend';
import StateStrips, { type StateStripEntry } from './StateStrips';
import { useMultiSeriesHistory } from './useMultiSeriesHistory';
import { Button } from '@/components/ui/button';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import type { SeriesSel } from './types';
import type { HistorySeriesData } from '@/lib/graphql/types';
import type { HistorySeriesRefInput } from '@/lib/graphql/types';

/**
 * The chart body every Analytics view shares: range segmented control,
 * compare/normalize, the numeric chart with its wrapping legend, state
 * strips, and the stats table. Views differ in how they CHOOSE series;
 * everything below that line lives here once.
 */

const RANGES = [
  { label: '6h', ms: 6 * 3_600_000 },
  { label: '24h', ms: 24 * 3_600_000 },
  { label: '7d', ms: 7 * 86_400_000 },
  { label: '30d', ms: 30 * 86_400_000 },
  { label: '1y', ms: 365 * 86_400_000 },
] as const;

const COMPARE_OPTIONS = [
  { value: 'none', label: 'No comparison', offsetMs: 0 },
  { value: 'day', label: 'Previous day', offsetMs: 86_400_000 },
  { value: 'week', label: 'Previous week', offsetMs: 7 * 86_400_000 },
] as const;

const TEMP_TYPES = new Set(['current_temperature']);

function ErrorBanner({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="border border-destructive/40 bg-destructive/5 rounded-lg p-3 flex items-center justify-between gap-3">
      <p className="text-xs text-destructive flex items-center gap-2 min-w-0">
        <AlertTriangle className="h-4 w-4 shrink-0" />
        <span className="truncate">{message}</span>
      </p>
      <Button variant="outline" size="sm" className="h-7 text-xs shrink-0" onClick={onRetry}>
        Retry
      </Button>
    </div>
  );
}

export interface ChartPanelProps {
  homeId: string | null;
  mock: boolean;
  series: SeriesSel[];
  /** Draw the min–max band + bold average when ≥3 temperature series. */
  aggregate?: boolean;
  /** Gather state strips under room headings (cross-room category views). */
  groupStripsByRoom?: boolean;
  /** Rendered at the right end of the controls row (Customize, Add series). */
  extraControls?: React.ReactNode;
  /** Shown when the caller capped the series list ("Showing 20 of 89 …"). */
  truncatedNote?: string;
  /** Collapse each room's sensors into ONE averaged line (the all-rooms
   *  default) with a home-wide band behind — the core de-noising move. */
  roomAggregate?: boolean;
  /** Cap state strips per room heading (rest behind "show more"). */
  stripsMaxPerRoom?: number;
}

export default function ChartPanel({
  homeId, mock, series, aggregate = false, groupStripsByRoom = false, extraControls, truncatedNote,
  roomAggregate = false, stripsMaxPerRoom,
}: ChartPanelProps) {
  const [rangeMs, setRangeMs] = useState<number>(24 * 3_600_000);
  const [normalize, setNormalize] = useState(false);
  const [compare, setCompare] = useState<'none' | 'day' | 'week'>('none');

  const seriesKey = series.map(s => `${s.accessoryId}|${s.characteristicType}`).join(',');
  const toTs = useMemo(() => Date.now(), [seriesKey, rangeMs]); // eslint-disable-line react-hooks/exhaustive-deps
  const fromTs = toTs - rangeMs;

  const refs = useMemo<HistorySeriesRefInput[]>(
    () => series.map(s => ({ accessoryId: s.accessoryId, characteristicType: s.characteristicType })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [seriesKey],
  );
  const compareOffsetMs = COMPARE_OPTIONS.find(c => c.value === compare)?.offsetMs ?? 0;
  const { data: seriesData, loading, error, retry } = useMultiSeriesHistory(
    homeId, refs, fromTs, toTs, compareOffsetMs, mock,
  );

  const numericSeries = useMemo<ChartSeries[]>(() => {
    const numericSels = series.filter(s => s.kind === 'numeric');
    if (!roomAggregate) {
      return numericSels.flatMap((s): ChartSeries[] => {
        const key = `${s.accessoryId.toUpperCase()}|${canonicalHistoryType(s.characteristicType)}`;
        const entry = seriesData.get(key);
        return entry ? [{ key, label: s.label, unit: s.unit, data: entry.main, ghost: entry.ghost }] : [];
      });
    }
    // Rooms-first: every room's sensors become one time-weighted average
    // line. Sensor-level lines live one tap away in the room drill-down.
    const unit = numericSels[0]?.unit ?? null;
    const byRoom = new Map<string, { mains: HistorySeriesData[]; ghosts: HistorySeriesData[] }>();
    for (const s of numericSels) {
      const key = `${s.accessoryId.toUpperCase()}|${canonicalHistoryType(s.characteristicType)}`;
      const entry = seriesData.get(key);
      if (!entry) continue;
      const room = s.room ?? 'Elsewhere';
      const bucket = byRoom.get(room) ?? { mains: [], ghosts: [] };
      bucket.mains.push(entry.main);
      if (entry.ghost) bucket.ghosts.push(entry.ghost);
      byRoom.set(room, bucket);
    }
    return [...byRoom.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([room, { mains, ghosts }]): ChartSeries => ({
        key: `room:${room}`,
        label: room,
        unit,
        data: aggregateToSeries(
          aggregateNumericSeries(mains, fromTs, toTs),
          { accessoryId: `room:${room}`, characteristicType: 'room_average', unit },
          mains[0]?.resolution ?? 'raw',
        ),
        ghost: ghosts.length > 0
          ? aggregateToSeries(
              aggregateNumericSeries(ghosts, fromTs, toTs),
              { accessoryId: `room:${room}::ghost`, characteristicType: 'room_average', unit },
              ghosts[0]?.resolution ?? 'raw',
            )
          : undefined,
      }));
  }, [series, seriesData, roomAggregate, fromTs, toTs]);

  const stateSeries = useMemo<StateStripEntry[]>(() => series
    .filter(s => s.kind !== 'numeric')
    .flatMap((s): StateStripEntry[] => {
      const key = `${s.accessoryId.toUpperCase()}|${canonicalHistoryType(s.characteristicType)}`;
      const entry = seriesData.get(key);
      return entry ? [{ sel: s, data: entry.main, room: s.room }] : [];
    }), [series, seriesData]);

  const band: AggregatePoint[] | null = useMemo(() => {
    // Rooms-first mode: the band is the HOME envelope behind the room lines
    // (one measure per chart, so every line is band-compatible).
    if (roomAggregate) {
      if (numericSeries.length < 2) return null;
      return aggregateNumericSeries(numericSeries.map(s => s.data), fromTs, toTs);
    }
    if (!aggregate) return null;
    const temps = numericSeries.filter(s => TEMP_TYPES.has(canonicalHistoryType(s.data.characteristicType)));
    if (temps.length < 3) return null;
    return aggregateNumericSeries(temps.map(s => s.data), fromTs, toTs);
  }, [aggregate, roomAggregate, numericSeries, fromTs, toTs]);

  const stats = useMemo(() => numericSeries.map((s, i) => {
    const sel = series.find(x => `${x.accessoryId.toUpperCase()}|${canonicalHistoryType(x.characteristicType)}` === s.key);
    const label = sel?.fullLabel ?? s.label;
    const points = s.data.points;
    if (points.length === 0) return { label, color: seriesColor(i), empty: true as const };
    let min = Infinity;
    let max = -Infinity;
    let sum = 0;
    for (const p of points) {
      min = Math.min(min, p.min);
      max = Math.max(max, p.max);
      sum += p.avg;
    }
    return {
      label, color: seriesColor(i), empty: false as const,
      min, max, avg: sum / points.length,
      now: points[points.length - 1].last,
      unit: s.unit ?? '',
    };
  }), [numericSeries, series]);

  const legendEntries = useMemo(() => numericSeries.map((s, i) => ({
    key: s.key, label: s.label, color: seriesColor(i),
  })), [numericSeries]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex items-center rounded-lg bg-muted p-0.5">
          {RANGES.map(r => (
            <button
              key={r.label}
              onClick={() => setRangeMs(r.ms)}
              className={`text-[11px] px-2.5 py-1 rounded-md transition-colors ${
                rangeMs === r.ms
                  ? 'bg-background text-foreground shadow-sm font-medium'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {r.label}
            </button>
          ))}
        </div>
        <div className="flex-1" />
        <Select value={compare} onValueChange={(v) => setCompare(v as typeof compare)}>
          <SelectTrigger className="w-[150px] h-7 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {COMPARE_OPTIONS.map(c => (
              <SelectItem key={c.value} value={c.value} className="text-xs">{c.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer">
          <input
            type="checkbox"
            checked={normalize}
            onChange={(e) => setNormalize(e.target.checked)}
            className="accent-current"
          />
          Normalize
        </label>
        {extraControls}
      </div>

      {truncatedNote && (
        <p className="text-[11px] text-muted-foreground -mt-2">{truncatedNote}</p>
      )}

      {error ? (
        <ErrorBanner message={`Couldn't load history: ${error}`} onRetry={retry} />
      ) : loading && numericSeries.length === 0 && stateSeries.length === 0 ? (
        <div className="py-16 flex justify-center text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" />
        </div>
      ) : (
        <>
          {numericSeries.length > 0 && (
            <div className="border rounded-lg p-3">
              {band && (
                <p className="text-[11px] text-muted-foreground mb-1">
                  {roomAggregate
                    ? 'Bold line = home average · shaded = min–max across rooms · thin lines = room averages'
                    : 'Bold line = average across sensors · shaded = min–max range · thin lines = individual sensors'}
                </p>
              )}
              <ExplorerChart
                series={numericSeries}
                band={band}
                bandLabel={roomAggregate ? 'home average' : 'average'}
                fromTs={fromTs}
                toTs={toTs}
                normalize={normalize}
              />
              <ChartLegend entries={legendEntries} />
            </div>
          )}

          <StateStrips
            entries={stateSeries}
            fromTs={fromTs}
            toTs={toTs}
            groupByRoom={groupStripsByRoom}
            maxPerRoom={stripsMaxPerRoom}
          />

          {stats.length > 0 && (
            <div className="border rounded-lg overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-muted-foreground border-b">
                    <th className="text-left font-medium px-3 py-2">Series</th>
                    <th className="text-right font-medium px-3 py-2">Min</th>
                    <th className="text-right font-medium px-3 py-2">Avg</th>
                    <th className="text-right font-medium px-3 py-2">Max</th>
                    <th className="text-right font-medium px-3 py-2">Now</th>
                  </tr>
                </thead>
                <tbody>
                  {stats.map(s => (
                    <tr key={s.label} className="border-b last:border-b-0">
                      <td className="px-3 py-1.5">
                        <span className="inline-flex items-center gap-1.5">
                          <span className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: s.color }} />
                          {s.label}
                        </span>
                      </td>
                      {s.empty ? (
                        <td colSpan={4} className="px-3 py-1.5 text-right text-muted-foreground">no data in range</td>
                      ) : (
                        <>
                          <td className="text-right px-3 py-1.5 tabular-nums">{s.min.toFixed(1)}{s.unit}</td>
                          <td className="text-right px-3 py-1.5 tabular-nums">{s.avg.toFixed(1)}{s.unit}</td>
                          <td className="text-right px-3 py-1.5 tabular-nums">{s.max.toFixed(1)}{s.unit}</td>
                          <td className="text-right px-3 py-1.5 tabular-nums font-medium">{s.now.toFixed(1)}{s.unit}</td>
                        </>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}
