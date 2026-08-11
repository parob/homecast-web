import { useMemo, useState } from 'react';
import { SlidersHorizontal } from 'lucide-react';
import { measuresIn, SETPOINT_STATE_TYPES, type AccessoryInfoEntry, type OrganizedCategory } from '@/history/categories';
import { canonicalHistoryType } from '@/history/keys';
import { sanitizeSeriesData } from '@/history/sanitize';
import { stateValueLabel } from '@/history/labels';
import { formatStateDuration, stateTotals } from '@/history/stateSummary';
import { PLOT_LEFT, PLOT_RIGHT } from './chartGeometry';
import StateTimeline from '@/components/widgets/StateTimeline';
import AnalyticsPanel from './AnalyticsPanel';
import ChartLegend from './ChartLegend';
import EChartsTimeChart from './EChartsTimeChart';
import { seriesColor, type ChartSeries } from './chartColors';
import { buildSels, labelWithoutRoom } from './selBuilder';
import { useMultiSeriesHistory } from './useMultiSeriesHistory';
import { Button } from '@/components/ui/button';
import type { ExplorerView, SeriesSel } from './types';
import type { HistorySeriesRefInput } from '@/lib/graphql/types';

const RANGES = [
  { label: '6h', ms: 6 * 3_600_000 },
  { label: '24h', ms: 24 * 3_600_000 },
  { label: '7d', ms: 7 * 86_400_000 },
  { label: '30d', ms: 30 * 86_400_000 },
  { label: '1y', ms: 365 * 86_400_000 },
] as const;

const PER_MEASURE_CAP = 10;

/**
 * A room's whole climate story on ONE time axis: a stacked panel per
 * measure (Temperature, then Humidity, then whatever else the room
 * records) with crosshairs linked across them — hover anywhere and every
 * panel shows the same instant — plus the room's state strips below. One
 * shared range control, one zoom, one fetch. This is the drill-down the
 * user chose over measure tabs: everything about the room, aligned.
 */
