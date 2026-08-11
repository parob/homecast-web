import { useMemo, useState } from 'react';
import { SlidersHorizontal } from 'lucide-react';
import { isSetpointType, measuresIn, SETPOINT_STATE_TYPES, type AccessoryInfoEntry } from '@/history/categories';
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
import type { AnalyticsSettings } from './scope';
import type { ExplorerView, SeriesSel } from './types';
import type { HistorySeriesInfo, HistorySeriesRefInput } from '@/lib/graphql/types';

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
  roomSeries,
  room,
  accessoryInfo,
  settings,
  onCustomize,
}: {
  homeId: string | null;
  mock: boolean;
  /** Every recorded series in this room, across all categories. */
  roomSeries: HistorySeriesInfo[];
  room: string | null;
  accessoryInfo: Map<string, AccessoryInfoEntry>;
  settings: AnalyticsSettings;
  onCustomize: (view: ExplorerView) => void;
}) {
  const { rangeMs, hideUnusual } = settings;
  // Setpoints off by default: they are flat lines that never move, and drawn
  // as peers they turned a three-sensor Temperature panel into seven
  // competing colours. One tick puts the intent back beside the reading.
  const [showTargets, setShowTargets] = useState(false);
  // Shared across the stacked panels: pointing at "Underfloor Heating" in the
  // Temperature legend picks it out of the Humidity panel too, which is the
  // whole reason these panels are stacked.
  const [highlightKeys, setHighlightKeys] = useState<string[] | null>(null);

  const toTs = useMemo(() => Date.now(), [room, rangeMs]); // eslint-disable-line react-hooks/exhaustive-deps
  const fromTs = toTs - rangeMs;

  const roomKey = room;

  // One panel per measure present in this room, importance-ordered.
  const measures = useMemo(() => measuresIn(roomSeries), [roomSeries]);
  const panels = useMemo(() => measures.map(measure => {
    const typeSet = new Set(measure.types);
    const infos = roomSeries.filter(s => s.kind === 'numeric' && typeSet.has(canonicalHistoryType(s.characteristicType)));
    const readings = infos.filter(s => !isSetpointType(canonicalHistoryType(s.characteristicType)));
    const targets = infos.filter(s => isSetpointType(canonicalHistoryType(s.characteristicType)));
    return {
      measure,
      // The cap applies to readings; a target rides along with its accessory
      // rather than competing for one of the slots.
      sels: buildSels(readings.slice(0, PER_MEASURE_CAP), accessoryInfo),
      targetSels: buildSels(targets, accessoryInfo),
      total: readings.length,
    };
  }).filter(p => p.sels.length > 0 || p.targetSels.length > 0), [measures, roomSeries, accessoryInfo]);

  const stripSels = useMemo(() => {
    const infos = roomSeries.filter(s =>
      s.kind !== 'numeric' && !SETPOINT_STATE_TYPES.has(canonicalHistoryType(s.characteristicType)));
    return buildSels(infos.slice(0, 8), accessoryInfo);
  }, [roomSeries, accessoryInfo]);

  const allSels = useMemo(
    () => [...panels.flatMap(p => [...p.sels, ...p.targetSels]), ...stripSels],
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
    // Colour belongs to the ACCESSORY, so its target inherits the colour of
    // its own reading and reads as the same device's intention.
    const colourOf = new Map<string, string>();
    panel.sels.forEach((sel, i) => colourOf.set(sel.accessoryId.toUpperCase(), seriesColor(i)));

    const readingSeries: ChartSeries[] = panel.sels.flatMap((sel, i) => {
      const main = entryFor(sel);
      return main ? [{
        key: `${sel.accessoryId}|${sel.characteristicType}`,
        label: sel.label,
        unit: sel.unit,
        data: main,
        color: seriesColor(i),
      }] : [];
    });
    const targetSeries: ChartSeries[] = showTargets ? panel.targetSels.flatMap(sel => {
      const main = entryFor(sel);
      return main ? [{
        key: `${sel.accessoryId}|${sel.characteristicType}`,
        label: sel.label,
        unit: sel.unit,
        data: main,
        // An accessory with a target but no reading in this panel still needs
        // a colour; fall back to the palette by its position.
        color: colourOf.get(sel.accessoryId.toUpperCase()) ?? seriesColor(panel.sels.length),
        dashed: true,
      }] : [];
    }) : [];
    const chartSeries = [...readingSeries, ...targetSeries];
    if (chartSeries.length === 0) return null;

    let min = Infinity;
    let max = -Infinity;
    let sum = 0;
    let n = 0;
    for (const s of readingSeries) {
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
        source={`${readingSeries.length} sensor${readingSeries.length === 1 ? '' : 's'} · ${resolution === 'raw' ? 'raw readings' : `${resolution} averages`}${panel.total > panel.sels.length ? ` · ${panel.total - panel.sels.length} not shown` : ''}`}
        actions={panel.targetSels.length > 0 ? (
          <label className="flex cursor-pointer items-center gap-1 text-[10px] text-muted-foreground">
            <input
              type="checkbox"
              checked={showTargets}
              onChange={(e) => setShowTargets(e.target.checked)}
              className="accent-current"
            />
            Targets
          </label>
        ) : undefined}
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
          entries={chartSeries.map(s => {
            const sel = [...panel.sels, ...panel.targetSels]
              .find(x => `${x.accessoryId}|${x.characteristicType}` === s.key);
            return {
              key: s.key,
              label: s.label,
              color: s.color ?? seriesColor(0),
              dashed: s.dashed,
              groupKey: sel?.accessoryId.toUpperCase(),
              group: sel?.accessoryName,
              shortLabel: sel?.charLabel,
            };
          })}
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
      <div className="flex flex-wrap items-center justify-end gap-2">
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
