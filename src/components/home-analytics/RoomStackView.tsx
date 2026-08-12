import { useCallback, useMemo, useState } from 'react';
import { isSetpointType, measuresIn, MEASURE_COMPLEMENTS, SETPOINT_STATE_TYPES, type AccessoryInfoEntry } from '@/history/categories';
import { canonicalHistoryType } from '@/history/keys';
import { sanitizeSeriesData } from '@/history/sanitize';
import { stateValueLabel } from '@/history/labels';
import { formatStateDuration, stateTotals } from '@/history/stateSummary';
import {
  lightingBrightnessSeries, lightingCountSeries, lightingSeries, lightingSummary, type LightingInput,
} from '@/history/lighting';
import { PLOT_LEFT, PLOT_RIGHT } from './chartGeometry';
import StateTimeline from '@/components/widgets/StateTimeline';
import ActivityStrips, { type ActivityEntry, type ActivityGroup } from './ActivityStrips';
import AnalyticsPanel from './AnalyticsPanel';
import ChartSkeleton from './ChartSkeleton';
import ChartLegend from './ChartLegend';
import EChartsTimeChart from './EChartsTimeChart';
import { seriesColor, type ChartSeries } from './chartColors';
import { aggregateNumericSeries, aggregateToSeries } from '@/history/aggregate';
import { buildSels, labelWithoutRoom } from './selBuilder';
import { useMultiSeriesHistory } from './useMultiSeriesHistory';
import type { AnalyticsSettings } from './scope';
import type { SeriesSel } from './types';
import type { HistorySeriesData, HistorySeriesInfo, HistorySeriesRefInput } from '@/lib/graphql/types';

const PER_MEASURE_CAP = 10;

/**
 * A panel's "also draw…" switch — Targets, Humidity, Brightness, Lux.
 *
 * A bare 10px checkbox in a header row reads as chrome, and these controls
 * are the only route to data the panel is deliberately holding back. A chip
 * that fills when it is on carries its state at a glance and gives the label
 * a hit target, which the checkbox's own 10px square did not.
 */
