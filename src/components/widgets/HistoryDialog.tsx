import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { ChevronDown, ExternalLink, Loader2, LineChart } from 'lucide-react';
import { useQuery } from '@apollo/client/react';
import { GET_HISTORY_STORAGE_STATS, GET_HISTORY_SERIES } from '@/lib/graphql/queries';
import { getRecordableCharacteristics, sortByHistoryImportance, type WritableChar } from '@/components/automations/characteristics';
import { charLabel } from '@/components/automations/format';
import { isMockHistoryEnabled, mockRecordedSeries } from '@/history/mock';
import { BOOL_STATE_LABELS } from '@/history/labels';
import { sanitizeSeriesData } from '@/history/sanitize';
import { useHistory } from '@/contexts/HistoryContext';
import { useMultiSeriesHistory } from '@/components/home-analytics/useMultiSeriesHistory';
import { AnimatedCollapse } from '@/components/ui/animated-collapse';
import type {
  HomeKitAccessory,
  HistorySeriesData,
  HistorySeriesInfo,
  HistoryStorageStatsData,
  HistorySeriesRefInput,
} from '@/lib/graphql/types';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import StateTimeline from './StateTimeline';

const HistoryChart = lazy(() => import('./HistoryChart'));
// Lazy for the same reason: it pulls the charting stack.
const GroupHistorySections = lazy(() => import('@/components/home-analytics/GroupHistorySections'));

const RANGES = [
  { label: '6h', ms: 6 * 3_600_000 },
  { label: '24h', ms: 24 * 3_600_000 },
  { label: '7d', ms: 7 * 86_400_000 },
  { label: '30d', ms: 30 * 86_400_000 },
  { label: '1y', ms: 365 * 86_400_000 },
  { label: 'All', ms: 2 * 365 * 86_400_000 },
] as const;

// Bool vocabulary is shared with the Analytics strips (history/labels);
// enum labels enrich from the characteristic's own options here, where the
// accessory's WritableChar is at hand.
function labelForValue(
  char: WritableChar | undefined, type: string, value: number, text?: string | null,
): string {
  if (text != null) return text; // string kind: the text IS the label
  const bool = BOOL_STATE_LABELS[type];
  if (bool) return bool[value === 0 ? 0 : 1];
  const option = char?.options?.find(o => o.value === value);
  if (option) return option.label;
  return value === 0 ? 'Off' : value === 1 ? 'On' : String(value);
}

/** Rolled stateMs keys: numeric codes for bool/enum, the raw text for string. */
function labelForKey(char: WritableChar | undefined, type: string, key: string): string {
  const parsed = Number(key);
  if (Number.isFinite(parsed) && key.trim() !== '') return labelForValue(char, type, parsed);
  return key;
}

