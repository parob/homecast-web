import { lazy, Suspense } from 'react';
import { charLabel } from '@/components/automations/format';
import type { WritableChar } from '@/components/automations/characteristics';
import { BOOL_STATE_LABELS } from '@/history/labels';
import { coverageStart, withCarryIn } from '@/history/carry';
import { sanitizeSeriesData } from '@/history/sanitize';
import { stateTotals } from '@/history/stateSummary';
import StateTimeline from '@/components/widgets/StateTimeline';
import { PLOT_LEFT, PLOT_RIGHT } from './chartGeometry';
import type { HistoryPointData, HistorySeriesData } from '@/lib/graphql/types';

const HistoryChart = lazy(() => import('@/components/widgets/HistoryChart'));

/**
 * One accessory's characteristics, stacked on a shared time axis: a chart per
 * numeric characteristic, a timeline per categorical one, each with the same
 * caption grammar.
 *
 * This is the layout the accessory popup already had and people liked, lifted
 * out of the dialog so the Analytics surface can render the same thing at its
 * accessory scope. It was the one screen the old category-first navigation
 * could never reach — a separate component, so the two would have drifted the
 * moment either changed.
 */

/** Bool vocabulary is shared with the strips; enum labels enrich from the
 *  characteristic's own options, where the accessory's WritableChar is known. */
export function labelForValue(
  char: WritableChar | undefined, type: string, value: number, text?: string | null,
): string {
  if (text != null) return text; // string kind: the text IS the label
  const bool = BOOL_STATE_LABELS[type];
  if (bool) return bool[value === 0 ? 0 : 1];
  const option = char?.options?.find(o => o.value === value);
  if (option) return option.label;
  return value === 0 ? 'Off' : value === 1 ? 'On' : String(value);
}

/** Rolled stateMs keys: numeric codes for bool/enum, raw text for string. */
export function labelForKey(char: WritableChar | undefined, type: string, key: string): string {
  const parsed = Number(key);
  if (Number.isFinite(parsed) && key.trim() !== '') return labelForValue(char, type, parsed);
  return key;
}

export function formatDuration(ms: number): string {
  const minutes = Math.round(ms / 60_000);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours}h ${minutes % 60}m`;
  return `${Math.floor(hours / 24)}d ${hours % 24}h`;
}

/**
 * "recorded from …" — but only when the window genuinely reaches back past
 * the recording. A window that opened with a carried value was covered from
 * its start, whatever time its first sample happens to carry.
 */
export function recordedFrom(data: HistorySeriesData, fromTs: number, toTs: number): string {
  const first = coverageStart(data, fromTs);
  if (!Number.isFinite(first)) return '';
  if (first - fromTs < (toTs - fromTs) * 0.05) return '';
  return ` · recorded from ${new Date(first).toLocaleDateString(undefined, {
    day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
  })}`;
}

function numericStats(points: HistoryPointData[]): { min: number; avg: number; max: number } | null {
  if (points.length === 0) return null;
  let min = Infinity;
  let max = -Infinity;
  let sum = 0;
  for (const p of points) {
    min = Math.min(min, p.min);
    max = Math.max(max, p.max);
    sum += p.avg;
  }
  return { min, avg: sum / points.length, max };
}

export function AccessorySeriesSection({
  raw, fromTs, toTs, char, gradientKey,
}: {
  raw: HistorySeriesData;
  fromTs: number;
  toTs: number;
  char?: WritableChar;
  gradientKey: string;
}) {
  const isNumeric = raw.kind === 'numeric';
  // Radio-fault sentinels (-40°) would stretch this little chart flat.
  const s = isNumeric ? sanitizeSeriesData(raw).data : raw;
  const points = isNumeric ? withCarryIn(s, fromTs) : s.points;
  const stats = isNumeric ? numericStats(points) : null;
  const states = !isNumeric ? stateTotals(s, fromTs, toTs) : null;
  const empty = points.length === 0 && s.states.length === 0 && s.stateBuckets.length === 0
    && s.prevValue === null;
  const unit = s.unit ?? '';

  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between">
        <span className="text-xs font-medium">{charLabel(s.characteristicType)}</span>
        {s.resolution !== 'raw' && (
          <span className="text-[10px] text-muted-foreground">{s.resolution} averages</span>
        )}
      </div>
      {empty ? (
        <div className="flex h-12 items-center justify-center rounded-md border border-dashed">
          <span className="text-xs text-muted-foreground">
            {isNumeric ? 'No data in this range' : 'Monitoring — no events in this range'}
          </span>
        </div>
      ) : isNumeric ? (
        <>
          <Suspense fallback={<div className="h-[200px] w-full" />}>
            <HistoryChart
              points={s.points}
              carriedValue={s.prevValue}
              unit={s.unit}
              gradientId={`hist-${gradientKey}-${s.characteristicType}`}
              fromTs={fromTs}
              toTs={toTs}
            />
          </Suspense>
          {stats && (
            <p className="text-[11px] text-muted-foreground">
              min {stats.min.toFixed(1)}{unit} · avg {stats.avg.toFixed(1)}{unit} · max {stats.max.toFixed(1)}{unit}
              {recordedFrom(s, fromTs, toTs)}
            </p>
          )}
        </>
      ) : (
        <>
          <StateTimeline
            fromTs={fromTs}
            toTs={toTs}
            padLeft={PLOT_LEFT}
            padRight={PLOT_RIGHT}
            prevValue={s.prevValue}
            prevValueText={s.prevValueText}
            states={s.states}
            stateBuckets={s.stateBuckets}
            labelFor={(v, text) => labelForValue(char, s.characteristicType, v, text)}
          />
          {states && states.totals.length > 0 && (
            <p className="text-[11px] text-muted-foreground">
              {states.totals.slice(0, 3).map(([key, ms]) =>
                `${labelForKey(char, s.characteristicType, key)} ${formatDuration(ms)}`,
              ).join(' · ')}
              {states.transitions > 0 && ` · ${states.transitions} changes`}
              {recordedFrom(s, fromTs, toTs)}
            </p>
          )}
        </>
      )}
    </div>
  );
}
