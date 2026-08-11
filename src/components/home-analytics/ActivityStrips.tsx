import { useMemo, useState } from 'react';
import { ChevronRight } from 'lucide-react';
import { canonicalHistoryType } from '@/history/keys';
import { groupStrip } from '@/history/groupStrip';
import { stateValueLabel } from '@/history/labels';
import { formatStateDuration, stateTotals } from '@/history/stateSummary';
import StateTimeline from '@/components/widgets/StateTimeline';
import { PLOT_LEFT, PLOT_RIGHT } from './chartGeometry';
import { labelWithRoom, labelWithoutRoom } from './selBuilder';
import type { SeriesSel } from './types';
import type { HistorySeriesData } from '@/lib/graphql/types';

/**
 * Activity, grouped the way the home is.
 *
 * Nine downlights each drew their own timeline saying "Off 20h 30m · 1
 * change" — nine rows, one fact. Those bulbs are a service group and move
 * together, so the GROUP gets the row, shaded by how many of its members were
 * on, and the members go behind a chevron for when you need to know which one
 * misbehaved. Anything not in a group keeps its own row, unchanged.
 *
 * Only power belongs to a group: a group of motion sensors has no shared
 * "how many are detecting" that means anything, so other characteristics stay
 * per-accessory.
 */
export interface ActivityEntry {
  sel: SeriesSel;
  data: HistorySeriesData;
}

export interface ActivityGroup {
  id: string;
  name: string;
  memberIds: string[];
}

const GROUPABLE = new Set(['power_state']);

export default function ActivityStrips({
  entries,
  groups,
  fromTs,
  toTs,
}: {
  entries: ActivityEntry[];
  groups: ActivityGroup[];
  fromTs: number;
  toTs: number;
}) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  // Does this list span rooms? In a room's own view the heading already said
  // which, and repeating it on nine rows spends the widest part of the label
  // on the one word that never varies. Across a home it is the only word that
  // does vary, and leaving it off made nine identical "Hue ambiance spot 3"
  // rows with no way to tell which room any of them was in.
  const spansRooms = useMemo(
    () => new Set(entries.map(e => e.sel.room ?? null)).size > 1,
    [entries],
  );

  const { grouped, loose } = useMemo(() => {
    const claimed = new Set<string>();
    const grouped = groups.flatMap(group => {
      const memberIds = new Set(group.memberIds.map(id => id.toUpperCase()));
      const members = entries.filter(e =>
        GROUPABLE.has(canonicalHistoryType(e.sel.characteristicType))
        && memberIds.has(e.sel.accessoryId.toUpperCase()));
      // A group of one is just that accessory — the row would say the same
      // thing with an extra layer to open.
      if (members.length < 2) return [];
      members.forEach(m => claimed.add(`${m.sel.accessoryId}|${m.sel.characteristicType}`));
      const rooms = new Set(members.map(m => m.sel.room ?? null));
      return [{
        group,
        members,
        groupRoom: rooms.size === 1 ? [...rooms][0] ?? 'Elsewhere' : null,
        strip: groupStrip(members.map(m => m.data), fromTs, toTs),
      }];
    });
    const loose = entries.filter(e => !claimed.has(`${e.sel.accessoryId}|${e.sel.characteristicType}`));
    return { grouped, loose };
  }, [entries, groups, fromTs, toTs]);

  if (grouped.length === 0 && loose.length === 0) return null;

  const renderStrip = ({ sel, data }: ActivityEntry, indent = false) => {
    const type = canonicalHistoryType(sel.characteristicType);
    const { totals, transitions } = stateTotals(data, fromTs, toTs);
    const labelForKey = (key: string) => {
      const parsed = Number(key);
      return Number.isFinite(parsed) && key.trim() !== '' ? stateValueLabel(type, parsed) : key;
    };
    return (
      <div key={`${sel.accessoryId}|${sel.characteristicType}`} className={`space-y-1 ${indent ? 'pl-4' : ''}`}>
        <p className="text-[11px] text-muted-foreground">
          {spansRooms ? labelWithRoom(sel) : labelWithoutRoom(sel)}
        </p>
        <StateTimeline
          fromTs={fromTs}
          toTs={toTs}
          padLeft={PLOT_LEFT}
          padRight={PLOT_RIGHT}
          prevValue={data.prevValue}
          prevValueText={data.prevValueText}
          states={data.states}
          stateBuckets={data.stateBuckets}
          labelFor={(v, text) => text ?? stateValueLabel(type, v)}
        />
        {totals.length > 0 && (
          <p className="text-[10px] text-muted-foreground">
            {totals.slice(0, 3).map(([key, ms]) => `${labelForKey(key)} ${formatStateDuration(ms)}`).join(' · ')}
            {transitions > 0 && ` · ${transitions} change${transitions === 1 ? '' : 's'}`}
          </p>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-3">
      {grouped.map(({ group, members, groupRoom, strip }) => {
        const open = expanded.has(group.id);
        return (
          <div key={group.id} className="space-y-1">
            <button
              className="flex w-full items-center gap-1 text-left"
              onClick={() => setExpanded(prev => {
                const next = new Set(prev);
                if (next.has(group.id)) next.delete(group.id); else next.add(group.id);
                return next;
              })}
            >
              <ChevronRight className={`h-3 w-3 shrink-0 text-muted-foreground transition-transform ${open ? 'rotate-90' : ''}`} />
              <span className="text-[11px] text-muted-foreground">
                {/* A group's own room, when it has one and the name does not
                    already say it: "Living · Living Lights" says it twice.
                    A group whose members span rooms belongs to none. */}
                {spansRooms && groupRoom
                  && !group.name.toLowerCase().startsWith(groupRoom.toLowerCase())
                  ? `${groupRoom} · ${group.name}`
                  : group.name}
              </span>
              <span className="text-[10px] text-muted-foreground/70">
                · {members.length} accessor{members.length === 1 ? 'y' : 'ies'}
              </span>
            </button>
            <StateTimeline
              fromTs={fromTs}
              toTs={toTs}
              padLeft={PLOT_LEFT}
              padRight={PLOT_RIGHT}
              prevValue={null}
              stateBuckets={strip.buckets}
              // The fill IS the share, so the readout names it rather than
              // claiming a single on/off the group never had.
              labelFor={() => 'On'}
            />
            <p className="text-[10px] text-muted-foreground">
              {[
                strip.allOnMs > 0 ? `all on ${formatStateDuration(strip.allOnMs)}` : null,
                strip.someOnMs > 0 ? `some on ${formatStateDuration(strip.someOnMs)}` : null,
                strip.offMs > 0 ? `off ${formatStateDuration(strip.offMs)}` : null,
                strip.peak > 0 ? `peak ${strip.peak} of ${strip.members}` : null,
              ].filter(Boolean).join(' · ')}
            </p>
            {open && <div className="space-y-2 pt-1">{members.map(m => renderStrip(m, true))}</div>}
          </div>
        );
      })}
      {loose.map(entry => renderStrip(entry))}
    </div>
  );
}
