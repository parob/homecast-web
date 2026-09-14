import React, { useLayoutEffect, useMemo, useRef } from 'react';
import { cn } from '@/lib/utils';
import { useAuth } from '@/contexts/AuthContext';
import { useNativeHeader } from '@/hooks/useNativeHeader';
import { NATIVE_HEADER_EVENT, NATIVE_HEADER_HIDDEN_CLASS, isNativeHeaderEnabled, nativeHeaderRowCenter, type NativeHeaderRefreshKind, type NativeHeaderHome, type NativeHeaderMenuSection, type NativeHeaderNavSection, type NativeHeaderState } from '@/native/native-header';
import { LogIn } from 'lucide-react';

interface AppHeaderProps {
  children: React.ReactNode;
  isInMacApp?: boolean;
  isInMobileApp?: boolean;
  /** Optional menu to show in the user bubble area */
  rightMenu?: React.ReactNode;
  /** Optional badge to show left of the user email (e.g. relay status) */
  leftBadge?: React.ReactNode;
  /** Whether there's a custom background image/gradient active */
  hasBackground?: boolean;
  /** Whether the background is dark enough to warrant light text */
  isDarkBackground?: boolean;
  /** Expand to full browser width (browser-only setting) */
  fullWidth?: boolean;
  /**
   * What the native top chrome should show as its title, when the iOS preview
   * is on (parob/homecast-cloud#120). Ignored everywhere else.
   */
  nativeTitle?: string;
  /** The room, room group or collection being viewed; the home when absent. */
  nativeHeading?: string;
  /** Put `leftBadge` at the start of the row rather than with the right cluster. */
  badgeLeads?: boolean;
  /** Phone layout: the bar draws the large title and offers the menu button. */
  nativeLargeTitle?: boolean;
  /** Whether the page has a drawer for the bar's ☰ to open. */
  nativeShowMenu?: boolean;
  /** The connection dot's colour for that bar, as CSS hex. `null` hides it. */
  nativeStatusColor?: string | null;
  /** The homes the native title menu lists, in the page's order. */
  nativeHomes?: NativeHeaderHome[];
  /** Which of them is current. */
  nativeCurrentHomeId?: string | null;
  /** The native title menu picked a home. */
  onNativeSelectHome?: (homeId: string) => void;
  /** The ⋯ menu as data, for the native bar to present natively. */
  nativeMenu?: NativeHeaderMenuSection[];
  /** The native ⋯ menu picked an item. */
  onNativeMenuAction?: (itemId: string) => void;
  /** Whether the page is drawing light-on-dark, so the bar can match. */
  nativeAppearance?: 'dark' | 'light';
  /** What the native ☰ menu offers: rooms, room groups, collections. */
  nativeNavigation?: NativeHeaderNavSection[];
  /** The native ☰ menu picked an item. */
  onNativeNavigate?: (itemId: string) => void;
  /** The native pull-to-refresh fired; answer with `publishRefreshDone()`. */
  onNativeRefresh?: (kind: NativeHeaderRefreshKind) => void;
  /**
   * Centred in the row, between the left cluster and the controls: the
   * phone's collapsed page title, shown once the big heading has scrolled
   * under the bar. Sized by its content; the caller keeps it narrow.
   */
  centerTitle?: React.ReactNode;
}

