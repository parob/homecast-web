import { useMemo } from 'react';
import { canonicalHistoryType } from '@/history/keys';
import { stripRoomPrefix } from '@/history/labels';
import type { OrganizedCategory } from '@/history/categories';
import type { LiveAccessory } from '@/history/summaries';
import type { ExplorerView } from './types';

/**
 * Batteries are a ranking, not a chart: every battery in the home sorted
 * worst-first with its live level. Tapping a row opens that accessory's
 * recorded battery curve (when one exists) — the chart is the drill-down,
 * never the wall.
 */
export default function BatteryView({
  category,
  live,
  onCustomize,
}: {
  category: OrganizedCategory;
  live: LiveAccessory[];
  onCustomize: (view: ExplorerView) => void;
}) {
  const rows = useMemo(() => {
    const recorded = new Set(
      category.series
        .filter(s => s.characteristicType === 'battery_level')
        .map(s => s.accessoryId.toUpperCase()),
    );
    return live
      .flatMap(acc => {
        const level = acc.values['battery_level'];
        if (typeof level !== 'number' || !Number.isFinite(level)) return [];
        return [{
          id: acc.id,
          name: stripRoomPrefix(acc.name, acc.room),
          room: acc.room,
          level,
          hasHistory: recorded.has(acc.id.toUpperCase()),
        }];
      })
      .sort((a, b) => a.level - b.level);
  }, [live, category.series]);

  if (rows.length === 0) {
    return (
      <div className="py-12 text-center">
        <p className="text-sm text-muted-foreground">
          No battery-powered accessories reporting right now.
        </p>
      </div>
    );
  }

  const lowCount = rows.filter(r => r.level < 20).length;

  return (
    <div className="space-y-3">
      <p className="text-[11px] text-muted-foreground">
        {rows.length} batteries, live levels, worst first
        {lowCount > 0 ? ` · ${lowCount} below 20%` : ' · all healthy'} — tap
        one with history for its curve
      </p>
      <div className="border rounded-lg divide-y">
        {rows.map(row => {
          const color = row.level < 20 ? 'bg-destructive' : row.level < 40 ? 'bg-amber-500' : 'bg-primary';
          const content = (
            <>
              <span className="min-w-0 flex-1 truncate text-left">
                {row.name}
                {row.room && <span className="text-muted-foreground"> · {row.room}</span>}
              </span>
              {row.level < 20 && (
                <span className="text-[10px] font-medium text-destructive shrink-0">LOW</span>
              )}
              <span className="w-28 h-1.5 rounded-full bg-muted overflow-hidden shrink-0">
                <span className={`block h-full rounded-full ${color}`} style={{ width: `${Math.max(row.level, 2)}%` }} />
              </span>
              <span className="tabular-nums w-12 text-right shrink-0">{Math.round(row.level)}%</span>
            </>
          );
          return row.hasHistory ? (
            <button
              key={row.id}
              className="w-full flex items-center gap-3 px-3 py-2 text-xs hover:bg-muted/50 transition-colors"
              onClick={() => onCustomize({
                title: `${row.name} · Battery`,
                series: [{
                  accessoryId: row.id,
                  characteristicType: canonicalHistoryType('battery_level'),
                  label: `${row.name} · Battery`,
                  fullLabel: [row.room, row.name, 'Battery Level'].filter(Boolean).join(' · '),
                  room: row.room,
                  unit: '%',
                  kind: 'numeric',
                }],
                aggregate: false,
              })}
            >
              {content}
            </button>
          ) : (
            <div key={row.id} className="w-full flex items-center gap-3 px-3 py-2 text-xs text-muted-foreground/90">
              {content}
            </div>
          );
        })}
      </div>
    </div>
  );
}
