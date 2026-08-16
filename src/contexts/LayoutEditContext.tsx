import { createContext, useContext } from 'react';

/**
 * Where the controls for arranging the dashboard belong on this device.
 *
 * Two platforms, two answers, and the difference is not cosmetic:
 *
 * - **Touch** has an Edit Layout mode. Hiding, unhiding and reordering all live
 *   inside it, on badges attached to the thing being arranged. Leaving the same
 *   actions in long-press menus as well would mean two routes to one job, one of
 *   which is invisible while the other is running (edit mode suppresses context
 *   menus so long-press can mean drag).
 * - **Desktop** has no edit mode — drag is always live and there is nothing to
 *   enter. So it keeps the right-click menu items, which are its only route.
 *
 * Passed by context rather than as a prop for the reason `PinnedTabsContext`
 * already documents: 28 widget components forward `WidgetProps`, and threading
 * one more flag through all of them is how the last menu item ended up wired in
 * exactly one place. It also keeps the flag off `AccessoryWidget`'s hand-written
 * memo comparator, where a forgotten prop silently stops the tile re-rendering.
 *
 * The default is `touchMode: false` — i.e. "show the menu items" — so a tile
 * rendered outside a provider (a shared view, a test) keeps the behaviour it had
 * before this context existed.
 */
export interface LayoutEditState {
  /** True on touch devices, where visibility is an Edit Layout job. */
  touchMode: boolean;
  /** True while Edit Layout is actually running. */
  editMode: boolean;
}

const NONE: LayoutEditState = { touchMode: false, editMode: false };

const LayoutEditContext = createContext<LayoutEditState>(NONE);

export const LayoutEditProvider = LayoutEditContext.Provider;

export function useLayoutEdit(): LayoutEditState {
  return useContext(LayoutEditContext);
}
