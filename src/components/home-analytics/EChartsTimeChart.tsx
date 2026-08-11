import { useEffect, useMemo, useRef } from 'react';
import * as echarts from 'echarts/core';
import { LineChart as EChartsLine } from 'echarts/charts';
import {
  DataZoomComponent,
  GridComponent,
  TooltipComponent,
} from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';
import type { HistorySeriesData } from '@/lib/graphql/types';
import type { AggregatePoint } from '@/history/aggregate';
import { normalizeValue } from '@/history/aggregate';
import { seriesColor } from './chartColors';
import { PLOT_LEFT, PLOT_RIGHT } from './chartGeometry';
import type { ChartSeries } from './chartColors';

echarts.use([EChartsLine, GridComponent, TooltipComponent, DataZoomComponent, CanvasRenderer]);

/**
 * The chart engine behind every Analytics line chart — Apache ECharts.
 *
 * What recharts couldn't give us (and each of these was a user complaint):
 * an axis-pointer tooltip that caps and sorts itself, drag-zoom + slider
 * that feel native, and crosshair SYNC across stacked charts via
 * echarts.connect(groupId) — hover the temperature panel and the humidity
 * panel's crosshair follows, which is what makes "one time axis, many
 * measures" readable. Lines are step-end: a characteristic holds its value
 * until it changes; smoothing would claim states the device never reported.
 */

const TOOLTIP_MAX_ROWS = 8;

interface ThemeColors {
  text: string;
  faint: string;
  grid: string;
}

function readTheme(el: HTMLElement): ThemeColors {
  const styles = getComputedStyle(el);
  const pick = (name: string, fallback: string) => {
    const raw = styles.getPropertyValue(name).trim();
    return raw ? `hsl(${raw})` : fallback;
  };
  return {
    text: pick('--foreground', '#333'),
    faint: pick('--muted-foreground', '#888'),
    grid: pick('--border', '#e5e5e5'),
  };
}

export interface EChartsTimeChartProps {
  series: ChartSeries[];
  /** Cross-sensor envelope rendered behind everything. */
  band?: AggregatePoint[] | null;
  bandLabel?: string;
  fromTs: number;
  toTs: number;
  normalize: boolean;
  height?: number;
  /** Charts sharing a groupId share their crosshair + zoom (stacked panels). */
  groupId?: string;
  /** Hide the zoom slider (stacked panels keep one slider on the last chart). */
  hideSlider?: boolean;
}

