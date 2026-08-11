import { useMemo, useState } from 'react';
import { SlidersHorizontal } from 'lucide-react';
import { isSetpointType, measuresIn, MEASURE_COMPLEMENTS, SETPOINT_STATE_TYPES, type AccessoryInfoEntry } from '@/history/categories';
import { canonicalHistoryType } from '@/history/keys';
import { sanitizeSeriesData } from '@/history/sanitize';
import { stateValueLabel } from '@/history/labels';
import { formatStateDuration, stateTotals } from '@/history/stateSummary';
import { lightingSeries, lightingSummary, smoothCounts, smoothIntensity, type LightingInput } from '@/history/lighting';
import { PLOT_LEFT, PLOT_RIGHT } from './chartGeometry';
import StateTimeline from '@/components/widgets/StateTimeline';
import ActivityStrips, { type ActivityEntry, type ActivityGroup } from './ActivityStrips';
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
  groups,
  settings,
  onCustomize,
}: {
  homeId: string | null;
  mock: boolean;
  /** Every recorded series in this room, across all categories. */
  roomSeries: HistorySeriesInfo[];
  room: string | null;
  accessoryInfo: Map<string, AccessoryInfoEntry>;
  /** Service groups, so a room's lights read as one row rather than nine. */
  groups: ActivityGroup[];
  settings: AnalyticsSettings;
  onCustomize: (view: ExplorerView) => void;
}) {
  const { rangeMs, hideUnusual } = settings;
  // Setpoints off by default: they are flat lines that never move, and drawn
  // as peers they turned a three-sensor Temperature panel into seven
  // competing colours. One tick puts the intent back beside the reading.
  // Which complementary measures each panel is currently borrowing. Off by
  // default everywhere: the panel is about its own measure.
  const [complements, setComplements] = useState<Record<string, Set<string>>>({});
  const toggleComplement = (measureId: string, complementId: string) => setComplements(prev => {
    const next = new Set(prev[measureId] ?? []);
    if (next.has(complementId)) next.delete(complementId); else next.add(complementId);
    return { ...prev, [measureId]: next };
  });
  const isOn = (measureId: string, complementId: string) => !!complements[measureId]?.has(complementId);
  // The swelling stroke is the point of the lighting line, so it is on by
  // default — but a room where every bulb sits at full has nothing to say
  // with it, and a plain line is easier to read a count off.
  const [showIntensity, setShowIntensity] = useState(true);
  // Shared across the stacked panels: pointing at "Underfloor Heating" in the
  // Temperature legend picks it out of the Humidity panel too, which is the
  // whole reason these panels are stacked.
  const [highlightKeys, setHighlightKeys] = useState<string[] | null>(null);

  const toTs = useMemo(() => Date.now(), [room, rangeMs]); // eslint-disable-line react-hooks/exhaustive-deps
  const fromTs = toTs - rangeMs;

  const roomKey = room;

  // Lights are their own question: see lighting.ts. Brightness leaves the
  // measure panels entirely — it was ten flat lines at 100%.
  const lightSels = useMemo(
    () => buildSels(roomSeries.filter(s => canonicalHistoryType(s.characteristicType) === 'brightness'), accessoryInfo),
    [roomSeries, accessoryInfo],
  );
  const powerSels = useMemo(
    () => buildSels(roomSeries.filter(s => canonicalHistoryType(s.characteristicType) === 'power_state'), accessoryInfo),
    [roomSeries, accessoryInfo],
  );

  // One panel per measure present in this room, importance-ordered.
  const measures = useMemo(() => measuresIn(roomSeries), [roomSeries]);
  const panels = useMemo(() => measures.map(measure => {
    const typeSet = new Set(measure.types);
    if (measure.id === 'brightness') return { measure, sels: [], targetSels: [], total: 0 };
    const infos = roomSeries.filter(s => s.kind === 'numeric' && typeSet.has(canonicalHistoryType(s.characteristicType)));
    const readings = infos.filter(s => !isSetpointType(canonicalHistoryType(s.characteristicType)));
    // Anything this panel can OFFER to borrow, and only what the room
    // actually records — a tick for data that isn't there is a dead control.
    const offers = (MEASURE_COMPLEMENTS[measure.id] ?? []).flatMap(complement => {
      const types = new Set(complement.types);
      const found = roomSeries.filter(s =>
        s.kind === 'numeric' && types.has(canonicalHistoryType(s.characteristicType)));
      return found.length > 0
        ? [{ complement, sels: buildSels(found, accessoryInfo) }]
        : [];
    });
    return {
      measure,
      // The cap applies to readings; borrowed series ride along rather than
      // competing for one of the slots.
      sels: buildSels(readings.slice(0, PER_MEASURE_CAP), accessoryInfo),
      offers,
      total: readings.length,
    };
  }).filter(p => p.sels.length > 0), [measures, roomSeries, accessoryInfo]);

  const stripSels = useMemo(() => {
    const infos = roomSeries.filter(s =>
      s.kind !== 'numeric' && !SETPOINT_STATE_TYPES.has(canonicalHistoryType(s.characteristicType)));
    // No tight cap here: grouping collapses a room's nine bulbs into one row,
    // so truncating first would hide members from their own group.
    return buildSels(infos.slice(0, 40), accessoryInfo);
  }, [roomSeries, accessoryInfo]);

  // What the lighting line can borrow — lux from the room's own sensors.
  const lightingOffers = useMemo(() => (MEASURE_COMPLEMENTS.lighting ?? []).flatMap(complement => {
    const types = new Set(complement.types);
    const found = roomSeries.filter(s =>
      s.kind === 'numeric' && types.has(canonicalHistoryType(s.characteristicType)));
    return found.length > 0 ? [{ complement, sels: buildSels(found, accessoryInfo) }] : [];
  }), [roomSeries, accessoryInfo]);

  const allSels = useMemo(
    () => [
      ...panels.flatMap(p => [...p.sels, ...p.offers.flatMap(o => o.sels)]),
      ...stripSels, ...lightSels, ...powerSels, ...lightingOffers.flatMap(o => o.sels),
    ],
    [panels, stripSels, lightSels, powerSels, lightingOffers],
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

  // The lighting line: centre = lights on, stroke thickness = how bright
  // they are. Half-width is in axis units (the axis counts lights), so the
  // stroke reads the same whether the room has three bulbs or nine.
  const lighting = useMemo(() => {
    const lights: LightingInput[] = powerSels.flatMap(powerSel => {
      const power = entryFor(powerSel);
      if (!power) return [];
      const brightnessSel = lightSels.find(b =>
        b.accessoryId.toUpperCase() === powerSel.accessoryId.toUpperCase());
      return [{ power, brightness: brightnessSel ? entryFor(brightnessSel) : undefined }];
    });
    if (lights.length === 0 || lightSels.length === 0) return null;
    const raw = lightingSeries(lights, fromTs, toTs, 400);
    if (raw.length === 0) return null;
    // Draw the eased shape, quote the real numbers: the summary below is
    // computed from `raw`, so its peak is a peak that actually happened.
    const points = smoothCounts(smoothIntensity(raw, 6), 6);
    const maxHalf = Math.max(lights.length * 0.075, 0.2);
    // Never vanishes: a stroke of zero width at 0% brightness would read as
    // missing data rather than as "on, but barely".
    const minHalf = maxHalf * 0.16;
    const evenHalf = maxHalf * 0.42; // plain line, when intensity is off
    return {
      count: lights.length,
      summary: lightingSummary(raw, toTs),
      ribbon: {
        label: 'Lights on',
        points: points.map(p => ({
          ts: p.ts,
          value: p.onCount,
          half: showIntensity
            ? minHalf + ((p.litBrightness ?? 0) / 100) * (maxHalf - minHalf)
            : evenHalf,
        })),
      },
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [powerSels, lightSels, data, fromTs, toTs, hideUnusual, showIntensity]);

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
    const borrowed: ChartSeries[] = panel.offers.flatMap(({ complement, sels }) => (
      isOn(panel.measure.id, complement.id)
        ? sels.flatMap(sel => {
          const main = entryFor(sel);
          return main ? [{
            key: `${sel.accessoryId}|${sel.characteristicType}`,
            label: sel.label,
            unit: sel.unit,
            data: main,
            // Colour always belongs to the ACCESSORY: this room's underfloor
            // heating is one blue whether you are looking at its temperature,
            // its target or its humidity. Weight says which is which.
            color: colourOf.get(sel.accessoryId.toUpperCase()) ?? seriesColor(panel.sels.length),
            dashed: complement.setpoint,
            secondary: !complement.setpoint,
          }] : [];
        })
        : []
    ));
    const chartSeries = [...readingSeries, ...borrowed];
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
        actions={panel.offers.length > 0 ? (
          <span className="flex items-center gap-2">
            {panel.offers.map(({ complement }) => (
              <label
                key={complement.id}
                className="flex cursor-pointer items-center gap-1 text-[10px] text-muted-foreground"
              >
                <input
                  type="checkbox"
                  checked={isOn(panel.measure.id, complement.id)}
                  onChange={() => toggleComplement(panel.measure.id, complement.id)}
                  className="accent-current"
                />
                {complement.label}
              </label>
            ))}
          </span>
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
            const sel = [...panel.sels, ...panel.offers.flatMap(o => o.sels)]
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

  const stripEntries = useMemo<ActivityEntry[]>(() => stripSels.flatMap(sel => {
    const main = entryFor(sel);
    return main ? [{ sel, data: main }] : [];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [stripSels, data, hideUnusual]);

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

      {chartPanels.length === 0 && stripEntries.length === 0 ? (
        <div className="py-12 text-center">
          <p className="text-sm text-muted-foreground">
            Nothing recorded here yet — charts build as accessories report changes.
          </p>
        </div>
      ) : (
        <>
          {lighting && (
            <AnalyticsPanel
              title="Lighting"
              source={`${lighting.count} light${lighting.count === 1 ? '' : 's'}${showIntensity ? ' · thickness = brightness' : ''}`}
              actions={(
                <span className="flex items-center gap-2">
                  <label className="flex cursor-pointer items-center gap-1 text-[10px] text-muted-foreground">
                    <input
                      type="checkbox"
                      checked={showIntensity}
                      onChange={(e) => setShowIntensity(e.target.checked)}
                      className="accent-current"
                    />
                    Brightness
                  </label>
                  {lightingOffers.map(({ complement }) => (
                    <label
                      key={complement.id}
                      className="flex cursor-pointer items-center gap-1 text-[10px] text-muted-foreground"
                    >
                      <input
                        type="checkbox"
                        checked={isOn('lighting', complement.id)}
                        onChange={() => toggleComplement('lighting', complement.id)}
                        className="accent-current"
                      />
                      {complement.label}
                    </label>
                  ))}
                </span>
              )}
              caption={lighting.summary.onMs > 0
                ? `lit ${formatStateDuration(lighting.summary.onMs)} · peak ${lighting.summary.peak} of ${lighting.count}${
                    lighting.summary.meanLit !== null ? ` · averaging ${Math.round(lighting.summary.meanLit)}%` : ''}`
                : 'nothing on in this range'}
            >
              <EChartsTimeChart
                series={lightingOffers.flatMap(({ complement, sels }) => (
                  isOn('lighting', complement.id)
                    ? sels.flatMap(sel => {
                      const main = entryFor(sel);
                      return main ? [{
                        key: `${sel.accessoryId}|${sel.characteristicType}`,
                        label: sel.label,
                        unit: sel.unit,
                        data: main,
                        secondary: true,
                      }] : [];
                    })
                    : []
                ))}
                ribbon={lighting.ribbon}
                // Whole lights only, and the axis always spans the room's
                // full set so two rooms can be compared by eye.
                axis={{ min: 0, max: lighting.count, minInterval: 1 }}
                fromTs={fromTs}
                toTs={toTs}
                normalize={false}
                height={180}
                groupId={groupId}
                hideSlider
              />
            </AnalyticsPanel>
          )}
          {chartPanels}
          {stripEntries.length > 0 && (
            <AnalyticsPanel
              title="Activity & states"
              source={`${stripEntries.length} timeline${stripEntries.length === 1 ? '' : 's'}`}
            >
              <ActivityStrips
                entries={stripEntries}
                groups={groups}
                fromTs={fromTs}
                toTs={toTs}
              />
            </AnalyticsPanel>
          )}
        </>
      )}
    </div>
  );
}
