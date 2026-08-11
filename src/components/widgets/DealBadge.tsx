import React, { useState, lazy, Suspense } from 'react';
import { Percent, ExternalLink, ChevronRight } from 'lucide-react';
import { useMutation, useLazyQuery } from '@apollo/client/react';
import { TRACK_DEAL_CLICK } from '@/lib/graphql/mutations';
import { GET_DEAL_PRICE_HISTORY } from '@/lib/graphql/queries';
import { DEAL_TIER_STYLES } from '@/lib/deals';
import { getCurrencySymbol } from '@/lib/marketplace';
import { openExternalUrl } from '@/lib/open-url';
import type { DealInfo, PricePoint } from '@/lib/graphql/types';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';

// recharts (~400 KB) is loaded only when a deal popover with price history is
// shown — keeps it off the main dashboard bundle.
const DealPriceChart = lazy(() => import('./DealPriceChart'));

interface DealBadgeProps {
  deal: DealInfo;
  onSeeFullHistory?: () => void;
}

export function DealBadge({ deal, onSeeFullHistory }: DealBadgeProps) {
  const [open, setOpen] = useState(false);
  const [trackClick] = useMutation(TRACK_DEAL_CLICK);
  const [fetchHistory, { data: historyData }] = useLazyQuery<{ dealPriceHistory: PricePoint[] }>(GET_DEAL_PRICE_HISTORY);
  const style = DEAL_TIER_STYLES[deal.dealTier] || DEAL_TIER_STYLES.good;

  const handleOpenChange = (isOpen: boolean) => {
    setOpen(isOpen);
    if (isOpen && !historyData) {
      fetchHistory({ variables: { dealId: deal.id } });
    }
  };

  const handleAmazonClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    trackClick({ variables: { dealId: deal.id } }).catch(() => {});
    // window.open is silently ignored inside the app's WKWebView
    openExternalUrl(deal.dealUrl);
  };

  const listingLabel = deal.listingType === 'multi_pack'
    ? `${deal.quantity}-Pack`
    : deal.listingType === 'starter_kit'
    ? 'Starter Kit'
    : deal.listingType === 'bundle'
    ? 'Bundle'
    : null;

  // Price history sparkline data (lazy-loaded)
  const priceHistory = historyData?.dealPriceHistory ?? [];
  const chartData = priceHistory.map(p => ({
    date: p.date,
    price: p.price,
  }));

  const atlPrice = deal.allTimeLow ? parseFloat(deal.allTimeLow) : null;
  const sym = getCurrencySymbol(deal.currency);

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <button
          className={`absolute bottom-3.5 right-3.5 z-10 w-5 h-5 rounded-full flex items-center justify-center cursor-pointer transition-transform hover:scale-110 ${style.pulse ? 'animate-pulse' : ''}`}
          style={{ backgroundColor: style.color }}
          onClick={e => { e.stopPropagation(); setOpen(true); }}
          aria-label={`${style.label} available`}
        >
          <Percent className="w-2.5 h-2.5 text-white" strokeWidth={3} />
        </button>
      </PopoverTrigger>
      <PopoverContent
        className="w-64 p-0 overflow-hidden"
        side="top"
        align="end"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex flex-col">
          {/* Product image */}
          {deal.imageUrl && (
            <div className="bg-white p-3 flex items-center justify-center">
              <img
                src={deal.imageUrl}
                alt={deal.productName}
                className="max-h-24 object-contain"
              />
            </div>
          )}

          <div className="p-3 space-y-2">
            {/* Listing type */}
            {listingLabel && (
              <div className="flex items-center gap-1.5">
                <span className="text-[10px] font-medium bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300 px-1.5 py-0.5 rounded">
                  {listingLabel}
                </span>
              </div>
            )}

            {/* Product name */}
            <p className="text-sm font-medium leading-tight line-clamp-2">
              {deal.productName}
            </p>

            {/* Tier label */}
            <div className="flex items-center gap-1">
              <span className="text-xs" style={{ color: style.color }}>
                {style.icon} {style.label}
              </span>
            </div>

            {/* Price history sparkline (recharts, lazy-loaded on open) */}
            {chartData.length > 1 && (
              <Suspense fallback={<div className="h-[60px] w-full" />}>
                <DealPriceChart
                  chartData={chartData}
                  atlPrice={atlPrice}
                />
              </Suspense>
            )}

            {/* Price line */}
            <div className="flex items-baseline gap-2 flex-wrap">
              <span className="text-base font-bold" style={{ color: style.color }}>
                {sym}{deal.dealPrice}
              </span>
              {deal.regularPrice && (
                <span className="text-xs text-muted-foreground line-through">
                  {sym}{deal.regularPrice}
                </span>
              )}
              {deal.discountPercentage != null && deal.discountPercentage > 0 && (
                <span
                  className="text-[10px] font-medium px-1.5 py-0.5 rounded text-white"
                  style={{ backgroundColor: style.color }}
                >
                  {deal.discountPercentage}% off
                </span>
              )}
            </div>

            {/* Unit price for multi-packs */}
            {deal.unitPrice && (
              <p className="text-[11px] text-muted-foreground">
                {sym}{deal.unitPrice}/each
              </p>
            )}

            {/* All-time low — a separate claim from the tier, so it gets its
                own line rather than inflating a small discount into "Amazing" */}
            {deal.isNearAtl && (
              <p className="text-[11px] font-medium text-muted-foreground">
                📉 Lowest price we've tracked
              </p>
            )}

            {/* Into the full price history */}
            {onSeeFullHistory && (
              <button
                className="w-full flex items-center justify-between text-[11px] text-muted-foreground hover:text-foreground transition-colors"
                onClick={(e) => {
                  e.stopPropagation();
                  setOpen(false);
                  onSeeFullHistory();
                }}
              >
                See full price history
                <ChevronRight className="w-3 h-3" />
              </button>
            )}

            {/* Amazon button */}
            <button
              className="w-full flex items-center justify-center gap-1.5 py-2 rounded-md text-sm font-medium text-black transition-colors"
              style={{ backgroundColor: '#FF9900' }}
              onClick={handleAmazonClick}
            >
              View on Amazon
              <ExternalLink className="w-3.5 h-3.5" />
            </button>

            {/* Disclosure */}
            <p className="text-[9px] text-center text-muted-foreground">
              Smart Deal · helps support Homecast
            </p>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
