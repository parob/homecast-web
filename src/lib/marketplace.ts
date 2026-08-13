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
  CAD: 'C$',
  AUD: 'A$',
  JPY: '\u00a5',
};

export function getCurrencySymbol(currency: string): string {
  return CURRENCY_SYMBOLS[currency] || currency;
}

/**
 * The locale a price in this currency should be rendered in.
 *
 * Keyed on currency rather than the viewer's locale: the number describes a
 * listing on a specific Amazon marketplace, so it should read the way it does
 * on that site. EUR is shared by four marketplaces whose conventions differ
 * slightly; any of them renders `1.234,56 \u20ac` rather than `\u20ac1234.56`, which is
 * the difference that matters.
 */
const CURRENCY_LOCALES: Record<string, string> = {
  USD: 'en-US',
  GBP: 'en-GB',
  EUR: 'de-DE',
  CAD: 'en-CA',
  AUD: 'en-AU',
  JPY: 'ja-JP',
};

/**
 * Render a price the way its own marketplace would.
 *
 * Prices arrive as canonical dot-decimal strings ("1234.56", or "7640" for
 * zero-decimal currencies). Concatenating a prefixed symbol onto that \u2014 which
 * is what every price label used to do \u2014 gets the symbol position, the decimal
 * separator and the grouping all wrong for the four EUR marketplaces, and
 * prints a bare "\u00a31234" for a whole-number price.
 */
export interface FormatPriceOptions {
  /**
   * Render so currencies are told apart at a glance, at the cost of the local
   * convention: USD/CAD/AUD all print a bare "$" in their own locales, which
   * is right on a single marketplace's listing but ambiguous in a table that
   * mixes marketplaces (an admin deals list, say). Forces a single locale so
   * CAD reads "CA$" and AUD "A$".
   */
  disambiguate?: boolean;
}

export function formatPrice(
  amount: string | number | null | undefined,
  currency: string,
  options: FormatPriceOptions = {},
): string {
  if (amount == null || amount === '') return '';
  const value = typeof amount === 'number' ? amount : parseFloat(amount);
  if (!Number.isFinite(value)) return String(amount);
  const locale = options.disambiguate ? 'en-US' : (CURRENCY_LOCALES[currency] || undefined);
  try {
    return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(value);
  } catch {
    // Unknown currency code \u2014 Intl throws rather than degrading.
    return `${getCurrencySymbol(currency)}${value}`;
  }
}
