import { useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, ChevronDown } from 'lucide-react';
import { charLabel } from '@/components/automations/format';
import { stripRoomPrefix } from '@/history/labels';
import type { AccessoryInfoEntry, OrganizedCategory } from '@/history/categories';
import type { LiveAccessory } from '@/history/summaries';
import MeasureView from './MeasureView';
import type { ExplorerView } from './types';

const SAFETY_TYPES: Record<string, string> = {
  smoke_detected: 'Smoke',
  carbon_monoxide_detected: 'Carbon monoxide',
  carbon_dioxide_detected: 'CO₂',
  leak_detected: 'Leak',
};

/**
 * Safety leads with the status board — every alarm's live state, triggered
 * first — because "all clear" IS the answer here, not missing data. Gas and
 * particulate levels chart below it (measure-first) when any are recorded;
 * the recordable-but-silent list sits behind one disclosure.
 */
export default function SafetyView({
  homeId,
  mock,
  category,
  room,
  live,
  accessoryInfo,
  onRoomChange,
  onCustomize,
}: {
  homeId: string | null;
  mock: boolean;
  category: OrganizedCategory;
  room?: string | null;
  live: LiveAccessory[];
  accessoryInfo: Map<string, AccessoryInfoEntry>;
  onRoomChange: (room: string | null) => void;
  onCustomize: (view: ExplorerView) => void;
}) {
  const [showMonitoring, setShowMonitoring] = useState(false);

  const board = useMemo(() => {
    const rows: Array<{ id: string; name: string; room: string | null; label: string; triggered: boolean }> = [];
    for (const acc of live) {
      for (const [type, label] of Object.entries(SAFETY_TYPES)) {
        const value = acc.values[type];
        if (typeof value !== 'number') continue;
        rows.push({
          id: `${acc.id}|${type}`,
          name: stripRoomPrefix(acc.name, acc.room),
          room: acc.room,
          label,
          triggered: value !== 0,
        });
      }
    }
    rows.sort((a, b) => Number(b.triggered) - Number(a.triggered) || (a.room ?? '').localeCompare(b.room ?? ''));
    return rows;
  }, [live]);

  // Gas/particulate level series chart via the measure-first view.
  const numericCategory = useMemo<OrganizedCategory>(() => ({
    ...category,
    series: category.series.filter(s => s.kind === 'numeric'),
    monitoring: [],
  }), [category]);
  const hasNumeric = numericCategory.series.length > 0;

  const triggered = board.filter(r => r.triggered);

  return (
    <div className="space-y-4">
      {board.length > 0 && (
        <div className="border rounded-lg p-3 space-y-1">
          <div className="flex items-center gap-2 pb-1">
            {triggered.length === 0 ? (
              <>
                <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                <p className="text-xs font-medium">All clear — {board.length} sensors quiet</p>
              </>
            ) : (
              <>
                <AlertTriangle className="h-4 w-4 text-destructive" />
                <p className="text-xs font-medium text-destructive">
                  {triggered.length} alert{triggered.length === 1 ? '' : 's'}
                </p>
              </>
            )}
          </div>
          {(triggered.length > 0 ? board.slice(0, 20) : board.slice(0, 8)).map(row => (
            <div key={row.id} className="flex items-center gap-2 text-xs py-0.5">
              {row.triggered ? (
                <AlertTriangle className="h-3.5 w-3.5 text-destructive shrink-0" />
              ) : (
                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600/60 shrink-0" />
              )}
              <span className="min-w-0 flex-1 truncate">
                {row.name}
                {row.room && <span className="text-muted-foreground"> · {row.room}</span>}
              </span>
              <span className={row.triggered ? 'text-destructive font-medium' : 'text-muted-foreground'}>
                {row.triggered ? row.label : `${row.label} · clear`}
              </span>
            </div>
          ))}
          {board.length > 8 && triggered.length === 0 && (
            <p className="text-[11px] text-muted-foreground pt-1">
              +{board.length - 8} more, all clear
            </p>
          )}
        </div>
      )}

      {hasNumeric && (
        <MeasureView
          homeId={homeId}
          mock={mock}
          category={numericCategory}
          room={room}
          accessoryInfo={accessoryInfo}
          onRoomChange={onRoomChange}
          onCustomize={onCustomize}
        />
      )}

      {category.monitoring.length > 0 && (
        <div className="border rounded-lg p-3">
          <button
            className="w-full flex items-center justify-between text-[11px] text-muted-foreground hover:text-foreground"
            onClick={() => setShowMonitoring(v => !v)}
          >
            <span>
              {category.monitoring.length} characteristics monitoring — they
              record the moment something happens
            </span>
            <ChevronDown className={`h-3.5 w-3.5 transition-transform ${showMonitoring ? 'rotate-180' : ''}`} />
          </button>
          {showMonitoring && (
            <div className="space-y-1 pt-2">
              {category.monitoring.slice(0, 60).map(m => (
                <p key={`${m.accessoryId}|${m.characteristicType}`} className="text-xs text-muted-foreground">
                  <span className="text-foreground">{stripRoomPrefix(m.accessoryName, m.room)}</span>
                  {m.room ? ` · ${m.room}` : ''} · {charLabel(m.characteristicType)}
                </p>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
