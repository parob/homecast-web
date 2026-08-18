export const checkIsInMacApp = (): boolean => {
  if (typeof window === 'undefined') return false;
  const w = window as any;
  if (w.isHomecastMacApp) return true;
  if (w.navigator?.standalone && /Mac/.test(navigator.userAgent)) return true;
  if (w.webkit?.messageHandlers?.homecast && !w.isHomecastIOSApp) return true;
  return false;
};

export const isNativePurchaseAvailable = (): boolean => {
  if (typeof window === 'undefined') return false;
  return !!(window as any).isHomecastNativePurchaseAvailable;
};

export const MAC_APP_TITLEBAR_INSET_PX = 33;

/**
 * Are we inside one of Apple's native shells — the iOS app or the Mac Catalyst
 * app?
 *
 * `checkIsInMacApp` above answers a deliberately narrower question and excludes
 * iOS, which is right for relay duty and wrong for anything true of both
 * shells. Reaching for it here is what made the marketing-page deep link easy
 * to get wrong. `window.isHomecastApp` is injected .atDocumentStart by both
 * (HomecastApp.swift), so this is answerable before React's first render.
 *
 * Tauri (Android, Windows, Linux) does NOT set that flag, on purpose: the web
 * app also reads it as "App Store build" for Apple's anti-steering rules, and a
 * Play build must not impersonate one. A rule that should cover Tauri too gets
 * widened here, never by setting the flag over there.
 */
export const isInNativeAppShell = (): boolean =>
  typeof window !== 'undefined' && !!window.isHomecastApp;
