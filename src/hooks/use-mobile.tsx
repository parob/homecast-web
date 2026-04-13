import * as React from "react";

const MOBILE_BREAKPOINT = 768;

export function useIsMobile() {
  const [isMobile, setIsMobile] = React.useState<boolean | undefined>(undefined);

  React.useEffect(() => {
    const update = () => {
      // Mac Catalyst scales the CSS viewport, so window.innerWidth doesn't match
      // the actual window frame. The native app posts the real UIKit width as
      // window.__nativeWidth via a bounds observer.
      const nativeWidth = (window as any).__nativeWidth as number | undefined;
      const width = nativeWidth && nativeWidth > 0 ? nativeWidth : window.innerWidth;
      setIsMobile(width < MOBILE_BREAKPOINT);
    };

    const mql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`);
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
