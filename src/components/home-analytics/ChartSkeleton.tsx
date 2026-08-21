/**
 * The wait, on its own — because a wait is no longer the same thing as an
 * empty screen.
 *
 * Held series paint immediately now, so opening the whole house after a room
 * arrives with content already on it and the rest still in flight. Gated on
 * "nothing to show yet", as it was when it lived only inside the skeleton,
 * that case reported nothing at all: charts quietly filled themselves in with
 * no sign that anything was still coming.
 */
export function SeriesProgress({ progress }: { progress?: { done: number; total: number } }) {
  const pct = progress && progress.total > 0
    ? Math.min(100, Math.round((progress.done / progress.total) * 100))
    : null;
  if (pct === null) return null;
  return (
    <div className="flex items-center gap-2">
      <div className="h-1 flex-1 overflow-hidden rounded-full bg-muted">
        <div
          className="h-full rounded-full bg-primary/60 transition-[width] duration-300"
          style={{ width: `${Math.max(pct, 4)}%` }}
        />
      </div>
      <span className="shrink-0 text-[0.625rem] tabular-nums text-muted-foreground">
        {progress!.done} of {progress!.total} series
      </span>
    </div>
  );
}

/**
 * What a chart looks like before it arrives: panel-shaped, so the page keeps
 * its height and nothing jumps when the data lands. A spinner in empty space
 * measures nothing and then shoves everything down.
 *
 * The wait is reported as real progress rather than a guessed ETA: the wire
 * caps a query at six series, so a wide view is a known number of sequential
 * chunks and "18 of 30 series" is a fact. A percentage invented from a timer
 * is the kind of progress bar nobody believes twice.
 */
export default function ChartSkeleton({
  panels = 2,
  progress,
}: {
  panels?: number;
  progress?: { done: number; total: number };
}) {
  return (
    <div className="space-y-3">
      <SeriesProgress progress={progress} />
      {Array.from({ length: panels }, (_, i) => (
        <div key={i} className="space-y-2 rounded-lg border p-3">
          <div className="h-3 w-28 animate-pulse rounded bg-muted" />
          <div className="h-[200px] animate-pulse rounded bg-muted/50" />
          <div className="h-3 w-48 animate-pulse rounded bg-muted" />
        </div>
      ))}
    </div>
  );
}
