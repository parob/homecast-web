import { useEffect, useMemo, useState, useCallback } from 'react';
import { useApolloClient, useQuery } from '@apollo/client/react';
import {
  AlertTriangle,
  ArrowLeft,
  Battery,
  Footprints,
  Loader2,
  Plus,
  Thermometer,
  X,
} from 'lucide-react';
import { GET_HISTORY, GET_HISTORY_SERIES } from '@/lib/graphql/queries';
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
 * The History Explorer's whole surface — presets landing, multi-series
 * comparison, stats — as a plain component so it renders identically inside
 * the Dashboard's Explorer dialog (the primary home: warm caches, the
 * accessories already loaded, no extra relay round-trips) and on the
 * standalone /history page (deep links, screenshots).
 *
 * Accessory data comes IN as a prop wherever the host already has it; the
 * component never fetches relay data itself. That distinction is why the
 * dialog is reliable where the first standalone version was flaky: a cold
 * page re-issued homes/accessories relay actions that fail while a relay is
 * busy or reconnecting.
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

export interface SeriesSel {
  accessoryId: string;
  characteristicType: string;
  label: string;
  unit: string | null;
  kind: 'numeric' | 'bool' | 'enum';
}

export interface ExplorerView {
  title: string;
  series: SeriesSel[];
  aggregate: boolean;
}

const TEMP_TYPES = new Set(['current_temperature']);
const CLIMATE_TYPES = new Set(['current_temperature', 'relative_humidity', 'current_ambient_light_level']);
const MOTION_TYPES = new Set(['motion_detected', 'occupancy_detected', 'contact_state']);
const BATTERY_TYPES = new Set(['battery_level']);

// Mock catalogue so ?mockHistory=1 exercises the whole surface offline.
const MOCK_RECORDED: Array<{ accessoryId: string; name: string; room: string; types: string[] }> = [
  { accessoryId: 'MOCK-LR-SENSOR', name: 'Living Room Sensor', room: 'Living Room', types: ['current_temperature', 'relative_humidity', 'current_ambient_light_level', 'motion_detected'] },
  { accessoryId: 'MOCK-LR-SENSOR2', name: 'Bookshelf Sensor', room: 'Living Room', types: ['current_temperature', 'motion_detected'] },
  { accessoryId: 'MOCK-BED-SENSOR', name: 'Bedroom Sensor', room: 'Bedroom', types: ['current_temperature', 'relative_humidity', 'battery_level'] },
  { accessoryId: 'MOCK-KITCHEN-TH', name: 'Kitchen Thermostat', room: 'Kitchen', types: ['current_temperature', 'heating_cooling_current'] },
  { accessoryId: 'MOCK-DOOR', name: 'Front Door', room: 'Hallway', types: ['contact_state', 'battery_level'] },
];

