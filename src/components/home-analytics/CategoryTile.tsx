import { useMemo } from 'react';
import {
  Activity as ActivityIcon,
  Battery,
  Boxes,
  ChevronRight,
  CircleDot,
  ShieldAlert,
  Sparkles,
  Thermometer,
  Zap,
} from 'lucide-react';
import { CATEGORIES, type OrganizedCategory } from '@/history/categories';
import Sparkline from './Sparkline';
import { useMultiSeriesHistory } from './useMultiSeriesHistory';
import type { HistorySeriesRefInput } from '@/lib/graphql/types';

/**
 * One overview tile: live 24h summary of a category — headline value or
 * event count, sparkline, and the series/room footprint. Exactly ONE
 * bounded GetHistory behind it (≤6 refs, 48 points) and none at all when
 * the category has nothing recorded yet.
 */

export const CATEGORY_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  climate: Thermometer,
  activity: ActivityIcon,
  safety: ShieldAlert,
  energy: Zap,
  battery: Battery,
  groups: Boxes,
  virtual: Sparkles,
  other: CircleDot,
};

const DAY_MS = 86_400_000;

export default function CategoryTile({
  homeId,
  mock,
  category,
  onOpen,
}: {
  homeId: string | null;
  mock: boolean;
  category: OrganizedCategory;
  onOpen: () => void;
}) {
  const meta = CATEGORIES[category.id];
  const Icon = CATEGORY_ICONS[category.id] ?? CircleDot;

  // The tile's sample: numeric series first (they drive the sparkline and
  // headline), then state series to fill the event count, capped at 6.
  // Groups keep their series under cat.groups, not cat.series.
  const sample = useMemo(() => {
    const pool = category.id === 'groups'
      ? (category.groups ?? []).flatMap(g => g.series)
      : category.series;
    const numeric = pool.filter(s => s.kind === 'numeric');
    const state = pool.filter(s => s.kind !== 'numeric');
    return [...numeric, ...state].slice(0, 6);
  }, [category]);

  const refs = useMemo<HistorySeriesRefInput[]>(
    () => sample.map(s => ({ accessoryId: s.accessoryId, characteristicType: s.characteristicType })),
    [sample],
  );
  const toTs = useMemo(() => Date.now(), []);
  const { data } = useMultiSeriesHistory(
    homeId, refs, toTs - DAY_MS, toTs, 0, mock,
    { maxPoints: 48, enabled: refs.length > 0 },
  );

  const summary = useMemo(() => {
    let sparkValues: number[] = [];
    let headline: string | null = null;
    let events = 0;
    for (const sel of sample) {
      const entry = data.get(`${sel.accessoryId.toUpperCase()}|${sel.characteristicType}`);
      if (!entry) continue;
      if (sel.kind === 'numeric' && entry.main.points.length > 1) {
        if (sparkValues.length === 0) {
          sparkValues = entry.main.points.map(p => p.avg);
          const last = entry.main.points[entry.main.points.length - 1].last;
          headline = `${last.toFixed(1)}${sel.unit ?? ''}`;
        }
      } else {
        events += entry.main.states.length;
        for (const bucket of entry.main.stateBuckets) events += bucket.transitions;
      }
    }
    return { sparkValues, headline, events };
  }, [data, sample]);

  const footprint = category.id === 'groups'
    ? `${category.groups?.length ?? 0} group${(category.groups?.length ?? 0) === 1 ? '' : 's'}`
    : [
        `${category.series.length} series`,
        category.roomCount > 0 ? `${category.roomCount} room${category.roomCount === 1 ? '' : 's'}` : null,
      ].filter(Boolean).join(' · ');

  return (
    <button
      className="text-left border rounded-xl p-4 hover:bg-muted/50 transition-colors flex flex-col gap-2 group"
      onClick={onOpen}
    >
      <div className="flex items-center gap-2">
        <span className="h-7 w-7 rounded-lg bg-muted flex items-center justify-center shrink-0">
          <Icon className="h-4 w-4 text-muted-foreground" />
        </span>
        <span className="text-sm font-medium flex-1 truncate">{meta.title}</span>
        <ChevronRight className="h-4 w-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
      </div>

      <div className="flex items-end justify-between gap-2 min-h-[28px]">
        <div className="min-w-0">
          {summary.headline ? (
            <p className="text-lg font-semibold tabular-nums leading-none">{summary.headline}</p>
          ) : summary.events > 0 ? (
            <p className="text-lg font-semibold tabular-nums leading-none">
              {summary.events}
              <span className="text-xs font-normal text-muted-foreground ml-1">events · 24h</span>
            </p>
          ) : sample.length === 0 ? (
            <p className="text-xs text-muted-foreground">monitoring · no events yet</p>
          ) : (
            <p className="text-xs text-muted-foreground">quiet last 24h</p>
          )}
        </div>
      </div>

      {summary.sparkValues.length > 1 ? (
        <Sparkline values={summary.sparkValues} height={28} />
      ) : (
        <div style={{ height: 28 }} />
      )}

      <p className="text-[11px] text-muted-foreground">
        {footprint}
        {category.monitoring.length > 0 && (
          <span> · {category.monitoring.length} monitoring</span>
        )}
      </p>
    </button>
  );
}
