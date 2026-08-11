/**
 * The house-style legend: a wrapping dot row with FULL labels — the
 * anti-truncation half of the label system (labels.ts shortens by
 * construction; the legend never cuts what remains). Hidden for a single
 * series: a legend for one series is noise (MultiEnvLegend rule).
 */
export interface LegendEntry {
  key: string;
  label: string;
  color: string;
  dashed?: boolean;
}

const MAX_LEGEND = 8;

export default function ChartLegend({ entries }: { entries: LegendEntry[] }) {
  if (entries.length < 2) return null;
  // Past 8 entries a legend stops being a key and becomes a second dataset —
  // cap it and point at the stats table, which lists everything.
  const shown = entries.slice(0, MAX_LEGEND);
  const hidden = entries.length - shown.length;
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground pt-1">
      {shown.map(entry => (
        <span key={entry.key} className="inline-flex items-center gap-1.5 min-w-0">
          <span
            className="inline-block h-2 w-2 rounded-full shrink-0"
            style={{
              backgroundColor: entry.dashed ? 'transparent' : entry.color,
              border: entry.dashed ? `1.5px dashed ${entry.color}` : undefined,
            }}
          />
          <span className="whitespace-normal break-words">{entry.label}</span>
        </span>
      ))}
      {hidden > 0 && <span>+{hidden} more — full list below</span>}
    </div>
  );
}
