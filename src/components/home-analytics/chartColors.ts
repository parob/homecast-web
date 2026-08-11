import type { HistorySeriesData } from '@/lib/graphql/types';

// Series accents: index-stable, readable in both themes, distinguishable at
// thin line weights. First entry matches the app's primary accent.
export const SERIES_COLORS = [
  '#3b82f6',
  '#f59e0b',
  '#8b5cf6',
  '#10b981',
  '#ef4444',
  '#0ea5e9',
  '#ec4899',
  '#84cc16',
];

export function seriesColor(index: number): string {
  return SERIES_COLORS[index % SERIES_COLORS.length];
}

export interface ChartSeries {
  key: string;
  label: string;
  unit: string | null;
  data: HistorySeriesData;
  /** Ghost twin from compare mode, already time-shifted onto this range. */
  ghost?: HistorySeriesData;
}
