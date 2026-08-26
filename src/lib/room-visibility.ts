/**
 * Two questions about a hidden room that are easy to confuse, and one answer
 * that cannot serve both.
 *
 * `isHidden` is the stored state. `shouldFilterOut` is whether the view should
 * drop it *as it stands* — false while hidden things are being shown, which is
 * what Edit Layout turns on.
 *
 * They were one function, returning the second. Everything that needed the
 * first got a wrong answer at exactly the moment it mattered: entering Edit
 * Layout revealed the room, which flipped the filter to "not hidden", so the
 * room sorted to the top with every other room and its heading offered to Hide
 * a room that was already hidden. The bug only appeared in the one mode where
 * you could see it.
 *
 * There is a second axis, added later: *which surface* a room is hidden from.
 * See `RoomSurface` below — the home view and the left menu keep separate
 * lists, because hiding a room from one is not a statement about the other.
 *
 * Pure and here so both distinctions are testable without a Dashboard.
 */

/**
 * The two places a room can be hidden from, independently.
 *
 * `home` — the home view's room sections, the public share link.
 * `menu` — the left menu / sidebar, and the Mac menu bar.
 *
 * A room hidden from one is untouched in the other. They were a single list
 * (`hiddenRooms`) until a report pointed out that they are two decisions.
 */
export type RoomSurface = 'home' | 'menu';

/** The visibility half of `HomeLayoutData` that concerns rooms. */
export interface RoomVisibility {
  /**
   * The single pre-split list. Still written (see `toggleRoomHidden`) and still
   * the fallback for a home that has never used the split, so no stored layout
   * needs migrating and no deploy can silently un-hide a room.
   */
  hiddenRooms?: string[];
  /** Hidden from the home view. Absent = inherit `hiddenRooms`. */
  hiddenRoomsHome?: string[];
  /** Hidden from the left menu. Absent = inherit `hiddenRooms`. */
  hiddenRoomsMenu?: string[];
}

const SURFACE_KEY = {
  home: 'hiddenRoomsHome',
  menu: 'hiddenRoomsMenu',
} as const satisfies Record<RoomSurface, keyof RoomVisibility>;

export const ROOM_SURFACES: readonly RoomSurface[] = ['home', 'menu'];

/**
 * The hidden list for one surface.
 *
 * The fallback IS the migration: a layout written before the split has neither
 * per-surface key, so both surfaces read the one list it does have and behave
 * exactly as they did. Nothing is rewritten until something is toggled.
 */
export function hiddenRoomsFor(
  visibility: RoomVisibility | undefined,
  surface: RoomSurface,
): string[] | undefined {
  return visibility?.[SURFACE_KEY[surface]] ?? visibility?.hiddenRooms;
}

/** The stored state: has this room been hidden from this surface? */
export function isRoomHiddenOn(
  visibility: RoomVisibility | undefined,
  roomId: string,
  surface: RoomSurface,
): boolean {
  return isRoomHidden(hiddenRoomsFor(visibility, surface), roomId);
}

/** Hidden from at least one surface — what a control that owns neither asks. */
export function isRoomHiddenAnywhere(
  visibility: RoomVisibility | undefined,
  roomId: string,
): boolean {
  return ROOM_SURFACES.some(s => isRoomHiddenOn(visibility, roomId, s));
}

/**
 * Flip a room's hidden state on the given surfaces, returning the new lists.
 *
 * Targeting both surfaces at once is a single decision, not two: if the room is
 * hidden on *either*, the toggle reveals it on both. That keeps the one control
 * with no surface of its own — the dropdown you reach from inside a room —
 * behaving exactly as it did when there was one list.
 *
 * `hiddenRooms` is kept up to date as the **intersection** of the two. A
 * Community-mode Mac app runs a bundled web build and may still be reading that
 * key; an intersection hides only what is hidden everywhere, so a stale reader
 * errs toward showing a room rather than hiding one the user can no longer find.
 */
export function toggleRoomHidden(
  visibility: RoomVisibility | undefined,
  roomId: string,
  surfaces: readonly RoomSurface[],
): Required<RoomVisibility> {
  const current: Record<RoomSurface, string[]> = {
    home: [...(hiddenRoomsFor(visibility, 'home') ?? [])],
    menu: [...(hiddenRoomsFor(visibility, 'menu') ?? [])],
  };

  // Hidden on any targeted surface means the gesture is "bring it back".
  const hide = !surfaces.some(s => current[s].includes(roomId));

  for (const surface of surfaces) {
    current[surface] = hide
      ? (current[surface].includes(roomId) ? current[surface] : [...current[surface], roomId])
      : current[surface].filter(id => id !== roomId);
  }

  const menu = new Set(current.menu);
  return {
    hiddenRoomsHome: current.home,
    hiddenRoomsMenu: current.menu,
    hiddenRooms: current.home.filter(id => menu.has(id)),
  };
}

/** The stored state: has this room been hidden, given an already-resolved list? */
export function isRoomHidden(hiddenRooms: string[] | undefined, roomId: string): boolean {
  return hiddenRooms?.includes(roomId) ?? false;
}

/** Should the view drop it right now? Not while hidden things are on show. */
export function shouldFilterRoomOut(
  hiddenRooms: string[] | undefined,
  roomId: string,
  reveal: boolean,
): boolean {
  if (reveal) return false;
  return isRoomHidden(hiddenRooms, roomId);
}

/**
 * Visible rooms first, hidden ones last — and only once they are on show.
 *
 * Last rather than in place so revealing them never reorders the rooms you
 * actually use, which is what `getOrderedItems` already does with hidden tiles.
 */
export function orderRoomsHiddenLast<T extends { id: string }>(
  rooms: T[],
  hiddenRooms: string[] | undefined,
  reveal: boolean,
): T[] {
  const hidden = (r: T) => isRoomHidden(hiddenRooms, r.id);
  if (!reveal) return rooms.filter(r => !hidden(r));
  return [...rooms.filter(r => !hidden(r)), ...rooms.filter(hidden)];
}

/**
 * The same rule, for the left menu — which is a tree, not a list.
 *
 * Only top-level rooms move. A room nested inside a room group keeps its place
 * in that group: the sidebar has never filtered group children by hidden state,
 * and quietly starting to would be a second behaviour change riding along.
 * Room groups themselves never move.
 */
export function orderMenuTreeHiddenLast<T extends { id: string; type: string }>(
  items: T[],
  hiddenRooms: string[] | undefined,
  reveal: boolean,
): T[] {
  const hidden = (i: T) => i.type === 'room' && isRoomHidden(hiddenRooms, i.id);
  if (!reveal) return items.filter(i => !hidden(i));
  return [...items.filter(i => !hidden(i)), ...items.filter(hidden)];
}
