/**
 * HomeKit auto-creates four built-in scenes per home (Good Morning, Goodnight,
 * Arrive Home, Leave Home). They cannot be modified or deleted through the
 * HomeKit framework, and Apple Home hides the ones that were never configured.
 * Mirror both behaviors: hide empty built-ins, show configured ones read-only.
 */

export const BUILT_IN_ACTION_SET_TYPES = new Set([
  'HMActionSetTypeWakeUp',
  'HMActionSetTypeSleep',
  'HMActionSetTypeHomeArrival',
  'HMActionSetTypeHomeDeparture',
]);

interface SceneLike {
  actionSetType?: string | null;
  actionCount?: number | null;
  actions?: unknown;
}

export function isBuiltInScene(scene: SceneLike | null | undefined): boolean {
  return !!scene?.actionSetType && BUILT_IN_ACTION_SET_TYPES.has(scene.actionSetType);
}

/** Unconfigured built-in scene — Apple Home hides these; so do we. */
export function isHiddenBuiltInScene(scene: SceneLike | null | undefined): boolean {
  if (!scene || !isBuiltInScene(scene)) return false;
  const count = scene.actionCount ?? 0;
  return count === 0;
}
