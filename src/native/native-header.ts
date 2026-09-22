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
  /** The home's name — what the compact bar carries. */
  title?: string;
  /**
   * What the large text at the top says, when it is not the home: the room,
   * room group or collection being viewed. Absent or equal to `title` means
   * the home view, where the large text is the home name and hands over to
   * the bar's title as you scroll. A distinct heading is a page heading: the
   * bar keeps the home name throughout and the heading simply scrolls away
   * with the content, like the Home app's room pages.
   */
  heading?: string;
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
  /**
   * Whether the bar should draw the large title band at all. False in the
   * layout that has a permanent sidebar (a phone in landscape, an iPad): the
   * page draws its own heading beside the sidebar there, and the bar is just
   * the compact row.
   */
  largeTitle?: boolean;
  /**
   * The connection state in words — what the Home app shows under its title
   * ("Updating…", "No Response"). The native bar draws it as the subtitle.
   */
  subtitle?: string;
  /**
   * The homes the native title menu offers, the way the Home app's title
   * chevron lists them. The page owns the order and the names.
   */
  homes?: NativeHeaderHome[];
  /** Which of `homes` is ticked. `null` when no home is selected. */
  currentHomeId?: string | null;
  /**
   * The ⋯ menu, as data, so the native bar can present it as a `UIMenu`
   * rather than tapping through to the web dropdown. Sections become inline
   * groups; `symbol` is an SF Symbol name.
   */
  menu?: NativeHeaderMenuSection[];
  /**
   * Whether the page is drawing light-on-dark right now (a dark wallpaper, or
   * the dark theme). The bar follows the page, not the system: a black title
   * over a black page is what happens otherwise.
   */
  appearance?: 'dark' | 'light';
  /**
   * Something web is drawn over the whole page right now — the drawer, a
   * dialog, a popover. The bar sits above every web layer, so it steps aside
   * while one is open, the way a presented sheet covers the Home app's bar.
   */
  covered?: boolean;
  /**
   * What the status bar sits over while the page is covered: "light" for a
   * full-height cover painted light (the automation editor, a sheet over a
   * light wallpaper), "dark" for the scrim or a dark cover. The shell keys
   * the status bar's ink on this instead of `appearance` while `covered`.
   */
  coverAppearance?: 'dark' | 'light';
  /** A widget is expanded over the page: the bar stays, dimmed behind it. */
  dimmed?: boolean;
  /**
   * What the ☰ button offers natively: the current home's rooms and room
   * groups, the collections and their groups. Homes are not here — they
   * moved to the title menu. An item with `children` is a submenu.
   */
  navigation?: NativeHeaderNavSection[];
}

export interface NativeHeaderNavItem {
  /** Unique across the whole menu — what comes back from `navigate`. */
  id: string;
  label: string;
  symbol?: string;
  /** Ticked. */
  selected?: boolean;
  /** Presented as a submenu instead of an action. */
  children?: NativeHeaderNavItem[];
}

export interface NativeHeaderNavSection {
  id: string;
  title?: string;
  items: NativeHeaderNavItem[];
}

export interface NativeHeaderMenuItem {
  /** Unique across the whole menu — what comes back from `menuAction`. */
  id: string;
  label: string;
  symbol?: string;
  destructive?: boolean;
  disabled?: boolean;
}

export interface NativeHeaderMenuSection {
  id: string;
  title?: string;
  items: NativeHeaderMenuItem[];
}

export interface NativeHeaderHome {
  id: string;
  name: string;
}

/**
 * Fired on `window` whenever native flips the bar on or off, so anything that
 * needs to know — the dashboard, which switches to document scrolling — can
 * subscribe without owning the bridge.
 */
export const NATIVE_HEADER_EVENT = 'homecast:native-header';

