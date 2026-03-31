export type PricingRegion = 'gb' | 'default';

interface PlanPricing {
  amount: number;
  symbol: string;
  formatted: string;
}

interface RegionPricing {
  standard: PlanPricing;
  cloud: PlanPricing;
}

const PRICING: Record<PricingRegion, RegionPricing> = {
  default: {
    standard: { amount: 8, symbol: '$', formatted: '$8' },
    cloud: { amount: 11, symbol: '$', formatted: '$11' },
  },
  gb: {
    standard: { amount: 6, symbol: '\u00a3', formatted: '\u00a36' },
    cloud: { amount: 9, symbol: '\u00a3', formatted: '\u00a39' },
  },
};

export function detectRegion(): PricingRegion {
  const lang = navigator?.language ?? '';
  if (lang.toLowerCase().endsWith('-gb')) return 'gb';
  return 'default';
}

let _cachedRegion: PricingRegion | null = null;

export function getRegion(): PricingRegion {
  if (_cachedRegion === null) {
    _cachedRegion = detectRegion();
  }
  return _cachedRegion;
}

export function getPricing(region?: PricingRegion): RegionPricing {
  return PRICING[region ?? getRegion()];
}