function useRecordedSeries(homeId: string | null, mock: boolean) {
  const { data, loading, error, refetch } = useQuery<{ historySeries: HistorySeriesInfo[] }>(GET_HISTORY_SERIES, {
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
    error: mock ? undefined : error,
    refetch,
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
  const [error, setError] = useState<string | null>(null);
  const [retryNonce, setRetryNonce] = useState(0);
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
    setError(null);
    void (async () => {
      try {
        const main = await fetchAll(fromTs, toTs);
        const ghost = compareOffsetMs > 0
          ? await fetchAll(fromTs - compareOffsetMs, toTs - compareOffsetMs)
          : [];
        if (cancelled) return;
        const map = new Map<string, { main: HistorySeriesData; ghost?: HistorySeriesData }>();
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
  }, [homeId, refsKey, fromTs, toTs, compareOffsetMs, mock, client, retryNonce]);

  return { data, loading, error, retry: () => setRetryNonce(n => n + 1) };
}

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

export interface HistoryExplorerContentProps {
  homeId: string | null;
  /** Host-provided accessory data — the component never fetches relay data. */
  accessories: HomeKitAccessory[] | null;
  initialPresetId?: string | null;
  /** A ready-made view to open with (e.g. a service group's members). */
  initialView?: ExplorerView | null;
  /** Fired when the active view changes; the page host mirrors it to the URL. */
  onViewChange?: (presetId: string | null) => void;
}

export default function HistoryExplorerContent({
  homeId, accessories, initialPresetId, initialView, onViewChange,
}: HistoryExplorerContentProps) {
  const mock = isMockHistoryEnabled();
  const effectiveHomeId = mock ? 'MOCK-HOME' : homeId;
  const { recorded, loading: seriesLoading, error: seriesError, refetch } = useRecordedSeries(effectiveHomeId, mock);

  const accessoryInfo = useMemo(() => {
    const map = new Map<string, { name: string; room: string | null }>();
    if (mock) {
      for (const m of MOCK_RECORDED) map.set(m.accessoryId, { name: m.name, room: m.room });
    } else {
      for (const acc of accessories ?? []) {
        map.set(acc.id.toUpperCase(), { name: acc.name, room: acc.roomName ?? null });
      }
    }
    return map;
  }, [accessories, mock]);

  const [view, setViewRaw] = useState<ExplorerView | null>(null);
  const [activePresetId, setActivePresetId] = useState<string | null>(null);
  const setView = useCallback((presetId: string | null, next: ExplorerView | null) => {
    setActivePresetId(presetId);
    setViewRaw(next);
    onViewChange?.(presetId);
  }, [onViewChange]);

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

  const presets = useMemo(() => {
    const enabled = recorded.filter(s => s.enabled);
    const roomOf = (s: HistorySeriesInfo) => accessoryInfo.get(s.accessoryId.toUpperCase())?.room ?? null;
    const out: Array<{ id: string; title: string; subtitle: string; icon: React.ReactNode; view: ExplorerView }> = [];

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
          series: [...perRoom.entries()].slice(0, 12).map(([room, s]) => ({ ...toSel(s), label: room })),
          aggregate: false,
        },
      });
    }

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

  // Ready-made view (service group) applies immediately; a preset deep link
  // waits for the recorded-series data the presets are built from.
  useEffect(() => {
    if (initialView && !view) setView(null, initialView);
  }, [initialView, view, setView]);
  useEffect(() => {
    if (initialPresetId && !view && presets.length > 0) {
      const preset = presets.find(p => p.id === initialPresetId);
      if (preset) setView(preset.id, preset.view);
    }
  }, [presets, initialPresetId, view, setView]);

  const refs = useMemo<HistorySeriesRefInput[]>(
    () => (view?.series ?? []).map(s => ({ accessoryId: s.accessoryId, characteristicType: s.characteristicType })),
    [view],
  );
  const compareOffsetMs = COMPARE_OPTIONS.find(c => c.value === compare)?.offsetMs ?? 0;
  const { data: seriesData, loading: dataLoading, error: dataError, retry } = useMultiSeriesHistory(
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
      .flatMap((s) => {
        const key = `${s.accessoryId.toUpperCase()}|${canonicalHistoryType(s.characteristicType)}`;
        const entry = seriesData.get(key);
        return entry ? [{ sel: s, data: entry.main }] : [];
      });
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

  if (!view) {
    if (seriesError) {
      return <ErrorBanner message={`Couldn't load recorded series: ${seriesError.message}`} onRetry={() => void refetch()} />;
    }
    if (seriesLoading) {
      return (
        <div className="py-16 flex justify-center text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" />
        </div>
      );
    }
    if (presets.length === 0) {
      return (
        <div className="py-16 text-center">
          <p className="text-sm text-muted-foreground">
            Nothing recorded yet. Turn on History in Settings → History and
            charts will build as your devices report changes.
          </p>
        </div>
      );
    }
    return (
      <div className="space-y-3">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Suggested views</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            Pick a view of what's recorded — every view can be edited once open
            (add or remove any series, change the range, compare periods).
          </p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {presets.map(p => (
            <button
              key={p.id}
              className="text-left border rounded-lg p-3 hover:bg-muted/50 transition-colors"
              onClick={() => setView(p.id, p.view)}
            >
              <div className="flex items-center gap-2 text-sm font-medium">
                {p.icon}
                {p.title}
              </div>
              <p className="text-xs text-muted-foreground mt-1">{p.subtitle}</p>
            </button>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Button
          variant="outline"
          size="sm"
          className="h-7 text-xs shrink-0"
          onClick={() => setView(null, null)}
        >
          <ArrowLeft className="h-3.5 w-3.5 mr-1" />
          All views
        </Button>
        <h2 className="text-sm font-semibold truncate flex-1">{view.title}</h2>
      </div>

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
                  onClick={() => setViewRaw(v => v && ({ ...v, series: [...v.series, toSel(s)], aggregate: false }))}
                >
                  {info?.name ?? s.accessoryId.slice(0, 8)} · {charLabel(s.characteristicType)}
                </DropdownMenuItem>
              );
            })}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {view.series.map((s) => (
          <span
            key={`${s.accessoryId}|${s.characteristicType}`}
            className="inline-flex items-center gap-1.5 text-[11px] border rounded-full pl-2 pr-1 py-0.5"
          >
            <span
              className="h-2 w-2 rounded-full shrink-0"
              style={{ backgroundColor: s.kind === 'numeric' ? seriesColor(view.series.filter(x => x.kind === 'numeric').findIndex(x => x === s)) : 'hsl(var(--muted-foreground))' }}
            />
            <span className="truncate max-w-[180px]">{s.label}</span>
            <button
              className="p-0.5 rounded-full hover:bg-muted"
              onClick={() => setViewRaw(v => v && ({ ...v, series: v.series.filter(x => x !== s) }))}
              aria-label={`Remove ${s.label}`}
            >
              <X className="h-3 w-3" />
            </button>
          </span>
        ))}
      </div>

      {dataError ? (
        <ErrorBanner message={`Couldn't load history: ${dataError}`} onRetry={retry} />
      ) : dataLoading && numericSeries.length === 0 && stateSeries.length === 0 ? (
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
    </div>
  );
}