/**
 * How far the native bar reaches down the screen with its large title shown,
 * and the status bar's own height, in CSS px. Both come from the shell with
 * `setEnabled`; zero until it has said.
 *
 * The page pads its content by `bar` and pins `--safe-area-top` to `status`:
 * the content draws under a transparent bar the way the Home app's does, and
 * because `env(safe-area-inset-top)` shrinks as the large title collapses,
 * reading it live would move the content under the finger.
 */
export function nativeHeaderInsets(): { bar: number; status: number; base?: number; eyebrow?: number } {
  return win()?.homecastNativeHeaderInsets ?? { bar: 0, status: 0 };
}

/**
 * How far the content starts below the top of the screen, for a page that
 * is (`onPage`) or is not showing a room, group or collection heading.
 *
 * The shell's band is 18pt taller on a room page, for the home's name above
 * the room's. A shell that reports `base` lets the page add that line itself,
 * in the same render that changes the heading; waiting for the shell to
 * measure and report back left the home view padded for a room for a frame
 * or two after a pop, and the content jumped. An older shell reports only
 * `bar`, already including the line as the shell last saw it.
 */
export function nativeHeaderContentInset(onPage: boolean): number {
  const { bar, base, eyebrow } = nativeHeaderInsets();
  if (typeof base === 'number' && typeof eyebrow === 'number') return base + (onPage ? eyebrow : 0);
  return bar;
}

/** Whether a heading is a page heading, by the rule the shell uses. */
export function isNativePageHeading(heading: string | undefined, title: string | undefined): boolean {
  const h = (heading ?? '').trim();
  return h.length > 0 && h !== (title ?? '');
}

/**
 * The large-title band's height, in points — the same number as the native
 * side's `WebHostingLayout.largeTitleHeight`. The bar inset it reports is the
 * compact bar plus this, so this is what recovers the compact bar's bottom.
 */
export const NATIVE_HEADER_LARGE_TITLE_HEIGHT = 52;

/**
 * The line the native bar's controls are centred on, in viewport px. In the
 * sidebar layout the bar reports no band (bar == status) and is just its
 * buttons on a standard-height row.
 *
 * This is NOT where a toast goes — see `nativeHeaderToastTop`. It used to be,
 * and that is parob/homecast-cloud#164: the bar is UIKit, composited above the
 * web view, so a pill centred on its controls is painted over by them and no
 * `z-index` reaches it.
 */
export function nativeHeaderRowCenter(): number {
  const { bar, status, base } = nativeHeaderInsets();
  const band = typeof base === 'number' ? base : bar;
  const compactBottom = band > status ? band - NATIVE_HEADER_LARGE_TITLE_HEIGHT : status + 54;
  return status + (compactBottom - status) / 2;
}

/**
 * The air the toast leaves between itself and the native bar's band.
 */
export const NATIVE_HEADER_TOAST_GAP = 8;

/**
 * Where the toaster's top edge goes while the native bar is up, in viewport px.
 *
 * The web header can have a toast sit on its own controls' line, because the
 * page draws both and the toaster wins on `z-index`. The native bar cannot: it
 * is a `UINavigationBar` outside the web view, so anything the page puts on
 * that line is painted over — the search and ⋯ buttons, the bar's scrim, and
 * the large title band too, since the bar draws the title and its eyebrow as
 * well as the controls (parob/homecast-cloud#164).
 *
 * So the toast clears the WHOLE band and starts where the page's own content
 * does. `nativeHeaderContentInset` is that line already — the same number the
 * page pads itself by — which keeps the two from drifting apart.
 *
 * The sidebar layout reports no band (`bar == status`): the bar is two
 * floating buttons on a standard-height row over content that lays itself out
 * as it always did, so there is nothing to clear but that row.
 */
