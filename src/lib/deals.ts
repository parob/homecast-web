/**
 * Client-side deal display logic and tier styling.
 *
 * Deal matching is now done server-side. The client just needs to
 * connect returned deals to the right accessory widgets using
 * deviceManufacturer matching.
 */

import type { DealInfo, DealTier, HomeKitAccessory } from './graphql/types';

export interface DealMatch {
  deal: DealInfo;
  isRelated: boolean;
}

export const DEAL_TIER_STYLES = {
  hot:   { color: '#ef4444', bg: 'bg-red-500/90',    label: 'Amazing Deal', icon: '🔥', pulse: true },
  great: { color: '#f97316', bg: 'bg-orange-500/90', label: 'Great Deal', icon: '⭐', pulse: false },
  good:  { color: '#eab308', bg: 'bg-yellow-500/90', label: 'Deal',       icon: '💰', pulse: false },
} as const;

const TIER_ORDER: Record<DealTier, number> = { good: 0, great: 1, hot: 2 };

/**
 * Extract manufacturer from an accessory's characteristics.
 */
function getAccessoryManufacturer(accessory: HomeKitAccessory): string | null {
  for (const svc of accessory.services) {
    for (const char of svc.characteristics) {
      if (char.characteristicType === 'manufacturer' && char.value) {
        return String(char.value);
      }
    }
  }
  return null;
}

/**
 * Calculate per-unit deal price for comparison.
 */
function getUnitPrice(deal: DealInfo): number {
  try {
    const price = parseFloat(deal.dealPrice);
    const qty = deal.quantity || 1;
    return price / qty;
  } catch {
    return Infinity;
  }
}

/**
 * Find the best deal for an accessory.
 *
 * Since deals are pre-matched by the server (via HomeKitMapping -> Device -> ProductPage -> Deal),
 * we just need to connect deals to accessories by matching the manufacturer.
 */
export function findDealForAccessory(
  accessory: HomeKitAccessory,
  deals: DealInfo[],
): DealMatch | null {
  if (!deals.length) return null;

  const manufacturer = getAccessoryManufacturer(accessory);
  if (!manufacturer) return null;

  const mfrLower = manufacturer.toLowerCase();

  // Find deals whose deviceManufacturer matches this accessory's manufacturer
  const matching = deals.filter(d => {
    const dm = d.deviceManufacturer.toLowerCase();
    return mfrLower.includes(dm) || dm.includes(mfrLower.split(' ')[0]);
  });

  if (!matching.length) return null;

  // Pick best by tier (highest), then lowest unit price
  const best = matching.reduce((a, b) => {
    const tierDiff = (TIER_ORDER[b.dealTier] || 0) - (TIER_ORDER[a.dealTier] || 0);
    if (tierDiff !== 0) return tierDiff > 0 ? b : a;
    return getUnitPrice(a) < getUnitPrice(b) ? a : b;
  });

  return { deal: best, isRelated: false };
}
