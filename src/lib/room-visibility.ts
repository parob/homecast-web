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
 * Pure and here so the distinction is testable without a Dashboard.
 */

/** The stored state: has this room been hidden for this home? */
export function isRoomHidden(hiddenRooms: string[] | undefined, roomId: string): boolean {
  return hiddenRooms?.includes(roomId) ?? false;
}

/** Should the view drop it right now? Not while hidden things are on show. */
export function shouldFilterRoomOut(
  hiddenRooms: string[] | undefined,
  roomId: string,
  showHiddenItems: boolean,
): boolean {
  if (showHiddenItems) return false;
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
  showHiddenItems: boolean,
): T[] {
  const hidden = (r: T) => isRoomHidden(hiddenRooms, r.id);
  if (!showHiddenItems) return rooms.filter(r => !hidden(r));
  return [...rooms.filter(r => !hidden(r)), ...rooms.filter(hidden)];
}
