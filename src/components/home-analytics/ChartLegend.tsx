/**
 * The house-style legend: a wrapping dot row with FULL labels — the
 * anti-truncation half of the label system (labels.ts shortens by
 * construction; the legend never cuts what remains).
 *
 * Entries sharing an accessory are drawn as ONE cluster with the accessory
 * named once: six rows reading "Air Conditioner · …" said the same thing
 * six times and buried the part that differed. Hidden for a single series:
 * a legend for one series is noise (MultiEnvLegend rule).
 *
 * It is also the chart's index: pointing at a name lights that line up and
 * fades the rest, pointing at a cluster's name does the whole accessory, and
 * pointing at a line in the chart lights the name back. Colour alone cannot
 * carry ten series, and counting swatches is not reading.
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

export interface ChartLegendProps {
  entries: LegendEntry[];
  /** Series keys currently lit — from this legend or from the chart. */
  highlightKeys?: string[] | null;
  /** Hovering a name or a cluster; null on leave. */
  onHighlight?: (keys: string[] | null) => void;
  /**
   * Names the dashed overlay ("previous day"). Not an entry: it stands for
   * every series' comparison at once, so there is nothing to highlight.
   */
  dashedNote?: string;
}

function Dot({
  entry, short, dim, onHighlight,
}: {
  entry: LegendEntry;
  short?: boolean;
  dim?: boolean;
  onHighlight?: (keys: string[] | null) => void;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 min-w-0 rounded px-0.5 transition-opacity ${
        dim ? 'opacity-35' : 'opacity-100'
      } ${onHighlight ? 'cursor-default' : ''}`}
      onMouseEnter={onHighlight ? () => onHighlight([entry.key]) : undefined}
      onMouseLeave={onHighlight ? () => onHighlight(null) : undefined}
    >
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

function DashedNote({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="inline-block h-0 w-3 shrink-0 border-t-[1.5px] border-dashed border-current opacity-70" />
      <span>{label}</span>
    </span>
  );
}

export default function ChartLegend({ entries, highlightKeys, onHighlight, dashedNote }: ChartLegendProps) {
  // One series still needs the note when a comparison is on — the dashed line
  // beside it is otherwise unexplained.
  if (entries.length < 2) {
    return dashedNote ? (
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground pt-1">
        <DashedNote label={dashedNote} />
      </div>
    ) : null;
  }
  // Past 8 entries a legend stops being a key and becomes a second dataset —
  // cap it and point at the stats table, which lists everything.
  const shown = entries.slice(0, MAX_LEGEND);
  const hidden = entries.length - shown.length;

  const lit = new Set(highlightKeys ?? []);
  const dimmed = (key: string) => lit.size > 0 && !lit.has(key);

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
        {shown.map(entry => (
          <Dot key={entry.key} entry={entry} dim={dimmed(entry.key)} onHighlight={onHighlight} />
        ))}
        {hidden > 0 && <span>+{hidden} more — full list below</span>}
        {dashedNote && <DashedNote label={dashedNote} />}
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-start gap-x-4 gap-y-2 text-[11px] text-muted-foreground pt-1">
      {[...groups.entries()].map(([name, list]) => (
        name && list.length > 1 ? (
          <span
            key={name}
            className="inline-flex flex-wrap items-center gap-x-2.5 gap-y-1 rounded-md bg-muted/60 px-2 py-1"
          >
            <span
              // The cluster's name is its own target: one hover lights every
              // series this accessory contributes.
              className={`font-medium text-foreground/70 transition-opacity ${
                list.every(e => dimmed(e.key)) ? 'opacity-35' : 'opacity-100'
              }`}
              onMouseEnter={onHighlight ? () => onHighlight(list.map(e => e.key)) : undefined}
              onMouseLeave={onHighlight ? () => onHighlight(null) : undefined}
            >
              {name}
            </span>
            {list.map(entry => (
              <Dot key={entry.key} entry={entry} short dim={dimmed(entry.key)} onHighlight={onHighlight} />
            ))}
          </span>
        ) : (
          <span key={name || list[0].key} className="inline-flex flex-wrap items-center gap-x-3 gap-y-1">
            {list.map(entry => (
              <Dot key={entry.key} entry={entry} dim={dimmed(entry.key)} onHighlight={onHighlight} />
            ))}
          </span>
        )
      ))}
      {hidden > 0 && <span>+{hidden} more — full list below</span>}
      {dashedNote && <DashedNote label={dashedNote} />}
    </div>
  );
}
