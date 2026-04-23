import { useEffect } from 'react';
import { checkIsInMacApp, MAC_APP_TITLEBAR_INSET_PX } from '@/lib/platform';

export function MacAppInsetVar() {
  useEffect(() => {
    const apply = () => {
      const px = checkIsInMacApp() ? `${MAC_APP_TITLEBAR_INSET_PX}px` : '0px';
      document.documentElement.style.setProperty('--mac-app-inset', px);
    };
    apply();
    const t = setTimeout(apply, 100);
    return () => clearTimeout(t);
  }, []);
  return null;
}