export function AppHeader({ children, isInMacApp, isInMobileApp, rightMenu, leftBadge, hasBackground, isDarkBackground, fullWidth, badgeLeads, nativeTitle, nativeHeading, nativeLargeTitle, nativeShowMenu, nativeStatusColor, nativeHomes, nativeCurrentHomeId, onNativeSelectHome, nativeMenu, onNativeMenuAction, nativeAppearance, nativeNavigation, onNativeNavigate, onNativeRefresh, centerTitle }: AppHeaderProps) {
  const { isAuthenticated, isLoading } = useAuth();

  // The native top chrome, on iOS, behind a preview flag that is off by
  // default — so on every other platform and every build without it, this is
  // `false` and nothing below changes.
  //
  // Memoised because the hook publishes on identity change, and an object
  // literal is a new identity every render — which would post to the bridge on
  // every keystroke anywhere in the app.
  //
  // The connection dot is NOT published here. `StatusBadge` owns that state and
  // publishes it itself; `header.setState` merges, so the two never overwrite
  // each other. `nativeStatusColor` stays as a prop for a caller that renders
  // no `StatusBadge` and still wants a dot.
  // The menu is rebuilt by `Dashboard` on every render (it cannot memoise —
  // it sits below an early return), so it is keyed on its content here.
  const nativeMenuKey = nativeMenu === undefined ? undefined : JSON.stringify(nativeMenu);
  const nativeNavigationKey = nativeNavigation === undefined ? undefined : JSON.stringify(nativeNavigation);
  const nativeState = useMemo(() => {
    const state: NativeHeaderState = { title: nativeTitle ?? '', heading: nativeHeading ?? '' };
    if (nativeLargeTitle !== undefined) state.largeTitle = nativeLargeTitle;
    if (nativeShowMenu !== undefined) state.showMenu = nativeShowMenu;
    if (nativeStatusColor !== undefined) state.statusColor = nativeStatusColor;
    if (nativeHomes !== undefined) state.homes = nativeHomes;
    if (nativeCurrentHomeId !== undefined) state.currentHomeId = nativeCurrentHomeId;
    if (nativeMenuKey !== undefined) state.menu = JSON.parse(nativeMenuKey) as NativeHeaderMenuSection[];
    if (nativeAppearance !== undefined) state.appearance = nativeAppearance;
    if (nativeNavigationKey !== undefined) state.navigation = JSON.parse(nativeNavigationKey) as NativeHeaderNavSection[];
    return state;
  }, [nativeTitle, nativeHeading, nativeLargeTitle, nativeShowMenu, nativeStatusColor, nativeHomes, nativeCurrentHomeId, nativeMenuKey, nativeAppearance, nativeNavigationKey]);
  const nativeHeaderActive = useNativeHeader(nativeState, { onSelectHome: onNativeSelectHome, onMenuAction: onNativeMenuAction, onNavigate: onNativeNavigate, onRefresh: onNativeRefresh });

  // Android: window.HomecastAndroid (JS bridge) is registered on WebView
  // creation and is therefore available at the first React render — whereas
  // window.isHomecastAndroidApp is injected by Tauri on PageLoadEvent::Started,
  // which lands AFTER React mounts. Falling back to the bridge guarantees the
  // header reserves status-bar inset on first paint, not after a rerender.
  const inMobileApp = isInMobileApp || (typeof window !== 'undefined' && !!(window as Window & { HomecastAndroid?: unknown }).HomecastAndroid);

  // Publish the line this row's controls are centred on, for anything drawn
  // beside them — today that is the toaster, whose pill lands between the
  // burger and Done while Edit Layout's bar covers this header. Measured, not
  // derived: the row is 80px from the top of the viewport on a phone and 70px
  // starting at a 33px title-bar inset in the Mac app, where the left cluster
  // sets the height rather than the class asking for 56px does. Reading it off
  // the element is what keeps the two in step through a text-scale change or
  // anything else that moves the row.
  const rowRef = useRef<HTMLDivElement>(null);
  const headerRef = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    const row = rowRef.current;
    const header = headerRef.current;
    if (!row || !header) return;
    const publish = () => {
      // While the native bar has the screen this row is collapsed to nothing
      // (`NATIVE_HEADER_HIDDEN_CLASS`), so measuring it put the toast on the
      // header's top padding — under the status bar, or under the bar's own
      // controls. The bar reports its insets; the line its buttons sit on
      // follows from those.
      if (isNativeHeaderEnabled()) {
        document.documentElement.style.setProperty('--top-row-center', `${nativeHeaderRowCenter()}px`);
        return;
      }
      const box = row.getBoundingClientRect();
      document.documentElement.style.setProperty('--top-row-center', `${box.top + box.height / 2}px`);
    };
    publish();
    // The bar coming or going, or reporting new insets after a rotation.
    window.addEventListener(NATIVE_HEADER_EVENT, publish);
    // The header is `fixed`, so the row moves only when the header's own box
    // changes — and that is NOT the same as the row resizing, which is all this
    // used to watch. The row is 80px tall whether or not it has been pushed down
    // past a notch, so the one thing that moves it moved it silently.
    //
    // It moves because `safe-area-top` arrives late. `isInMobileApp` is seeded
    // false and flipped in an effect, so the first layout is always the
    // uninset one; on iOS `env(safe-area-inset-top)` can resolve a beat late as
    // well. Either way the row slides down by the inset at constant height, and
    // the toaster went on aiming at the line it had left — which on a notched
    // iPhone put the pill at y=20–61, underneath the status bar
    // (parob/homecast-cloud#59).
    //
    // Watching the header covers every case, because header height is its
    // padding plus this row: the safe-area inset landing, the Mac app's 33px
    // title bar, an orientation change, and a text-scale change that resizes
    // the row itself.
    //
    // `border-box` is load-bearing: the inset arrives as `padding-top`, and a
    // default ResizeObserver watches the CONTENT box, which padding leaves at
    // 80px. Observed the default way the header grows 80 → 139 in silence.
    const observer = new ResizeObserver(publish);
    observer.observe(row);
    observer.observe(header, { box: 'border-box' });
    return () => {
      observer.disconnect();
      window.removeEventListener(NATIVE_HEADER_EVENT, publish);
      // Back to the stylesheet's default, which is what a page with no header
      // — login, a share link — is positioned against.
      document.documentElement.style.removeProperty('--top-row-center');
    };
  }, []);

  return (
    <header
      ref={headerRef}
      className={cn(
        "fixed top-0 left-0 right-0 z-[10001]",
        "overscroll-none pointer-events-none",
        inMobileApp && "safe-area-top safe-area-x",
        isInMacApp && "window-drag"
      )}
      style={isInMacApp ? { paddingTop: '33px' } : undefined}
    >
      {/* In the Mac app the 33px above this row already clears the traffic
          lights, so a full 80px row on top of it pushed the whole page down.
          56px is exactly the bubble's height — nothing to spare, nothing wasted. */}
      {/* Hidden, not unmounted, while the native bar has the screen. The four
          triggers stay in the DOM and keep their layout box so a native tap can
          click the real one and Radix can anchor to it — see
          `NATIVE_HEADER_HIDDEN_CLASS`. It also keeps `--top-row-center` (below)
          resolving to the line the native bar is drawn on, which is where the
          toaster wants to sit anyway. */}
      <div ref={rowRef} className={cn("relative mx-auto w-full px-4 flex items-center justify-between",
        isInMacApp ? "h-[max(3.5rem,56px)]" : "h-[80px]",
        !isInMacApp && !fullWidth && "max-w-7xl",
        nativeHeaderActive && NATIVE_HEADER_HIDDEN_CLASS)}>
        {/* Left content. The slab that used to sit behind it over a light
            background is gone with the buttons' own circles — see
            `lib/header-chrome.ts`; legibility is the glyph's own drop shadow
            now, which costs the header no box at all. */}
        <div className="relative flex items-center gap-2 h-[max(3.5rem,56px)] px-0 md:px-[max(0.5rem,8px)] pointer-events-auto">
          {badgeLeads && leftBadge}
          {children}
        </div>
        {centerTitle && (
          <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 pointer-events-auto">
            {centerTitle}
          </div>
        )}

        {/* User login state bubble */}
        {!isInMacApp && (
          <div className="relative flex items-center gap-2 pl-0 pr-0 md:pl-[max(1.25rem,20px)] md:pr-[17px] h-[max(3.5rem,56px)] pointer-events-auto">
            {!badgeLeads && leftBadge}
            {!isAuthenticated && !isLoading && (
              <span className={cn(
                "flex items-center gap-1.5 px-2 py-1 rounded-full text-[11px] font-medium transition-colors duration-300 no-drag",
                isDarkBackground
                  ? "material-regular-dark text-white/90"
                  : "bg-muted text-muted-foreground"
              )}>
                <LogIn className="h-3 w-3" />
                Guest
              </span>
            )}
            {rightMenu}
          </div>
        )}
      </div>
      {/* Mac app: position bubble at top-right, in title bar area */}
      {isInMacApp && (
        // Centred on the same line as the left cluster: 33px of title-bar
        // padding plus half a 56px row puts that line at 61px, and this is
        // positioned against the header's padding box, so it starts at 33.
        <div className="absolute top-[33px] right-[23px] flex items-center gap-2 pl-[max(1.25rem,20px)] pr-[17px] h-[max(3.5rem,56px)] pointer-events-auto">
          {leftBadge}
          {!isAuthenticated && !isLoading && (
            <span className={cn(
              "flex items-center gap-1.5 px-2 py-1 rounded-full text-[11px] font-medium transition-colors duration-300 no-drag",
              isDarkBackground
                ? "material-regular-dark text-white/70"
                : "bg-black/10 text-muted-foreground"
            )}>
              <LogIn className="h-3 w-3" />
              Guest
            </span>
          )}
          {rightMenu}
        </div>
      )}
    </header>
  );
}
