// The per-trigger `choose` wrapper, and how to see past it.
//
// An automation has one action list, but the editor lets you draw a separate
// chain from each trigger — "lights on → notify 'on'", "lights off → notify
// 'off'". Saving folds those into a single `choose`, one arm per trigger, gated
// on a `trigger` condition, because that is the only thing the engine has that
// can tell the arms apart.
//
// That fold is a transport detail. Anything reading an automation back — the
// canvas, the card's "2 triggers, 1 action" summary — must look through it, or
// it reports the wrapper instead of the work. Every such reader shares the
// helpers here rather than reimplementing the check.

import type { Action, Condition } from './types/automation';
import { isConditionBlock } from './types/automation';

/**
 * Id prefix marking a `choose` the serializer synthesised, so it can be told
 * apart from one dragged in from the palette (which carries a random uuid).
 */
export const CHOOSE_BY_TRIGGER_PREFIX = 'choose-by-trigger-';

/** Id prefix of the synthetic condition gating each arm to its trigger. */
export const TRIGGER_GATE_PREFIX = 'trigger-is-';

/** Is this the wrapper, rather than a Choose the user built themselves? */
export function isTriggerBranchChoose(action: Action | undefined): boolean {
  return !!action && action.type === 'choose' && action.id.startsWith(CHOOSE_BY_TRIGGER_PREFIX);
}

/**
 * The actions an automation really performs, with the wrapper unfolded.
 *
 * Returns the list unchanged when there is no wrapper, so callers can use it
 * unconditionally. Conditions come back separately: the synthetic trigger gates
 * are dropped, and any the user actually drew are kept.
 */
export function flattenTriggerBranches(
  actions: Action[] | undefined | null,
): { actions: Action[]; conditions: Condition[] } {
  const list = actions ?? [];
  const only = list.length === 1 ? list[0] : undefined;
  if (!isTriggerBranchChoose(only)) return { actions: list, conditions: [] };

  const flat: Action[] = [];
  const conditions: Condition[] = [];
  for (const choice of (only as Extract<Action, { type: 'choose' }>).choices) {
    flat.push(...choice.actions);
    for (const c of choice.conditions.conditions) {
      if (!isConditionBlock(c) && c.type === 'trigger' && c.id.startsWith(TRIGGER_GATE_PREFIX)) continue;
      conditions.push(c as Condition);
    }
  }
  return { actions: flat, conditions };
}

/** How many actions an automation performs, counting past the wrapper. */
export function countEffectiveActions(actions: Action[] | undefined | null): number {
  return flattenTriggerBranches(actions).actions.length;
}
