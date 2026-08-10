import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useApolloClient, useQuery } from '@apollo/client/react';
import {
  ArrowLeft,
  Battery,
  Footprints,
  LineChart as LineChartIcon,
  Loader2,
  Plus,
  Thermometer,
  X,
} from 'lucide-react';
import { GET_HISTORY, GET_HISTORY_SERIES } from '@/lib/graphql/queries';
import { useHomes, useAccessoriesForHomes } from '@/hooks/useHomeKitData';
import { charLabel } from '@/components/automations/format';
import { aggregateNumericSeries, type AggregatePoint } from '@/history/aggregate';
import { isMockHistoryEnabled, mockHistoryData } from '@/history/mock';
import { canonicalHistoryType } from '@/history/keys';
import StateTimeline from '@/components/widgets/StateTimeline';
import ExplorerChart, { seriesColor, type ChartSeries } from '@/components/history-explorer/ExplorerChart';
import { Button } from '@/components/ui/button';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import type {
  HistorySeriesData,
  HistorySeriesInfo,
  HistorySeriesRefInput,
  HomeKitAccessory,
} from '@/lib/graphql/types';

/**
 * History Explorer — /history. The advanced-analytics surface: compare any
 * recorded series across sensors and rooms on one chart.
 *
 * The landing state is presets, not an empty canvas: "Living Room climate"
 * (every thermometer/hygrometer/lux meter in the room, band + average),
 * "Temperature across the home" (one line per room), motion, battery. Every
 * view is editable from there and deep-linkable. `?mockHistory=1` runs the
 * whole page on deterministic fake data — no relay, no waiting for charts
 * to fill.
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

interface SeriesSel {
  accessoryId: string;
  characteristicType: string;
  label: string;
  unit: string | null;
  kind: 'numeric' | 'bool' | 'enum';
}

interface ExplorerView {
  title: string;
  series: SeriesSel[];
  /** Band + average instead of individual lines (many-sensor presets). */
  aggregate: boolean;
}

const TEMP_TYPES = new Set(['current_temperature']);
const CLIMATE_TYPES = new Set(['current_temperature', 'relative_humidity', 'current_ambient_light_level']);
const MOTION_TYPES = new Set(['motion_detected', 'occupancy_detected', 'contact_state']);
const BATTERY_TYPES = new Set(['battery_level']);

// Mock catalogue so ?mockHistory=1 exercises the whole page offline.
const MOCK_RECORDED: Array<{ accessoryId: string; name: string; room: string; types: string[] }> = [
  { accessoryId: 'MOCK-LR-SENSOR', name: 'Living Room Sensor', room: 'Living Room', types: ['current_temperature', 'relative_humidity', 'current_ambient_light_level', 'motion_detected'] },
  { accessoryId: 'MOCK-LR-SENSOR2', name: 'Bookshelf Sensor', room: 'Living Room', types: ['current_temperature', 'motion_detected'] },
  { accessoryId: 'MOCK-BED-SENSOR', name: 'Bedroom Sensor', room: 'Bedroom', types: ['current_temperature', 'relative_humidity', 'battery_level'] },
  { accessoryId: 'MOCK-KITCHEN-TH', name: 'Kitchen Thermostat', room: 'Kitchen', types: ['current_temperature', 'heating_cooling_current'] },
  { accessoryId: 'MOCK-DOOR', name: 'Front Door', room: 'Hallway', types: ['contact_state', 'battery_level'] },
];

function useRecordedSeries(homeId: string | null, mock: boolean) {
  const { data, loading } = useQuery<{ historySeries: HistorySeriesInfo[] }>(GET_HISTORY_SERIES, {
    variables: { homeId },
    skip: !homeId || mock,
    fetchPolicy: 'cache-and-network',
  });
  return {
    recorded: mock
      ? MOCK_RECORDED.flatMap(m => m.types.map(t => ({
          accessoryId: m.accessoryId,
          characteristicType: t,
          kind: (t === 'contact_state' || t === 'heating_cooling_current' ? 'enum'
            : t === 'motion_detected' ? 'bool' : 'numeric') as 'numeric' | 'bool' | 'enum',
          unit: t === 'current_temperature' ? '°' : t.includes('humidity') || t === 'battery_level' ? '%' : t.includes('light') ? 'lux' : null,
          enabled: true, minIntervalS: null, deadband: null,
          firstTs: null, lastTs: null, sampleCount: 1000,
        })))
      : (data?.historySeries ?? []),
    loading: !mock && loading,
  };
}

