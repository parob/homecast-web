import { useMemo, useState } from 'react';
import type { AccessoryInfoEntry, OrganizedCategory } from '@/history/categories';
import GroupHistorySections from './GroupHistorySections';
import type { HistorySeriesInfo } from '@/lib/graphql/types';

const RANGES = [
  { label: '6h', ms: 6 * 3_600_000 },
  { label: '24h', ms: 24 * 3_600_000 },
  { label: '7d', ms: 7 * 86_400_000 },
  { label: '30d', ms: 30 * 86_400_000 },
  { label: '1y', ms: 365 * 86_400_000 },
] as const;

/**
 * The full-screen Groups view: group chips + range control around the same
 * aggregated per-characteristic sections the compact group popup shows
 * (GroupHistorySections) — one story, two frames.
 */
export default function GroupView({
  homeId,
  mock,
  category,
  groupId,
  recorded,
  onGroupChange,
}: {
  homeId: string | null;
  mock: boolean;
  category: OrganizedCategory;
  groupId?: string | null;
  accessoryInfo?: Map<string, AccessoryInfoEntry>;
  /** The home's full recorded-series listing (member lookup). */
  recorded: HistorySeriesInfo[];
  onGroupChange: (groupId: string) => void;
}) {
  const [rangeMs, setRangeMs] = useState<number>(24 * 3_600_000);
  const groups = category.groups ?? [];
  const activeGroup = groups.find(g => g.id.toUpperCase() === groupId?.toUpperCase()) ?? groups[0] ?? null;

  const seriesKey = activeGroup?.id ?? '';
  const toTs = useMemo(() => Date.now(), [seriesKey, rangeMs]); // eslint-disable-line react-hooks/exhaustive-deps
  const fromTs = toTs - rangeMs;
  const memberCount = activeGroup?.memberIds.length ?? 0;

  return (
    <div className="space-y-4">
      {groups.length > 1 && (
        <div className="flex flex-wrap gap-1.5">
          {groups.map(g => (
            <button
              key={g.id}
              onClick={() => onGroupChange(g.id)}
              className={`text-[11px] px-2.5 py-1 rounded-full border transition-colors ${
                g.id === activeGroup?.id
                  ? 'bg-primary text-primary-foreground border-primary'
                  : 'text-muted-foreground hover:bg-muted'
              }`}
            >
              {g.name}
            </button>
          ))}
        </div>
      )}

      <div className="flex items-center gap-2">
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
        {activeGroup && (
          <p className="text-[11px] text-muted-foreground">
            aggregated across {memberCount} member{memberCount === 1 ? '' : 's'}
          </p>
        )}
      </div>

      {activeGroup && (
        <GroupHistorySections
          homeId={homeId}
          mock={mock}
          group={activeGroup}
          recorded={recorded}
          fromTs={fromTs}
          toTs={toTs}
        />
      )}
    </div>
  );
}
