/**
 * The pinned tab bar: what may be pinned, and how a pin is identified.
 *
 * A leaf on purpose — no React, no lucide, no Apollo. The tab bar, the settings
 * pane, the dashboard and every tile that offers "Pin to Tab Bar" all need the
 * same key function, and none of them should have to import each other to get
 * it. `MAX_PINNED_TABS` lives here for the same reason: it used to live in
 * `components/layout/MobileTabBar.tsx`, which meant the settings dialog had to
 * import the tab bar just to render a limit.
 *
 * Pins fall into three behaviours, which is the whole design of the bar:
 * navigate somewhere, run something, or open a control for something.
 */

/** Pinned tab bar item (mobile bottom navigation). */
export interface PinnedTab {
  type: PinnedTabType;
  /** Entity id — for `action`, one of the eight `HomeActionId` values. */
  id: string;
  /** Cached for display before data loads, and as the fallback if it never does. */
  name: string;
  /** User-defined label override for tab bar display. */
  customName?: string;
  /** Required for room, action, scene, accessory and serviceGroup. */
  homeId?: string;
  /** Required for collectionGroup (navigate to the parent collection first). */
  collectionId?: string;
}

export type PinnedTabType =
  | 'home' | 'room' | 'collection' | 'collectionGroup'
  | 'action' | 'scene' | 'accessory' | 'serviceGroup';

/** Everything `pinKey` needs — lets callers key a pin they have not built yet. */
export type PinTarget = Pick<PinnedTab, 'type' | 'id' | 'homeId' | 'collectionId'>;

export const MAX_PINNED_TABS = 5;

/**
 * Tapping one switches the view. The tab latches "selected" while you are there.
 */
export const NAV_PIN_TYPES = ['home', 'room', 'collection', 'collectionGroup'] as const;

/**
 * Tapping one does something and you stay put. These must never latch selected —
 * a bar that claims you are "in" Everything Off is lying about where you are.
 */
export const RUN_PIN_TYPES = ['action', 'scene'] as const;

/**
 * Tapping one opens its control panel above the bar. Active only while open.
 */
export const POPOVER_PIN_TYPES = ['accessory', 'serviceGroup'] as const;

export type PinBehaviour = 'navigate' | 'run' | 'popover';

export function pinBehaviour(type: PinnedTabType): PinBehaviour {
  if ((RUN_PIN_TYPES as readonly string[]).includes(type)) return 'run';
  if ((POPOVER_PIN_TYPES as readonly string[]).includes(type)) return 'popover';
  return 'navigate';
}

/**
 * Stable identity for a pin — React key, dnd sortable id, and the basis of
 * every pinned/unpinned comparison.
 *
 * Two details matter and both were wrong in the `${type}-${id}` key this
 * replaces:
 *
 * 1. **The separator is `:`, not `-`.** HomeKit UUIDs and hc_ids are full of
 *    hyphens, so a hyphenated key could not be split back apart unambiguously.
 * 2. **The scope segment.** Action ids are a closed eight-value union
 *    (`HomeActionId`), not UUIDs — so "Lights" pinned in two homes collided on
 *    `action-lights`, and unpinning one unpinned both. Scoping by home fixes
 *    that, and hardens `room`/`collectionGroup` for free.
 *
 * Derived, never persisted: the stored shape is unchanged, so no migration.
 */
export function pinKey(target: PinTarget): string {
  const scope = target.homeId ?? target.collectionId ?? '';
  return `${target.type}:${scope}:${target.id}`;
}

export function samePin(a: PinTarget, b: PinTarget): boolean {
  return pinKey(a) === pinKey(b);
}

/**
 * How a pin's type reads in the settings list. The raw union value leaks
 * camelCase ("serviceGroup") and says "collectionGroup" for what the rest of
 * the UI calls a room group.
 */
export const PIN_TYPE_LABELS: Record<PinnedTabType, string> = {
  home: 'Home',
  room: 'Room',
  collection: 'Collection',
  collectionGroup: 'Room group',
  action: 'Action',
  scene: 'Scene',
  accessory: 'Accessory',
  serviceGroup: 'Service group',
};
