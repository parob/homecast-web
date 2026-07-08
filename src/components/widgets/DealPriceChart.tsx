import {
  Area,
  AreaChart,
  ResponsiveContainer,
  ReferenceLine,
  YAxis,
} from 'recharts';

/**
 * Price-history sparkline for a deal popover.
 *
 * Split into its own module and loaded via React.lazy from DealBadge so
 * recharts (~400 KB) only downloads when a user actually opens a deal — it
 * was otherwise hoisted onto the main dashboard bundle for a chart most
 * users never see.
 */
export interface DealPriceChartProps {
  chartData: { date: string; price: number }[];
  color: string;
  gradientId: string;
  atlPrice: number | null;
}

export default function DealPriceChart({ chartData, color, gradientId, atlPrice }: DealPriceChartProps) {
  return (
    <div className="h-[60px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={chartData} margin={{ top: 2, right: 2, bottom: 2, left: 2 }}>
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.3} />
              <stop offset="100%" stopColor={color} stopOpacity={0.05} />
            </linearGradient>
          </defs>
          <YAxis domain={['dataMin - 2', 'dataMax + 2']} hide />
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
            />
          )}
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
