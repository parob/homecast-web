import React, { createContext, useCallback, useContext, useMemo } from 'react';
import { useQuery } from '@apollo/client/react';
import { GET_ACTIVE_DEALS, GET_TRACKED_ACCESSORIES } from '@/lib/graphql/queries';
import { getMarketplace } from '@/lib/marketplace';
import { getAccessoryIdentity } from '@/lib/deals';
import type {
  DealInfo,
  GetActiveDealsResponse,
  HomeKitAccessory,
  MappedAccessory,
} from '@/lib/graphql/types';
import type { PriceHistoryTarget } from '@/components/widgets/PriceHistoryDialog';

interface DealsContextValue {
  deals: DealInfo[];
  /** Whether we track a product for this accessory (gates the menu entry). */
  isTracked: (accessory: HomeKitAccessory) => boolean;
  /** Open the Price & Deals screen. No-op outside the dashboard. */
  openPriceHistory: (accessory: HomeKitAccessory) => void;
}

const DealsContext = createContext<DealsContextValue>({
  deals: [],
  isTracked: () => false,
  openPriceHistory: () => {},
});

interface DealsProviderProps {
  enabled: boolean;
  accessories: HomeKitAccessory[];
  onOpenPriceHistory?: (target: PriceHistoryTarget) => void;
  children: React.ReactNode;
}

/**
 * Extract unique {manufacturer, model} pairs from accessories for server-side deal matching.
 */
function extractAccessoryInputs(accessories: HomeKitAccessory[]): Array<{ manufacturer: string; model: string }> {
  const seen = new Set<string>();
  const result: Array<{ manufacturer: string; model: string }> = [];

  for (const acc of accessories) {
    let manufacturer: string | null = null;
    let model: string | null = null;
    for (const svc of acc.services) {
      for (const char of svc.characteristics) {
        if (char.characteristicType === 'manufacturer' && char.value) {
          manufacturer = String(char.value);
        } else if (char.characteristicType === 'model' && char.value) {
          model = String(char.value);
        }
      }
    }
    if (manufacturer && model) {
      const key = `${manufacturer}|${model}`;
      if (!seen.has(key)) {
        seen.add(key);
        result.push({ manufacturer, model });
      }
    }
  }

  return result;
}

export function DealsProvider({
  enabled,
  accessories,
  onOpenPriceHistory,
  children,
}: DealsProviderProps) {
  const marketplace = getMarketplace();

  const accessoryInputs = useMemo(
    () => extractAccessoryInputs(accessories),
    [accessories],
  );

  const { data } = useQuery<GetActiveDealsResponse>(GET_ACTIVE_DEALS, {
    skip: !enabled || accessoryInputs.length === 0,
    variables: { marketplace, accessories: accessoryInputs },
    pollInterval: 300_000, // 5 min refresh
  });

  // Which accessories have a listing behind them. Deal badges are rare by
  // design, so this is what keeps price info reachable for the rest —
  // fetched once for the whole set rather than per widget.
  const { data: trackedData } = useQuery<{ trackedAccessories: MappedAccessory[] }>(
    GET_TRACKED_ACCESSORIES,
    {
      skip: !enabled || accessoryInputs.length === 0,
      variables: { marketplace, accessories: accessoryInputs },
    },
  );

  const deals = enabled ? (data?.activeDeals ?? []) : [];

  const trackedKeys = useMemo(() => {
    const set = new Set<string>();
    for (const m of trackedData?.trackedAccessories ?? []) {
      set.add(`${m.manufacturer.toLowerCase()}|${m.model.toLowerCase()}`);
    }
    return set;
  }, [trackedData]);

  const isTracked = useCallback((accessory: HomeKitAccessory) => {
    const identity = getAccessoryIdentity(accessory);
    if (!identity) return false;
    return trackedKeys.has(
      `${identity.manufacturer.toLowerCase()}|${identity.model.toLowerCase()}`,
    );
  }, [trackedKeys]);

  const openPriceHistory = useCallback((accessory: HomeKitAccessory) => {
    const identity = getAccessoryIdentity(accessory);
    if (!identity || !onOpenPriceHistory) return;
    onOpenPriceHistory({
      manufacturer: identity.manufacturer,
      model: identity.model,
      accessoryName: accessory.name,
      marketplace,
    });
  }, [onOpenPriceHistory, marketplace]);

  const value = useMemo(
    () => ({ deals, isTracked, openPriceHistory }),
    [deals, isTracked, openPriceHistory],
  );

  return (
    <DealsContext.Provider value={value}>
      {children}
    </DealsContext.Provider>
  );
}

export function useDeals(): DealsContextValue {
  return useContext(DealsContext);
}
