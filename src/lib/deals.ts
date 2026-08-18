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
 * Mirrors `deal_detector.MIN_ATL_HISTORY_POINTS` on the server.
 *
 * `accessoryPriceInfo` returns `pricePointCount` but no meaningfulness flag
 * (unlike `activeDeals`, which carries `atlIsMeaningful`), so the price screen
 * has to apply the same threshold itself. Keep the two in step.
 */
export const MIN_ATL_HISTORY_POINTS = 8;

export function atlIsMeaningful(pricePointCount: number | null | undefined): boolean {
  return (pricePointCount ?? 0) >= MIN_ATL_HISTORY_POINTS;
}

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
 * The member of a service group whose product a price screen should show.
 *
 * A group is usually several of the same bulb, so "the price of this group"
 * means that bulb's price. Count the members by identity and take the most
 * common — the dominant product — with ties going to the first member, which is
 * the order the group already lists them in.
 *
 * Only tracked members count. Three bulbs we know nothing about plus one we
 * track should still offer prices for the one we know, rather than letting the
 * unknown majority decide there is nothing to show.
 */
export function pickDominantTrackedAccessory(
  accessories: HomeKitAccessory[],
  isTracked: (accessory: HomeKitAccessory) => boolean,
): HomeKitAccessory | null {
  const byIdentity = new Map<string, { accessory: HomeKitAccessory; count: number }>();

  for (const accessory of accessories) {
    if (!isTracked(accessory)) continue;
    const identity = getAccessoryIdentity(accessory);
    if (!identity) continue;
    const key = `${identity.manufacturer.toLowerCase()}|${identity.model.toLowerCase()}`;
    const seen = byIdentity.get(key);
    if (seen) seen.count += 1;
    else byIdentity.set(key, { accessory, count: 1 });
  }

  let best: { accessory: HomeKitAccessory; count: number } | null = null;
  // A Map iterates in insertion order and this is a strict >, so a tie keeps
  // whichever product appeared first.
  for (const entry of byIdentity.values()) {
    if (!best || entry.count > best.count) best = entry;
  }
  return best?.accessory ?? null;
}

/**
 * Calculate per-unit deal price for comparison.
 *
 * Returns Infinity for a price we can't read, so an unparseable deal loses
 * the tie-break instead of winning it. This used to be a try/catch around
 * parseFloat — but parseFloat returns NaN rather than throwing, so the catch
 * was dead code and `10 < NaN` is false, which meant a deal with a malformed
 * price beat every well-formed one and took the badge.
 */
function getUnitPrice(deal: DealInfo): number {
  const price = parseFloat(deal.dealPrice);
  const qty = deal.quantity || 1;
  if (!Number.isFinite(price) || price <= 0) return Infinity;
  return price / qty;
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

/**
 * The member a service group's price surfaces — badge, button, menu — should
 * all speak for.
 *
 * Dominance decides, as it does for the price screen: a group is mostly one
 * product, and that product's price is the group's. But a member that is
 * actually on offer wins the job first, because a deal inside a group is
 * otherwise invisible — the member tiles live inside the group, so if the
 * group won't badge a deal, nothing will.
 *
 * Everything reads from this one function so the badge and the button can
 * never point at two different products.
 */
export function pickGroupPriceAccessory(
  accessories: HomeKitAccessory[],
  isTracked: (accessory: HomeKitAccessory) => boolean,
  deals: DealInfo[],
): HomeKitAccessory | null {
  const onOffer = deals.length
    ? accessories.filter(a => findDealForAccessory(a, deals))
    : [];
  // A live deal is stronger evidence that we know this product than the tracked
  // list is: they are two separate queries on a five-minute poll and can
  // disagree for that long. An on-offer member does not have to be in it.
  const dealIsProofEnough = () => true;
  return (
    pickDominantTrackedAccessory(onOffer, dealIsProofEnough) ??
    pickDominantTrackedAccessory(accessories, isTracked)
  );
}
