import React from 'react';
import { cn } from '@/lib/utils';
import { useAuth } from '@/contexts/AuthContext';
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
}

export function AppHeader({ children, isInMacApp, isInMobileApp, rightMenu, leftBadge, hasBackground, isDarkBackground, fullWidth }: AppHeaderProps) {
  const { isAuthenticated, isLoading } = useAuth();

  // Android: window.HomecastAndroid (JS bridge) is registered on WebView
  // creation and is therefore available at the first React render — whereas
  // window.isHomecastAndroidApp is injected by Tauri on PageLoadEvent::Started,
  // which lands AFTER React mounts. Falling back to the bridge guarantees the
  // header reserves status-bar inset on first paint, not after a rerender.
  const inMobileApp = isInMobileApp || (typeof window !== 'undefined' && !!(window as Window & { HomecastAndroid?: unknown }).HomecastAndroid);

  return (
    <header
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
      <div className={cn("relative mx-auto w-full px-4 flex items-center justify-between",
        isInMacApp ? "h-[max(3.5rem,56px)]" : "h-[80px]",
        !isInMacApp && !fullWidth && "max-w-7xl")}>
        {/* Left content with bubble background on mobile */}
        <div className="relative flex items-center h-[max(3.5rem,56px)] px-[max(0.5rem,8px)] pointer-events-auto">
          {/* Same rule as the right-hand cluster: over a dark background the
              buttons carry their own fill, so a bubble as well made the burger
              a 56px slab beside two 40px circles. Over a light one the bubble
              is what makes them legible. */}
          <div className={cn(
            "absolute inset-0 rounded-2xl -z-10 transition-colors duration-300 md:hidden",
            isDarkBackground ? "" : "material-regular"
          )} />
          {children}
        </div>

        {/* User login state bubble */}
        {!isInMacApp && (
          <div className="relative flex items-center gap-2 pl-[max(1.25rem,20px)] pr-[17px] h-[max(3.5rem,56px)] pointer-events-auto">
            <div className={cn(
              "absolute inset-0 rounded-2xl -z-10 transition-colors duration-300",
              isDarkBackground ? "" : "material-regular"
            )} />
            {leftBadge}
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
          <div className={cn(
            "absolute inset-0 rounded-2xl -z-10 transition-colors duration-300",
            isDarkBackground ? "" : "material-regular"
          )} />
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
