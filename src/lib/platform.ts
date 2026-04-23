export const checkIsInMacApp = (): boolean => {
  if (typeof window === 'undefined') return false;
  const w = window as any;
  if (w.isHomecastMacApp) return true;
  if (w.navigator?.standalone && /Mac/.test(navigator.userAgent)) return true;
  if (w.webkit?.messageHandlers?.homecast && !w.isHomecastIOSApp) return true;
  return false;
};

export const MAC_APP_TITLEBAR_INSET_PX = 33;
