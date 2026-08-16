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

/**
 * A phone, in either orientation — as opposed to `useIsMobile`, which is a width
 * breakpoint tied to Tailwind's `md:` so the sidebar/sheet swap agrees with it.
 *
 * Turned sideways, an iPhone is about 844px wide. That is wider than the
 * breakpoint, so it stopped counting as mobile: the pinned tab bar vanished and
 * every tile's Pin button went with it, on a device whose whole point is the tab
 * bar. Width alone cannot answer "is this a phone".
 *
 * Narrow, or touch-operated and short. The pointer test is what keeps a merely
 * short Mac window out — the sidebar is its navigation, and it has no use for a
 * tab bar. An iPad is neither: 768x1024 fails the width test in portrait and the
 * height test in landscape.
 */
const PHONE_QUERY = `(max-width: ${MOBILE_BREAKPOINT - 1}px), ((pointer: coarse) and (max-height: ${MOBILE_BREAKPOINT - 1}px))`;

export function useIsPhone() {
  const [isPhone, setIsPhone] = React.useState<boolean | undefined>(undefined);

  React.useEffect(() => {
    const mql = window.matchMedia(PHONE_QUERY);
    const update = () => setIsPhone(mql.matches);

    mql.addEventListener("change", update);
    // matchMedia change events don't fire reliably in iOS WKWebView after an
    // orientation change — which is the exact case this hook exists for.
    window.addEventListener("resize", update);
    window.addEventListener("orientationchange", update);
    window.addEventListener("nativeResize", update);
    update();
    return () => {
      mql.removeEventListener("change", update);
      window.removeEventListener("resize", update);
      window.removeEventListener("orientationchange", update);
      window.removeEventListener("nativeResize", update);
    };
  }, []);

  return !!isPhone;
}
