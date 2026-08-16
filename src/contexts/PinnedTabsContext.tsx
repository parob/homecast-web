import { createContext, useContext } from 'react';
import { MAX_PINNED_TABS, type PinnedTab, type PinTarget } from '@/lib/pinned-tabs';

/**
 * How anything offers "Pin to Tab Bar".
 *
 * Passed by context rather than as props for the reason WidgetCard already
 * states about its other menu items: there are 28 widget components forwarding
 * `WidgetProps`, and threading one more through all of them is how the last
 * menu item ended up wired in exactly one place. It also keeps the new item off
 * `AccessoryWidget`'s hand-written memo comparator, where a forgotten prop
 * silently stops the tile re-rendering.
 *
 * The default is inert, so a tile rendered outside a provider — a shared view,
 * a test — simply doesn't offer pinning rather than crashing.
 */
export interface PinnedTabsActions {
  /** False where pinning isn't offered at all (desktop). Hides the menu item. */
  enabled: boolean;
  isPinned: (target: PinTarget) => boolean;
  /** True when the bar is at MAX_PINNED_TABS, so unpinned targets read as full. */
  isFull: boolean;
  /** Pins if absent, unpins if present. */
  toggle: (tab: PinnedTab) => void;
}

const NONE: PinnedTabsActions = {
  enabled: false,
  isPinned: () => false,
  isFull: false,
  toggle: () => {},
};

const PinnedTabsContext = createContext<PinnedTabsActions>(NONE);

export const PinnedTabsProvider = PinnedTabsContext.Provider;

export function usePinnedTabs(): PinnedTabsActions {
  return useContext(PinnedTabsContext);
}

/**
 * The three-way state every "Pin to Tab Bar" affordance needs: pinned, full, or
 * pinnable. Extracted when the same logic was wanted by a menu item, a tile
 * button and a sidebar row button — three places is where "it's only four
 * lines" stops being true and the wordings start drifting apart.
 *
 * Returns `null` when pinning isn't on offer at all, so callers render nothing
 * rather than each repeating the `enabled` check.
 */
export interface PinAction {
  pinned: boolean;
  /** Bar is at capacity and this isn't already on it — offer it, disabled. */
  full: boolean;
  label: string;
  toggle: () => void;
}

export function usePinAction(tab: PinnedTab | null | undefined): PinAction | null {
  const { enabled, isPinned, isFull, toggle } = usePinnedTabs();
  if (!enabled || !tab) return null;
  const pinned = isPinned(tab);
  const full = !pinned && isFull;
  return {
    pinned,
    full,
    label: pinned
      ? 'Unpin from Tab Bar'
      : full
        ? `Tab Bar Full (${MAX_PINNED_TABS}/${MAX_PINNED_TABS})`
        : 'Pin to Tab Bar',
    toggle: () => { if (!full) toggle(tab); },
  };
}

export { MAX_PINNED_TABS };
