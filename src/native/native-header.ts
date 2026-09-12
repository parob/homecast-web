/**
 * The web half of the native top chrome — a **preview**, off by default.
 *
 * Asked for on parob/homecast-cloud#120. The native bar lives in
 * `app-ios-macos/Sources/App/NativeHeaderBar.swift`; this module is everything
 * the page needs to cooperate with it, and nothing else.
 *
 * ## Two crossings, and both have to exist
 *
 * | direction | how |
 * |---|---|
 * | page → native | `publishHeaderState()` — a `header.setState` postMessage |
 * | native → page | `window.__homecastNativeHeader.tap(control)`, installed here |
 *
 * The bar draws the same four controls the web header does, so **exactly one of
 * them may be on screen**. `isNativeHeaderEnabled()` is what the header row
 * reads to hide itself; get that wrong and you have two burgers and two ⋮.
 *
 * ## Why everything is feature-detected rather than assumed
 *
 * Native code reaches a device through App Review, so an installed build is
 * routinely older than the page it is showing — the Mac and iOS apps load their
 * UI from `homecast.cloud` at runtime. A build that predates this preview sets
 * neither global, so every predicate here answers `false` and the app behaves
 * exactly as it did before. That is the same rule the repo's CLAUDE.md states
 * for bridge methods generally: never call a new one without checking it exists.
 */

/** The four controls, named as the native bar names them. */
export type NativeHeaderControl = 'menu' | 'status' | 'search' | 'overflow';

/**
 * What the page publishes down for the native bar to draw.
 *
 * **Every field is optional and a publish is a partial merge**, not a
 * replacement. That is what lets the two things the bar draws be owned by the
 * two different components that actually know them: `AppHeader` holds the
 * title, `StatusBadge` holds the connection colour, and neither has to learn
 * the other's state to publish its own. A replacing protocol would force one
 * component to know both, which on this screen means threading the whole
 * `statusPresentation` result up through `Dashboard`.
 *
 * An omitted key therefore means "unchanged", and is the normal case.
 */
export interface NativeHeaderState {
  /** The current home, room or collection name. */
  title?: string;
  /**
   * The connection dot's fill, as CSS hex (`#22c55e`).
   *
   * `null` hides the dot rather than drawing it grey — a page with no home
   * selected has no connection to report, and a grey dot reads as "offline".
   * Note this is the one field where `null` and "absent" differ.
   */
  statusColor?: string | null;
  showMenu?: boolean;
  showSearch?: boolean;
  showOverflow?: boolean;
}

/**
 * The native dot's fill for a Tailwind `dotClass` from `connection-presentation`.
 *
 * A translation table rather than a shared constant, because the two sides
 * genuinely cannot share one: the web dot is a Tailwind class resolved by the
 * stylesheet, and UIKit needs a literal colour. Keeping the table here — next
 * to the rest of the preview — means the whole thing is deleted in one move if
 * it is rejected.
 *
 * Matched on the colour name rather than the exact class so that an opacity
 * change (`bg-emerald-500/60`) does not silently fall through to grey.
 */
export function statusDotHex(dotClass: string | null | undefined): string | null {
  if (!dotClass) return null;
  if (dotClass.includes('red')) return '#ef4444';
  if (dotClass.includes('amber')) return '#f59e0b';
  if (dotClass.includes('emerald') || dotClass.includes('green')) return '#10b981';
  // `bg-muted-foreground/40` — connected to nothing in particular, which is a
  // real state and not an error. Grey, not hidden: the control still has to be
  // there to be tapped.
  return '#8e8e93';
}

interface NativeHeaderWindow extends Window {
  /** This build can draw the bar at all. Absent on every older build. */
  homecastNativeHeaderAvailable?: boolean;
  /** The bar is drawing right now. Kept in step by `setEnabled` below. */
  homecastNativeHeaderEnabled?: boolean;
  __homecastNativeHeader?: {
    tap: (control: string) => void;
    setEnabled: (enabled: boolean) => void;
  };
  webkit?: {
    messageHandlers?: {
      homecast?: { postMessage: (message: unknown) => void };
    };
  };
}

function win(): NativeHeaderWindow | null {
  return typeof window === 'undefined' ? null : (window as NativeHeaderWindow);
}

function post(message: Record<string, unknown>): boolean {
  const handler = win()?.webkit?.messageHandlers?.homecast;
  if (!handler) return false;
  try {
    handler.postMessage(message);
    return true;
  } catch {
    // A postMessage to a handler the build never registered throws. Swallowed
    // on purpose: this is a preview, and it must never be the reason the header
    // fails to render.
    return false;
  }
}

/**
 * Can this build draw the native bar?
 *
 * This is the gate on *offering the switch*, not on using it. A build without
 * it must not show a toggle that would do nothing.
 */
export function isNativeHeaderAvailable(): boolean {
  return win()?.homecastNativeHeaderAvailable === true;
}

/**
 * Is the native bar on screen right now?
 *
 * The web header row reads this to decide whether to draw itself.
 */
