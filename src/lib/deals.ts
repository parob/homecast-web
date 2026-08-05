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
}

export const DEAL_TIER_STYLES = {
  hot:   { color: '#ef4444', bg: 'bg-red-500/90',    label: 'Amazing Deal', icon: '🔥', pulse: true },
  great: { color: '#f97316', bg: 'bg-orange-500/90', label: 'Great Deal', icon: '⭐', pulse: false },
  good:  { color: '#eab308', bg: 'bg-yellow-500/90', label: 'Deal',       icon: '💰', pulse: false },
} as const;

const TIER_ORDER: Record<DealTier, number> = { good: 0, great: 1, hot: 2 };

/**
 * Extract the HomeKit identity (manufacturer + model) of an accessory —
 * the same pair the server maps to a device.
 */
export function getAccessoryIdentity(
  accessory: HomeKitAccessory,
): { manufacturer: string; model: string } | null {
  let manufacturer: string | null = null;
  let model: string | null = null;
  for (const svc of accessory.services) {
    for (const char of svc.characteristics) {
      if (char.characteristicType === 'manufacturer' && char.value) {
        manufacturer = String(char.value);
      } else if (char.characteristicType === 'model' && char.value) {
        model = String(char.value);
      }
    }
  }
  return manufacturer && model ? { manufacturer, model } : null;
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
 * Deals are matched server-side on the exact HomeKit (manufacturer, model)
 * pair, and carry those pairs in `mappings`. Matching here on the same exact
 * pair keeps the badge on the product that is actually on offer — the old
 * manufacturer-substring test badged every accessory of the brand, so one
 * Hue deal lit up all thirty Hue bulbs in a home.
 */
export function findDealForAccessory(
  accessory: HomeKitAccessory,
  deals: DealInfo[],
): DealMatch | null {
  if (!deals.length) return null;

  const identity = getAccessoryIdentity(accessory);
  if (!identity) return null;

  const mfr = identity.manufacturer.toLowerCase();
  const model = identity.model.toLowerCase();

  const matching = deals.filter(d =>
    (d.mappings ?? []).some(
      m => m.manufacturer.toLowerCase() === mfr && m.model.toLowerCase() === model,
    ),
  );

  if (!matching.length) return null;

  // Pick best by tier (highest), then lowest unit price
  const best = matching.reduce((a, b) => {
    const tierDiff = (TIER_ORDER[b.dealTier] || 0) - (TIER_ORDER[a.dealTier] || 0);
    if (tierDiff !== 0) return tierDiff > 0 ? b : a;
    return getUnitPrice(a) < getUnitPrice(b) ? a : b;
  });

  return { deal: best };
}