export function nativeHeaderToastTop(onPage: boolean): number {
  const { bar, status, base } = nativeHeaderInsets();
  const band = typeof base === 'number' ? base : bar;
  const bottom = band > status ? nativeHeaderContentInset(onPage) : status + 54;
  return bottom + NATIVE_HEADER_TOAST_GAP;
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
    setEnabled: (enabled: boolean, barInset?: number, statusInset?: number, baseInset?: number, eyebrow?: number) => void;
    selectHome?: (homeId: string) => void;
    menuAction?: (itemId: string) => void;
    navigate?: (itemId: string) => void;
    refresh?: (kind: string) => void;
  };
  /** The bar's full height (large title shown) and the status bar alone, pt.
   *  `base` (newer shells) is the height without the eyebrow line a room
   *  page adds above its name; `eyebrow` is that line's height. */
  homecastNativeHeaderInsets?: { bar: number; status: number; base?: number; eyebrow?: number };
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
  if (state.heading !== undefined) message.heading = state.heading;
  if (state.statusColor !== undefined) message.statusColor = state.statusColor;
  if (state.showMenu !== undefined) message.showMenu = state.showMenu;
  if (state.showSearch !== undefined) message.showSearch = state.showSearch;
  if (state.showOverflow !== undefined) message.showOverflow = state.showOverflow;
  if (state.largeTitle !== undefined) message.largeTitle = state.largeTitle;
  if (state.subtitle !== undefined) message.subtitle = state.subtitle;
  if (state.homes !== undefined) message.homes = state.homes;
  if (state.currentHomeId !== undefined) message.currentHomeId = state.currentHomeId;
  if (state.menu !== undefined) message.menu = state.menu;
  if (state.appearance !== undefined) message.appearance = state.appearance;
  if (state.covered !== undefined) message.covered = state.covered;
  if (state.coverAppearance !== undefined) message.coverAppearance = state.coverAppearance;
  if (state.dimmed !== undefined) message.dimmed = state.dimmed;
  if (state.navigation !== undefined) message.navigation = state.navigation;

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
export const NATIVE_HEADER_HIDDEN_CLASS = 'invisible pointer-events-none !h-0 overflow-hidden';

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
export type NativeHeaderRefreshKind = 'soft' | 'hard';

/** The page has done what the native pull-to-refresh asked; stop the spinner. */
export function publishRefreshDone(): boolean {
  return post({ action: 'header.refreshDone' });
}

/**
 * Tell the shell the page has PAINTED the view whose heading it just
 * published. The heading goes out before the browser has drawn the new
 * page; the shell slides a picture of the new page in, and a picture taken
 * before the paint slid in blank.
 *
 * "Painted" means settled, not merely the next frame: a room renders in
 * more than one commit (its shell, then its tiles), and a picture taken two
 * frames after the first slid in with the title and no tiles. So this
 * watches the document for mutations and speaks after two consecutive
 * frames without any — or after `PAINT_SETTLE_LIMIT_MS`, whichever comes
 * first, so a page that never stops moving (a spinner) does not hold the
 * slide forever. Returns a cancel, for a heading that changes again first.
 */
export const PAINT_SETTLE_LIMIT_MS = 600;

export function publishPaintedAfterNextFrame(): () => void {
  if (typeof requestAnimationFrame === 'undefined') return () => {};
  let done = false;
  let quietFrames = 0;
  let frame = 0;
  const started = Date.now();
  const observer = typeof MutationObserver === 'undefined' ? null : new MutationObserver(() => { quietFrames = 0; });
  observer?.observe(document.body, { childList: true, subtree: true, attributes: true, characterData: true });
  const finish = () => {
    if (done) return;
    done = true;
    observer?.disconnect();
    if (frame) cancelAnimationFrame(frame);
    post({ action: 'header.painted' });
  };
  const tick = () => {
    frame = 0;
    if (done) return;
    quietFrames += 1;
    if (quietFrames >= 2 || Date.now() - started >= PAINT_SETTLE_LIMIT_MS) {
      finish();
      return;
    }
    frame = requestAnimationFrame(tick);
  };
  frame = requestAnimationFrame(tick);
  return () => {
    done = true;
    observer?.disconnect();
    if (frame) cancelAnimationFrame(frame);
  };
}

