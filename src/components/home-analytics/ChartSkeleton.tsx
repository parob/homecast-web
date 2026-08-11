/**
 * What a chart looks like before it arrives: panel-shaped, so the page keeps
 * its height and nothing jumps when the data lands. A spinner in empty space
 * measures nothing and then shoves everything down.
 */
export default function ChartSkeleton({ panels = 2 }: { panels?: number }) {
  return (
    <div className="space-y-3">
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
