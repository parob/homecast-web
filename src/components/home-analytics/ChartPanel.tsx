import { useMemo, useState } from 'react';
import { AlertTriangle, Loader2 } from 'lucide-react';
import { aggregateNumericSeries, aggregateToSeries, type AggregatePoint } from '@/history/aggregate';
import { findOutlierSeries, sanitizeSeriesData } from '@/history/sanitize';
import { canonicalHistoryType } from '@/history/keys';
import { compareSeries } from '@/history/comparison';
import { accessoryDisplayNames } from './selBuilder';
import ExplorerChart, { seriesColor, type ChartSeries } from './ExplorerChart';
import ChartLegend from './ChartLegend';
import ComparisonSummary from './ComparisonSummary';
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
  // `name` reads inside a sentence ("warmer than yesterday"); `label` is the
  // control's own wording.
  { value: 'none', label: 'No comparison', offsetMs: 0, name: '' },
  { value: 'day', label: 'Previous day', offsetMs: 86_400_000, name: 'yesterday' },
  { value: 'week', label: 'Previous week', offsetMs: 7 * 86_400_000, name: 'last week' },
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
  /**
   * Makes the key the view's series editor (Custom view). Without it the key
   * is read-only, which is right for views whose series are chosen for you.
   */
  onRemoveSeries?: (accessoryId: string, characteristicType: string) => void;
  /** "Add series" control, rendered at the end of the key. */
  legendAddSlot?: React.ReactNode;
}

