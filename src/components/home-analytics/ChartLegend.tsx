import { X } from 'lucide-react';

/**
 * The chart's key — ours, not the charting library's — and, where a view
 * lets you choose its series, the place you edit them.
 *
 * It does three jobs that used to be three separate lists:
 *  · names the lines (full labels; labels.ts shortens by construction, the
 *    legend never truncates what remains)
 *  · indexes them — pointing at a name lifts that line and fades the rest,
 *    pointing at a line lights the name back, because colour alone cannot
 *    carry ten series and counting swatches is not reading
 *  · edits them — an ✕ per entry and Add beside them, so a Custom view no
 *    longer repeats its whole series list as chips above the chart AND as a
 *    key below it AND as a stats table under that.
 *
 * Entries sharing an accessory draw as ONE cluster with the accessory named
 * once. Clusters key on accessory IDENTITY, never on the name: six rooms each
 * holding an "Underfloor Heating" are six accessories, and grouping them by
 * name collapsed them into one box of six identical "Temperature" chips.
 */
export interface LegendEntry {
  key: string;
  label: string;
  color: string;
  /** Setpoint — hollow with a dashed edge, matching its stroke. */
  dashed?: boolean;
  /** Borrowed from another measure — hollow with a dotted edge. */
  dotted?: boolean;
  /** Accessory this belongs to — the identity, for grouping. */
  groupKey?: string;
  /** What to call that accessory here (room-qualified only if it must be). */
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
  /**
   * Makes this key the view's series editor. Every entry gains an ✕ — and the
   * 8-entry cap lifts, because a key you cannot scroll to is a series you
   * cannot remove.
   */
  onRemove?: (key: string) => void;
  /** Rendered after the entries — the "Add series" control. */
  addSlot?: React.ReactNode;
}

function Dot({
  entry, short, dim, onHighlight, onRemove,
}: {
  entry: LegendEntry;
  short?: boolean;
  dim?: boolean;
  onHighlight?: (keys: string[] | null) => void;
  onRemove?: (key: string) => void;
}) {
  // Every entry is a chip. The old bare dot-and-label key read as a caption
  // rather than as a set of things, and it sat next to a chip row that said
  // the same names in a better shape — so the chips won and the caption went.
  return (
    <span
      className={`group inline-flex items-center gap-1.5 min-w-0 border rounded-full bg-background py-0.5 pl-2 transition-opacity ${
        onRemove ? 'pr-1' : 'pr-2'
      } ${dim ? 'opacity-35' : 'opacity-100'}`}
      onMouseEnter={onHighlight ? () => onHighlight([entry.key]) : undefined}
      onMouseLeave={onHighlight ? () => onHighlight(null) : undefined}
    >
      <span
        className="inline-block h-2 w-2 rounded-full shrink-0"
        style={{
          backgroundColor: entry.dashed || entry.dotted ? 'transparent' : entry.color,
          border: entry.dashed
            ? `1.5px dashed ${entry.color}`
            : entry.dotted ? `1.5px dotted ${entry.color}` : undefined,
        }}
      />
      <span className="whitespace-normal break-words">
        {short ? (entry.shortLabel ?? entry.label) : entry.label}
      </span>
      {onRemove && (
        <button
          type="button"
          className="rounded-full p-0.5 opacity-60 transition-opacity hover:bg-muted hover:opacity-100 focus-visible:opacity-100"
          onClick={() => onRemove(entry.key)}
          aria-label={`Remove ${entry.label}`}
        >
          <X className="h-3 w-3" />
        </button>
      )}
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

export default function ChartLegend({
  entries, highlightKeys, onHighlight, dashedNote, onRemove, addSlot,
}: ChartLegendProps) {
  const editable = !!onRemove || !!addSlot;
  // A key for one series is noise — unless it is also the editor, or a
  // comparison put an unexplained dashed line beside it.
  if (entries.length < 2 && !editable) {
    return dashedNote ? (
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground pt-1">
        <DashedNote label={dashedNote} />
      </div>
    ) : null;
  }

  // Past 8 entries a key stops being a key and becomes a second dataset — cap
  // it and point at the stats table. Never when it is the editor.
  const shown = editable ? entries : entries.slice(0, MAX_LEGEND);
  const hidden = entries.length - shown.length;

  const lit = new Set(highlightKeys ?? []);
  const dimmed = (key: string) => lit.size > 0 && !lit.has(key);

  const groups = new Map<string, LegendEntry[]>();
  for (const entry of shown) {
    const key = entry.groupKey ?? entry.group ?? '';
    const list = groups.get(key) ?? [];
    list.push(entry);
    groups.set(key, list);
  }
  const hasCluster = [...groups.values()].some(list => list.length > 1 && list[0].group);

  const row = 'flex flex-wrap items-start gap-x-4 gap-y-2 text-[11px] text-muted-foreground';

  const content = !hasCluster
    ? shown.map(entry => (
      <Dot key={entry.key} entry={entry} dim={dimmed(entry.key)} onHighlight={onHighlight} onRemove={onRemove} />
    ))
    : [...groups.entries()].map(([groupKey, list]) => (
      list.length > 1 && list[0].group ? (
        <span
          key={groupKey}
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
            {list[0].group}
          </span>
          {list.map(entry => (
            <Dot
              key={entry.key} entry={entry} short dim={dimmed(entry.key)}
              onHighlight={onHighlight} onRemove={onRemove}
            />
          ))}
        </span>
      ) : (
        <span key={groupKey || list[0].key} className="inline-flex flex-wrap items-center gap-x-3 gap-y-1">
          {list.map(entry => (
            <Dot key={entry.key} entry={entry} dim={dimmed(entry.key)} onHighlight={onHighlight} onRemove={onRemove} />
          ))}
        </span>
      )
    ));

  const notes = (
    <>
      {hidden > 0 && <span>+{hidden} more — full list below</span>}
      {dashedNote && <DashedNote label={dashedNote} />}
    </>
  );

  if (!editable) {
    return <div className={`${row} pt-1`}>{content}{notes}</div>;
  }

  // Editing: the entries scroll, Add does not. A thirty-series view scrolls
  // its own key off the bottom, and an Add button that goes with it is an Add
  // button you cannot find.
  return (
    <div className="pt-1 space-y-2">
      <div className={`${row} max-h-56 overflow-y-auto`}>{content}</div>
      <div className={row}>
        {addSlot}
        {notes}
      </div>
    </div>
  );
}
