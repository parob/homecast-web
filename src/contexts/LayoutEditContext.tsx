import { createContext, useContext } from 'react';

/**
 * Where the controls for arranging the dashboard belong on this device.
 *
 * Two platforms, two answers, and the difference is not cosmetic:
 *
 * - **Touch** has an Edit Layout mode. Hiding, unhiding and reordering all live
 *   inside it, on badges attached to the thing being arranged. There is no
 *   long-press menu to duplicate them into, because long press means drag.
 * - **Desktop** has no edit mode — drag is always live and there is nothing to
 *   enter. So it keeps the right-click menu items, which are its only route.
 *
 * On touch, a long press is now the way *into* Edit Layout, and the press that
 * enters it is also the press that picks the tile up. That is why touch has no
 * context menus at all any more: Radix opens one on a native `contextmenu` as
 * well as on its own 700ms timer, and an open menu sets `pointer-events: none`
 * on the body, which kills the drag outright. There is no delay that separates
 * them — the menu had to go.
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
  /**
   * A drag has started. On touch this is how Edit Layout is *entered*: the hold
   * that begins the drag is the same hold that turns the mode on, so the two
   * arrive together and the gesture reads as one movement.
   *
   * Every `DndContext` must call this from `onDragStart`, and `endLift` from
   * both `onDragEnd` **and** `onDragCancel`. Missing the cancel leaves the
   * deferred tidy-up pending — hence Dashboard's watchdog.
   *
   * Optional, and called as `beginLift?.()`: a grid rendered outside a provider
   * (a shared view, a test) has no mode to enter, and requiring the pair would
   * mean every such caller supplying two functions that do nothing.
   */
  beginLift?: () => void;
  /** That drag ended or was cancelled. Runs the tidy-up the lift deferred. */
  endLift?: () => void;
}

const NONE: LayoutEditState = { touchMode: false, editMode: false };

const LayoutEditContext = createContext<LayoutEditState>(NONE);

export const LayoutEditProvider = LayoutEditContext.Provider;

export function useLayoutEdit(): LayoutEditState {
  return useContext(LayoutEditContext);
}