export default function ChartPanel({
  homeId, mock, series, aggregate = false, groupStripsByRoom = false, extraControls, truncatedNote,
  roomAggregate = false, stripsMaxPerRoom, onRemoveSeries, legendAddSlot,
}: ChartPanelProps) {
  const [rangeMs, setRangeMs] = useState<number>(24 * 3_600_000);
  const [normalize, setNormalize] = useState(false);
  // Which series the pointer is on, wherever the pointer is: legend name,
  // cluster name, or the line itself. One piece of state, both directions.
  const [highlightKeys, setHighlightKeys] = useState<string[] | null>(null);
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

  // Cleaned per-sensor data + what the cleanup did (for the notice).
  const { cleaned, droppedReadings, hiddenSensors } = useMemo(() => {
    const numericSels = series.filter(s => s.kind === 'numeric');
    const map = new Map<string, { sel: SeriesSel; main: HistorySeriesData; ghost?: HistorySeriesData }>();
    let dropped = 0;
    for (const s of numericSels) {
      const key = `${s.accessoryId.toUpperCase()}|${canonicalHistoryType(s.characteristicType)}`;
      const entry = seriesData.get(key);
      if (!entry) continue;
      // Always cleaned: a -40° radio fault or a pegged sensor is not a
      // reading, and nobody ever wanted the version with it in. What the
      // cleanup DID is still announced below.
      const main = sanitizeSeriesData(entry.main);
      const ghost = entry.ghost ? sanitizeSeriesData(entry.ghost) : undefined;
      dropped += main.droppedPoints + (ghost?.droppedPoints ?? 0);
      map.set(key, { sel: s, main: main.data, ghost: ghost?.data });
    }
    // Series rule: sensors whose average sits far outside the home's
    // typical band leave the AGGREGATE picture (named below, reversible).
    let hidden: Array<{ key: string; label: string; mean: number }> = [];
    if (roomAggregate) {
      const inputs = [...map.entries()].flatMap(([key, { sel, main }]) => {
        if (main.points.length === 0) return [];
        const mean = main.points.reduce((a, p) => a + p.avg, 0) / main.points.length;
        return [{ key, label: sel.label, characteristicType: sel.characteristicType, mean }];
      });
      const verdict = findOutlierSeries(inputs);
      hidden = verdict.hidden;
      for (const key of verdict.hiddenKeys) map.delete(key);
    }
    return { cleaned: map, droppedReadings: dropped, hiddenSensors: hidden };
  }, [series, seriesData, roomAggregate]);

  const numericSeries = useMemo<ChartSeries[]>(() => {
    if (!roomAggregate) {
      return [...cleaned.entries()].map(([key, { sel, main, ghost }]): ChartSeries => (
        { key, label: sel.label, unit: sel.unit, data: main, ghost }
      ));
    }
    // Rooms-first: every room's sensors become one time-weighted average
    // line. Sensor-level lines live one tap away in the room drill-down.
    const first = [...cleaned.values()][0];
    const unit = first?.sel.unit ?? null;
    const byRoom = new Map<string, { mains: HistorySeriesData[]; ghosts: HistorySeriesData[] }>();
    for (const { sel, main, ghost } of cleaned.values()) {
      const room = sel.room ?? 'Elsewhere';
      const bucket = byRoom.get(room) ?? { mains: [], ghosts: [] };
      bucket.mains.push(main);
      if (ghost) bucket.ghosts.push(ghost);
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
  }, [cleaned, roomAggregate, fromTs, toTs]);

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
    const sel = cleaned.get(s.key)?.sel;
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
  }), [numericSeries, cleaned]);

  const compareOption = COMPARE_OPTIONS.find(c => c.value === compare) ?? COMPARE_OPTIONS[0];
  const compareRows = useMemo(
    () => (compare === 'none' ? [] : compareSeries(numericSeries, seriesColor)),
    [compare, numericSeries],
  );

  // Cluster by accessory IDENTITY and name it distinctly within this view:
  // six rooms' worth of "Underfloor Heating" are six accessories, and keying
  // on the room-stripped name merged them into one box of identical chips.
  const displayNames = useMemo(
    () => accessoryDisplayNames([...cleaned.values()].map(c => c.sel)),
    [cleaned],
  );
  const legendEntries = useMemo(() => numericSeries.map((s, i) => {
    const sel = cleaned.get(s.key)?.sel;
    return {
      key: s.key,
      label: sel?.fullLabel ?? s.label,
      color: seriesColor(i),
      groupKey: sel?.accessoryId.toUpperCase(),
      group: sel ? displayNames.get(sel.accessoryId.toUpperCase()) : undefined,
      shortLabel: sel?.charLabel,
    };
  }), [numericSeries, cleaned, displayNames]);

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

      {hiddenSensors.length > 0 && (
        <p className="text-[11px] text-muted-foreground -mt-2">
          {`${hiddenSensors.length} unusual sensor${hiddenSensors.length === 1 ? '' : 's'} left out of averages: ${
            hiddenSensors.slice(0, 3).map(h => `${h.label} (${h.mean.toFixed(1)})`).join(', ')
          }${hiddenSensors.length > 3 ? '…' : ''}`}
          {' — add it back from Add series'}
        </p>
      )}

      {error ? (
        <ErrorBanner message={`Couldn't load history: ${error}`} onRetry={retry} />
      ) : loading && numericSeries.length === 0 && stateSeries.length === 0 ? (
        <div className="py-16 flex justify-center text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" />
        </div>
      ) : (
        <>
          {compare !== 'none' && compareRows.length > 0 && (
            <ComparisonSummary
              rows={compareRows}
              fromTs={fromTs}
              toTs={toTs}
              now={toTs}
              offsetMs={compareOffsetMs}
              comparisonName={compareOption.name}
            />
          )}

          {numericSeries.length > 0 && (
            <div className="border rounded-lg p-3">
              {band && (
                <p className="text-[11px] text-muted-foreground mb-1">
                  {roomAggregate
                    ? 'Bold line = Home Average · shaded = min–max across rooms · thin lines = room averages'
                    : 'Bold line = average across sensors · shaded = min–max range · thin lines = individual sensors'}
                </p>
              )}
              <ExplorerChart
                series={numericSeries}
                band={band}
                bandLabel={roomAggregate ? 'Home Average' : 'Average'}
                fromTs={fromTs}
                toTs={toTs}
                normalize={normalize}
                highlightKeys={highlightKeys}
                onSeriesHover={(key) => setHighlightKeys(key ? [key] : null)}
              />
              <ChartLegend
                entries={legendEntries}
                highlightKeys={highlightKeys}
                onHighlight={setHighlightKeys}
                // The dashed lines were never named anywhere; a reader had to
                // infer them from the control at the top of the page.
                dashedNote={compare === 'none' ? undefined : compareOption.label.toLowerCase()}
                onRemove={onRemoveSeries
                  ? (key) => {
                      const sel = cleaned.get(key)?.sel;
                      if (sel) onRemoveSeries(sel.accessoryId, sel.characteristicType);
                    }
                  : undefined}
                addSlot={legendAddSlot}
              />
            </div>
          )}

          <StateStrips
            entries={stateSeries}
            fromTs={fromTs}
            toTs={toTs}
            onRemove={onRemoveSeries}
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
