import { useEffect, useState } from 'react';
import { isNativePurchaseAvailable } from './platform';
import { getNativeProducts } from './purchase';

interface PlanPricing {
  amount: number;
  symbol: string;
  formatted: string;
}

export interface Pricing {
  standard: PlanPricing;
  cloud: PlanPricing;
}

const WEB_PRICING: Pricing = {
  standard: { amount: 8, symbol: '$', formatted: '$8' },
  cloud: { amount: 11, symbol: '$', formatted: '$11' },
};

/**
 * Synchronous pricing for the web context. Throws (returns null) if called
 * inside an App Store build — those need to fetch from StoreKit. Use the
 * `usePricing()` hook everywhere instead.
 */
export function getPricing(): Pricing {
  return WEB_PRICING;
}

/**
 * Returns pricing to display in the current rendering context.
 *
 * - On the web (homecast.cloud / browser): returns USD `WEB_PRICING` immediately.
 * - Inside an App Store WKWebView: returns null on first render, then the
 *   StoreKit-localized prices (e.g. "$10.99", "£9.99") once `getProducts`
 *   returns. Anti-steering: never shows web prices inside the App Store build.
 */
export function usePricing(): Pricing | null {
  const [native, setNative] = useState<Pricing | null>(null);

  useEffect(() => {
    if (!isNativePurchaseAvailable()) return;
    let cancelled = false;
    (async () => {
      const products = await getNativeProducts();
      if (cancelled || !products) return;
      setNative({
        standard: {
          amount: products.standard?.price ?? 0,
          symbol: '',
          formatted: products.standard?.displayPrice ?? '',
        },
        cloud: {
          amount: products.cloud?.price ?? 0,
          symbol: '',
          formatted: products.cloud?.displayPrice ?? '',
        },
      });
    })();
    return () => { cancelled = true; };
  }, []);

  if (isNativePurchaseAvailable()) return native;
  return WEB_PRICING;
}
