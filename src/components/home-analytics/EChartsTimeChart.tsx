import { useEffect, useMemo, useRef } from 'react';
import * as echarts from 'echarts/core';
import { LineChart as EChartsLine } from 'echarts/charts';
import {
  DataZoomComponent,
  GridComponent,
  MarkAreaComponent,
  TooltipComponent,
} from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';
import type { HistorySeriesData } from '@/lib/graphql/types';
import type { AggregatePoint } from '@/history/aggregate';
import { normalizeValue } from '@/history/aggregate';
import { coverageStart, withCarryIn } from '@/history/carry';
import { seriesColor } from './chartColors';
import { PLOT_LEFT, PLOT_RIGHT } from './chartGeometry';
import type { ChartSeries } from './chartColors';

// Tree-shaken build: an unregistered component is silently a no-op, not an
// error — MarkArea drew nothing at all until it was added here.
echarts.use([EChartsLine, GridComponent, TooltipComponent, DataZoomComponent, MarkAreaComponent, CanvasRenderer]);

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
  /**
   * A line whose STROKE carries a second variable.
   *
   * ECharts sets line width per series, not per point, so a swelling stroke
   * is drawn as a filled envelope around the centre — value ± half — with a
   * hairline down the middle so it stays readable where the stroke thins to
   * nothing. Lighting uses it: the centre is how many lights are on, the
   * thickness is how bright they are.
   */
  ribbon?: { points: Array<{ ts: number; value: number; half: number }>; label: string } | null;
  /** Pin the value axis — a count of lights has no half. */
  axis?: { min?: number; max?: number; minInterval?: number };
  fromTs: number;
  toTs: number;
  normalize: boolean;
  height?: number;
  /** Charts sharing a groupId share their crosshair + zoom (stacked panels). */
  groupId?: string;
  /** Hide the zoom slider (stacked panels keep one slider on the last chart). */
  hideSlider?: boolean;
  /**
   * Series keys to pick out of the crowd — everything else fades. Driven by
   * the legend, so pointing at a name answers "which line is that?" without
   * counting colours. Null/empty means show them all equally.
   */
  highlightKeys?: string[] | null;
  /** The reverse trip: the line under the pointer, so the legend can echo it. */
  onSeriesHover?: (key: string | null) => void;
}

