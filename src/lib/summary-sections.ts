/**
 * What the home summary row shows, per home.
 *
 * Two sets of flags live here — the section contents (Scenes, Actions,
 * Automations, Status) and the individual actions inside the Scenes pill. They
 * share one mechanic, so they share one module: both are stored as *hidden*
 * arrays in `HomeLayoutData.visibility`, which means an absent key reads as
 * "everything shown". A layout blob written before this feature existed has
 * neither key, so every home defaults to the full row with no migration.
 *
 * **`actions` is a content flag, not a pill.** Scenes and Actions used to be
 * two pills; they are now one section called Scenes holding both kinds of card.
 * The id survives as the switch for the shortcut half, which is what lets a
 * home that had already hidden Actions keep exactly the choice it made — and it
 * must stay in SUMMARY_SECTION_ORDER for that to hold, because every write is
 * normalised through that array.
 *
 * This file is a leaf on purpose: `HomeLayoutData` is declared in two places
 * (`hooks/useEntityLayout.ts` and `lib/graphql/types.ts`) and neither may
 * import the other, so the shared unions cannot live in either.
 */

export type SummarySectionId = 'actions' | 'scenes' | 'automations' | 'status';

export type HomeActionId =
  | 'lights'
  | 'blinds'
  | 'locks'
  | 'fans'
  | 'switches'
  | 'climate-off'
  | 'security'
  | 'everything-off';

/**
 * Canonical order for normalising a stored hidden-list. Every id ever used
 * belongs here, including `actions`, which no longer has a pill of its own —
 * `toggleIn` filters writes through this array, so an id missing from it is
 * quietly erased from the blob the next time anything is toggled.
 */
export const SUMMARY_SECTION_ORDER: SummarySectionId[] = ['actions', 'scenes', 'automations', 'status'];

/** Render order in the summary row. Scenes leads — it's the pill that does something. */
export const SUMMARY_PILL_ORDER: SummarySectionId[] = ['scenes', 'automations', 'status'];

/** The two halves of the Scenes section, in the order the settings page lists them. */
export const SCENES_CONTENT_ORDER: SummarySectionId[] = ['actions', 'scenes'];

/** What each pill is called in the summary row. */
export const SUMMARY_PILL_LABEL: Record<SummarySectionId, string> = {
  actions: 'Scenes',   // folded into Scenes; kept total so the map stays exhaustive
  scenes: 'Scenes',
  automations: 'Automations',
  status: 'Status',
};

export const SUMMARY_SECTION_META: Record<SummarySectionId, { label: string; description: string }> = {
  actions: {
    label: 'Shortcuts',
    description: 'One-tap shortcuts — all lights off, close the blinds, lock up',
  },
  scenes: {
    label: 'Apple Home scenes',
    description: 'Scenes you and Apple Home have set up for this home',
  },
  automations: {
    label: 'Automations',
    description: 'Automations that run on a trigger or schedule',
  },
  status: {
    label: 'Status',
    description: 'Temperature, humidity and sensor readings across the home',
  },
};

/** The subset of HomeLayoutData these helpers read. Keeps this module free of the full type. */
interface VisibilityCarrier {
  visibility?: {
    hiddenSummarySections?: string[];
    hiddenActions?: string[];
  };
}

export function isSummarySectionVisible(
  layout: VisibilityCarrier | null | undefined,
  id: SummarySectionId,
): boolean {
  return !layout?.visibility?.hiddenSummarySections?.includes(id);
}

/**
 * Is the merged Scenes section worth a pill at all?
 *
 * It holds two kinds of card behind two switches, so it only disappears when
 * both are off. Checking just `scenes` would have thrown away the shortcuts of
 * anyone who had hidden the Apple Home half.
 */
export function isScenesSectionVisible(layout: VisibilityCarrier | null | undefined): boolean {
  return isSummarySectionVisible(layout, 'scenes') || isSummarySectionVisible(layout, 'actions');
}

export function isHomeActionVisible(
  layout: VisibilityCarrier | null | undefined,
  id: HomeActionId,
): boolean {
  return !layout?.visibility?.hiddenActions?.includes(id);
}

/**
 * Filtering the result through a canonical order does three jobs at once:
 * dedupes, stabilises ordering so two writes of the same set produce the same
 * JSON, and drops ids from a future or rolled-back build rather than carrying
 * junk forward.
 */
function toggleIn<T extends string>(order: T[], hidden: string[] | undefined, id: T, visible: boolean): T[] {
  const set = new Set(hidden ?? []);
  if (visible) set.delete(id);
  else set.add(id);
  return order.filter(candidate => set.has(candidate));
}

export function withSummarySectionVisibility(
  hidden: string[] | undefined,
  id: SummarySectionId,
  visible: boolean,
): SummarySectionId[] {
  return toggleIn(SUMMARY_SECTION_ORDER, hidden, id, visible);
}

/**
 * Unlike the pills, the action order is the catalog's, not this module's — but
 * the catalog imports from here, so passing it in keeps the dependency one-way.
 */
/**
 * Turn the whole Scenes pill on or off — both halves at once.
 *
 * The Edit Layout row has one eye per pill, so it cannot express "scenes but
 * not shortcuts"; that lives in Settings, which writes the two ids separately.
 * Turning the pill back on restores both, since a pill that reappeared still
 * empty would read as broken.
 */
export function withScenesSectionVisibility(
  hidden: string[] | undefined,
  visible: boolean,
): SummarySectionId[] {
  const afterScenes = toggleIn(SUMMARY_SECTION_ORDER, hidden, 'scenes', visible);
  return toggleIn(SUMMARY_SECTION_ORDER, afterScenes, 'actions', visible);
}

export function withHomeActionVisibility(
  order: HomeActionId[],
  hidden: string[] | undefined,
  id: HomeActionId,
  visible: boolean,
): HomeActionId[] {
  return toggleIn(order, hidden, id, visible);
}
