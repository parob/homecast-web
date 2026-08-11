import { useState } from 'react';
import StateTimeline from '@/components/widgets/StateTimeline';
import { stateValueLabel } from '@/history/labels';
import { canonicalHistoryType } from '@/history/keys';
import type { SeriesSel } from './types';
import type { HistorySeriesData } from '@/lib/graphql/types';

export interface StateStripEntry {
  sel: SeriesSel;
  data: HistorySeriesData;
  /** Room heading key when the host groups strips by room. */
  room?: string | null;
}

/**
 * The state-series half of a view: one timeline strip per bool/enum series,
 * labelled in the characteristic's own vocabulary. When `groupByRoom` is on
 * (category views spanning rooms) strips gather under room headings so a
 * dozen motion sensors read as a floor plan, not a list.
 */
export default function StateStrips({
  entries,
  fromTs,
  toTs,
  groupByRoom = false,
  maxPerRoom,
}: {
  entries: StateStripEntry[];
  fromTs: number;
  toTs: number;
  groupByRoom?: boolean;
  /** Cap strips per room heading; the rest sit behind "show more". */
  maxPerRoom?: number;
}) {
  const [expandedRooms, setExpandedRooms] = useState<Set<string>>(new Set());
  if (entries.length === 0) return null;

  const renderStrip = ({ sel, data }: StateStripEntry) => (
    <div key={`${sel.accessoryId}|${sel.characteristicType}`} className="space-y-1">
      <p className="text-[11px] text-muted-foreground">{sel.label}</p>
      <StateTimeline
        fromTs={fromTs}
        toTs={toTs}
        prevValue={data.prevValue}
        prevValueText={data.prevValueText}
        states={data.states}
        stateBuckets={data.stateBuckets}
        labelFor={(v, text) => text ?? stateValueLabel(canonicalHistoryType(sel.characteristicType), v)}
      />
    </div>
  );

  if (!groupByRoom) {
    return (
      <div className="border rounded-lg p-3 space-y-2">
        {entries.map(renderStrip)}
      </div>
    );
  }

  const byRoom = new Map<string, StateStripEntry[]>();
  for (const entry of entries) {
    const room = entry.room ?? 'Elsewhere';
    const list = byRoom.get(room) ?? [];
    list.push(entry);
    byRoom.set(room, list);
  }

  return (
    <div className="border rounded-lg p-3 space-y-3">
      {[...byRoom.entries()].map(([room, list]) => {
        const expanded = expandedRooms.has(room);
        const cap = maxPerRoom && !expanded ? maxPerRoom : list.length;
        const hidden = list.length - cap;
        return (
          <div key={room} className="space-y-2">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{room}</p>
            {list.slice(0, cap).map(renderStrip)}
            {(hidden > 0 || (expanded && maxPerRoom && list.length > maxPerRoom)) && (
              <button
                className="text-[11px] text-muted-foreground hover:text-foreground"
                onClick={() => setExpandedRooms(prev => {
                  const next = new Set(prev);
                  if (expanded) next.delete(room); else next.add(room);
                  return next;
                })}
              >
                {expanded ? 'Show fewer' : `Show ${hidden} more`}
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}
