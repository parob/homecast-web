import { cn } from '@/lib/utils';
import { AppHeader } from './AppHeader';

// Header height constants (in pixels)
const HEADER_HEIGHT = 80;
const MAC_TRAFFIC_LIGHTS = 28;
// What AppHeader actually occupies in the Mac app: 33px of title-bar padding
// above a row that is 3.5rem tall but never shorter than 56px. Kept as a
// calc so it tracks the text-size setting the way the header itself does.
const MAC_HEADER_HEIGHT = 'calc(33px + max(3.5rem, 56px))';

interface PageLayoutProps {
  children: React.ReactNode;
  headerContent: React.ReactNode;
  isInMacApp?: boolean;
  isInMobileApp?: boolean;
  className?: string;
  footer?: React.ReactNode;
  sidebar?: React.ReactNode;
}

export function PageLayout({
  children,
  headerContent,
  isInMacApp,
  isInMobileApp,
  className,
  footer,
  sidebar,
}: PageLayoutProps) {
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

  return (
    <div className="fixed inset-0 bg-background flex flex-col">
      <AppHeader
        isInMacApp={isInMacApp}
        isInMobileApp={isInMobileApp}
      >
        {headerContent}
      </AppHeader>

      <div className="flex-1 flex justify-center overflow-hidden">
        <div className={cn("flex w-full", !isInMacApp && "max-w-7xl")}>
          {/* Sidebar - separate scroll */}
          {sidebar && (
            <aside
              className="hidden md:block w-48 overflow-y-auto scrollbar-hidden shrink-0"
              style={{ paddingTop: sidebarPaddingTop }}
            >
              <div className="p-4">
                {sidebar}
              </div>
            </aside>
          )}

          {/* Main content - separate scroll */}
          <main className="flex-1 overflow-hidden relative">
            <div
              className={cn("absolute inset-0 overflow-y-auto scrollbar-hidden", className)}
              style={{ paddingTop: contentPaddingTop }}
            >
              <div className="px-4 pb-6">
                {children}
              </div>
              {footer}
            </div>
          </main>
        </div>
      </div>
    </div>
  );
}

// Export constants for other components that need them
export { HEADER_HEIGHT, MAC_TRAFFIC_LIGHTS };
