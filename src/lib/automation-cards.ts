/**
 * Ordering and visibility for the Automations section.
 *
 * The section shows two engines' automations in one grid — HomeKit's own and
 * Homecast's — and they can be dragged into any arrangement, so one order array
 * has to span two kinds of thing that share no id space: a HomeKit automation
 * id is a UUID, a Homecast one is an engine id. Keys are prefixed so they
 * cannot collide, with `:` and not `-` for the reason `pinned-tabs.ts` writes
 * down: HomeKit UUIDs contain hyphens, so a hyphen cannot be split on.
 *
 * The same shape as `home-cards.ts`, which does this for the Scenes grid. A
 * leaf on purpose: `HomeLayoutData` is declared in two modules that may not
 * import each other, exactly as `summary-sections.ts` documents.
 */

/** `hk` is HomeKit's own automation engine, `hc` is Homecast's. */
export type AutomationCardKind = 'hk' | 'hc';

export function automationCardKey(kind: AutomationCardKind, id: string): string {
  return `${kind}:${id}`;
}

/**
 * Put `items` into the user's saved order.
 *
 * Same two rules as `applyHomeCardOrder`, and they carry more weight here: the
 * Homecast half is fetched only once the section is open, so an unresolved key
 * is the *normal* state of a collapsed section rather than an edge case.
 *
 * - **A key that no longer resolves is skipped, not an error.** An automation
 *   can be deleted, or belong to an engine that has not answered yet.
 * - **Anything not named in the order goes last, keeping its natural order.**
 *   A newly created automation therefore appears, rather than silently ranking
 *   ahead of everything, and an order written before this feature existed needs
 *   no migration.
 */
export function applyAutomationCardOrder<T>(
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
    if (item === undefined) continue;   // deleted, or its engine is still quiet
    ordered.push(item);
    remaining.delete(key);              // also dedupes a repeated key
  }

  for (const item of remaining.values()) ordered.push(item);
  return ordered;
}

/**
 * Is this automation's card shown for this home?
 *
 * Stored as a *hidden* list, so absent means shown and no migration was needed
 * when the list was introduced — the same choice the rest of the home layout's
 * visibility flags make.
 */
export function isAutomationVisible(hidden: string[] | undefined, key: string): boolean {
  return !hidden?.includes(key);
}

/**
 * Hide or show one automation.
 *
 * Deliberately not normalised through a canonical order, for the reason
 * `withSceneVisibility` gives: automations come from the relay and the engine
 * store, so the list is empty while either is still answering, and filtering
 * through it would quietly drop every hidden key the moment someone toggled
 * anything on a home that had not finished loading.
 *
 * Sorted instead, which is all the canonical order was buying: two writes of
 * the same set produce the same JSON. The Set drops any duplicate.
 */
export function withAutomationVisibility(
  hidden: string[] | undefined,
  key: string,
  visible: boolean,
): string[] {
  const set = new Set(hidden ?? []);
  if (visible) set.delete(key);
  else set.add(key);
  return Array.from(set).sort();
}
