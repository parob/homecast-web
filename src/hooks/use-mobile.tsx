import * as React from "react";

const MOBILE_BREAKPOINT = 768;

export function useIsMobile() {
  const [isMobile, setIsMobile] = React.useState<boolean | undefined>(undefined);

  React.useEffect(() => {
    const mql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`);
    const update = () => {
      // Prefer matchMedia.matches so we always agree with Tailwind's `md:`
      // responsive classes (the source of truth for the sidebar/sheet swap).
      // window.innerWidth and __nativeWidth can briefly disagree on Mac
      // Catalyst during resize, leaving the tutorial in desktop mode while
      // the dashboard has already switched to mobile.
      if (typeof mql.matches === 'boolean') {
        setIsMobile(mql.matches);
        return;
      }
      const nativeWidth = (window as { __nativeWidth?: number }).__nativeWidth;
      const width = nativeWidth && nativeWidth > 0 ? nativeWidth : window.innerWidth;
      setIsMobile(width < MOBILE_BREAKPOINT);
    };

    mql.addEventListener("change", update);
    // Also listen to resize as fallback — matchMedia change events
    // don't fire reliably in iOS WKWebView after orientation changes
    window.addEventListener("resize", update);
    // Listen for native width updates from Mac Catalyst
    window.addEventListener("nativeResize", update);
    update();
    return () => {
      mql.removeEventListener("change", update);
      window.removeEventListener("resize", update);
      window.removeEventListener("nativeResize", update);
    };
  }, []);

  return !!isMobile;
}
