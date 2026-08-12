import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { ChevronDown, ExternalLink, Loader2, LineChart } from 'lucide-react';
import { useQuery } from '@apollo/client/react';
import { GET_HISTORY_STORAGE_STATS, GET_HISTORY_SERIES } from '@/lib/graphql/queries';
import { getRecordableCharacteristics, sortByHistoryImportance, type WritableChar } from '@/components/automations/characteristics';
import { isMockHistoryEnabled, mockRecordedSeries } from '@/history/mock';
import { useHistory } from '@/contexts/HistoryContext';
import { useMultiSeriesHistory } from '@/components/home-analytics/useMultiSeriesHistory';
import { AnimatedCollapse } from '@/components/ui/animated-collapse';
import type {
  HomeKitAccessory,
  HistoryPointData,
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
import { AccessorySeriesSection } from '@/components/home-analytics/AccessorySections';

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


/** Time-in-state totals + transition count across the served range. */


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
    target?.homeId ?? null, refs, fromTs, toTs, mock,
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

  // The section renderer lives in home-analytics now: the Analytics surface
  // renders the SAME component at its accessory scope, so the layout people
  // like here cannot drift away from the one they meet there.
  const renderSeriesRow = (raw: HistorySeriesData) => (
    <AccessorySeriesSection
      key={raw.characteristicType}
      raw={raw}
      fromTs={fromTs}
      toTs={toTs}
      char={charByType.get(raw.characteristicType)}
      gradientKey={target?.accessory?.id ?? 'group'}
    />
  );

  return (
    <Dialog open={!!target} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto overflow-x-hidden">
        <DialogHeader>
          <DialogTitle className="text-base leading-tight pr-6 flex items-center gap-2">
            <LineChart className="h-4 w-4 text-muted-foreground" />
            <span className="flex-1 truncate">{target?.accessory?.name ?? target?.group?.name ?? 'Analytics'}</span>
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
              Open in Analytics <ExternalLink className="h-3 w-3" />
            </button>
          </DialogTitle>
        </DialogHeader>

        <div className="flex gap-1">
          {RANGES.map(r => (
            <button
              key={r.label}
              onClick={() => setRangeMs(r.ms)}
              className={`text-[0.6875rem] px-2 py-0.5 rounded transition-colors ${
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
              Analytics is off for this home. Nothing is being recorded.
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
            Nothing recorded for this range yet — charts fill in as the
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
                  className="w-full text-[0.6875rem] text-muted-foreground hover:text-foreground inline-flex items-center justify-center gap-1 py-1"
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