export default function EChartsTimeChart({
  series, band, bandLabel, ribbon, axis, fromTs, toTs, normalize, height = 320, groupId, hideSlider = false,
  highlightKeys, onSeriesHover,
}: EChartsTimeChartProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<echarts.ECharts | null>(null);
  // Latest callback/map without re-registering chart listeners on every render.
  const hoverCbRef = useRef(onSeriesHover);
  hoverCbRef.current = onSeriesHover;
  const keyByIndexRef = useRef(new Map<number, string>());

  // Axis plan: units in appearance order; first → left, second → right;
  // more than two borrow the left axis (Normalize is the honest fix there).
  const units = useMemo(() => {
    const seen: Array<string | null> = [];
    for (const s of series) {
      if (!seen.includes(s.unit)) seen.push(s.unit);
    }
    return seen.slice(0, 2);
  }, [series]);

  const { option, indexByKey, keyByIndex } = useMemo(() => {
    const theme = hostRef.current ? readTheme(hostRef.current) : { text: '#333', faint: '#888', grid: '#e5e5e5' };
    const axisIndexFor = (unit: string | null) => {
      if (ribbon && ribbon.points.length > 0) return 1; // the ribbon owns axis 0
      return !normalize && units.length > 1 && units.indexOf(unit) === 1 ? 1 : 0;
    };

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
      // withCarryIn: a series records on change, so its first in-window sample
      // is normally later than the window start. Drawing from that sample lost
      // a stretch whose value was perfectly well known.
      const pairs: Array<[number, number]> = withCarryIn(data, fromTs).map(p => [p.ts, value(p.avg)]);
      // Hold the last value to the range edge — LOCF is the data's meaning.
      if (pairs.length > 0 && pairs[pairs.length - 1][0] < toTs) {
        pairs.push([toTs, pairs[pairs.length - 1][1]]);
      }
      return pairs;
    };

    const chartSeries: object[] = [];
    // ECharts addresses series by index; the app addresses them by key. One
    // map, built where the series are built, keeps the two from drifting.
    const indexByKey = new Map<string, number[]>();
    const keyByIndex = new Map<number, string>();
    const claim = (key: string) => {
      const idx = chartSeries.length;
      indexByKey.set(key, [...(indexByKey.get(key) ?? []), idx]);
      keyByIndex.set(idx, key);
    };

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

    if (ribbon && ribbon.points.length > 0) {
      const colour = seriesColor(0);
      chartSeries.push(
        {
          // Curved, not stepped: the stroke is an eased shape (see
          // lighting.ts), and stepping its edges would put the staircase back.
          name: '__ribbonLow', type: 'line', smooth: 0.35, silent: true,
          data: ribbon.points.map(p => [p.ts, Math.max(p.value - p.half, 0)]),
          lineStyle: { opacity: 0 }, symbol: 'none', stack: '__ribbon', z: 1,
          tooltip: { show: false },
        },
        {
          // The stroke itself: one solid band, full opacity, no outline. A
          // paler fill under a darker centre line read as two marks — a line
          // with a halo — when the whole idea is a single swelling stroke.
          name: '__ribbonThickness', type: 'line', smooth: 0.35, silent: true,
          data: ribbon.points.map(p => [p.ts, p.half * 2]),
          lineStyle: { opacity: 0 }, symbol: 'none', stack: '__ribbon',
          areaStyle: { color: colour, opacity: 1 }, z: 2,
          tooltip: { show: false },
        },
        {
          // Invisible, and only here so the axis tooltip has a value to
          // report: the stroke above carries the whole visual.
          name: ribbon.label, type: 'line', smooth: 0.35,
          data: ribbon.points.map(p => [p.ts, p.value]),
          lineStyle: { opacity: 0 }, symbol: 'none',
          itemStyle: { color: colour }, z: 3,
        },
      );
    }

    // Nothing on the left of a long window is ambiguous — a dead sensor reads
    // the same as a window reaching back past the recording. Shade the stretch
    // before anything was KNOWN and name it.
    //
    // Known, not sampled: a series whose window opened with a carried value is
    // covered from the very start even if its first reading lands an hour in.
    // And earliest across the series, not per-series: one shared time axis,
    // and a per-series version would be a stack of overlapping greys.
    const firstTs = Math.min(...series.map(s => coverageStart(s.data, fromTs)));
    const unrecordedUntil = Number.isFinite(firstTs) && firstTs - fromTs > (toTs - fromTs) * 0.05
      ? firstTs
      : null;

    series.forEach((s, i) => {
      claim(s.key);
      const colour = s.color ?? seriesColor(i);
      chartSeries.push({
        name: s.label, type: 'line', step: 'end',
        data: toPairs(s.data),
        yAxisIndex: axisIndexFor(s.unit),
        lineStyle: {
          // A setpoint is thinner and dashed in its accessory's own colour:
          // same device, different kind of claim. A borrowed measure is
          // solid but recedes — it is context, not the subject.
          width: s.dashed ? 1.25 : s.secondary ? 1.5 : (band ? 1 : 2),
          color: colour,
          opacity: s.secondary ? 0.5 : (band && !s.dashed ? 0.5 : 1),
          type: s.dashed ? [5, 4] : 'solid',
        },
        itemStyle: { color: colour },
        symbol: 'none', z: s.dashed ? 1 : 2,
        emphasis: { focus: 'series', lineStyle: { width: s.dashed ? 2 : 2.5, opacity: 1 } },
        // Explicit, because the default blur for a line is barely a change
        // when the lines are already thin — "which one is that" needs the
        // others to genuinely recede.
        blur: { lineStyle: { opacity: 0.15 } },
      });
      if (s.ghost) {
        // The ghost answers to its series' key too — highlighting a line
        // should bring its own comparison with it, not orphan it.
        claim(s.key);
        chartSeries.push({
          name: `${s.label} (previous)`, type: 'line', step: 'end',
          data: toPairs(s.ghost),
          yAxisIndex: axisIndexFor(s.unit),
          lineStyle: { width: 1.5, color: colour, opacity: 0.45, type: [5, 4] },
          itemStyle: { color: colour },
          symbol: 'none', z: 2,
        });
      }
    });

    if (unrecordedUntil !== null && chartSeries.length > 0) {
      // A markArea rides on a series and is not drawn if that series has no
      // data — so it goes on the first real line, not on a spacer.
      (chartSeries[0] as { markArea?: unknown }).markArea = {
        silent: true,
        itemStyle: { color: theme.faint, opacity: 0.07 },
        label: { show: true, position: 'insideTopLeft', color: theme.faint, fontSize: 10 },
        data: [[{ name: 'No Data', xAxis: fromTs }, { xAxis: unrecordedUntil }]],
      };
    }

    const ribbonAxis = ribbon && ribbon.points.length > 0;
    const axisUnits = ribbonAxis
      // The ribbon's axis counts lights; a borrowed measure cannot share it.
      ? [null, ...(units[0] !== undefined ? [units[0]] : [])]
      : (units.length > 1 && !normalize ? units : [units[0] ?? null]);
    const yAxes = axisUnits.map((unit, idx) => ({
      type: 'value' as const,
      position: idx === 0 ? 'left' as const : 'right' as const,
      min: normalize ? 0 : (idx === 0 ? axis?.min : undefined),
      max: normalize ? 100 : (idx === 0 ? axis?.max : undefined),
      minInterval: idx === 0 ? axis?.minInterval : undefined,
      scale: !(idx === 0 && axis),
      axisLabel: {
        color: theme.faint, fontSize: 11,
        formatter: (v: number) => (normalize ? `${Math.round(v)}%` : `${Number.isInteger(v) ? v : v.toFixed(1)}${unit ?? ''}`),
      },
      splitLine: { show: idx === 0, lineStyle: { color: theme.grid } },
    }));

    const option = {
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
        // snap: without it a value axis lets the crosshair float between
        // readings, so the line you are pointing at and the number you are
        // reading are from different instants. confine: the chart lives in a
        // dialog that clips its overflow, and an unconfined tooltip near the
        // right edge was drawn half outside it. triggerOn/hideDelay stop the
        // panel flickering as the pointer crosses between stacked charts.
        axisPointer: {
          type: 'cross' as const,
          snap: true,
          label: { show: false },
          crossStyle: { color: theme.faint },
          lineStyle: { color: theme.faint },
        },
        confine: true,
        triggerOn: 'mousemove' as const,
        hideDelay: 40,
        transitionDuration: 0,
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
            .filter(p => p.seriesName && !p.seriesName.startsWith('__band') && !p.seriesName.startsWith('__ribbon')
              && Array.isArray(p.value) && Number.isFinite(p.value[1]))
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
    return { option, indexByKey, keyByIndex };
  }, [series, band, bandLabel, ribbon, axis, fromTs, toTs, normalize, units, hideSlider]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const chart = echarts.init(host);
    chartRef.current = chart;
    if (groupId) {
      chart.group = groupId;
      echarts.connect(groupId);
    }
    // Pointing at a line tells the legend which name to light up. Read the
    // key through a ref: re-registering these on every render would tear the
    // listener down mid-hover.
    chart.on('mouseover', (params: { seriesIndex?: number }) => {
      const key = params.seriesIndex !== undefined ? keyByIndexRef.current.get(params.seriesIndex) : undefined;
      if (key) hoverCbRef.current?.(key);
    });
    chart.on('mouseout', () => hoverCbRef.current?.(null));
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
    keyByIndexRef.current = keyByIndex;
    chartRef.current?.setOption(option as never, { notMerge: true });
  }, [option, keyByIndex]);

  // Legend → chart. `emphasis.focus: 'series'` on each line means emphasising
  // one blurs the rest, so a single highlight action does both halves of
  // "show me this one". Downplay first: highlights are additive.
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    // escapeConnect: stacked panels are connected so their crosshairs move
    // together, but connect() also relays actions — so each panel's own
    // "downplay everything" was landing on its neighbours and wiping the
    // highlight the legend had just asked for. Series indices are per-chart
    // anyway; sharing them across panels was never meaningful.
    chart.dispatchAction({ type: 'downplay', escapeConnect: true });
    const indices = (highlightKeys ?? []).flatMap(key => indexByKey.get(key) ?? []);
    if (indices.length > 0) {
      chart.dispatchAction({ type: 'highlight', seriesIndex: indices, escapeConnect: true });
    }
  }, [highlightKeys, indexByKey, option]);

  return <div ref={hostRef} style={{ width: '100%', height }} />;
}
