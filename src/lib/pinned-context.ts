/**
 * Where a pinned accessory or group actually lives.
 *
 * A pin is the one place in the app that shows a control with no surrounding
 * context. Everywhere else you reached the accessory by walking into its home
 * and its room, so the title bar behind it already says which "Lamp" this is —
 * from the tab bar you could be three homes away, and two homes with a Kitchen
 * Lamp each are otherwise indistinguishable.
 *
 * A service group has no room of its own; only its members do. One room between
 * them is worth naming, several is worth counting, and none at all is a
 * home-level group — which is a real shape, not a bug (see the MQTT home-level
 * topics in CLAUDE.md).
 */

export interface PinnedContext {
  homeName?: string;
  /** Every room the thing touches. One entry for an accessory, N for a group. */
  roomNames?: (string | undefined)[];
}

/**
 * The subtitle for an expanded pin, or undefined when there is nothing to say.
 *
 * Undefined rather than an empty string so the caller renders no element at
 * all: a blank line above a control is a gap that looks like a bug.
 */
export function pinnedContextLabel({ homeName, roomNames }: PinnedContext): string | undefined {
  const rooms = Array.from(new Set((roomNames ?? []).filter((r): r is string => !!r && !!r.trim())));

  const roomPart = rooms.length === 0
    ? undefined
    : rooms.length === 1
      ? rooms[0]
      : `${rooms.length} rooms`;

  const home = homeName?.trim() || undefined;
  if (home && roomPart) return `${home} · ${roomPart}`;
  return home ?? roomPart;
}
