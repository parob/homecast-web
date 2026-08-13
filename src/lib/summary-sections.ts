/**
 * What the home summary row shows, per home.
 *
 * Two sets of flags live here — the four pills (Actions, Scenes, Automations,
 * Status) and the individual actions inside the Actions pill. They share one
 * mechanic, so they share one module: both are stored as *hidden* arrays in
 * `HomeLayoutData.visibility`, which means an absent key reads as "everything
 * shown". A layout blob written before this feature existed has neither key,
 * so every home defaults to the full row with no migration.
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

/** Render order in the summary row. Actions leads — it's the only pill that does something. */
export const SUMMARY_SECTION_ORDER: SummarySectionId[] = ['actions', 'scenes', 'automations', 'status'];

export const SUMMARY_SECTION_META: Record<SummarySectionId, { label: string; description: string }> = {
  actions: {
    label: 'Actions',
    description: 'One-tap shortcuts — all lights off, close the blinds, lock up',
  },
  scenes: {
    label: 'Scenes',
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
export function withHomeActionVisibility(
  order: HomeActionId[],
  hidden: string[] | undefined,
  id: HomeActionId,
  visible: boolean,
): HomeActionId[] {
  return toggleIn(order, hidden, id, visible);
}