export function installNativeHeaderBridge(handlers: {
  onTap: (control: NativeHeaderControl) => void;
  onEnabledChange?: (enabled: boolean) => void;
  /** The native title menu picked a home. */
  onSelectHome?: (homeId: string) => void;
  /** The native ⋯ menu picked an item, by the id the page published. */
  onMenuAction?: (itemId: string) => void;
  /** The native ☰ menu picked a room, group or collection, by id. */
  onNavigate?: (itemId: string) => void;
  /**
   * The native pull-to-refresh fired. `soft` is the ordinary refresh; `hard`
   * is the deep pull that used to mean the web's hard-reload countdown. The
   * page answers with `publishRefreshDone()` so the spinner can stop.
   */
  onRefresh?: (kind: NativeHeaderRefreshKind) => void;
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
    setEnabled: (enabled: boolean, barInset?: number, statusInset?: number, baseInset?: number, eyebrow?: number) => {
      w.homecastNativeHeaderEnabled = enabled;
      if (typeof barInset === 'number' && typeof statusInset === 'number') {
        w.homecastNativeHeaderInsets = typeof baseInset === 'number' && typeof eyebrow === 'number'
          ? { bar: barInset, status: statusInset, base: baseInset, eyebrow }
          : { bar: barInset, status: statusInset };
      }
      handlers.onEnabledChange?.(enabled);
      w.dispatchEvent(new CustomEvent(NATIVE_HEADER_EVENT, { detail: { enabled } }));
    },
    selectHome: (homeId: string) => {
      if (typeof homeId === 'string' && homeId) handlers.onSelectHome?.(homeId);
    },
    menuAction: (itemId: string) => {
      if (typeof itemId === 'string' && itemId) handlers.onMenuAction?.(itemId);
    },
    navigate: (itemId: string) => {
      if (typeof itemId === 'string' && itemId) handlers.onNavigate?.(itemId);
    },
    refresh: (kind: string) => {
      handlers.onRefresh?.(kind === 'hard' ? 'hard' : 'soft');
    },
  };

  // Tell the shell the page's half is up. Native syncs on every page load,
  // but that fires when the document lands — before React has mounted this
  // bridge — so anything it said then (the bar's insets, above all) fell on
  // the floor. This asks it to say it again now that someone is listening.
  post({ action: 'header.ready' });

  return () => {
    // Sign-in, setup and other routes without AppHeader have no controls for
    // the native bar to operate. The next header's cover observer reveals it.
    publishHeaderState({ covered: true });
    delete w.__homecastNativeHeader;
  };
}

/**
 * What counts as covering the page: an open Radix dialog or sheet, or a web
 * bar that has taken the top of the page over and says so with
 * `data-native-header-cover="true"` — Edit Layout's toolbar, which replaces
 * the header's controls with Done while it is up. Left showing, the native
 * ⋯ menu and title selector sat over that toolbar and still worked, which is
 * exactly what the toolbar covers the web header to prevent. A popover also
 * carries `role="dialog"`, but it hangs off a control rather than covering
 * the page — and the connection popover is opened *from* the bar, which must
 * not vanish under it.
 */
export const NATIVE_HEADER_COVER_ATTR = 'data-native-header-cover';
export const NATIVE_HEADER_COVER_SELECTOR = `[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"], [${NATIVE_HEADER_COVER_ATTR}="true"]`;
const POPPER_WRAPPER = '[data-radix-popper-content-wrapper]';

export function isPageCovered(root: HTMLElement | Document = document): boolean {
  return Array.from(root.querySelectorAll<HTMLElement>(NATIVE_HEADER_COVER_SELECTOR))
    .some((el) => !el.closest(POPPER_WRAPPER));
}

