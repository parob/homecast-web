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

export { MAX_PINNED_TABS };
