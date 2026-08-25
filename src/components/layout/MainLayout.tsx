import { useState, useEffect } from 'react';
import { cn } from '@/lib/utils';
import { AppHeader } from './AppHeader';
import { BackgroundImage } from '@/components/BackgroundImage';
import { useBackgroundDarkness } from '@/hooks/useBackgroundDarkness';
import { useCanvasTint } from '@/hooks/useCanvasTint';
import { BackgroundContext } from '@/contexts/BackgroundContext';
import { useIsMobile } from '@/hooks/use-mobile';
import { useEdgeSwipeOpen } from '@/hooks/useDrawerSwipe';
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Menu } from 'lucide-react';
import type { BackgroundSettings } from '@/lib/graphql/types';

// Android Tauri app: ensure safe area CSS variable is set early.
// Tauri injects this via on_page_load (onPageFinished) but that's after React renders.
// HomecastAndroid is a @JavascriptInterface registered on WebView creation — always available.
if ((window as Window & { HomecastAndroid?: unknown }).HomecastAndroid) {
  document.documentElement.style.setProperty('--safe-area-top', '48px');
}

// Header height constants (in pixels)
const HEADER_HEIGHT = 80;
const MAC_TRAFFIC_LIGHTS = 28;
// What AppHeader actually occupies in the Mac app: 33px of title-bar padding
// above a row that is 3.5rem tall but never shorter than 56px. Kept as a calc
// so it is measured the way the header itself is, off the root font size.
const MAC_HEADER_HEIGHT = 'calc(33px + max(3.5rem, 56px))';

interface MainLayoutProps {
  children: React.ReactNode;
  headerContent: React.ReactNode;
  sidebar?: React.ReactNode;
  isInMacApp?: boolean;
  isInMobileApp?: boolean;
  footer?: React.ReactNode;
  background?: BackgroundSettings | null;
  /** Sits in the header's right-hand bubble, just left of the Guest chip. */
  headerBadge?: React.ReactNode;
}