function ComplementToggle({ label, on, onToggle }: {
  label: string;
  on: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={onToggle}
      className={`rounded-full border px-2 py-0.5 text-[0.625rem] leading-4 transition-colors ${
        on
          ? 'border-foreground/30 bg-foreground/10 text-foreground'
          : 'border-border text-muted-foreground hover:border-foreground/30 hover:text-foreground'
      }`}
    >
      {label}
    </button>
  );
}

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
  byRoom = false,
  accessoryInfo,
  groups,
  settings,
}: {
  homeId: string | null;
  mock: boolean;
  /** Every recorded series in scope, across all categories. */
  roomSeries: HistorySeriesInfo[];
  room: string | null;
  /**
   * Whole-home scope: collapse each room's sensors into ONE line per room,
   * so the home reads as nine rooms rather than ninety sensors. The panels,
   * the toggles and the strips are otherwise identical — a home is just a
   * bigger room.
   */
  byRoom?: boolean;
  accessoryInfo: Map<string, AccessoryInfoEntry>;
  /** Service groups, so a room's lights read as one row rather than nine. */
  groups: ActivityGroup[];
  settings: AnalyticsSettings;
}) {
  const { rangeMs } = settings;
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
  // Brightness is a complement like any other: the lighting chart is about
  // how many lights are on, and how bright they were is a second question.
  const [showBrightness, setShowBrightness] = useState(false);
  // Highlighting is by THING, not by series: pointing at Underfloor Heating's
  // temperature must also pick out its humidity in the panel below, and those
  // are different series. Identity is the accessory — or the room, when the
  // whole view is per-room averages.
  const [hovered, setHovered] = useState<string | null>(null);
  // Clicking — a line, or its name in the key — latches it. A latched set is
  // a filter rather than a highlight: it survives the mouse leaving, it takes
  // several at once, and while anything is latched, hovering stops moving it,
  // so a chart you have narrowed down stays narrowed while you read it.
  const [latched, setLatched] = useState<Set<string>>(new Set());
  const toggleLatch = (id: string | null) => {
    if (!id) return;
    setLatched(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };
  const highlight = latched.size > 0 ? null : hovered;

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
    () => buildSels(
      roomSeries.filter(s =>
        canonicalHistoryType(s.characteristicType) === 'power_state'
        // Lightbulbs only. Every outlet, switch and fan also reports power,
        // and counting those made a home of nine bulbs claim twenty-one
        // lights — while fetching every one of their histories to do it.
        && accessoryInfo.get(s.accessoryId.toUpperCase())?.widgetType === 'lightbulb'),
      accessoryInfo,
    ),
    [roomSeries, accessoryInfo],
  );

  // A heater-cooler reports BOTH thresholds whatever mode it is in, so the
  // one it isn't aiming at draws a flat line that commands nothing. Filtering
  // here rather than at draw time means the inert series is never fetched and
  // never counted as a hidden target. Auto — and any accessory whose mode we
  // can't read — keeps both, which is correct: in Auto both govern.
  const governsNow = useCallback((characteristicType: string, accessoryId: string) => {
    const canonical = canonicalHistoryType(characteristicType);
    if (canonical !== 'heating_threshold' && canonical !== 'cooling_threshold') return true;
    const mode = accessoryInfo.get(accessoryId.toUpperCase())?.hvacMode;
    if (!mode || mode === 'both') return true;
    return mode === (canonical === 'heating_threshold' ? 'heat' : 'cool');
  }, [accessoryInfo]);

  // One panel per measure present in this room, importance-ordered.
  const measures = useMemo(() => measuresIn(roomSeries), [roomSeries]);
  const panels = useMemo(() => measures.map(measure => {
    const typeSet = new Set(measure.types);
    // Brightness has the Lighting panel; a fan's speed belongs to that fan.
    // Neither says anything as a room-wide line, and both crowded out the
    // measures that do.
    if (measure.id === 'brightness' || measure.id === 'speed') {
      return { measure, sels: [], offers: [], total: 0 };
    }
    // A virtual accessory's counter or number is that accessory's own
    // bookkeeping — the automation engine's tally of something. It is not a
    // property of a place, so a whole-home panel drawing "Count · 1 room ·
    // averaged from 1 sensor" was averaging a single counter with itself and
    // calling the answer a fact about the house. It keeps its panel wherever
    // it IS the subject: its own page, and the roomless list it lives in.
    if (byRoom && (measure.id === 'value' || measure.id === 'count')) {
      return { measure, sels: [], offers: [], total: 0 };
    }
    const infos = roomSeries.filter(s => s.kind === 'numeric' && typeSet.has(canonicalHistoryType(s.characteristicType)));
    const readings = infos.filter(s => !isSetpointType(canonicalHistoryType(s.characteristicType)));
    // Anything this panel can OFFER to borrow, and only what the room
    // actually records — a tick for data that isn't there is a dead control.
    const offers = (MEASURE_COMPLEMENTS[measure.id] ?? []).flatMap(complement => {
      const types = new Set(complement.types);
      const found = roomSeries.filter(s =>
        s.kind === 'numeric' && types.has(canonicalHistoryType(s.characteristicType))
        && governsNow(s.characteristicType, s.accessoryId));
      return found.length > 0
        ? [{ complement, sels: buildSels(found, accessoryInfo) }]
        : [];
    });
    return {
      measure,
      // The cap applies to readings; borrowed series ride along rather than
      // competing for one of the slots.
      sels: buildSels(byRoom ? readings : readings.slice(0, PER_MEASURE_CAP), accessoryInfo),
      offers,
      total: readings.length,
    };
  }).filter(p => p.sels.length > 0), [measures, roomSeries, accessoryInfo, byRoom, governsNow]);

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

  // Everything on screen, and nothing else. Complements used to be fetched
  // whether or not their tick was on, which on a whole home meant hundreds of
  // series nobody had asked to see — and the fetch is sequential, so each one
  // cost real seconds.
  const allSels = useMemo(
    () => [
      ...panels.flatMap(p => [
        ...p.sels,
        ...p.offers.filter(o => isOn(p.measure.id, o.complement.id)).flatMap(o => o.sels),
      ]),
      ...stripSels, ...lightSels, ...powerSels,
      ...lightingOffers.filter(o => isOn('lighting', o.complement.id)).flatMap(o => o.sels),
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [panels, stripSels, lightSels, powerSels, lightingOffers, complements],
  );
  const refs = useMemo<HistorySeriesRefInput[]>(() => {
    // One accessory's power state can be both a strip and a light; asking for
    // it twice is a whole extra round trip for a duplicate.
    const seen = new Set<string>();
    return allSels.flatMap(s => {
      const key = `${s.accessoryId.toUpperCase()}|${canonicalHistoryType(s.characteristicType)}`;
      if (seen.has(key)) return [];
      seen.add(key);
      return [{ accessoryId: s.accessoryId, characteristicType: s.characteristicType }];
    });
  }, [allSels]);
  const { data, loading, progress } = useMultiSeriesHistory(homeId, refs, fromTs, toTs, mock, {
    enabled: refs.length > 0,
  });
  // First load only: once there is data, a range change redraws from what is
  // already on screen rather than blanking it.
  const firstLoad = loading && data.size === 0;

  const entryFor = (sel: SeriesSel) => {
    const entry = data.get(`${sel.accessoryId.toUpperCase()}|${canonicalHistoryType(sel.characteristicType)}`);
    if (!entry) return undefined;
    // Always: a -40° radio fault or a pegged sensor is not a reading, and
    // nobody ever wanted the version of the chart with it in.
    return sanitizeSeriesData(entry.main).data;
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
    const points = lightingSeries(lights, fromTs, toTs, 400);
    if (points.length === 0) return null;
    return {
      count: lights.length,
      summary: lightingSummary(points, toTs),
      countSeries: lightingCountSeries(points),
      brightnessSeries: lightingBrightnessSeries(points),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [powerSels, lightSels, data, fromTs, toTs]);

  const identityOf = (sel: SeriesSel) => (byRoom ? (sel.room ?? 'Elsewhere') : sel.accessoryId.toUpperCase());

  // One colour per thing, fixed for the whole view. Colour was a per-panel
  // index, so Kitchen could be green in Temperature and orange in Humidity —
  // the two panels are stacked precisely so they can be read together.
  const colourIndex = useMemo(() => {
    const order: string[] = [];
    const add = (id: string) => { if (!order.includes(id)) order.push(id); };
    for (const panel of panels) {
      for (const sel of panel.sels) add(identityOf(sel));
    }
    for (const sel of stripSels) add(identityOf(sel));
    return new Map(order.map((id, i) => [id, i]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [panels, stripSels, byRoom]);
  const colourFor = (id: string) => seriesColor(colourIndex.get(id) ?? 0);

  const groupId = `room-stack-${roomKey ?? 'elsewhere'}`;
  const chartPanels = panels.map((panel, panelIndex) => {
    // Colour belongs to the thing, so a target inherits the colour of its own
    // reading and reads as the same device's intention.
    const colourOf = new Map<string, string>();
    panel.sels.forEach(sel => colourOf.set(sel.accessoryId.toUpperCase(), colourFor(identityOf(sel))));

    const perAccessory: Array<{ sel: SeriesSel; main: HistorySeriesData }> = panel.sels.flatMap(sel => {
      const main = entryFor(sel);
      return main ? [{ sel, main }] : [];
    });
    const readingSeries: ChartSeries[] = byRoom
      ? [...perAccessory.reduce((acc, { sel, main }) => {
          const key = sel.room ?? 'Elsewhere';
          acc.set(key, [...(acc.get(key) ?? []), main]);
          return acc;
        }, new Map<string, HistorySeriesData[]>())]
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([roomName, mains]) => ({
          key: `room:${roomName}`,
          label: roomName,
          unit: panel.measure.unit,
          data: aggregateToSeries(
            aggregateNumericSeries(mains, fromTs, toTs),
            { accessoryId: `room:${roomName}`, characteristicType: 'room_average', unit: panel.measure.unit },
            mains[0]?.resolution ?? 'raw',
          ),
          color: colourFor(roomName),
        }))
      : perAccessory.map(({ sel, main }) => ({
          key: `${sel.accessoryId}|${sel.characteristicType}`,
          label: sel.label,
          unit: sel.unit,
          data: main,
          color: colourFor(identityOf(sel)),
        }));
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
            color: colourOf.get(sel.accessoryId.toUpperCase()) ?? colourFor(identityOf(sel)),
            dashed: complement.setpoint,
            secondary: !complement.setpoint,
          }] : [];
        })
        : []
    ));
    const chartSeries = [...readingSeries, ...borrowed];
    if (chartSeries.length === 0) return null;

    // A chart speaks in series keys; the view thinks in things. This panel's
    // keys for whatever is currently lit — which may be none of them, and
    // that is how a highlight in one panel dims a neighbour that has nothing
    // of that accessory.
    const identityOfKey = (key: string) => {
      if (key.startsWith('room:')) return key.slice('room:'.length);
      const sel = [...panel.sels, ...panel.offers.flatMap(o => o.sels)]
        .find(x => `${x.accessoryId}|${x.characteristicType}` === key);
      return sel ? identityOf(sel) : key;
    };
    const litKeys = latched.size > 0
      ? chartSeries.filter(cs => latched.has(identityOfKey(cs.key))).map(cs => cs.key)
      : highlight
        ? chartSeries.filter(cs => identityOfKey(cs.key) === highlight).map(cs => cs.key)
        : null;

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
    // A panel that is holding targets back says so. Without this the panel is
    // indistinguishable from one whose accessories record no target at all,
    // which is how a working overlay went unfound: the readings are right,
    // nothing is missing, and there is no reason to go looking for a tick.
    const hiddenTargets = panel.offers
      .filter(o => o.complement.setpoint && !isOn(panel.measure.id, o.complement.id))
      .reduce((count, o) => count + o.sels.length, 0);

    return (
      <AnalyticsPanel
        key={panel.measure.id}
        title={panel.measure.title}
        source={`${byRoom
          ? `${readingSeries.length} room${readingSeries.length === 1 ? '' : 's'} · averaged from ${perAccessory.length} sensor${perAccessory.length === 1 ? '' : 's'}`
          : `${readingSeries.length} sensor${readingSeries.length === 1 ? '' : 's'} · ${resolution === 'raw' ? 'raw readings' : `${resolution} averages`}${panel.total > panel.sels.length ? ` · ${panel.total - panel.sels.length} not shown` : ''}`
        }${hiddenTargets > 0 ? ` · ${hiddenTargets} target${hiddenTargets === 1 ? '' : 's'} hidden` : ''}`}
        actions={panel.offers.length > 0 ? (
          <span className="flex items-center gap-1.5">
            {panel.offers.map(({ complement }) => (
              <ComplementToggle
                key={complement.id}
                label={complement.label}
                on={isOn(panel.measure.id, complement.id)}
                onToggle={() => toggleComplement(panel.measure.id, complement.id)}
              />
            ))}
          </span>
        ) : undefined}
        caption={n > 0 ? `min ${min.toFixed(1)}${unit} · avg ${(sum / n).toFixed(1)}${unit} · max ${max.toFixed(1)}${unit}` : undefined}
      >
        <EChartsTimeChart
          series={chartSeries}
          // A blind's percentage is meaningless without its ends named, and
          // 40% of a window is not comparable to 40% of another unless both
          // axes span the whole travel.
          axis={panel.measure.id === 'position'
            ? { min: 0, max: 100, minInterval: 25, labels: { 0: 'Closed', 100: 'Open' } }
            : undefined}
          fromTs={fromTs}
          toTs={toTs}
          normalize={false}
          height={panels.length > 1 ? 200 : 280}
          groupId={groupId}
          hideSlider={!isLastChart}
          highlightKeys={litKeys}
          // Hover is inert while a latch is on: the point of narrowing to two
          // lines is that they stay narrowed as the mouse crosses the others.
          onSeriesHover={(key) => { if (latched.size === 0) setHovered(key ? identityOfKey(key) : null); }}
          onSeriesSelect={(key) => toggleLatch(key ? identityOfKey(key) : null)}
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
              dotted: s.secondary,
              // Room averages have no accessory to cluster under.
              groupKey: byRoom ? undefined : sel?.accessoryId.toUpperCase(),
              group: byRoom ? undefined : sel?.accessoryName,
              shortLabel: byRoom ? undefined : sel?.charLabel,
            };
          })}
          highlightKeys={litKeys}
          latchedKeys={latched.size > 0 ? chartSeries.filter(cs => latched.has(identityOfKey(cs.key))).map(cs => cs.key) : []}
          onHighlight={(keys) => {
            if (latched.size > 0) return;
            setHovered(keys && keys.length > 0 ? identityOfKey(keys[0]) : null);
          }}
          onToggle={(key) => toggleLatch(identityOfKey(key))}
        />
      </AnalyticsPanel>
    );
  });

  const stripEntries = useMemo<ActivityEntry[]>(() => stripSels.flatMap(sel => {
    const main = entryFor(sel);
    return main ? [{ sel, data: main }] : [];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [stripSels, data]);

  return (
    <div className="space-y-3">
      {firstLoad ? (
        <ChartSkeleton progress={progress} />
      ) : chartPanels.length === 0 && stripEntries.length === 0 ? (
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
              source={`${lighting.count} light${lighting.count === 1 ? '' : 's'}`}
              actions={(
                <span className="flex items-center gap-1.5">
                  <ComplementToggle
                    label="Brightness"
                    on={showBrightness}
                    onToggle={() => setShowBrightness(v => !v)}
                  />
                  {lightingOffers.map(({ complement }) => (
                    <ComplementToggle
                      key={complement.id}
                      label={complement.label}
                      on={isOn('lighting', complement.id)}
                      onToggle={() => toggleComplement('lighting', complement.id)}
                    />
                  ))}
                </span>
              )}
              caption={lighting.summary.onMs > 0
                ? `lit ${formatStateDuration(lighting.summary.onMs)} · peak ${lighting.summary.peak} of ${lighting.count}${
                    lighting.summary.meanLit !== null ? ` · averaging ${Math.round(lighting.summary.meanLit)}%` : ''}`
                : 'nothing on in this range'}
            >
              <EChartsTimeChart
                series={[
                  {
                    key: 'lights-on',
                    label: 'Lights on',
                    unit: null,
                    data: lighting.countSeries,
                  },
                  ...(showBrightness ? [{
                    key: 'lights-brightness',
                    label: 'Brightness of those lit',
                    unit: '%',
                    data: lighting.brightnessSeries,
                    secondary: true,
                  }] : []),
                  ...lightingOffers.flatMap(({ complement, sels }) => (
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
                  )),
                ]}
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
          {/* Owns its own panel: how many timelines it ends up drawing is its
              decision (see quiet.ts), so the count in the header has to be
              made in the same place. */}
          <ActivityStrips
            entries={stripEntries}
            groups={groups}
            fromTs={fromTs}
            toTs={toTs}
          />
        </>
      )}
    </div>
  );
}
