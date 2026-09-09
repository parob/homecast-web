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
/**
 * What this device calls itself in a sentence — "This iPhone can't reach
 * Homecast", "this Mac is standing in". iPadOS Safari presents a Macintosh
 * user agent, so touch points settle it there; a Mac is a Mac only when it can
 * be the relay, which is the one thing a desktop browser on a Mac cannot.
 */
export function thisDeviceNoun(): 'iPhone' | 'iPad' | 'Mac' | 'device' {
  if (typeof navigator === 'undefined') return 'device';
  const ua = navigator.userAgent || '';
  if (/iPad/i.test(ua)) return 'iPad';
  if (/Macintosh/i.test(ua) && (navigator.maxTouchPoints ?? 0) > 1) return 'iPad';
  const w = window as Window & { isHomecastIOSApp?: boolean; isHomeKitRelayCapable?: boolean };
  if (/iPhone/i.test(ua) || w.isHomecastIOSApp) return 'iPhone';
  if (w.isHomeKitRelayCapable) return 'Mac';
  return 'device';
}

export const isInNativeAppShell = (): boolean =>
  typeof window !== 'undefined' && !!window.isHomecastApp;
