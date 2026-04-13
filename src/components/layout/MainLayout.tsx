import { useState, useEffect, useCallback, useMemo } from 'react';
import { cn } from '@/lib/utils';
import { AppHeader } from './AppHeader';
import { BackgroundImage } from '@/components/BackgroundImage';
import { useBackgroundDarkness } from '@/hooks/useBackgroundDarkness';
import { BackgroundContext } from '@/contexts/BackgroundContext';
import { useIsMobile } from '@/hooks/use-mobile';
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

interface MainLayoutProps {
  children: React.ReactNode;
  headerContent: React.ReactNode;
  sidebar?: React.ReactNode;
  isInMacApp?: boolean;
  isInMobileApp?: boolean;
  footer?: React.ReactNode;
  background?: BackgroundSettings | null;
}

// Get a stable key for background changes (used to reset readiness state)
function getBackgroundChangeKey(settings?: BackgroundSettings | null): string {
  if (!settings || settings.type === 'none') return 'none';
  if (settings.type === 'preset' && settings.presetId) return `preset:${settings.presetId}`;
  if (settings.type === 'custom' && settings.customUrl) return `custom:${settings.customUrl}`;
  return 'none';
}

export function MainLayout({
  children,
  headerContent,
  sidebar,
  isInMacApp,
  isInMobileApp,
  footer,
  background,
}: MainLayoutProps) {
  const isMobile = useIsMobile();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [bgImageLuminance, setBgImageLuminance] = useState<number | null>(null);

  // Determine if there's an active background and if it's dark enough for light text
  const { hasBackground, isDarkBackground } = useBackgroundDarkness(background, bgImageLuminance);

  // Track when background becomes visible (coordinates text color change)
  const backgroundKey = useMemo(() => getBackgroundChangeKey(background), [background]);
  const [isBackgroundReady, setIsBackgroundReady] = useState(() => {
    if (!background || background.type === 'none') return true;
    if (background.type === 'preset' && background.presetId &&
      (background.presetId.startsWith('solid-') || background.presetId.startsWith('gradient-'))) return true;
    return false;
  });

  // Reset readiness when background changes
  useEffect(() => {
    if (!background || background.type === 'none') {
      setIsBackgroundReady(true);
    } else if (
      background.type === 'preset' &&
      background.presetId &&
      (background.presetId.startsWith('solid-') || background.presetId.startsWith('gradient-'))
    ) {
      // Gradients and solid colors render instantly — no loading needed
      setIsBackgroundReady(true);
    } else {
      // Images need to load before we apply dark text styling
      setIsBackgroundReady(false);
    }
  }, [backgroundKey]);

  const handleBackgroundReady = useCallback(() => {
    setIsBackgroundReady(true);
  }, []);

  // Only apply dark text styling when both dark AND ready
  const shouldUseDarkText = isDarkBackground && isBackgroundReady;

  // Android Tauri app: sync status bar icon color with background darkness.
  // Calls the @JavascriptInterface directly (registered on WebView creation,
  // always available — no timing dependency on Tauri's on_page_load).
  useEffect(() => {
    const w = window as Window & { HomecastAndroid?: { setStatusBarDarkIcons: (dark: boolean) => void } };
    w.HomecastAndroid?.setStatusBarDarkIcons(!shouldUseDarkText);
  }, [shouldUseDarkText]);

  const sidebarPaddingTop = isInMacApp
    ? `${HEADER_HEIGHT + MAC_TRAFFIC_LIGHTS}px`
    : isInMobileApp
    ? `calc(${HEADER_HEIGHT}px + var(--safe-area-top, 0px))`
    : `${HEADER_HEIGHT}px`;

  const contentPaddingTop = isInMacApp
    ? `${HEADER_HEIGHT + MAC_TRAFFIC_LIGHTS}px`
    : isInMobileApp
    ? `calc(${HEADER_HEIGHT}px + var(--safe-area-top, 0px))`
    : `${HEADER_HEIGHT}px`;

  const contentPaddingBottom = isInMobileApp
    ? 'calc(16px + var(--safe-area-bottom, 0px))'
    : '64px';

  return (
    <BackgroundContext.Provider value={{ hasBackground, isDarkBackground: shouldUseDarkText }}>
    <div className={cn("fixed inset-0", hasBackground && isDarkBackground ? "bg-black" : "bg-background")}>
      {/* Background image layer */}
      <BackgroundImage settings={background} onReady={handleBackgroundReady} onLuminanceChange={setBgImageLuminance} />

      <AppHeader
        isInMacApp={isInMacApp}
        isInMobileApp={isInMobileApp}
        hasBackground={hasBackground}
        isDarkBackground={shouldUseDarkText}
      >
        <div className="flex items-center gap-3">
          {/* Mobile menu button - shown when sidebar content exists */}
          {sidebar && isMobile && (
            <Sheet open={sidebarOpen} onOpenChange={setSidebarOpen}>
              <SheetTrigger asChild>
                <Button variant="ghost" size="icon" className={cn("md:hidden focus-visible:ring-0 focus-visible:ring-offset-0 !bg-transparent hover:!bg-black/10 active:!bg-black/20 transition-colors duration-300", shouldUseDarkText && "!bg-black/40 backdrop-blur-xl text-white hover:!bg-black/50 active:!bg-black/60")}>
                  <Menu className="h-5 w-5" />
                </Button>
              </SheetTrigger>
              <SheetContent side="left" className={cn("w-[266px] p-0 overflow-x-hidden border-none safe-area-top safe-area-bottom safe-area-left", shouldUseDarkText ? "bg-black/40 backdrop-blur-xl" : "bg-background")} aria-describedby={undefined}>
                <SheetTitle className="sr-only">Navigation Menu</SheetTitle>
                <div className="h-full flex flex-col overflow-hidden">
                  {/* Close sheet when a nav button is clicked */}
                  <div className={cn("p-4 mt-3 overflow-y-auto flex-1", shouldUseDarkText && "text-white")} onClick={(e) => {
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
                shouldUseDarkText
                  ? "rounded-[20px] p-3 bg-black/50 backdrop-blur-xl text-white shadow-[0_0_20px_rgba(0,0,0,0.3)]"
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
