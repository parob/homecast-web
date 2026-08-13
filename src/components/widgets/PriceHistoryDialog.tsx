import { lazy, Suspense, useState } from 'react';
import { ExternalLink, Loader2 } from 'lucide-react';
import { useQuery, useMutation } from '@apollo/client/react';
import { GET_ACCESSORY_PRICE_INFO } from '@/lib/graphql/queries';
import { TRACK_DEAL_CLICK } from '@/lib/graphql/mutations';
import { atlIsMeaningful, DEAL_TIER_STYLES } from '@/lib/deals';
import { formatPrice, getCurrencySymbol } from '@/lib/marketplace';
import { openExternalUrl } from '@/lib/open-url';
import type { AccessoryPriceInfo } from '@/lib/graphql/types';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

const DealPriceChart = lazy(() => import('./DealPriceChart'));

const RANGES = [
  { label: '30d', days: 30 },
  { label: '90d', days: 90 },
  { label: '1y', days: 365 },
] as const;

export interface PriceHistoryTarget {
  manufacturer: string;
  model: string;
  accessoryName: string;
  marketplace?: string;
}

interface PriceHistoryDialogProps {
  target: PriceHistoryTarget | null;
  onClose: () => void;
}

/**
 * Price & Deals screen for a single accessory.
 *
 * The always-available counterpart to the deal badge: badges are deliberately
 * rare, so this is how a user reaches price information for anything else we
 * track — including products with no current deal.
 */