export function MainLayout({
  children,
  headerContent,
  sidebar,
  isInMacApp,
  isInMobileApp,
  footer,
  background,
  headerBadge,
}: MainLayoutProps) {
  const isMobile = useIsMobile();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [bgImageLuminance, setBgImageLuminance] = useState<number | null>(null);

  // Determine if there's an active background and if it's dark enough for light text.
  //
  // There is deliberately no extra "background has loaded" gate here. It used to
  // AND this with a readiness flag reset on every background change, which
  // defeated the hold-previous behaviour inside useBackgroundDarkness: swapping
  // one dark wallpaper for another flashed the whole chrome to light text for the
  // duration of the image load, because the outgoing (still dark) wallpaper was
  // what was actually on screen. The hook already returns the previous answer
  // while a new image's luminance is pending, and false on a cold start when
  // there is no previous answer — which is the readable choice, since nothing is
  // painted over bg-background yet. Gating on top of that could only ever be a
  // no-op or a regression.
  const { hasBackground, isDarkBackground, effectiveLuminance } = useBackgroundDarkness(background, bgImageLuminance);

  // Swipe in from the left edge to open the menu — the same gesture that closes
  // it again from inside the sheet (see SheetContent). Only where the menu is
  // collapsed behind a button in the first place: on md and up the sidebar is a
  // permanent column, and there is nothing to open.
  useEdgeSwipeOpen({
    enabled: !!sidebar && isMobile && !sidebarOpen,
    onOpen: () => setSidebarOpen(true),
  });

  // Android Tauri app: sync status bar icon color with background darkness.
  // Calls the @JavascriptInterface directly (registered on WebView creation,
  // always available — no timing dependency on Tauri's on_page_load).
  useEffect(() => {
    const w = window as Window & { HomecastAndroid?: { setStatusBarDarkIcons: (dark: boolean) => void } };
    w.HomecastAndroid?.setStatusBarDarkIcons(!isDarkBackground);
  }, [isDarkBackground]);

  const sidebarPaddingTop = isInMacApp
    ? MAC_HEADER_HEIGHT
    : isInMobileApp
    ? `calc(${HEADER_HEIGHT}px + var(--safe-area-top, 0px))`
    : `${HEADER_HEIGHT}px`;

  const contentPaddingTop = isInMacApp
    ? MAC_HEADER_HEIGHT
    : isInMobileApp
    ? `calc(${HEADER_HEIGHT}px + var(--safe-area-top, 0px))`
    : `${HEADER_HEIGHT}px`;

  const contentPaddingBottom = isInMobileApp
    ? 'calc(16px + var(--safe-area-bottom, 0px))'
    : '64px';

  // Same canvas paint the dashboard does. This layout scrolls inside itself
  // rather than scrolling the document, so the canvas is rarely on show — but
  // when it is, it should not be the theme's white over a dark wallpaper.
  // No sampled colour here: this layout only tracks luminance, which is enough
  // to land the tint in the right register.
  useCanvasTint({
    background,
    sampledTopColor: null,
    isDark: isDarkBackground,
    isNativeShell: isInMacApp || isInMobileApp,
  });

  return (
    <BackgroundContext.Provider value={{ hasBackground, isDarkBackground, effectiveLuminance }}>
    <div className="fixed inset-0">
      {/* Backdrop color painted past the safe areas — the layout container
          itself must stay at inset-0 so content keeps clear of the notch. */}
      <div aria-hidden className={cn("fixed-full-screen pointer-events-none -z-10", hasBackground && isDarkBackground ? "bg-black" : "bg-background")} />
      {/* Background image layer */}
      <BackgroundImage settings={background} onLuminanceChange={setBgImageLuminance} />

      <AppHeader
        isInMacApp={isInMacApp}
        isInMobileApp={isInMobileApp}
        hasBackground={hasBackground}
        isDarkBackground={isDarkBackground}
        leftBadge={headerBadge}
      >
        <div className="flex items-center gap-3">
          {/* Mobile menu button - shown when sidebar content exists */}
          {sidebar && isMobile && (
            <Sheet open={sidebarOpen} onOpenChange={setSidebarOpen}>
              <SheetTrigger asChild>
                <Button variant="ghost" size="icon" className={cn("md:hidden focus-visible:ring-0 focus-visible:ring-offset-0 !bg-transparent hover:!bg-black/10 active:!bg-black/20 transition-colors duration-300", isDarkBackground && "!bg-black/40 backdrop-blur-xl text-white hover:!bg-black/50 active:!bg-black/60")}>
                  <Menu className="h-5 w-5" />
                </Button>
              </SheetTrigger>
              {/* Mac: clear the traffic lights the same way the Dashboard drawer
                  does — inset the padding, not the panel. */}
              {/* No close button, the same as the Dashboard drawer: a left menu
                  opens straight onto its nav, so the X lands on top of the first
                  row. Picking any nav button closes it, as does tapping outside,
                  swiping back to the left, or Esc. */}
              <SheetContent side="left" className={cn("w-[266px] p-0 overflow-x-hidden border-none safe-area-top safe-area-bottom safe-area-left", isDarkBackground ? "material-regular-dark" : "bg-background")} style={isInMacApp ? { paddingTop: 33 } : undefined} aria-describedby={undefined}>
                <SheetTitle className="sr-only">Navigation Menu</SheetTitle>
                <div className="h-full flex flex-col overflow-hidden">
                  {/* Close sheet when a nav button is clicked */}
                  <div className={cn("p-4 mt-3 overflow-y-auto scrollbar-hidden flex-1", isDarkBackground && "text-white")} onClick={(e) => {
                    if ((e.target as HTMLElement).closest('button')) setSidebarOpen(false);
                  }}>
                    {sidebar}
                  </div>
                </div>
              </SheetContent>
            </Sheet>
          )}
          {headerContent}
        </div>
      </AppHeader>

      <div className="absolute inset-0 flex justify-center">
        <div className={cn("flex w-full", !isInMacApp && "max-w-7xl")}>
          {/* Sidebar - separate scroll, hidden on mobile (shown via Sheet) */}
          {sidebar && (
            <aside
              className={cn(
                "hidden md:block w-48 overflow-y-auto scrollbar-hidden shrink-0 min-h-0",
                hasBackground ? "" : "bg-card/80 backdrop-blur-md",
              )}
              style={{ paddingTop: sidebarPaddingTop }}
            >
              <div className={cn(
                isDarkBackground
                  ? "rounded-2xl p-3 material-thick-dark text-white shadow-[0_0_20px_rgba(0,0,0,0.3)]"
                  : "p-4"
              )}>
                {sidebar}
              </div>
            </aside>
          )}

          {/* Main Content - separate scroll */}
          <main className="relative flex-1 overflow-hidden">
            <div
              className="absolute inset-0 overflow-y-auto overflow-x-hidden overscroll-contain scrollbar-hidden"
              style={{
                paddingTop: contentPaddingTop,
                paddingBottom: contentPaddingBottom,
              }}
            >
              <div className="px-4 md:px-6 min-h-[calc(100%+1px)]">
                {children}
              </div>
              {footer}
            </div>
          </main>
        </div>
      </div>
    </div>
    </BackgroundContext.Provider>
  );
}

// Export constants for other components that need them
export { HEADER_HEIGHT, MAC_TRAFFIC_LIGHTS };