export default function EChartsTimeChart({
  series, band, bandLabel, fromTs, toTs, normalize, height = 320, groupId, hideSlider = false,
}: EChartsTimeChartProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<echarts.ECharts | null>(null);

  // Axis plan: units in appearance order; first → left, second → right;
  // more than two borrow the left axis (Normalize is the honest fix there).
  const units = useMemo(() => {
    const seen: Array<string | null> = [];
    for (const s of series) {
      if (!seen.includes(s.unit)) seen.push(s.unit);
    }
    return seen.slice(0, 2);
  }, [series]);

  const option = useMemo(() => {
    const theme = hostRef.current ? readTheme(hostRef.current) : { text: '#333', faint: '#888', grid: '#e5e5e5' };
    const axisIndexFor = (unit: string | null) => (!normalize && units.length > 1 && units.indexOf(unit) === 1 ? 1 : 0);

    const toPairs = (data: HistorySeriesData): Array<[number, number]> => {
      const range = (() => {
        if (!normalize) return null;
        let min = Infinity;
        let max = -Infinity;
        for (const p of data.points) {
          min = Math.min(min, p.avg);
          max = Math.max(max, p.avg);
        }
        return { min, max };
      })();
      const value = (v: number) => (range ? normalizeValue(v, range.min, range.max) : v);
      const pairs: Array<[number, number]> = data.points.map(p => [p.ts, value(p.avg)]);
      // Hold the last value to the range edge — LOCF is the data's meaning.
      if (pairs.length > 0 && pairs[pairs.length - 1][0] < toTs) {
        pairs.push([toTs, pairs[pairs.length - 1][1]]);
      }
      return pairs;
    };

    const chartSeries: object[] = [];

    // Band: lower bound (invisible) + diff (filled) stacked, then bold avg.
    if (band && band.length > 0 && !normalize) {
      chartSeries.push(
        {
          name: '__bandLow', type: 'line', step: 'end', silent: true,
          data: band.map(p => [p.ts, p.min]),
          lineStyle: { opacity: 0 }, symbol: 'none', stack: '__band', z: 1,
          tooltip: { show: false },
        },
        {
          name: '__bandDiff', type: 'line', step: 'end', silent: true,
          data: band.map(p => [p.ts, p.max - p.min]),
          lineStyle: { opacity: 0 }, symbol: 'none', stack: '__band',
          areaStyle: { color: seriesColor(0), opacity: 0.08 }, z: 1,
          tooltip: { show: false },
        },
        {
          name: bandLabel ?? 'average', type: 'line', step: 'end',
          data: band.map(p => [p.ts, p.avg]),
          lineStyle: { width: 2.5, color: seriesColor(0) }, symbol: 'none',
          itemStyle: { color: seriesColor(0) }, z: 3,
        },
      );
    }

    series.forEach((s, i) => {
      chartSeries.push({
        name: s.label, type: 'line', step: 'end',
        data: toPairs(s.data),
        yAxisIndex: axisIndexFor(s.unit),
        lineStyle: { width: band ? 1 : 2, color: seriesColor(i), opacity: band ? 0.5 : 1 },
        itemStyle: { color: seriesColor(i) },
        symbol: 'none', z: 2,
        emphasis: { focus: 'series', lineStyle: { width: 2.5, opacity: 1 } },
      });
      if (s.ghost) {
        chartSeries.push({
          name: `${s.label} (previous)`, type: 'line', step: 'end',
          data: toPairs(s.ghost),
          yAxisIndex: axisIndexFor(s.unit),
          lineStyle: { width: 1.5, color: seriesColor(i), opacity: 0.45, type: [5, 4] },
          itemStyle: { color: seriesColor(i) },
          symbol: 'none', z: 2,
        });
      }
    });

    const yAxes = (units.length > 1 && !normalize ? units : [units[0] ?? null]).map((unit, idx) => ({
      type: 'value' as const,
      position: idx === 0 ? 'left' as const : 'right' as const,
      min: normalize ? 0 : undefined,
      max: normalize ? 100 : undefined,
      scale: true,
      axisLabel: {
        color: theme.faint, fontSize: 11,
        formatter: (v: number) => (normalize ? `${Math.round(v)}%` : `${Number.isInteger(v) ? v : v.toFixed(1)}${unit ?? ''}`),
      },
      splitLine: { show: idx === 0, lineStyle: { color: theme.grid } },
    }));

    return {
      animation: false,
      grid: {
        // Fixed gutters, not containLabel: state strips inset by the same
        // numbers so a vertical read lines up across stacked panels.
        left: PLOT_LEFT,
        right: yAxes.length > 1 ? PLOT_LEFT : PLOT_RIGHT,
        top: 12,
        bottom: hideSlider ? 24 : 48,
        containLabel: false,
      },
      xAxis: {
        type: 'time' as const,
        min: fromTs,
        max: toTs,
        axisLabel: { color: theme.faint, fontSize: 11, hideOverlap: true },
        axisLine: { lineStyle: { color: theme.grid } },
        splitLine: { show: false },
      },
      yAxis: yAxes,
      dataZoom: [
        { type: 'inside' as const, xAxisIndex: 0, filterMode: 'none' as const },
        ...(hideSlider ? [] : [{
          type: 'slider' as const, xAxisIndex: 0, height: 18, bottom: 6,
          borderColor: 'transparent', backgroundColor: 'transparent',
          fillerColor: 'rgba(128,128,128,0.12)',
          handleStyle: { color: theme.faint },
          textStyle: { color: theme.faint, fontSize: 10 },
          filterMode: 'none' as const,
        }]),
      ],
      tooltip: {
        trigger: 'axis' as const,
        axisPointer: { type: 'cross' as const, label: { show: false } },
        backgroundColor: document.documentElement.classList.contains('dark')
          ? 'rgba(24,24,27,0.96)'
          : 'rgba(255,255,255,0.96)',
        borderWidth: 0,
        padding: [8, 12],
        textStyle: { fontSize: 12, color: theme.text },
        extraCssText: 'box-shadow: 0 4px 12px rgba(0,0,0,0.12); border-radius: 8px; max-width: 320px;',
        // Cap + sort the rows ourselves — a 20-series wall is not a tooltip.
        formatter: (params: unknown) => {
          const items = (Array.isArray(params) ? params : [params]) as Array<{
            seriesName?: string; value?: [number, number]; color?: string;
          }>;
          const rows = items
            .filter(p => p.seriesName && !p.seriesName.startsWith('__band') && Array.isArray(p.value) && Number.isFinite(p.value[1]))
            .map(p => ({ name: p.seriesName!, value: (p.value as [number, number])[1], color: String(p.color ?? '#888') }));
          if (rows.length === 0) return '';
          rows.sort((a, b) => b.value - a.value);
          const ts = (items[0]?.value as [number, number] | undefined)?.[0];
          const header = ts !== undefined
            ? `<div style="font-weight:600;margin-bottom:4px">${new Date(ts).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</div>`
            : '';
          const shown = rows.slice(0, TOOLTIP_MAX_ROWS);
          const hidden = rows.length - shown.length;
          const fmt = (v: number) => (normalize ? `${v.toFixed(0)}%` : v.toFixed(1));
          const lines = shown.map(r =>
            `<div style="display:flex;align-items:center;gap:6px">`
            + `<span style="width:8px;height:8px;border-radius:50%;background:${r.color};flex:none"></span>`
            + `<span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;opacity:.75">${r.name}</span>`
            + `<span style="font-variant-numeric:tabular-nums;font-weight:500">${fmt(r.value)}</span>`
            + `</div>`).join('');
          const more = hidden > 0 ? `<div style="opacity:.6;margin-top:4px">+${hidden} more</div>` : '';
          return header + lines + more;
        },
      },
      series: chartSeries,
    };
  }, [series, band, bandLabel, fromTs, toTs, normalize, units, hideSlider]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const chart = echarts.init(host);
    chartRef.current = chart;
    if (groupId) {
      chart.group = groupId;
      echarts.connect(groupId);
    }
    const observer = new ResizeObserver(() => chart.resize());
    observer.observe(host);
    return () => {
      observer.disconnect();
      chart.dispose();
      chartRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupId]);

  useEffect(() => {
    chartRef.current?.setOption(option as never, { notMerge: true });
  }, [option]);

  return <div ref={hostRef} style={{ width: '100%', height }} />;
}
