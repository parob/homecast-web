/**
 * Ordering for the merged Scenes section.
 *
 * Scenes and shortcuts sit in one grid and can be dragged into any arrangement,
 * so one order array has to span two kinds of thing that share no id space:
 * a scene id is a HomeKit UUID, a shortcut id is one of the eight
 * `HomeActionId` values. Keys are prefixed so they cannot collide.
 *
 * The separator is `:` and not `-` for the reason written down in
 * `pinned-tabs.ts` — HomeKit UUIDs contain hyphens, so a hyphen cannot be split
 * on. Keys are derived on every render and never stored on the card itself;
 * only the order array is persisted.
 *
 * A leaf on purpose: `HomeLayoutData` is declared in two modules that may not
 * import each other, exactly as `summary-sections.ts` documents.
 */

export type HomeCardKind = 'action' | 'scene';

export function homeCardKey(kind: HomeCardKind, id: string): string {
  return `${kind}:${id}`;
}

/**
 * Put `items` into the user's saved order.
 *
 * Two rules, both of which matter more than they look:
 *
 * - **A key that no longer resolves is skipped, not an error.** Shortcuts are
 *   derived from what the home currently contains, so one disappears the moment
 *   its last light does and comes back when the light does; a scene can be
 *   deleted from Apple Home entirely. The order outlives both.
 * - **Anything not named in the order goes last, keeping its natural order.**
 *   That is what makes a brand-new scene appear at all rather than silently
 *   ranking before everything, and it means an order array written before a
 *   feature existed needs no migration.
 *
 * Same shape as the sidebar's room/room-group ordering, which is the only other
 * place in the app that orders a heterogeneous list.
 */
export function applyHomeCardOrder<T>(
  items: T[],
  order: string[] | undefined,
  keyOf: (item: T) => string,
): T[] {
  if (!order?.length) return items;

  const remaining = new Map<string, T>();
  for (const item of items) remaining.set(keyOf(item), item);

  const ordered: T[] = [];
  for (const key of order) {
    const item = remaining.get(key);
    if (item === undefined) continue;   // gone, or never here
    ordered.push(item);
    remaining.delete(key);              // also dedupes a repeated key
  }

  // `remaining` keeps insertion order, so newcomers stay in the order their
  // own source gave them (HOME_ACTION_ORDER for shortcuts, the relay's order
  // for scenes) instead of being shuffled.
  for (const item of remaining.values()) ordered.push(item);
  return ordered;
}