export default function RoomStackView({
  homeId,
  mock,
  category,
  room,
  accessoryInfo,
  onCustomize,
}: {
  homeId: string | null;
  mock: boolean;
  category: OrganizedCategory;
  room: string;
  accessoryInfo: Map<string, AccessoryInfoEntry>;
  onCustomize: (view: ExplorerView) => void;
}) {
  const [rangeMs, setRangeMs] = useState<number>(24 * 3_600_000);
  const [hideUnusual, setHideUnusual] = useState(true);
  // Shared across the stacked panels: pointing at "Underfloor Heating" in the
  // Temperature legend picks it out of the Humidity panel too, which is the
  // whole reason these panels are stacked.
  const [highlightKeys, setHighlightKeys] = useState<string[] | null>(null);

  const toTs = useMemo(() => Date.now(), [room, rangeMs]); // eslint-disable-line react-hooks/exhaustive-deps
  const fromTs = toTs - rangeMs;

  const roomKey = room === 'Elsewhere' ? null : room;
  const roomSeries = useMemo(
    () => category.series.filter(s =>
      (accessoryInfo.get(s.accessoryId.toUpperCase())?.room ?? null) === roomKey),
    [category.series, accessoryInfo, roomKey],
  );

  // One panel per measure present in this room, importance-ordered.
  const measures = useMemo(() => measuresIn(roomSeries), [roomSeries]);
  const panels = useMemo(() => measures.map(measure => {
    const typeSet = new Set(measure.types);
    const infos = roomSeries.filter(s => s.kind === 'numeric' && typeSet.has(canonicalHistoryType(s.characteristicType)));
    return { measure, sels: buildSels(infos.slice(0, PER_MEASURE_CAP), accessoryInfo), total: infos.length };
  }).filter(p => p.sels.length > 0), [measures, roomSeries, accessoryInfo]);

  const stripSels = useMemo(() => {
    const infos = roomSeries.filter(s =>
      s.kind !== 'numeric' && !SETPOINT_STATE_TYPES.has(canonicalHistoryType(s.characteristicType)));
    return buildSels(infos.slice(0, 8), accessoryInfo);
  }, [roomSeries, accessoryInfo]);

  const allSels = useMemo(
    () => [...panels.flatMap(p => p.sels), ...stripSels],
    [panels, stripSels],
  );
  const refs = useMemo<HistorySeriesRefInput[]>(
    () => allSels.map(s => ({ accessoryId: s.accessoryId, characteristicType: s.characteristicType })),
    [allSels],
  );
  const { data } = useMultiSeriesHistory(homeId, refs, fromTs, toTs, 0, mock, {
    enabled: refs.length > 0,
  });

  const entryFor = (sel: SeriesSel) => {
    const entry = data.get(`${sel.accessoryId.toUpperCase()}|${canonicalHistoryType(sel.characteristicType)}`);
    if (!entry) return undefined;
    return hideUnusual ? sanitizeSeriesData(entry.main).data : entry.main;
  };

  const groupId = `room-stack-${roomKey ?? 'elsewhere'}`;
  const chartPanels = panels.map((panel, panelIndex) => {
    const chartSeries: ChartSeries[] = panel.sels.flatMap(sel => {
      const main = entryFor(sel);
      return main ? [{
        key: `${sel.accessoryId}|${sel.characteristicType}`,
        label: sel.label,
        unit: sel.unit,
        data: main,
      }] : [];
    });
    if (chartSeries.length === 0) return null;

    let min = Infinity;
    let max = -Infinity;
    let sum = 0;
    let n = 0;
    for (const s of chartSeries) {
      for (const p of s.data.points) {
        min = Math.min(min, p.min);
        max = Math.max(max, p.max);
        sum += p.avg;
        n++;
      }
    }
    const unit = panel.measure.unit ?? '';
    const resolution = chartSeries[0].data.resolution;
    const isLastChart = panelIndex === panels.length - 1;

    return (
      <AnalyticsPanel
        key={panel.measure.id}
        title={panel.measure.title}
        source={`${chartSeries.length} sensor${chartSeries.length === 1 ? '' : 's'} · ${resolution === 'raw' ? 'raw readings' : `${resolution} averages`}${panel.total > panel.sels.length ? ` · ${panel.total - panel.sels.length} not shown` : ''}`}
        caption={n > 0 ? `min ${min.toFixed(1)}${unit} · avg ${(sum / n).toFixed(1)}${unit} · max ${max.toFixed(1)}${unit}` : undefined}
      >
        <EChartsTimeChart
          series={chartSeries}
          fromTs={fromTs}
          toTs={toTs}
          normalize={false}
          height={panels.length > 1 ? 200 : 280}
          groupId={groupId}
          hideSlider={!isLastChart}
          highlightKeys={highlightKeys}
          onSeriesHover={(key) => setHighlightKeys(key ? [key] : null)}
        />
        <ChartLegend
          entries={chartSeries.map((s, i) => ({
            key: s.key, label: s.label, color: seriesColor(i),
            group: panel.sels.find(sel => `${sel.accessoryId}|${sel.characteristicType}` === s.key)?.accessoryName,
            shortLabel: panel.sels.find(sel => `${sel.accessoryId}|${sel.characteristicType}` === s.key)?.charLabel,
          }))}
          highlightKeys={highlightKeys}
          onHighlight={setHighlightKeys}
        />
      </AnalyticsPanel>
    );
  });

  const strips = stripSels.flatMap(sel => {
    const main = entryFor(sel);
    if (!main) return [];
    const type = canonicalHistoryType(sel.characteristicType);
    const { totals, transitions } = stateTotals(main, fromTs, toTs);
    const labelForKey = (key: string) => {
      const parsed = Number(key);
      return Number.isFinite(parsed) && key.trim() !== '' ? stateValueLabel(type, parsed) : key;
    };
    return [(
      <div key={`${sel.accessoryId}|${sel.characteristicType}`} className="space-y-1">
        {/* This whole view is one room — the heading already said which. */}
        <p className="text-[11px] text-muted-foreground">{labelWithoutRoom(sel)}</p>
        <StateTimeline
          fromTs={fromTs}
          toTs={toTs}
          padLeft={PLOT_LEFT}
          padRight={PLOT_RIGHT}
          prevValue={main.prevValue}
          prevValueText={main.prevValueText}
          states={main.states}
          stateBuckets={main.stateBuckets}
          labelFor={(v, text) => text ?? stateValueLabel(type, v)}
        />
        {totals.length > 0 && (
          <p className="text-[10px] text-muted-foreground">
            {totals.slice(0, 3).map(([key, ms]) => `${labelForKey(key)} ${formatStateDuration(ms)}`).join(' · ')}
            {transitions > 0 && ` · ${transitions} change${transitions === 1 ? '' : 's'}`}
          </p>
        )}
      </div>
    )];
  });

  return (
    <div className="space-y-3">
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
        <label
          className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer"
          title="Drop implausible readings (radio-fault sentinels)"
        >
          <input
            type="checkbox"
            checked={hideUnusual}
            onChange={(e) => setHideUnusual(e.target.checked)}
            className="accent-current"
          />
          Hide unusual data
        </label>
        <Button
          variant="outline"
          size="sm"
          className="h-7 text-xs"
          onClick={() => onCustomize({ title: 'Custom view', series: allSels, aggregate: false })}
        >
          <SlidersHorizontal className="h-3 w-3 mr-1" /> Customize
        </Button>
      </div>

      {chartPanels.length === 0 && strips.length === 0 ? (
        <div className="py-12 text-center">
          <p className="text-sm text-muted-foreground">
            Nothing recorded here yet — charts build as accessories report changes.
          </p>
        </div>
      ) : (
        <>
          {chartPanels}
          {strips.length > 0 && (
            <AnalyticsPanel title="Activity & states" source={`${strips.length} timeline${strips.length === 1 ? '' : 's'}`}>
              <div className="space-y-2">{strips}</div>
            </AnalyticsPanel>
          )}
        </>
      )}
    </div>
  );
}