/**
 * What the status bar sits over while the page is covered.
 *
 * The bar hides behind a cover, but the status bar stays, and its ink kept
 * following the page underneath: white over a dark wallpaper, which is
 * white over the automation editor's white — the clock vanished. The scrim is
 * black at 80%, so a cover that does not reach the top of the screen (a
 * centred dialog) leaves the status bar over something dark whatever the
 * wallpaper; only a cover as tall as the viewport paints under it, and then
 * its own background decides. Measured as `offsetHeight`, which a Radix
 * open animation's scale does not touch — the rect during zoom-in would
 * read a full-screen dialog as a few points short of the top.
 */
export function coverAppearance(root: HTMLElement | Document = document): 'dark' | 'light' {
  const covers = Array.from(root.querySelectorAll<HTMLElement>(NATIVE_HEADER_COVER_SELECTOR))
    .filter((el) => !el.closest(POPPER_WRAPPER))
    .filter((el) => el.offsetHeight >= window.innerHeight * 0.95);
  const top = covers[covers.length - 1];
  if (!top) return 'dark';
  return isLightPaint(getComputedStyle(top).backgroundColor) ? 'light' : 'dark';
}

/**
 * Whether a CSS colour reads as light once painted over the scrim. A
 * translucent material (`rgb(0 0 0 / 0.4)`, `rgb(255 255 255 / 0.7)`) is
 * composited over black, which is what sits behind every cover.
 */
export function isLightPaint(color: string): boolean {
  const parts = color.match(/[\d.]+%?/g);
  if (!parts || parts.length < 3) return false;
  const [r, g, b] = parts.slice(0, 3).map(Number);
  const raw = parts[3];
  const alpha = raw === undefined ? 1 : raw.endsWith('%') ? Number(raw.slice(0, -1)) / 100 : Number(raw);
  const luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) * alpha;
  return luminance > 127.5;
}

/** An expanded widget's panel, while open (see `ExpandedOverlay`). */
export const NATIVE_HEADER_DIM_SELECTOR = '[data-expanded-overlay="open"]';

/** Whether a widget is expanded over the page — the bar dims behind it. */
export function isPageDimmed(root: HTMLElement | Document = document): boolean {
  return root.querySelector(NATIVE_HEADER_DIM_SELECTOR) !== null;
}

/**
 * Publish `covered` whenever a web overlay opens or closes, and `dimmed`
 * whenever a widget expands or collapses.
 *
 * Watched on the DOM rather than lifted from state on purpose: the dashboard
 * owns dozens of dialogs and sheets, each with its own flag, and every future
 * one would have to remember to report itself. Radix stamps them all the same
 * way, so one observer covers them all. Returns a teardown.
 *
 * An expanded widget is not a cover: the page's own header stays reachable
 * over it (activating it dismisses the widget), so the bar stays too — but
 * behind the page's scrim, which the native bar floats above, it would read
 * as the one thing not dimmed. It dims itself instead.
 */
export function watchNativeHeaderCover(root: HTMLElement = document.body): () => void {
  if (!isNativeHeaderAvailable()) return () => {};
  let lastCovered: boolean | null = null;
  let lastCoverAppearance: 'dark' | 'light' | null = null;
  let lastDimmed: boolean | null = null;
  const check = () => {
    const covered = isPageCovered(root);
    const dimmed = isPageDimmed(root);
    const state: NativeHeaderState = {};
    if (covered !== lastCovered) { lastCovered = covered; state.covered = covered; }
    // Re-read on every mutation while covered, not only when `covered` flips:
    // a second, taller dialog can open over the first.
    const paint = covered ? coverAppearance(root) : null;
    if (paint !== null && paint !== lastCoverAppearance) { lastCoverAppearance = paint; state.coverAppearance = paint; }
    if (!covered) lastCoverAppearance = null;
    if (dimmed !== lastDimmed) { lastDimmed = dimmed; state.dimmed = dimmed; }
    if (Object.keys(state).length > 0) publishHeaderState(state);
  };
  const observer = new MutationObserver(check);
  observer.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-state', NATIVE_HEADER_COVER_ATTR, 'data-expanded-overlay'] });
  check();
  return () => observer.disconnect();
}