export function isNativeHeaderEnabled(): boolean {
  const w = win();
  return w?.homecastNativeHeaderAvailable === true && w?.homecastNativeHeaderEnabled === true;
}

/**
 * Turn the preview on or off.
 *
 * Native writes the flag to UserDefaults, shows or hides the bar, and calls
 * `setEnabled` back — so the switch takes effect without a reload, which is
 * what makes it usable as a preview rather than a setting you have to restart
 * to evaluate.
 */
export function setNativeHeaderPreview(enabled: boolean): boolean {
  if (!isNativeHeaderAvailable()) return false;
  return post({ action: 'settings.setNativeHeaderPreview', enabled });
}

/**
 * Tell the native bar what to draw.
 *
 * Safe and cheap to call on every render: it is a no-op off iOS, and the native
 * side treats a message with no bar on screen as normal rather than an error.
 * Deliberately NOT gated on `isNativeHeaderEnabled()` — the bar must already
 * have a title the moment it appears, so the page keeps publishing while the
 * preview is off.
 */
export function publishHeaderState(state: NativeHeaderState): boolean {
  if (!isNativeHeaderAvailable()) return false;

  // Only the keys the caller actually set. Sending `undefined` for the rest
  // would be indistinguishable from setting them, and the native side merges —
  // so a title publish would blank the status dot and vice versa.
  const message: Record<string, unknown> = { action: 'header.setState' };
  if (state.title !== undefined) message.title = state.title;
  if (state.statusColor !== undefined) message.statusColor = state.statusColor;
  if (state.showMenu !== undefined) message.showMenu = state.showMenu;
  if (state.showSearch !== undefined) message.showSearch = state.showSearch;
  if (state.showOverflow !== undefined) message.showOverflow = state.showOverflow;

  return post(message);
}

/**
 * The attribute that marks a web control as the target of a native tap.
 *
 * ## Why a native tap clicks the web button rather than calling a handler
 *
 * All four controls open Radix surfaces — a `Sheet`, a `Popover`, a
 * `DropdownMenu` — whose open state lives inside the trigger, not in a prop
 * anyone can set. Routing a native tap to "the handler" would mean lifting all
 * four into controlled state through a 7,000-line `Dashboard`, for a preview
 * that may be rejected.
 *
 * So the web row stays **mounted and hidden** rather than unmounted, and a
 * native tap clicks the real trigger. Radix's own logic runs untouched,
 * anchoring still works because the trigger is still laid out, and the whole
 * mechanism reverts by deleting one CSS class. The cost is that the hidden row
 * must keep its layout box — see `nativeHeaderHiddenClass`.
 */
export const NATIVE_HEADER_TARGET_ATTR = 'data-native-header';

/**
 * How the web header row hides while the native bar has the screen.
 *
 * `visibility: hidden` and not `display: none`: a `display: none` trigger has
 * no box, so Radix would anchor every popover at the origin, and a click on it
 * does nothing. This keeps the row laid out and unreachable — invisible to the
 * eye and to the pointer, still present for `.click()`.
 */
export const NATIVE_HEADER_HIDDEN_CLASS = 'invisible pointer-events-none';

/** Find the web control a native tap should reach. */
export function findHeaderTarget(
  control: NativeHeaderControl,
  root: Document | HTMLElement = document,
): HTMLElement | null {
  return root.querySelector<HTMLElement>(`[${NATIVE_HEADER_TARGET_ATTR}="${control}"]`);
}

/**
 * Press the web control that corresponds to a native tap.
 *
 * Returns whether anything was found — `false` is the honest answer on a screen
 * that has no ⋮ (a share link, the login page), and the caller should not treat
 * it as a failure.
 */
export function activateHeaderControl(
  control: NativeHeaderControl,
  root: Document | HTMLElement = document,
): boolean {
  const target = findHeaderTarget(control, root);
  if (!target) return false;
  target.click();
  return true;
}

/**
 * Install the native → page half of the handshake.
 *
 * Returns a teardown. Call this once, from the component that owns the four
 * controls, handing it the same handlers its own buttons run — the whole point
 * is that a native tap and a web tap end in the same place.
 *
 * `onEnabledChange` fires when native flips the bar on or off, so the web row
 * can hide or come back without a reload.
 */
export function installNativeHeaderBridge(handlers: {
  onTap: (control: NativeHeaderControl) => void;
  onEnabledChange?: (enabled: boolean) => void;
}): () => void {
  const w = win();
  if (!w) return () => {};

  const isControl = (value: string): value is NativeHeaderControl =>
    value === 'menu' || value === 'status' || value === 'search' || value === 'overflow';

  w.__homecastNativeHeader = {
    tap: (control: string) => {
      // An older page talking to a newer build could be handed a control it
      // has never heard of. Ignoring it beats throwing inside an
      // `evaluateJavaScript` nobody is reading the result of.
      if (isControl(control)) handlers.onTap(control);
    },
    setEnabled: (enabled: boolean) => {
      w.homecastNativeHeaderEnabled = enabled;
      handlers.onEnabledChange?.(enabled);
    },
  };

  return () => {
    delete w.__homecastNativeHeader;
  };
}
