/**
 * The house-style legend: a wrapping dot row with FULL labels — the
 * anti-truncation half of the label system (labels.ts shortens by
 * construction; the legend never cuts what remains).
 *
 * Entries sharing an accessory are drawn as ONE cluster with the accessory
 * named once: six rows reading "Air Conditioner · …" said the same thing
 * six times and buried the part that differed. Hidden for a single series:
 * a legend for one series is noise (MultiEnvLegend rule).
 */
export interface LegendEntry {
  key: string;
  label: string;
  color: string;
  dashed?: boolean;
  /** Accessory (or other owner) these entries belong to. */
  group?: string;
  /** Shown instead of `label` inside a cluster (the group names the rest). */
  shortLabel?: string;
}

const MAX_LEGEND = 8;

function Dot({ entry, short }: { entry: LegendEntry; short?: boolean }) {
  return (
    <span className="inline-flex items-center gap-1.5 min-w-0">
      <span
        className="inline-block h-2 w-2 rounded-full shrink-0"
        style={{
          backgroundColor: entry.dashed ? 'transparent' : entry.color,
          border: entry.dashed ? `1.5px dashed ${entry.color}` : undefined,
        }}
      />
      <span className="whitespace-normal break-words">
        {short ? (entry.shortLabel ?? entry.label) : entry.label}
      </span>
    </span>
  );
}

export default function ChartLegend({ entries }: { entries: LegendEntry[] }) {
  if (entries.length < 2) return null;
  // Past 8 entries a legend stops being a key and becomes a second dataset —
  // cap it and point at the stats table, which lists everything.
  const shown = entries.slice(0, MAX_LEGEND);
  const hidden = entries.length - shown.length;

  const groups = new Map<string, LegendEntry[]>();
  for (const entry of shown) {
    const key = entry.group ?? '';
    const list = groups.get(key) ?? [];
    list.push(entry);
    groups.set(key, list);
  }
  const hasCluster = [...groups.entries()].some(([name, list]) => name && list.length > 1);

  if (!hasCluster) {
    return (
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground pt-1">
        {shown.map(entry => <Dot key={entry.key} entry={entry} />)}
        {hidden > 0 && <span>+{hidden} more — full list below</span>}
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-start gap-x-4 gap-y-2 text-[11px] text-muted-foreground pt-1">
      {[...groups.entries()].map(([name, list]) => (
        name && list.length > 1 ? (
          <span key={name} className="inline-flex flex-wrap items-center gap-x-2.5 gap-y-1 rounded-md bg-muted/60 px-2 py-1">
            <span className="font-medium text-foreground/70">{name}</span>
            {list.map(entry => <Dot key={entry.key} entry={entry} short />)}
          </span>
        ) : (
          <span key={name || list[0].key} className="inline-flex flex-wrap items-center gap-x-3 gap-y-1">
            {list.map(entry => <Dot key={entry.key} entry={entry} />)}
          </span>
        )
      ))}
      {hidden > 0 && <span>+{hidden} more — full list below</span>}
    </div>
  );
}
