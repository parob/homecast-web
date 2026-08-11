import { useMemo, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { onMs } from '@/history/insights';
import { stateValueLabel } from '@/history/labels';
import { canonicalHistoryType } from '@/history/keys';
import StateTimeline from '@/components/widgets/StateTimeline';
import type { AccessoryInfoEntry, OrganizedCategory } from '@/history/categories';
import { buildSels } from './selBuilder';
import { useMultiSeriesHistory } from './useMultiSeriesHistory';
import type { HistorySeriesRefInput } from '@/lib/graphql/types';

const SWITCH_TYPES = new Set(['power_state', 'active', 'in_use', 'outlet_in_use']);
const TOP_N = 10;

function formatDuration(ms: number): string {
  const minutes = Math.round(ms / 60_000);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

/**
 * "What ran, and for how long" as a ranked answer instead of a wall of 200
 * strips. Top accessories by time-on today; a row expands into its
 * timeline. This is the Usage half of Energy — the watt charts are the
 * Power half above it.
 */
export default function UsageTable({
  homeId,
  mock,
  category,
  room,
  accessoryInfo,
}: {
  homeId: string | null;
  mock: boolean;
  category: OrganizedCategory;
  room?: string | null;
  accessoryInfo: Map<string, AccessoryInfoEntry>;
}) {
  const [now] = useState(() => Date.now());
  const dayStart = useMemo(() => new Date(now).setHours(0, 0, 0, 0), [now]);
  const [expanded, setExpanded] = useState<string | null>(null);

  const sels = useMemo(() => {
    const infos = category.series.filter(s => {
      if (!SWITCH_TYPES.has(canonicalHistoryType(s.characteristicType))) return false;
      if (!room) return true;
      const r = accessoryInfo.get(s.accessoryId.toUpperCase())?.room ?? null;
      return r === (room === 'Elsewhere' ? null : room);
    });
    return buildSels(infos.slice(0, 30), accessoryInfo);
  }, [category.series, room, accessoryInfo]);

  const refs = useMemo<HistorySeriesRefInput[]>(
    () => sels.map(s => ({ accessoryId: s.accessoryId, characteristicType: s.characteristicType })),
    [sels],
  );
  const { data, loading } = useMultiSeriesHistory(homeId, refs, dayStart, now, 0, mock, {
    enabled: refs.length > 0,
  });

  const rows = useMemo(() => {
    const out = sels.flatMap(sel => {
      const entry = data.get(`${sel.accessoryId.toUpperCase()}|${canonicalHistoryType(sel.characteristicType)}`);
      if (!entry) return [];
      return [{ sel, data: entry.main, onMs: onMs(entry.main, dayStart, now) }];
    });
    out.sort((a, b) => b.onMs - a.onMs);
    return out.slice(0, TOP_N);
  }, [sels, data, dayStart, now]);

  if (sels.length === 0 || (rows.length === 0 && !loading)) return null;
  const windowMs = Math.max(now - dayStart, 1);

  return (
    <div className="border rounded-lg p-3 space-y-2">
      <div className="flex items-baseline justify-between">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          Usage today
        </p>
        <p className="text-[11px] text-muted-foreground">
          time on so far today · top {Math.min(rows.length, TOP_N)} of {sels.length}
        </p>
      </div>
      <div className="space-y-1">
        {rows.map(row => {
          const key = `${row.sel.accessoryId}|${row.sel.characteristicType}`;
          const isOpen = expanded === key;
          return (
            <div key={key}>
              <button
                className="w-full flex items-center gap-2 py-1 text-xs hover:bg-muted/50 rounded px-1 transition-colors"
                onClick={() => setExpanded(isOpen ? null : key)}
              >
                <span className="min-w-0 flex-1 truncate text-left">
                  {row.sel.label}
                  {row.sel.room && !row.sel.label.includes(row.sel.room) && (
                    <span className="text-muted-foreground"> · {row.sel.room}</span>
                  )}
                </span>
                <span className="w-24 h-1.5 rounded-full bg-muted overflow-hidden shrink-0">
                  <span
                    className="block h-full bg-primary rounded-full"
                    style={{ width: `${Math.min((row.onMs / windowMs) * 100, 100)}%` }}
                  />
                </span>
                <span className="tabular-nums w-14 text-right shrink-0">{formatDuration(row.onMs)}</span>
                <ChevronDown className={`h-3 w-3 text-muted-foreground shrink-0 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
              </button>
              {isOpen && (
                <div className="px-1 pb-2">
                  <StateTimeline
                    fromTs={dayStart}
                    toTs={now}
                    prevValue={row.data.prevValue}
                    prevValueText={row.data.prevValueText}
                    states={row.data.states}
                    stateBuckets={row.data.stateBuckets}
                    labelFor={(v, text) => text ?? stateValueLabel(canonicalHistoryType(row.sel.characteristicType), v)}
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
