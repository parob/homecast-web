import { ArrowDown, ArrowUp, Minus } from 'lucide-react';
import { formatDelta, formatWindow, verdictLabel, type CompareRow } from '@/history/comparison';

/**
 * The comparison, in words and numbers, above the chart.
 *
 * Two overlaid lines show the SHAPE of a change; nobody can read "+1.2°" off
 * them. This states both windows by date — a comparison whose periods are
 * unnamed is a claim you cannot check — then one row per series with the
 * change and what it means.
 *
 * A series with nothing to compare against says so and keeps its place.
 * Dropping it silently left the control looking broken on a home that had
 * only started recording, which is exactly when people go looking.
 */
const MAX_ROWS = 6;

export default function ComparisonSummary({
  rows, fromTs, toTs, offsetMs, comparisonName, now,
}: {
  rows: CompareRow[];
  fromTs: number;
  toTs: number;
  offsetMs: number;
  /** "yesterday" / "last week" — reads inside a sentence. */
  comparisonName: string;
  now: number;
}) {
  if (rows.length === 0) return null;
  const shown = rows.slice(0, MAX_ROWS);
  const hidden = rows.length - shown.length;
  const previousLabel = new Date(fromTs - offsetMs).toLocaleDateString(undefined, {
    weekday: 'short', day: 'numeric', month: 'short',
  });

  return (
    <div className="border rounded-lg p-3 space-y-2">
      <p className="text-[11px] text-muted-foreground">
        {formatWindow(fromTs, toTs, now)}
        {'  vs  '}
        {formatWindow(fromTs - offsetMs, toTs - offsetMs, now)}
      </p>
      {/* Capped width: pushed to the full width of a desktop panel the name
          and its number end up a hand's width apart and stop reading as a
          pair. */}
      <div className="space-y-1 max-w-3xl">
        {shown.map(row => {
          const Icon = row.verdict === 'higher' ? ArrowUp : row.verdict === 'lower' ? ArrowDown : Minus;
          const tone = row.verdict === 'higher'
            ? 'text-amber-600 dark:text-amber-400'
            : row.verdict === 'lower'
              ? 'text-sky-600 dark:text-sky-400'
              : 'text-muted-foreground';
          return (
            <div key={row.key} className="flex items-baseline gap-2 text-xs">
              <span className="h-2 w-2 rounded-full shrink-0 self-center" style={{ backgroundColor: row.color }} />
              <span className="min-w-0 flex-1 truncate">{row.label}</span>
              <span className="tabular-nums font-medium">
                {row.current !== null ? `${row.current.toFixed(1)}${row.unit}` : '—'}
              </span>
              {row.verdict === 'no-data' ? (
                <span className="text-muted-foreground w-[13.5rem] text-right truncate">
                  no data for {previousLabel}
                </span>
              ) : (
                <span className={`w-[13.5rem] text-right truncate ${tone}`}>
                  <Icon className="inline h-3 w-3 -mt-0.5" aria-hidden />
                  <span className="tabular-nums font-medium ml-0.5">
                    {row.delta !== null ? formatDelta(row.delta, row.unit) : ''}
                  </span>
                  <span className="text-muted-foreground ml-1.5">
                    {verdictLabel(row.verdict, row.unit, comparisonName)}
                  </span>
                </span>
              )}
            </div>
          );
        })}
        {hidden > 0 && (
          <p className="text-[11px] text-muted-foreground">+{hidden} more — full list below</p>
        )}
      </div>
    </div>
  );
}
