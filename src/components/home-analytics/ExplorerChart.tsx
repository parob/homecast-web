import EChartsTimeChart from './EChartsTimeChart';
import type { AggregatePoint } from '@/history/aggregate';
import type { ChartSeries } from './chartColors';

// Engine swap (2026-08-11): recharts → Apache ECharts (EChartsTimeChart).
// This module keeps its old surface so every caller stays untouched; the
// engine underneath now provides the capped self-sorting tooltip, native
// drag-zoom, and crosshair sync across stacked charts.
export { SERIES_COLORS, seriesColor } from './chartColors';
export type { ChartSeries } from './chartColors';

interface ExplorerChartProps {
  series: ChartSeries[];
  /** Cross-sensor envelope rendered behind everything (aggregated views). */
  band?: AggregatePoint[] | null;
  bandLabel?: string;
  fromTs: number;
  toTs: number;
  normalize: boolean;
  height?: number;
  /** Charts sharing a groupId share their crosshair (stacked panels). */
  groupId?: string;
  hideSlider?: boolean;
}

export default function ExplorerChart(props: ExplorerChartProps) {
  return <EChartsTimeChart {...props} />;
}
