import React, { createContext, useContext, useMemo } from 'react';
import { useQuery } from '@apollo/client/react';
import { GET_ACTIVE_DEALS } from '@/lib/graphql/queries';
import { getMarketplace } from '@/lib/marketplace';
import type { DealInfo, GetActiveDealsResponse, HomeKitAccessory } from '@/lib/graphql/types';

interface DealsContextValue {
  deals: DealInfo[];
}

const DealsContext = createContext<DealsContextValue>({ deals: [] });

interface DealsProviderProps {
  enabled: boolean;
  accessories: HomeKitAccessory[];
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

export function DealsProvider({ enabled, accessories, children }: DealsProviderProps) {
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

  const deals = enabled ? (data?.activeDeals ?? []) : [];

  return (
    <DealsContext.Provider value={{ deals }}>
      {children}
    </DealsContext.Provider>
  );
}

export function useDeals(): DealsContextValue {
  return useContext(DealsContext);
}
