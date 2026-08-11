import { useMemo } from 'react';
import { SlidersHorizontal } from 'lucide-react';
import { charLabel } from '@/components/automations/format';
import { canonicalHistoryType } from '@/history/keys';
import { disambiguateSeriesLabels } from '@/history/labels';
import type { AccessoryInfoEntry, OrganizedCategory } from '@/history/categories';
import ChartPanel from './ChartPanel';
import { Button } from '@/components/ui/button';
import type { ExplorerView, SeriesSel } from './types';
import type { HistorySeriesInfo } from '@/lib/graphql/types';

/**
 * One category, explorable: a room filter across the top (groups category
 * swaps rooms for groups), the shared chart body under it, and monitoring
 * rows for recordable-but-silent characteristics. "Customize" carries the
 * current series into a custom view for free-form editing.
 */

const MAX_SERIES = 20;

export default function CategoryView({
  homeId,
  mock,
  category,
  room,
  groupId,
  accessoryInfo,
  onRoomChange,
  onGroupChange,
  onCustomize,
}: {
  homeId: string | null;
  mock: boolean;
  category: OrganizedCategory;
  /** Current room filter; null/undefined = all rooms. */
  room?: string | null;
  /** Groups category: the selected service group. */
  groupId?: string | null;
  accessoryInfo: Map<string, AccessoryInfoEntry>;
  onRoomChange: (room: string | null) => void;
  onGroupChange: (groupId: string) => void;
  onCustomize: (view: ExplorerView) => void;
}) {
  const isGroups = category.id === 'groups';

  const rooms = useMemo(() => {
    const named = [...category.byRoom.keys()].filter((r): r is string => r !== null).sort();
    if (category.byRoom.has(null) || category.monitoring.some(m => m.room === null)) named.push('Elsewhere');
    return named;
  }, [category]);

  const activeGroup = useMemo(() => {
    if (!isGroups) return null;
    const groups = category.groups ?? [];
    return groups.find(g => g.id.toUpperCase() === groupId?.toUpperCase()) ?? groups[0] ?? null;
  }, [isGroups, category.groups, groupId]);

  // The series in scope: the room filter's slice of the category, numeric
  // first. A group is ONE item — its own recorded series (group writes
  // record under the group id). A per-member fan-out led with brightness
  // and read as a wall of 100% lines; members chart under their own rooms
  // and device analytics instead.
  const scoped = useMemo<SeriesSel[]>(() => {
    let infos: HistorySeriesInfo[];
    if (isGroups) {
      infos = activeGroup?.series ?? [];
    } else if (room === 'Elsewhere') {
      infos = category.byRoom.get(null) ?? [];
    } else if (room) {
      infos = category.byRoom.get(room) ?? [];
    } else {
      infos = category.series;
    }

    const items = infos.map(s => {
      const info = accessoryInfo.get(s.accessoryId.toUpperCase());
      return {
        key: `${s.accessoryId.toUpperCase()}|${s.characteristicType}`,
        room: info?.room ?? null,
        accessoryName: info?.name ?? s.accessoryId.slice(0, 8),
        charLabel: charLabel(s.characteristicType),
        series: s,
      };
    });
    const labels = disambiguateSeriesLabels(items);
    const sels = items.map(({ key, series: s, room: r }): SeriesSel => ({
      accessoryId: s.accessoryId,
      characteristicType: s.characteristicType,
      // Group-id series (isGroups' infos) carry the group's name — the id
      // means nothing to accessoryInfo.
      label: isGroups ? `${activeGroup?.name ?? 'Group'} · Group` : (labels.get(key)?.short ?? key),
      fullLabel: isGroups
        ? `${activeGroup?.name ?? 'Group'} · ${charLabel(s.characteristicType)} (group)`
        : labels.get(key)?.full,
      room: r,
      unit: s.unit,
      kind: s.kind,
    }));

    sels.sort((a, b) => (a.kind === 'numeric' ? 0 : 1) - (b.kind === 'numeric' ? 0 : 1));
    return sels.slice(0, MAX_SERIES);
  }, [isGroups, activeGroup, room, category, accessoryInfo]);

  // The climate band rule: ≥4 temperature sensors in scope collapse into a
  // min–max envelope with a bold average.
  const aggregate = category.id === 'climate'
    && scoped.filter(s => canonicalHistoryType(s.characteristicType) === 'current_temperature').length >= 4;

  const monitoring = useMemo(() => category.monitoring.filter(m =>
    !room || (room === 'Elsewhere' ? m.room === null : m.room === room),
  ), [category.monitoring, room]);

  const chips = isGroups
    ? (category.groups ?? []).map(g => ({
        key: g.id,
        label: g.name,
        active: g.id === activeGroup?.id,
        onClick: () => onGroupChange(g.id),
      }))
    : rooms.length > 1
      ? [
          { key: '__all', label: 'All rooms', active: !room, onClick: () => onRoomChange(null) },
          ...rooms.map(r => ({ key: r, label: r, active: room === r, onClick: () => onRoomChange(r) })),
        ]
      : [];

  return (
    <div className="space-y-4">
      {chips.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {chips.map(chip => (
            <button
              key={chip.key}
              onClick={chip.onClick}
              className={`text-[11px] px-2.5 py-1 rounded-full border transition-colors ${
                chip.active
                  ? 'bg-primary text-primary-foreground border-primary'
                  : 'text-muted-foreground hover:bg-muted'
              }`}
            >
              {chip.label}
            </button>
          ))}
        </div>
      )}

      {scoped.length > 0 ? (
        <ChartPanel
          homeId={homeId}
          mock={mock}
          series={scoped}
          aggregate={aggregate}
          groupStripsByRoom={!isGroups && !room}
          extraControls={
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs"
              onClick={() => onCustomize({
                title: 'Custom view',
                series: scoped,
                aggregate: false,
              })}
            >
              <SlidersHorizontal className="h-3 w-3 mr-1" /> Customize
            </Button>
          }
        />
      ) : (
        <div className="py-12 text-center">
          <p className="text-sm text-muted-foreground">
            Nothing recorded here yet — charts build as devices report changes.
          </p>
        </div>
      )}

      {monitoring.length > 0 && (
        <div className="border rounded-lg p-3">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">
            Monitoring — no events yet
          </p>
          <div className="space-y-1">
            {monitoring.map(m => (
              <p key={`${m.accessoryId}|${m.characteristicType}`} className="text-xs text-muted-foreground">
                <span className="text-foreground">{m.accessoryName}</span>
                {m.room ? ` · ${m.room}` : ''} · {charLabel(m.characteristicType)}
              </p>
            ))}
          </div>
          <p className="text-[11px] text-muted-foreground mt-2">
            These record the moment something happens — a quiet sensor is a
            good sign.
          </p>
        </div>
      )}
    </div>
  );
}
