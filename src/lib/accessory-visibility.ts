/**
 * Which surface an accessory is hidden from.
 *
 * Accessory visibility has always been stored per room — `hiddenAccessories`
 * on that room's layout — and read by two different views: the home view, which
 * renders a section per room, and the room's own view. One list served both, so
 * hiding a tile from the home view also emptied the room you went into to find
 * it. They are two decisions, exactly as the home view and the left menu turned
 * out to be for rooms.
 *
 * This is `lib/room-visibility.ts` applied to the other entity, and it keeps
 * that module's two rules:
 *
 *  - the stored state and "drop it right now" are different questions, because
 *    Edit Layout reveals hidden things and the answer to the second flips while
 *    the first must not;
 *  - the pre-split list stays written and stays the fallback, so no stored
 *    layout needs migrating and no deploy silently un-hides anything.
 *
 * Pure and here so both distinctions are testable without a Dashboard.
 */

/**
 * The two places an accessory can be hidden from, independently.
 *
 * `home` — the home view's room sections, a room-group view, a shared home or
 *   room-group link.
 * `room` — one room's own view, a shared room link, and the Mac menu bar, whose
 *   accessory list is the contents of a room.
 *
 * An accessory hidden from one is untouched in the other.
 */
export type AccessorySurface = 'home' | 'room';

/** The visibility half of `RoomLayoutData` that concerns accessories. */
export interface AccessoryVisibility {
  /**
   * The single pre-split list. Still written (see `toggleAccessoryHidden`) and
   * still the fallback for a room that has never used the split, so no stored
   * layout needs migrating.
   */
  hiddenAccessories?: string[];
  /** Hidden from the home view. Absent = inherit `hiddenAccessories`. */
  hiddenAccessoriesHome?: string[];
  /** Hidden from the room's own view. Absent = inherit `hiddenAccessories`. */
  hiddenAccessoriesRoom?: string[];
}

const SURFACE_KEY = {
  home: 'hiddenAccessoriesHome',
  room: 'hiddenAccessoriesRoom',
} as const satisfies Record<AccessorySurface, keyof AccessoryVisibility>;

export const ACCESSORY_SURFACES: readonly AccessorySurface[] = ['home', 'room'];

/**
 * The hidden list for one surface.
 *
 * The fallback IS the migration: a layout written before the split has neither
 * per-surface key, so both surfaces read the one list it does have and behave
 * exactly as they did. Nothing is rewritten until something is toggled.
 */
export function hiddenAccessoriesFor(
  visibility: AccessoryVisibility | undefined,
  surface: AccessorySurface,
): string[] | undefined {
  return visibility?.[SURFACE_KEY[surface]] ?? visibility?.hiddenAccessories;
}

/** The stored state: has this accessory been hidden from this surface? */
export function isAccessoryHiddenOn(
  visibility: AccessoryVisibility | undefined,
  accessoryId: string,
  surface: AccessorySurface,
): boolean {
  return isAccessoryHidden(hiddenAccessoriesFor(visibility, surface), accessoryId);
}

/** Hidden from at least one surface — what a control that owns neither asks. */
export function isAccessoryHiddenAnywhere(
  visibility: AccessoryVisibility | undefined,
  accessoryId: string,
): boolean {
  return ACCESSORY_SURFACES.some(s => isAccessoryHiddenOn(visibility, accessoryId, s));
}

/**
 * Flip an accessory's hidden state on the given surfaces, returning the new
 * lists.
 *
 * Targeting both surfaces at once is a single decision, not two: if it is
 * hidden on *either*, the toggle brings it back on both. Nothing in the app
 * does that today — every tile knows which surface it is on — but a control
 * that owns neither would otherwise have to guess, and this is the answer
 * `toggleRoomHidden` already gives for rooms.
 *
 * `hiddenAccessories` is kept up to date as the **intersection** of the two. A
 * Community-mode Mac app runs a bundled web build and may still be reading that
 * key; an intersection hides only what is hidden everywhere, so a stale reader
 * errs toward showing an accessory rather than hiding one the user can no
 * longer find.
 */
export function toggleAccessoryHidden(
  visibility: AccessoryVisibility | undefined,
  accessoryId: string,
  surfaces: readonly AccessorySurface[],
): Required<AccessoryVisibility> {
  const current: Record<AccessorySurface, string[]> = {
    home: [...(hiddenAccessoriesFor(visibility, 'home') ?? [])],
    room: [...(hiddenAccessoriesFor(visibility, 'room') ?? [])],
  };

  // Hidden on any targeted surface means the gesture is "bring it back".
  const hide = !surfaces.some(s => current[s].includes(accessoryId));

  for (const surface of surfaces) {
    current[surface] = hide
      ? (current[surface].includes(accessoryId)
          ? current[surface]
          : [...current[surface], accessoryId])
      : current[surface].filter(id => id !== accessoryId);
  }

  const room = new Set(current.room);
  return {
    hiddenAccessoriesHome: current.home,
    hiddenAccessoriesRoom: current.room,
    hiddenAccessories: current.home.filter(id => room.has(id)),
  };
}

/** The stored state, given an already-resolved list. */
export function isAccessoryHidden(
  hiddenAccessories: string[] | undefined,
  accessoryId: string,
): boolean {
  return hiddenAccessories?.includes(accessoryId) ?? false;
}

/** Should the view drop it right now? Not while hidden things are on show. */
export function shouldFilterAccessoryOut(
  hiddenAccessories: string[] | undefined,
  accessoryId: string,
  reveal: boolean,
): boolean {
  if (reveal) return false;
  return isAccessoryHidden(hiddenAccessories, accessoryId);
}
