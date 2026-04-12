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

  return (
    <header
      className={cn(
        "fixed top-0 left-0 right-0 z-[10001]",
        "overscroll-none pointer-events-none",
        isInMobileApp && "safe-area-top",
        isInMacApp && "window-drag"
      )}
      style={isInMacApp ? { paddingTop: '33px' } : undefined}
    >
      <div className={cn("relative mx-auto w-full px-4 h-[80px] flex items-center justify-between", !isInMacApp && !fullWidth && "max-w-7xl")}>
        {/* Left content with bubble background on mobile */}
        <div className="relative flex items-center h-[56px] px-3 pointer-events-auto">
          <div className={cn(
            "absolute inset-0 backdrop-blur-xl rounded-[20px] -z-10 transition-colors duration-300 md:hidden",
            isDarkBackground ? "bg-black/40" : "bg-white/70"
          )} />
          {children}
        </div>

        {/* User login state bubble */}
        {!isInMacApp && (
          <div className="relative flex items-center gap-2 pl-5 pr-[17px] h-[56px] pointer-events-auto">
            <div className={cn(
              "absolute inset-0 rounded-[20px] -z-10 transition-colors duration-300",
              isDarkBackground ? "" : "backdrop-blur-xl bg-white/70"
            )} />
            {leftBadge}
            {!isAuthenticated && !isLoading && (
              <span className={cn(
                "flex items-center gap-1.5 px-2 py-1 rounded-full text-[11px] font-medium transition-colors duration-300 no-drag",
                isDarkBackground
                  ? "bg-black/40 backdrop-blur-xl text-white/90"
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
        <div className="absolute top-[25px] right-[23px] flex items-center gap-2 pl-5 pr-[17px] h-[56px] pointer-events-auto">
          <div className={cn(
            "absolute inset-0 rounded-[20px] -z-10 transition-colors duration-300",
            isDarkBackground ? "" : "backdrop-blur-xl bg-white/70"
          )} />
          {leftBadge}
          {!isAuthenticated && !isLoading && (
            <span className={cn(
              "flex items-center gap-1.5 px-2 py-1 rounded-full text-[11px] font-medium transition-colors duration-300 no-drag",
              isDarkBackground
                ? "bg-black/40 backdrop-blur-xl text-white/70"
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
