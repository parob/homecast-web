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
  color: string;
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
  color,
  gradientId,
  atlPrice,
  detailed = false,
  currencySymbol = '',
}: DealPriceChartProps) {
  return (
    <div className={detailed ? 'h-[200px] w-full' : 'h-[60px] w-full'}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart
          data={chartData}
          margin={detailed
            ? { top: 8, right: 8, bottom: 4, left: 0 }
            : { top: 2, right: 2, bottom: 2, left: 2 }}
        >
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.3} />
              <stop offset="100%" stopColor={color} stopOpacity={0.05} />
            </linearGradient>
          </defs>
          {detailed && (
            <CartesianGrid strokeDasharray="3 3" stroke="currentColor" strokeOpacity={0.12} vertical={false} />
          )}
          {detailed && (
            <XAxis
              dataKey="date"
              tickFormatter={shortDate}
              tick={{ fontSize: 11 }}
              stroke="currentColor"
              strokeOpacity={0.3}
              minTickGap={28}
            />
          )}
          <YAxis
            domain={['dataMin - 2', 'dataMax + 2']}
            hide={!detailed}
            tick={{ fontSize: 11 }}
            stroke="currentColor"
            strokeOpacity={0.3}
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
          <Area
            type="monotone"
            dataKey="price"
            stroke={color}
            strokeWidth={1.5}
            fill={`url(#${gradientId})`}
          />
          {atlPrice != null && (
            <ReferenceLine
              y={atlPrice}
              stroke={color}
              strokeDasharray="3 3"
              strokeOpacity={0.5}
              label={detailed
                ? { value: 'all-time low', position: 'insideBottomLeft', fontSize: 10, fill: color }
                : undefined}
            />
          )}
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