function formatDuration(ms: number): string {
  const minutes = Math.round(ms / 60_000);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours}h ${minutes % 60}m`;
  return `${Math.floor(hours / 24)}d ${hours % 24}h`;
}

export interface HistoryTarget {
  homeId: string;
  /** Accessory mode: per-characteristic charts for one accessory. */
  accessory?: HomeKitAccessory;
  /** Group mode: the same layout, aggregated across the group's members. */
  group?: { id: string; name: string; memberIds: string[] };
}

interface HistoryDialogProps {
  target: HistoryTarget | null;
  onClose: () => void;
  /** Open the home's settings page (wired from the dashboard shell). */
  onOpenSettings?: () => void;
}

/** Numeric range stats from the served points. */
function numericStats(data: HistorySeriesData): { min: number; avg: number; max: number } | null {
  if (data.points.length === 0) return null;
  let min = Infinity;
  let max = -Infinity;
  let sum = 0;
  for (const p of data.points) {
    min = Math.min(min, p.min);
    max = Math.max(max, p.max);
    sum += p.avg;
  }
  return { min, avg: sum / data.points.length, max };
}

/** Time-in-state totals + transition count across the served range. */
function stateStats(
  data: HistorySeriesData,
  fromTs: number,
  toTs: number,
): { totals: Array<[string, number]>; transitions: number } {
  // Keyed by state IDENTITY — String(code) for bool/enum, the raw text for
  // the string kind — the same convention the rollup stateMs uses.
  const totals = new Map<string, number>();
  let transitions = 0;
  const keyOf = (v: number, vt?: string | null) => vt ?? String(v);

  if (data.states.length > 0) {
    let prevTs = fromTs;
    let prevKey = data.prevValue !== null ? keyOf(data.prevValue, data.prevValueText) : null;
    for (const s of data.states) {
      const key = keyOf(s.value, s.valueText);
      if (prevKey !== null) totals.set(prevKey, (totals.get(prevKey) ?? 0) + (s.ts - prevTs));
      if (prevKey !== null && key !== prevKey) transitions++;
      else if (prevKey === null) transitions++;
      prevTs = s.ts;
      prevKey = key;
    }
    if (prevKey !== null) totals.set(prevKey, (totals.get(prevKey) ?? 0) + (toTs - prevTs));
  } else {
    for (const b of data.stateBuckets) {
      transitions += b.transitions;
      try {
        const stateMs = JSON.parse(b.stateMsJson) as Record<string, number>;
        for (const [key, ms] of Object.entries(stateMs)) {
          totals.set(key, (totals.get(key) ?? 0) + ms);
        }
      } catch { /* cell without detail */ }
    }
  }
  return {
    totals: [...totals.entries()].sort((a, b) => b[1] - a[1]),
    transitions,
  };
}

export function HistoryDialog({ target, onClose, onOpenSettings }: HistoryDialogProps) {
  const { openAnalytics } = useHistory();
  const [rangeMs, setRangeMs] = useState<number>(24 * 3_600_000);
  const [showAll, setShowAll] = useState(false);
  useEffect(() => { setShowAll(false); }, [target]);
  const mock = isMockHistoryEnabled();

  // Snapshot "now" per open+range so the query key is stable while the dialog
  // is up (a ticking `to` would refetch on every render).
  const toTs = useMemo(() => Date.now(), [target, rangeMs]); // eslint-disable-line react-hooks/exhaustive-deps
  const fromTs = toTs - rangeMs;

  const recordable = useMemo(
    () => (target?.accessory ? sortByHistoryImportance(getRecordableCharacteristics(target.accessory)) : []),
    [target],
  );
  const charByType = useMemo(() => {
    const map = new Map<string, WritableChar>();
    for (const c of recordable) map.set(c.type, c);
    return map;
  }, [recordable]);

  // EVERY recordable characteristic, importance-ordered — the chunked fetch
  // handles the 6-refs-per-query wire cap (the old first-6 cap hid lux and
  // air quality on multi-sensor devices).
  const refs = useMemo<HistorySeriesRefInput[]>(
    () => recordable.map(c => ({
      accessoryId: target!.accessory!.id,
      characteristicType: c.type,
    })),
    [recordable, target],
  );

  const { data: statsData } = useQuery<{ historyStorageStats: HistoryStorageStatsData }>(
    GET_HISTORY_STORAGE_STATS,
    { variables: { homeId: target?.homeId }, skip: !target || mock },
  );
  const historyEnabled = mock || (statsData?.historyStorageStats?.enabled ?? true);

  // Group mode needs the home's recorded-series listing for member lookup.
  const { data: recordedData } = useQuery<{ historySeries: HistorySeriesInfo[] }>(GET_HISTORY_SERIES, {
    variables: { homeId: target?.homeId },
    skip: !target?.group || mock || !historyEnabled,
    fetchPolicy: 'cache-and-network',
  });
  const recorded = useMemo<HistorySeriesInfo[]>(
    () => (mock ? mockRecordedSeries() : (recordedData?.historySeries ?? [])),
    [mock, recordedData],
  );

  const { data: histMap, loading } = useMultiSeriesHistory(
    target?.homeId ?? null, refs, fromTs, toTs, 0, mock,
    { enabled: !!target && historyEnabled },
  );

  const series: HistorySeriesData[] = useMemo(() => {
    if (!target?.accessory) return [];
    const accessoryKey = target.accessory.id.toUpperCase();
    return recordable.flatMap(c => {
      const entry = histMap.get(`${accessoryKey}|${c.type}`);
      return entry ? [entry.main] : [];
    });
  }, [target, recordable, histMap]);

  const hasAnyData = series.some(
    s => s.points.length > 0 || s.states.length > 0 || s.stateBuckets.length > 0,
  );

  const renderSeriesRow = (raw: HistorySeriesData) => {
    const char = charByType.get(raw.characteristicType);
    const isNumeric = raw.kind === 'numeric';
    // Radio-fault sentinels (-40°) would stretch this little chart flat.
    const sanitized = isNumeric ? sanitizeSeriesData(raw) : { data: raw, droppedPoints: 0 };
    const s = sanitized.data;
    const stats = isNumeric ? numericStats(s) : null;
    const states = !isNumeric ? stateStats(s, fromTs, toTs) : null;
    const empty = s.points.length === 0 && s.states.length === 0 && s.stateBuckets.length === 0;
    const unit = s.unit ?? '';
    return (
      <div key={s.characteristicType} className="space-y-1.5">
        <div className="flex items-baseline justify-between">
          <span className="text-xs font-medium">{charLabel(s.characteristicType)}</span>
          {s.resolution !== 'raw' && (
            <span className="text-[10px] text-muted-foreground">{s.resolution} averages</span>
          )}
        </div>
        {empty ? (
          <div className="h-12 rounded-md border border-dashed flex items-center justify-center">
            <span className="text-xs text-muted-foreground">
              {isNumeric ? 'No data in this range' : 'Monitoring — no events in this range'}
            </span>
          </div>
        ) : isNumeric ? (
          <>
            <Suspense fallback={<div className="h-[200px] w-full" />}>
              <HistoryChart
                points={s.points}
                unit={s.unit}
                gradientId={`hist-${target?.accessory?.id}-${s.characteristicType}`}
              />
            </Suspense>
            {stats && (
              <p className="text-[11px] text-muted-foreground">
                min {stats.min.toFixed(1)}{unit} · avg {stats.avg.toFixed(1)}{unit} · max {stats.max.toFixed(1)}{unit}
                {sanitized.droppedPoints > 0 && ` · ${sanitized.droppedPoints} implausible hidden`}
              </p>
            )}
          </>
        ) : (
          <>
            <StateTimeline
              fromTs={fromTs}
              toTs={toTs}
              prevValue={s.prevValue}
              prevValueText={s.prevValueText}
              states={s.states}
              stateBuckets={s.stateBuckets}
              labelFor={(v, text) => labelForValue(char, s.characteristicType, v, text)}
            />
            {states && states.totals.length > 0 && (
              <p className="text-[11px] text-muted-foreground">
                {states.totals.slice(0, 3).map(([key, ms]) =>
                  `${labelForKey(char, s.characteristicType, key)} ${formatDuration(ms)}`,
                ).join(' · ')}
                {states.transitions > 0 && ` · ${states.transitions} changes`}
              </p>
            )}
          </>
        )}
      </div>
    );
  };

  return (
    <Dialog open={!!target} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-base leading-tight pr-6 flex items-center gap-2">
            <LineChart className="h-4 w-4 text-muted-foreground" />
            <span className="flex-1 truncate">{target?.accessory?.name ?? target?.group?.name ?? 'History'}</span>
            <button
              onClick={() => {
                const accessory = target?.accessory;
                const group = target?.group;
                const homeId = target?.homeId;
                onClose();
                if (group) openAnalytics({ level: 'group', groupId: group.id, homeId });
                else openAnalytics(accessory ? { level: 'accessory', accessory, homeId } : undefined);
              }}
              className="text-xs font-normal text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
              title="Open full-screen and compare with other accessories"
            >
              Expand <ExternalLink className="h-3 w-3" />
            </button>
          </DialogTitle>
        </DialogHeader>

        <div className="flex gap-1">
          {RANGES.map(r => (
            <button
              key={r.label}
              onClick={() => setRangeMs(r.ms)}
              className={`text-[11px] px-2 py-0.5 rounded transition-colors ${
                rangeMs === r.ms
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:bg-muted'
              }`}
            >
              {r.label}
            </button>
          ))}
        </div>

        {!historyEnabled ? (
          <div className="py-8 text-center space-y-2">
            <p className="text-sm text-muted-foreground">
              History is off for this home. Nothing is being recorded.
            </p>
            {onOpenSettings && (
              <button className="text-sm text-primary underline" onClick={onOpenSettings}>
                Turn on in Settings → Homes → this home
              </button>
            )}
          </div>
        ) : target?.group ? (
          <Suspense fallback={<div className="h-[240px]" />}>
            <GroupHistorySections
              homeId={target.homeId}
              mock={mock}
              group={target.group}
              recorded={recorded}
              fromTs={fromTs}
              toTs={toTs}
            />
          </Suspense>
        ) : loading && !hasAnyData ? (
          <div className="py-10 flex items-center justify-center text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        ) : !hasAnyData ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            No history recorded for this range yet — charts fill in as the
            accessory reports changes.
          </p>
        ) : (
          <div className="space-y-5">
            {series.slice(0, 6).map(renderSeriesRow)}
            {series.length > 6 && (
              <>
                <AnimatedCollapse open={showAll}>
                  <div className="space-y-5 pb-1">{series.slice(6).map(renderSeriesRow)}</div>
                </AnimatedCollapse>
                <button
                  className="w-full text-[11px] text-muted-foreground hover:text-foreground inline-flex items-center justify-center gap-1 py-1"
                  onClick={() => setShowAll(v => !v)}
                >
                  <ChevronDown className={`h-3 w-3 transition-transform ${showAll ? 'rotate-180' : ''}`} />
                  {showAll ? 'Show fewer' : `Show ${series.length - 6} more`}
                </button>
              </>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
