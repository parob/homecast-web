import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  ReferenceLine,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

/**
 * Price-history chart. Renders as a bare sparkline for the deal popover and,
 * with `detailed`, as a full chart with axes for the price-history screen.
 *
 * Split into its own module and loaded via React.lazy so recharts (~400 KB)
 * only downloads when a user actually looks at prices — it was otherwise
 * hoisted onto the main dashboard bundle for a chart most users never see.
 */
export interface DealPriceChartProps {
  chartData: { date: string; price: number }[];
  gradientId: string;
  atlPrice: number | null;
  /** Show axes, grid and hover tooltip, at a taller size. */
  detailed?: boolean;
  /** Currency symbol for axis/tooltip labels (detailed only). */
  currencySymbol?: string;
}

const shortDate = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

export default function DealPriceChart({
  chartData,
  gradientId,
  atlPrice,
  detailed = false,
  currencySymbol = '',
}: DealPriceChartProps) {
  return (
    // text-primary sets currentColor for the series, so the line and its fill
    // follow the theme instead of a hardcoded hex. One accent for every chart:
    // colouring the line by deal tier said nothing the label above it didn't
    // already say, and its no-deal fallback was a muddy grey slab.
    <div className={`text-primary ${detailed ? 'h-[200px] w-full' : 'h-[60px] w-full'}`}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart
          data={chartData}
          margin={detailed
            ? { top: 8, right: 8, bottom: 4, left: 0 }
            : { top: 2, right: 2, bottom: 2, left: 2 }}
        >
          <defs>
            {/* A tint, not a block — a saturated fill over 200px reads as a slab */}
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="currentColor" stopOpacity={0.18} />
              <stop offset="100%" stopColor="currentColor" stopOpacity={0.01} />
            </linearGradient>
          </defs>
          {detailed && (
            // Solid hairline: a dashed grid reads as a threshold when it's just a grid
            <CartesianGrid className="stroke-border" vertical={false} />
          )}
          {detailed && (
            <XAxis
              dataKey="date"
              tickFormatter={shortDate}
              tick={{ fontSize: 11, fill: 'currentColor' }}
              className="stroke-border text-muted-foreground"
              minTickGap={28}
            />
          )}
          <YAxis
            domain={['dataMin - 2', 'dataMax + 2']}
            hide={!detailed}
            tick={{ fontSize: 11, fill: 'currentColor' }}
            className="stroke-border text-muted-foreground"
            width={52}
            tickFormatter={(v: number) => `${currencySymbol}${v.toFixed(0)}`}
          />
          {detailed && (
            <Tooltip
              contentStyle={{ fontSize: 12, borderRadius: 8 }}
              labelFormatter={(l: string) => shortDate(l)}
              formatter={(v: number) => [`${currencySymbol}${v.toFixed(2)}`, 'Price']}
            />
          )}
          {/* stepAfter, not a curve: a price holds until it changes. A smooth
              interpolation claims prices the product never actually had. */}
          <Area
            type="stepAfter"
            dataKey="price"
            stroke="currentColor"
            strokeWidth={2}
            fill={`url(#${gradientId})`}
          />
          {atlPrice != null && (
            // Dashed here is meaningful — this is a threshold, not a gridline
            <ReferenceLine
              y={atlPrice}
              className="stroke-muted-foreground"
              strokeDasharray="4 4"
              strokeOpacity={0.7}
              label={detailed
                ? {
                    value: 'all-time low',
                    position: 'insideBottomLeft',
                    fontSize: 10,
                    className: 'fill-muted-foreground',
                  }
                : undefined}
            />
          )}
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
