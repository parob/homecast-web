export type Marketplace = 'US' | 'GB' | 'DE' | 'FR' | 'IT' | 'ES';

const LANGUAGE_TO_MARKETPLACE: Record<string, Marketplace> = {
  'en-gb': 'GB',
  'de': 'DE',
  'de-de': 'DE',
  'de-at': 'DE',
  'de-ch': 'DE',
  'fr': 'FR',
  'fr-fr': 'FR',
  'fr-be': 'FR',
  'fr-ch': 'FR',
  'it': 'IT',
  'it-it': 'IT',
  'it-ch': 'IT',
  'es': 'ES',
  'es-es': 'ES',
};

export function detectMarketplace(): Marketplace {
  const lang = (navigator?.language ?? '').toLowerCase();
  return LANGUAGE_TO_MARKETPLACE[lang]
    ?? LANGUAGE_TO_MARKETPLACE[lang.split('-')[0]]
    ?? 'US';
}

let _cached: Marketplace | null = null;

export function getMarketplace(): Marketplace {
  if (!_cached) _cached = detectMarketplace();
  return _cached;
}

export const CURRENCY_SYMBOLS: Record<string, string> = {
  USD: '$',
  GBP: '\u00a3',
  EUR: '\u20ac',
};

export function getCurrencySymbol(currency: string): string {
  return CURRENCY_SYMBOLS[currency] || currency;
}
