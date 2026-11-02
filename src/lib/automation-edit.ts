/**
 * Which parts of an edited HomeKit automation to send.
 *
 * The edit dialog cannot round-trip everything HomeKit holds: a condition that
 * isn't characteristic equality (time of day, before sunset) has no editor and
 * is dropped, and a weekly trigger's day is re-derived from today. So a part the
 * user did not touch must not be sent at all — sending it would quietly rewrite
 * the automation. Older relays also rebuild the whole automation whenever a
 * trigger arrives, which is how an edit that failed half-way lost it.
 */

/** One automation as the update mutation serialises it. */
export interface AutomationEditParts {
  name: string;
  /** JSON: the trigger with its conditions */
  trigger: string;
  /** JSON: the action list */
  actions: string;
}

/** The parts of `current` that differ from `initial` (all of them when there is no baseline). */
export function changedAutomationParts(
  initial: AutomationEditParts | null,
  current: AutomationEditParts,
): Partial<AutomationEditParts> {
  if (!initial) return { ...current };
  const changed: Partial<AutomationEditParts> = {};
  for (const key of ['name', 'trigger', 'actions'] as const) {
    if (initial[key] !== current[key]) changed[key] = current[key];
  }
  return changed;
}
