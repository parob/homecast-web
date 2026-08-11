import { useMemo, useState } from 'react';
import { ChevronRight } from 'lucide-react';
import { canonicalHistoryType } from '@/history/keys';
import { groupStrip } from '@/history/groupStrip';
import { stateValueLabel, stripRoomPrefix } from '@/history/labels';
import { isQuietRange } from '@/history/quiet';
import { stateTotals } from '@/history/stateSummary';
import StateTimeline from '@/components/widgets/StateTimeline';
import AnalyticsPanel from './AnalyticsPanel';
import { PLOT_LEFT, PLOT_RIGHT } from './chartGeometry';
import { labelWithRoom, labelWithoutRoom } from './selBuilder';
import type { SeriesSel } from './types';
import type { HistorySeriesData } from '@/lib/graphql/types';

/**
 * Activity, grouped the way the home is and filtered by whether anything
 * actually happened.
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
 *
 * Whatever survives that, the quiet fold in quiet.ts still applies — see there
 * for why a low-battery flag reading OK is a summary line and one reading Low
 * is a row.
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
  const [showQuiet, setShowQuiet] = useState(false);

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
      const strip = groupStrip(members.map(m => m.data), fromTs, toTs);
      return [{
        group,
        members,
        groupRoom: rooms.size === 1 ? [...rooms][0] ?? 'Elsewhere' : null,
        strip,
        // Nobody in the group came on at any point in the range: one flat bar
        // for nine accessories, which is the same nothing the members would
        // each have reported.
        quiet: strip.allOnMs === 0 && strip.someOnMs === 0,
      }];
    });
    const loose = entries
      .filter(e => !claimed.has(`${e.sel.accessoryId}|${e.sel.characteristicType}`))
      .map(entry => {
        const type = canonicalHistoryType(entry.sel.characteristicType);
        const { totals, transitions } = stateTotals(entry.data, fromTs, toTs);
        return { entry, type, totals, transitions, quiet: isQuietRange(type, totals) };
      });
    return { grouped, loose };
  }, [entries, groups, fromTs, toTs]);

  const activeGroups = grouped.filter(g => !g.quiet);
  const quietGroups = grouped.filter(g => g.quiet);
  const activeLoose = loose.filter(r => !r.quiet);
  const quietLoose = loose.filter(r => r.quiet);
  const quietCount = quietGroups.length + quietLoose.length;

  if (grouped.length === 0 && loose.length === 0) return null;

  type LooseRow = typeof loose[number];

  const renderStrip = ({ entry: { sel, data }, type }: LooseRow, indent = false) => (
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
    </div>
  );

  const renderGroup = ({ group, members, groupRoom, strip }: typeof grouped[number]) => {
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
            {/* Strip the room, then put it back only where it distinguishes —
                exactly what an accessory row does. "Living Lights" reads
                "Lights" under its own room and "Living · Lights" across the
                home; a group spanning rooms belongs to none and keeps its
                whole name. */}
            {groupLabel(group.name, groupRoom, spansRooms)}
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
        {open && (
          <div className="space-y-2 pt-1">
            {members.map(m => {
              const type = canonicalHistoryType(m.sel.characteristicType);
              const { totals, transitions } = stateTotals(m.data, fromTs, toTs);
              return renderStrip({ entry: m, type, totals, transitions, quiet: false }, true);
            })}
          </div>
        )}
      </div>
    );
  };

  const shown = activeGroups.length + activeLoose.length;

  return (
    <AnalyticsPanel
      title="Activity"
      source={shown > 0 ? `${shown} timeline${shown === 1 ? '' : 's'}` : undefined}
    >
      <div className="space-y-3">
        {activeGroups.map(renderGroup)}
        {activeLoose.map(row => renderStrip(row))}

        {quietCount > 0 && (
          <div className={shown > 0 ? 'border-t pt-2' : undefined}>
            {/* Folded, not dropped. The line says exactly what the rule
                removed and what those rows were holding, and opening it puts
                every one of them back. */}
            <button
              className="flex w-full items-center gap-1 text-left text-[10px] text-muted-foreground transition-colors hover:text-foreground"
              onClick={() => setShowQuiet(v => !v)}
            >
              <ChevronRight className={`h-3 w-3 shrink-0 transition-transform ${showQuiet ? 'rotate-90' : ''}`} />
              <span className="min-w-0 truncate">No activity</span>
            </button>
            {showQuiet && (
              <div className="space-y-3 pt-2">
                {quietGroups.map(renderGroup)}
                {quietLoose.map(row => renderStrip(row))}
              </div>
            )}
          </div>
        )}
      </div>
    </AnalyticsPanel>
  );
}

/**
 * A group's name for a list that may or may not already say which room it is
 * in — the strip-then-re-add rule the accessory rows follow.
 */
function groupLabel(name: string, room: string | null, spansRooms: boolean): string {
  if (!room) return name;
  const base = stripRoomPrefix(name, room);
  return spansRooms ? `${room} · ${base}` : base;
}

/** A time-in-state key rendered as words — numeric codes go through the
 * characteristic's vocabulary, string-kind keys are already the text. */
function stateKeyLabel(type: string, key: string): string {
  const parsed = Number(key);
  return Number.isFinite(parsed) && key.trim() !== '' ? stateValueLabel(type, parsed) : key;
}
