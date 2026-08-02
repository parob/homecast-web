/**
 * Recursive walk over an automation's action tree.
 *
 * Actions nest: `if_then_else` carries then/else chains, `choose` carries
 * per-branch chains plus a default, `repeat` a sequence, `parallel` an array
 * of chains. A top-level `.some()` misses all of those, which matters when
 * the question is "does this automation ever notify".
 *
 * Deliberately does NOT follow `call_script` — the called automation is a
 * separate entity walked on its own.
 *
 * Tolerant of malformed input: automation JSON round-trips through storage
 * and older builds, so any missing/misshapen branch is skipped, not thrown on.
 */
import type { Action, ActionType, Automation } from '../types/automation';

export function* walkActions(actions: readonly Action[] | undefined | null): Generator<Action> {
  if (!Array.isArray(actions)) return;
  for (const action of actions) {
    if (!action || typeof action !== 'object' || typeof action.type !== 'string') continue;
    yield action;
    switch (action.type) {
      case 'if_then_else':
        yield* walkActions(action.then);
        yield* walkActions(action.else);
        break;
      case 'choose':
        for (const choice of Array.isArray(action.choices) ? action.choices : []) {
          yield* walkActions(choice?.actions);
        }
        yield* walkActions(action.default);
        break;
      case 'repeat':
        yield* walkActions(action.sequence);
        break;
      case 'parallel':
        for (const branch of Array.isArray(action.branches) ? action.branches : []) {
          yield* walkActions(branch);
        }
        break;
    }
  }
}

/** Whether the automation's action tree contains an action of the given type. */
export function automationContainsActionType(
  automation: Pick<Automation, 'actions'> | undefined | null,
  type: ActionType,
): boolean {
  for (const action of walkActions(automation?.actions)) {
    if (action.type === type) return true;
  }
  return false;
}
