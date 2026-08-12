import { useMemo, useState } from 'react';
import { ChevronRight, Home, Layers, LayoutGrid, Search } from 'lucide-react';
import { accessoryIcon } from './accessoryIcons';
import type { AnalyticsScope, ScopeRoom, ScopeTreeModel } from './scope';

/**
 * The navigation pane: the home as it actually is — rooms, the accessories
 * in them, then groups.
 *
 * Collapsed by default and open only where you are. Nine rooms of three
 * accessories each is thirty rows, which is the same data overload the old
 * category lists had, just moved to the left-hand side. The filter is there
 * for the homes where even the room list is long.
 */
export default function ScopeTree({
  tree,
  scope,
  homeName,
  homes = [],
  homeId,
  onSelectHome,
  onSelect,
}: {
  tree: ScopeTreeModel;
  scope: AnalyticsScope;
  homeName: string;
  /** Every home with Analytics on — switchable without leaving the screen. */
  homes?: Array<{ id: string; name: string }>;
  homeId: string | null;
  onSelectHome?: (id: string) => void;
  onSelect: (scope: AnalyticsScope) => void;
}) {
  // undefined, not null, when the scope is not a room: null is a real room
  // here (the roomless bucket) and would match it.
  const openRoom = scope.level === 'room' ? scope.room : undefined;
  const activeAccessory = scope.level === 'accessory' ? scope.accessoryId.toUpperCase() : null;
  const activeGroup = scope.level === 'group' ? scope.groupId : null;
  // Whatever you are standing in, its room opens — an accessory's room, and a
  // GROUP's room too, or picking a room's lights folded that room away under
  // your feet.
  const roomOfActive = useMemo(() => {
    if (activeGroup) {
      return tree.rooms.find(r => r.groups.some(g => g.id === activeGroup))?.room;
    }
    if (!activeAccessory) return undefined;
    return tree.rooms.find(r =>
      r.accessories.some(a => a.id === activeAccessory)
      || r.groups.some(g => g.members.some(m => m.id === activeAccessory)))?.room;
  }, [tree.rooms, activeAccessory, activeGroup]);

  // Expansion is tracked in BOTH directions. A room that opened because you
  // are standing in it must still close when you press its chevron — a Set of
  // "opened" rooms could only ever add.
  const [manual, setManual] = useState<Record<string, boolean>>({});
  const [openGroups, setOpenGroups] = useState<Set<string>>(new Set());
  // A room group opens when you are standing anywhere inside it, and closes
  // when you press its chevron — the same two-way rule rooms follow.
  const [openRoomGroups, setOpenRoomGroups] = useState<Record<string, boolean>>({});
  const [filter, setFilter] = useState('');

  const keyOf = (room: string | null) => room ?? ' roomless';
  const isOpen = (room: string | null) => {
    const explicit = manual[keyOf(room)];
    if (explicit !== undefined) return explicit;
    if (filter.trim()) return true; // filtering is its own expansion
    return room === openRoom || room === roomOfActive;
  };
  const toggle = (room: string | null) => setManual(prev => ({
    ...prev, [keyOf(room)]: !isOpen(room),
  }));
  const toggleGroup = (id: string) => setOpenGroups(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const toggleRoomGroup = (id: string, isOpen: boolean) =>
    setOpenRoomGroups(prev => ({ ...prev, [id]: !isOpen }));

  const needle = filter.trim().toLowerCase();
  const rooms = useMemo(() => {
    if (!needle) return tree.rooms;
    return tree.rooms
      .map(r => {
        const wholeRoom = r.label.toLowerCase().includes(needle);
        return {
          ...r,
          groups: wholeRoom ? r.groups : r.groups.filter(g =>
            g.name.toLowerCase().includes(needle)
            || g.members.some(m => m.name.toLowerCase().includes(needle))),
          accessories: wholeRoom
            ? r.accessories
            : r.accessories.filter(a => a.name.toLowerCase().includes(needle)),
        };
      })
      .filter(r => r.accessories.length > 0 || r.groups.length > 0 || r.label.toLowerCase().includes(needle));
  }, [tree.rooms, needle]);

  const roomGroups = useMemo(() => {
    if (!needle) return tree.roomGroups;
    return tree.roomGroups
      .map(g => ({
        ...g,
        rooms: g.name.toLowerCase().includes(needle)
          ? g.rooms
          : g.rooms.filter(r => r.label.toLowerCase().includes(needle)
            || r.accessories.some(a => a.name.toLowerCase().includes(needle))
            || r.groups.some(x => x.name.toLowerCase().includes(needle))),
      }))
      .filter(g => g.rooms.length > 0 || g.name.toLowerCase().includes(needle));
  }, [tree.roomGroups, needle]);

  const groups = useMemo(() => (
    needle ? tree.groups.filter(g => g.name.toLowerCase().includes(needle)) : tree.groups
  ), [tree.groups, needle]);

  // The main navigation's room rows, exactly: px-3 py-2 text-sm with 16px
  // icons. This tree is the same job in a narrower column, and on a phone it
  // IS that menu — a sidebar that changes size depending on which screen
  // opened it reads as two different lists.
  const rowBase = 'w-full flex items-center gap-2 rounded-lg px-3 py-2 text-left text-sm transition-colors';
  const selected = 'bg-primary/10 text-foreground font-medium';
  const plain = 'text-muted-foreground hover:bg-muted hover:text-foreground';

  const renderRoom = (room: ScopeRoom, indent = 'pl-1') => {
    const open = isOpen(room.room);
    const isRoomScope = scope.level === 'room' && scope.room === room.room;
    return (
          <div key={keyOf(room.room)}>
            <div className={`${rowBase} ${isRoomScope ? selected : plain} ${indent}`}>
              <button
                className="rounded p-0.5 hover:bg-muted"
                onClick={() => toggle(room.room)}
                aria-label={open ? `Collapse ${room.label}` : `Expand ${room.label}`}
              >
                <ChevronRight className={`h-4 w-4 transition-transform ${open ? 'rotate-90' : ''}`} />
              </button>
              <button
                className="min-w-0 flex-1 truncate text-left"
                onClick={() => onSelect({ level: 'room', room: room.room })}
              >
                {room.label}
              </button>
              <span className="shrink-0 text-xs opacity-60">{room.total}</span>
            </div>
            {open && room.groups.map(group => {
              const groupOpen = openGroups.has(group.id);
              const isGroupScope = scope.level === 'group' && scope.groupId === group.id;
          return (
                <div key={group.id}>
                  {/* A room's lights are one row here for the same reason
                      they are one row in its activity: nine near-identical
                      entries are not nine choices. */}
                  <div className={`${rowBase} ${isGroupScope ? selected : plain} pl-4`}>
                    <button
                      className="rounded p-0.5 hover:bg-muted"
                      onClick={() => toggleGroup(group.id)}
                      aria-label={groupOpen ? `Collapse ${group.name}` : `Expand ${group.name}`}
                    >
                      <ChevronRight className={`h-4 w-4 transition-transform ${groupOpen ? 'rotate-90' : ''}`} />
                    </button>
                    <Layers className="h-4 w-4 shrink-0 opacity-70" />
                    <button
                      className="min-w-0 flex-1 truncate text-left"
                      onClick={() => onSelect({ level: 'group', groupId: group.id })}
                    >
                      {group.name}
                    </button>
                    <span className="shrink-0 text-xs opacity-60">{group.memberCount}</span>
                  </div>
                  {groupOpen && group.members.map(member => {
                    const MemberIcon = accessoryIcon(member.widgetType);
              return (
                    <button
                      key={member.id}
                      className={`${rowBase} pl-11 ${activeAccessory === member.id ? selected : plain}`}
                      onClick={() => onSelect({ level: 'accessory', accessoryId: member.id })}
                    >
                      <MemberIcon className="h-4 w-4 shrink-0 opacity-70" />
                      <span className="min-w-0 flex-1 truncate">{member.name}</span>
                      <span className="shrink-0 text-xs opacity-60">{member.seriesCount}</span>
                    </button>
                    );
                  })}
                </div>
              );
            })}
            {open && room.accessories.map(acc => {
              const AccIcon = accessoryIcon(acc.widgetType);
          return (
                <button
                  key={acc.id}
                  className={`${rowBase} pl-7 ${activeAccessory === acc.id ? selected : plain}`}
                  onClick={() => onSelect({ level: 'accessory', accessoryId: acc.id })}
                >
                  <AccIcon className="h-4 w-4 shrink-0 opacity-70" />
                  <span className="min-w-0 flex-1 truncate">{acc.name}</span>
                  <span className="shrink-0 text-xs opacity-60">{acc.seriesCount}</span>
                </button>
              );
            })}
          </div>
          );
  };

  return (
    <div className="flex h-full flex-col gap-2">
      <div className="relative">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Find a room or accessory"
          className="h-9 w-full rounded-lg border bg-background pl-8 pr-2 text-sm outline-none focus:ring-1 focus:ring-ring"
        />
      </div>

      <div className="min-h-0 flex-1 space-y-0.5 overflow-y-auto pr-1">
        {(homes.length > 0 ? homes : [{ id: homeId ?? '', name: homeName }]).map(home => {
          const isCurrent = home.id === homeId || homes.length === 0;
          return (
            <div key={home.id || 'home'}>
              {/* A home expands like a room, and expanding another one IS
                  switching to it — only the home you are in has its tree
                  built, so there is nothing to show until you go there. This
                  is how the main navigation behaves too. */}
              <div className={`${rowBase} ${isCurrent && scope.level === 'home' ? selected : plain}`}>
                <button
                  className="rounded p-0.5 hover:bg-muted"
                  onClick={() => (isCurrent ? onSelect({ level: 'home' }) : onSelectHome?.(home.id))}
                  aria-label={isCurrent ? `Collapse ${home.name}` : `Expand ${home.name}`}
                >
                  <ChevronRight className={`h-4 w-4 transition-transform ${isCurrent ? 'rotate-90' : ''}`} />
                </button>
                <Home className="h-4 w-4 shrink-0" />
                <button
                  className="min-w-0 flex-1 truncate text-left"
                  onClick={() => (isCurrent ? onSelect({ level: 'home' }) : onSelectHome?.(home.id))}
                >
                  {home.name}
                </button>
              </div>
              {isCurrent && (
                <div className="pl-2">
        {roomGroups.map(group => {
          const inside = group.rooms.some(r => r.room === openRoom || r.room === roomOfActive);
          const explicit = openRoomGroups[group.id];
          const groupOpen = explicit !== undefined ? explicit : (!!needle || inside);
          const isGroupScope = scope.level === 'roomGroup' && scope.groupId === group.id;
          return (
            <div key={group.id}>
              {/* A room group is where the sidebar puts these rooms, so the
                  tree puts them there too — and only there, the way a service
                  group's members are reachable through the group rather than
                  beside it. */}
              <div className={`${rowBase} ${isGroupScope ? selected : plain} pl-1`}>
                <button
                  className="rounded p-0.5 hover:bg-muted"
                  onClick={() => toggleRoomGroup(group.id, groupOpen)}
                  aria-label={groupOpen ? `Collapse ${group.name}` : `Expand ${group.name}`}
                >
                  <ChevronRight className={`h-4 w-4 transition-transform ${groupOpen ? 'rotate-90' : ''}`} />
                </button>
                <LayoutGrid className="h-4 w-4 shrink-0 opacity-70" />
                <button
                  className="min-w-0 flex-1 truncate text-left"
                  onClick={() => onSelect({ level: 'roomGroup', groupId: group.id })}
                >
                  {group.name}
                </button>
                <span className="shrink-0 text-xs opacity-60">{group.total}</span>
              </div>
              {groupOpen && group.rooms.map(room => renderRoom(room, 'pl-5'))}
            </div>
          );
        })}
        {rooms.map(room => renderRoom(room))}
                </div>
              )}
            </div>
          );
        })}

        {groups.length > 0 && (
          <>
            <p className="px-3 pt-3 pb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Across rooms
            </p>
            {groups.map(group => (
              <button
                key={group.id}
                className={`${rowBase} ${scope.level === 'group' && scope.groupId === group.id ? selected : plain}`}
                onClick={() => onSelect({ level: 'group', groupId: group.id })}
              >
                <Layers className="h-4 w-4 shrink-0" />
                <span className="min-w-0 flex-1 truncate">{group.name}</span>
                <span className="shrink-0 text-xs opacity-60">{group.memberCount}</span>
              </button>
            ))}
          </>
        )}

        {rooms.length === 0 && groups.length === 0 && needle && (
          <p className="px-3 py-6 text-center text-sm text-muted-foreground">Nothing matches “{filter}”.</p>
        )}
      </div>
    </div>
  );
}