export function PriceHistoryDialog({ target, onClose }: PriceHistoryDialogProps) {
  const [days, setDays] = useState<number>(90);
  const [trackClick] = useMutation(TRACK_DEAL_CLICK);

  const { data, loading } = useQuery<{ accessoryPriceInfo: AccessoryPriceInfo | null }>(
    GET_ACCESSORY_PRICE_INFO,
    {
      variables: {
        manufacturer: target?.manufacturer,
        model: target?.model,
        marketplace: target?.marketplace,
        days,
      },
      skip: !target,
      fetchPolicy: 'cache-and-network',
    },
  );

  const info = data?.accessoryPriceInfo ?? null;
  // No `|| 'USD'` fallback on the currency: defaulting made a server response
  // with an empty currency print dollars for a .co.uk listing rather than
  // failing visibly. `sym` is only for the chart axis; every price label goes
  // through formatPrice, which renders in the listing's own convention.
  const currency = info?.currency ?? '';
  const sym = currency ? getCurrencySymbol(currency) : '';
  const deal = info?.deal ?? null;
  const style = deal ? (DEAL_TIER_STYLES[deal.dealTier] || DEAL_TIER_STYLES.good) : null;

  const chartData = (info?.priceHistory ?? []).map(p => ({ date: p.date, price: p.price }));
  // Same gate as DealBadge: the server declines to call a thin history an
  // all-time low, so the chart must not draw one either.
  const parsedAtl = info?.allTimeLow ? parseFloat(info.allTimeLow) : NaN;
  const atlPrice =
    info && atlIsMeaningful(info.pricePointCount) && Number.isFinite(parsedAtl)
      ? parsedAtl
      : null;

  // How the current price sits against its own recent average — the useful
  // read when there is no deal to report.
  let vsAverage: string | null = null;
  if (!deal && info?.currentPrice && info?.avg30dPrice) {
    const cur = parseFloat(info.currentPrice);
    const avg = parseFloat(info.avg30dPrice);
    if (cur > 0 && avg > 0) {
      const diff = Math.round(((cur - avg) / avg) * 100);
      if (diff > 0) vsAverage = `${diff}% above its 30-day average`;
      else if (diff < 0) vsAverage = `${Math.abs(diff)}% below its 30-day average`;
      else vsAverage = 'In line with its 30-day average';
    }
  }

  const handleBuy = () => {
    if (!info) return;
    if (deal) trackClick({ variables: { dealId: deal.id } }).catch(() => {});
    openExternalUrl(info.dealUrl);
  };

  return (
    <Dialog open={!!target} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="text-base leading-tight pr-6">
            {info?.productName || target?.accessoryName || 'Price & Deals'}
          </DialogTitle>
        </DialogHeader>

        {loading && !info ? (
          <div className="py-10 flex items-center justify-center text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        ) : !info ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            We don't track pricing for this accessory yet.
          </p>
        ) : (
          <div className="space-y-4">
            {/* Price summary */}
            <div className="flex gap-3">
              {info.imageUrl && (
                <div className="bg-white rounded-md p-2 shrink-0 w-20 h-20 flex items-center justify-center">
                  <img
                    src={info.imageUrl}
                    alt={info.productName}
                    className="max-h-16 max-w-16 object-contain"
                  />
                </div>
              )}
              <div className="min-w-0 space-y-0.5">
                <div className="flex items-baseline gap-2 flex-wrap">
                  <span
                    className="text-2xl font-semibold"
                    style={style ? { color: style.color } : undefined}
                  >
                    {info.currentPrice ? formatPrice(info.currentPrice, currency) : '—'}
                  </span>
                  {deal?.regularPrice && (
                    // A struck-through number reads as a manufacturer's list
                    // price. Ours usually isn't one — it's our own rolling
                    // 30-day mean — so only strike it through when Amazon
                    // actually advertised a was-price, and say so otherwise.
                    deal.baselineSource === 'list_price' ? (
                      <span className="text-xs text-muted-foreground line-through">
                        {formatPrice(deal.regularPrice, currency)}
                      </span>
                    ) : (
                      <span className="text-xs text-muted-foreground">
                        usually {formatPrice(deal.regularPrice, currency)}
                      </span>
                    )
                  )}
                  {deal?.discountPercentage != null && deal.discountPercentage > 0 && (
                    <span className="text-xs text-muted-foreground">
                      {deal.discountPercentage}% off
                    </span>
                  )}
                </div>
                {style ? (
                  <p className="text-xs" style={{ color: style.color }}>
                    {style.icon} {style.label}
                  </p>
                ) : (
                  <p className="text-xs text-muted-foreground">No current deal</p>
                )}
                {vsAverage && (
                  <p className="text-xs text-muted-foreground">{vsAverage}</p>
                )}
                {info.isNearAtl && (
                  <p className="text-xs text-muted-foreground">
                    📉 Lowest price we've tracked
                  </p>
                )}
              </div>
            </div>

            {/* Chart */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium">Price history</span>
                <div className="flex gap-1">
                  {RANGES.map(r => (
                    <button
                      key={r.days}
                      onClick={() => setDays(r.days)}
                      className={`text-[11px] px-2 py-0.5 rounded transition-colors ${
                        days === r.days
                          ? 'bg-primary text-primary-foreground'
                          : 'text-muted-foreground hover:bg-muted'
                      }`}
                    >
                      {r.label}
                    </button>
                  ))}
                </div>
              </div>

              {chartData.length > 1 ? (
                <Suspense fallback={<div className="h-[200px] w-full" />}>
                  <DealPriceChart
                    chartData={chartData}
                    atlPrice={atlPrice}
                    detailed
                    currencySymbol={sym}
                  />
                </Suspense>
              ) : (
                <div className="h-[100px] rounded-md border border-dashed flex items-center justify-center px-4">
                  <p className="text-xs text-muted-foreground text-center">
                    Not enough history to chart yet — prices are checked a few
                    times a day. Check back soon.
                  </p>
                </div>
              )}
            </div>

            {/* Facts */}
            <div className="space-y-1 text-xs">
              {info.allTimeLow && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Lowest seen</span>
                  <span className="font-medium">
                    {formatPrice(info.allTimeLow, currency)}
                    {info.allTimeLowDate && (
                      <span className="text-muted-foreground font-normal">
                        {' · '}{new Date(info.allTimeLowDate).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}
                      </span>
                    )}
                  </span>
                </div>
              )}
              {info.avg30dPrice && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Average (30d)</span>
                  <span className="font-medium">{formatPrice(info.avg30dPrice, currency)}</span>
                </div>
              )}
              {info.trackedSince && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Tracked since</span>
                  <span className="font-medium">
                    {new Date(info.trackedSince).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}
                  </span>
                </div>
              )}
            </div>

            <button
              className="w-full flex items-center justify-center gap-1.5 py-2 rounded-md text-sm font-medium text-black transition-colors"
              style={{ backgroundColor: '#FF9900' }}
              onClick={handleBuy}
            >
              View on Amazon
              <ExternalLink className="w-3.5 h-3.5" />
            </button>

            <p className="text-[9px] text-center text-muted-foreground">
              Smart Deal · helps support Homecast
            </p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