/** Chunked multi-series fetch: the wire caps GetHistory at 6 refs. */
function useMultiSeriesHistory(
  homeId: string | null,
  refs: HistorySeriesRefInput[],
  fromTs: number,
  toTs: number,
  compareOffsetMs: number,
  mock: boolean,
) {
  const client = useApolloClient();
  const [data, setData] = useState<Map<string, { main: HistorySeriesData; ghost?: HistorySeriesData }>>(new Map());
  const [loading, setLoading] = useState(false);
  const refsKey = refs.map(r => `${r.accessoryId}|${r.characteristicType}`).join(',');

  useEffect(() => {
    if (!homeId || refs.length === 0) {
      setData(new Map());
      return;
    }
    let cancelled = false;

    const fetchAll = async (from: number, to: number): Promise<HistorySeriesData[]> => {
      if (mock) return mockHistoryData(refs, from, to);
      const out: HistorySeriesData[] = [];
      for (let i = 0; i < refs.length; i += 6) {
        const chunk = refs.slice(i, i + 6);
        const result = await client.query<{ history: HistorySeriesData[] }>({
          query: GET_HISTORY,
          variables: { homeId, series: chunk, fromTs: from, toTs: to, maxPoints: 500 },
          fetchPolicy: 'network-only',
        });
        out.push(...(result.data?.history ?? []));
      }
      return out;
    };

    setLoading(true);
    void (async () => {
      try {
        const main = await fetchAll(fromTs, toTs);
        const ghost = compareOffsetMs > 0
          ? await fetchAll(fromTs - compareOffsetMs, toTs - compareOffsetMs)
          : [];
        if (cancelled) return;
        const map = new Map<string, { main: HistorySeriesData; ghost?: HistorySeriesData }>();
        for (const s of main) {
          const key = `${s.accessoryId.toUpperCase()}|${s.characteristicType}`;
          map.set(key, { main: s });
        }
        for (const g of ghost) {
          const key = `${g.accessoryId.toUpperCase()}|${g.characteristicType}`;
          const entry = map.get(key);
          if (entry) {
            // Shift the ghost onto the current range so both plot together.
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
        console.error('[HistoryExplorer] fetch failed', e);
        if (!cancelled) setData(new Map());
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [homeId, refsKey, fromTs, toTs, compareOffsetMs, mock, client]);

  return { data, loading };
}

export default function HistoryExplorer() {
  const mock = isMockHistoryEnabled();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const { data: homes } = useHomes({ skip: mock });
  const [homeId, setHomeId] = useState<string | null>(searchParams.get('home'));
  const effectiveHomeId = mock ? 'MOCK-HOME' : (homeId ?? homes?.[0]?.id ?? null);

  const { data: accessories } = useAccessoriesForHomes(
    effectiveHomeId && !mock ? [effectiveHomeId] : [],
  );
  const { recorded, loading: seriesLoading } = useRecordedSeries(effectiveHomeId, mock);

  const accessoryInfo = useMemo(() => {
    const map = new Map<string, { name: string; room: string | null }>();
    if (mock) {
      for (const m of MOCK_RECORDED) map.set(m.accessoryId, { name: m.name, room: m.room });
    } else {
      for (const acc of accessories ?? []) {
        map.set(acc.id.toUpperCase(), { name: acc.name, room: (acc as HomeKitAccessory).roomName ?? null });
      }
    }
    return map;
  }, [accessories, mock]);

  const [view, setView] = useState<ExplorerView | null>(null);
  const [rangeMs, setRangeMs] = useState<number>(24 * 3_600_000);
  const [normalize, setNormalize] = useState(false);
  const [compare, setCompare] = useState<'none' | 'day' | 'week'>('none');
  const toTs = useMemo(() => Date.now(), [view, rangeMs]); // eslint-disable-line react-hooks/exhaustive-deps
  const fromTs = toTs - rangeMs;

  const toSel = useCallback((s: HistorySeriesInfo): SeriesSel => {
    const info = accessoryInfo.get(s.accessoryId.toUpperCase());
    return {
      accessoryId: s.accessoryId,
      characteristicType: s.characteristicType,
      label: `${info?.name ?? s.accessoryId.slice(0, 8)} · ${charLabel(s.characteristicType)}`,
      unit: s.unit,
      kind: s.kind,
    };
  }, [accessoryInfo]);

  // --- Presets: built from what is actually recorded -------------------
  const presets = useMemo(() => {
    const enabled = recorded.filter(s => s.enabled);
    const roomOf = (s: HistorySeriesInfo) => accessoryInfo.get(s.accessoryId.toUpperCase())?.room ?? null;

    const out: Array<{ id: string; title: string; subtitle: string; icon: React.ReactNode; view: ExplorerView }> = [];

    // Climate per room: rooms with ≥1 temperature series.
    const rooms = new Map<string, HistorySeriesInfo[]>();
    for (const s of enabled) {
      if (!CLIMATE_TYPES.has(s.characteristicType)) continue;
      const room = roomOf(s);
      if (!room) continue;
      const list = rooms.get(room) ?? [];
      list.push(s);
      rooms.set(room, list);
    }
    for (const [room, list] of [...rooms.entries()].sort((a, b) => b[1].length - a[1].length)) {
      if (!list.some(s => TEMP_TYPES.has(s.characteristicType))) continue;
      const sensors = new Set(list.map(s => s.accessoryId)).size;
      out.push({
        id: `climate:${room}`,
        title: `${room} climate`,
        subtitle: `${sensors} sensor${sensors === 1 ? '' : 's'} · temperature, humidity, light`,
        icon: <Thermometer className="h-4 w-4" />,
        view: {
          title: `${room} climate`,
          series: list.slice(0, 20).map(toSel),
          aggregate: list.filter(s => TEMP_TYPES.has(s.characteristicType)).length >= 4,
        },
      });
    }

    // Whole-home temperature: one series per room.
    const perRoom = new Map<string, HistorySeriesInfo>();
    for (const s of enabled) {
      if (!TEMP_TYPES.has(s.characteristicType)) continue;
      const room = roomOf(s) ?? 'Elsewhere';
      if (!perRoom.has(room)) perRoom.set(room, s);
    }
    if (perRoom.size >= 2) {
      out.push({
        id: 'home-temp',
        title: 'Temperature across the home',
        subtitle: `${perRoom.size} rooms`,
        icon: <Thermometer className="h-4 w-4" />,
        view: {
          title: 'Temperature across the home',
          series: [...perRoom.entries()].slice(0, 12).map(([room, s]) => ({
            ...toSel(s),
            label: room,
          })),
          aggregate: false,
        },
      });
    }

    // Motion / doors.
    const motion = enabled.filter(s => MOTION_TYPES.has(s.characteristicType));
    if (motion.length > 0) {
      out.push({
        id: 'motion',
        title: 'Motion & doors',
        subtitle: `${motion.length} sensor${motion.length === 1 ? '' : 's'}`,
        icon: <Footprints className="h-4 w-4" />,
        view: { title: 'Motion & doors', series: motion.slice(0, 12).map(toSel), aggregate: false },
      });
    }

    // Battery levels.
    const battery = enabled.filter(s => BATTERY_TYPES.has(s.characteristicType));
    if (battery.length > 1) {
      out.push({
        id: 'battery',
        title: 'Battery levels',
        subtitle: `${battery.length} devices`,
        icon: <Battery className="h-4 w-4" />,
        view: { title: 'Battery levels', series: battery.slice(0, 12).map(toSel), aggregate: false },
      });
    }

    return out;
  }, [recorded, accessoryInfo, toSel]);

  // Deep link: apply ?preset= once data is ready; keep URL in sync.
  useEffect(() => {
    const presetId = searchParams.get('preset');
    if (presetId && !view && presets.length > 0) {
      const preset = presets.find(p => p.id === presetId);
      if (preset) setView(preset.view);
    }
  }, [presets, searchParams, view]);

  const openView = (presetId: string | null, next: ExplorerView) => {
    setView(next);
    const params: Record<string, string> = {};
    if (effectiveHomeId && !mock) params.home = effectiveHomeId;
    if (presetId) params.preset = presetId;
    if (mock) params.mockHistory = '1';
    setSearchParams(params, { replace: true });
  };

  // --- Data for the active view ---------------------------------------
  const refs = useMemo<HistorySeriesRefInput[]>(
    () => (view?.series ?? []).map(s => ({ accessoryId: s.accessoryId, characteristicType: s.characteristicType })),
    [view],
  );
  const compareOffsetMs = COMPARE_OPTIONS.find(c => c.value === compare)?.offsetMs ?? 0;
  const { data: seriesData, loading: dataLoading } = useMultiSeriesHistory(
    effectiveHomeId, refs, fromTs, toTs, compareOffsetMs, mock,
  );

  const numericSeries = useMemo<ChartSeries[]>(() => {
    if (!view) return [];
    return view.series
      .filter(s => s.kind === 'numeric')
      .flatMap((s): ChartSeries[] => {
        const key = `${s.accessoryId.toUpperCase()}|${canonicalHistoryType(s.characteristicType)}`;
        const entry = seriesData.get(key);
        return entry ? [{ key, label: s.label, unit: s.unit, data: entry.main, ghost: entry.ghost }] : [];
      });
  }, [view, seriesData]);

  const stateSeries = useMemo(() => {
    if (!view) return [];
    return view.series
      .filter(s => s.kind !== 'numeric')
      .map(s => {
        const key = `${s.accessoryId.toUpperCase()}|${canonicalHistoryType(s.characteristicType)}`;
        const entry = seriesData.get(key);
        return entry ? { sel: s, data: entry.main } : null;
      })
      .filter((s): s is { sel: SeriesSel; data: HistorySeriesData } => s !== null);
  }, [view, seriesData]);

  const band: AggregatePoint[] | null = useMemo(() => {
    if (!view?.aggregate) return null;
    const tempSeries = numericSeries.filter(s => TEMP_TYPES.has(canonicalHistoryType(s.data.characteristicType)));
    if (tempSeries.length < 3) return null;
    return aggregateNumericSeries(tempSeries.map(s => s.data), fromTs, toTs);
  }, [view, numericSeries, fromTs, toTs]);

  const stats = useMemo(() => numericSeries.map((s, i) => {
    const points = s.data.points;
    if (points.length === 0) return { label: s.label, color: seriesColor(i), empty: true as const };
    let min = Infinity;
    let max = -Infinity;
    let sum = 0;
    for (const p of points) {
      min = Math.min(min, p.min);
      max = Math.max(max, p.max);
      sum += p.avg;
    }
    return {
      label: s.label, color: seriesColor(i), empty: false as const,
      min, max, avg: sum / points.length,
      now: points[points.length - 1].last,
      unit: s.unit ?? '',
    };
  }), [numericSeries]);

  const addableSeries = useMemo(() => {
    if (!view) return [];
    const used = new Set(view.series.map(s => `${s.accessoryId.toUpperCase()}|${s.characteristicType}`));
    return recorded
      .filter(s => s.enabled && !used.has(`${s.accessoryId.toUpperCase()}|${s.characteristicType}`))
      .slice(0, 60);
  }, [view, recorded]);

  // --- Render ----------------------------------------------------------
  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b px-4 py-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <button
            className="p-1 rounded hover:bg-muted"
            onClick={() => (view ? (setView(null), setSearchParams(mock ? { mockHistory: '1' } : {}, { replace: true })) : navigate('/portal'))}
            aria-label="Back"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
          <LineChartIcon className="h-4 w-4 text-muted-foreground shrink-0" />
          <h1 className="text-sm font-semibold truncate">{view ? view.title : 'History Explorer'}</h1>
        </div>
        {!mock && (homes?.length ?? 0) > 1 && !view && (
          <Select value={effectiveHomeId ?? ''} onValueChange={(v) => setHomeId(v)}>
            <SelectTrigger className="w-[180px] h-8 text-xs">
              <SelectValue placeholder="Home" />
            </SelectTrigger>
            <SelectContent>
              {(homes ?? []).map(h => (
                <SelectItem key={h.id} value={h.id} className="text-xs">{h.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </header>

      <main className="p-4 max-w-5xl mx-auto space-y-4">
        {!view ? (
          seriesLoading ? (
            <div className="py-16 flex justify-center text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          ) : presets.length === 0 ? (
            <div className="py-16 text-center space-y-2">
              <p className="text-sm text-muted-foreground">
                Nothing recorded yet. Turn on History in Settings → History and
                charts will build as your devices report changes.
              </p>
            </div>
          ) : (
            <>
              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Suggested views</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {presets.map(p => (
                  <button
                    key={p.id}
                    className="text-left border rounded-lg p-3 hover:bg-muted/50 transition-colors"
                    onClick={() => openView(p.id, p.view)}
                  >
                    <div className="flex items-center gap-2 text-sm font-medium">
                      {p.icon}
                      {p.title}
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">{p.subtitle}</p>
                  </button>
                ))}
              </div>
            </>
          )
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex gap-1">
                {RANGES.map(r => (
                  <button
                    key={r.label}
                    onClick={() => setRangeMs(r.ms)}
                    className={`text-[11px] px-2 py-0.5 rounded transition-colors ${
                      rangeMs === r.ms ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted'
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
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm" className="h-7 text-xs" disabled={addableSeries.length === 0}>
                    <Plus className="h-3 w-3 mr-1" /> Add series
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent className="max-h-[300px] overflow-y-auto">
                  <DropdownMenuLabel className="text-xs">Recorded characteristics</DropdownMenuLabel>
                  {addableSeries.map(s => {
                    const info = accessoryInfo.get(s.accessoryId.toUpperCase());
                    return (
                      <DropdownMenuItem
                        key={`${s.accessoryId}|${s.characteristicType}`}
                        className="text-xs"
                        onClick={() => setView(v => v && ({
                          ...v,
                          series: [...v.series, toSel(s)],
                          aggregate: false,
                        }))}
                      >
                        {info?.name ?? s.accessoryId.slice(0, 8)} · {charLabel(s.characteristicType)}
                      </DropdownMenuItem>
                    );
                  })}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>

            {/* Selected series chips */}
            <div className="flex flex-wrap gap-1.5">
              {view.series.map((s, i) => (
                <span
                  key={`${s.accessoryId}|${s.characteristicType}`}
                  className="inline-flex items-center gap-1.5 text-[11px] border rounded-full pl-2 pr-1 py-0.5"
                >
                  <span className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: s.kind === 'numeric' ? seriesColor(view.series.filter(x => x.kind === 'numeric').findIndex(x => x === s)) : 'hsl(var(--muted-foreground))' }} />
                  <span className="truncate max-w-[180px]">{s.label}</span>
                  <button
                    className="p-0.5 rounded-full hover:bg-muted"
                    onClick={() => setView(v => v && ({ ...v, series: v.series.filter(x => x !== s) }))}
                    aria-label={`Remove ${s.label}`}
                  >
                    <X className="h-3 w-3" />
                  </button>
                </span>
              ))}
            </div>

            {dataLoading && numericSeries.length === 0 && stateSeries.length === 0 ? (
              <div className="py-16 flex justify-center text-muted-foreground">
                <Loader2 className="h-5 w-5 animate-spin" />
              </div>
            ) : (
              <>
                {numericSeries.length > 0 && (
                  <div className="border rounded-lg p-3">
                    {band && (
                      <p className="text-[11px] text-muted-foreground mb-1">
                        Bold line = average across sensors · shaded = min–max range · thin lines = individual sensors
                      </p>
                    )}
                    <ExplorerChart
                      series={numericSeries}
                      band={band}
                      bandLabel="average"
                      fromTs={fromTs}
                      toTs={toTs}
                      normalize={normalize}
                    />
                  </div>
                )}

                {stateSeries.length > 0 && (
                  <div className="border rounded-lg p-3 space-y-2">
                    {stateSeries.map(({ sel, data }) => (
                      <div key={`${sel.accessoryId}|${sel.characteristicType}`} className="space-y-1">
                        <p className="text-[11px] text-muted-foreground">{sel.label}</p>
                        <StateTimeline
                          fromTs={fromTs}
                          toTs={toTs}
                          prevValue={data.prevValue}
                          states={data.states}
                          stateBuckets={data.stateBuckets}
                          labelFor={(v) => (v === 0 ? 'Off/Closed/Clear' : v === 1 ? 'On/Open/Active' : String(v))}
                        />
                      </div>
                    ))}
                  </div>
                )}

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
                                <span className="h-2 w-2 rounded-full" style={{ backgroundColor: s.color }} />
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
          </>
        )}
      </main>
    </div>
  );
}
