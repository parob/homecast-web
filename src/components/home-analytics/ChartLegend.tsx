/**
 * The chart's key — ours, not the charting library's.
 *
 * It does two jobs that used to be two separate lists:
 *  · names the lines (full labels; labels.ts shortens by construction, the
 *    legend never truncates what remains)
 *  · indexes them — pointing at a name lifts that line and fades the rest,
 *    pointing at a line lights the name back, because colour alone cannot
 *    carry ten series and counting swatches is not reading
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

export interface ChartLegendProps {
  entries: LegendEntry[];
  /** Series keys currently lit — from this legend or from the chart. */
  highlightKeys?: string[] | null;
  /** Hovering a name or a cluster; null on leave. */
  onHighlight?: (keys: string[] | null) => void;
  /** Latched entries — ringed, and the only ones the chart draws in full. */
  latchedKeys?: string[];
  /** Clicking a name latches it, and clicking it again lets it go. */
  onToggle?: (key: string) => void;
}

function Dot({
  entry, short, dim, latched, onHighlight, onToggle,
}: {
  entry: LegendEntry;
  short?: boolean;
  dim?: boolean;
  latched?: boolean;
  onHighlight?: (keys: string[] | null) => void;
  onToggle?: (key: string) => void;
}) {
  // Every entry is a chip. The old bare dot-and-label key read as a caption
  // rather than as a set of things, and it sat next to a chip row that said
  // the same names in a better shape — so the chips won and the caption went.
  //
  // A real <button>, not a span wearing role="button". WebKit does not move
  // focus to a button on tap, but it does to a [tabindex] span — and this chip
  // had no focus styling at all, so the user agent drew its own ring, in the
  // same blue and at the same radius as the latch ring below, and left it there
  // until you tapped something else. A button also joins the PRESSABLE list in
  // main.tsx, so a tapped chip finally acknowledges the tap, and it brings
  // Enter/Space activation with it.
  const shell = `group inline-flex min-w-0 items-center gap-1.5 rounded-full border bg-background px-2 py-0.5 text-left transition-opacity ${
    latched ? 'ring-2 ring-primary/60 ring-offset-1 ring-offset-background' : ''
  } ${dim ? 'opacity-35' : 'opacity-100'}`;

  const body = (
    <>
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
    </>
  );

  const hover = {
    onMouseEnter: onHighlight ? () => onHighlight([entry.key]) : undefined,
    onMouseLeave: onHighlight ? () => onHighlight(null) : undefined,
  };

  // Nothing to toggle: a plain label, and not focusable.
  if (!onToggle) return <span className={shell} {...hover}>{body}</span>;

  return (
    <button
      type="button"
      aria-pressed={!!latched}
      // The latch owns ring-*, so focus is drawn with outline — a separate
      // property, in a different colour at a different offset, so a chip that
      // is both focused and latched shows two marks you can tell apart.
      className={`${shell} cursor-pointer outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground`}
      onClick={() => onToggle(entry.key)}
      {...hover}
    >
      {body}
    </button>
  );
}

export default function ChartLegend({
  entries, highlightKeys, onHighlight, latchedKeys, onToggle,
}: ChartLegendProps) {
  // A key for one series is noise: the panel title already named it.
  if (entries.length < 2) return null;

  // Every line gets its name. A capped key is worse than a long one: the
  // entries it dropped are still drawn on the chart, so the reader is left
  // matching a colour against a list that does not contain it. Chips wrap.
  const shown = entries;

  const lit = new Set(highlightKeys ?? []);
  // An empty ARRAY is not the same as null: something is picked out and none
  // of it is here, so every name in this key fades — matching the lines above
  // it, which have already faded, and the tooltip, which has gone quiet.
  const noneHere = Array.isArray(highlightKeys) && highlightKeys.length === 0;
  const dimmed = (key: string) => noneHere || (lit.size > 0 && !lit.has(key));
  const latchedSet = new Set(latchedKeys ?? []);

  const groups = new Map<string, LegendEntry[]>();
  for (const entry of shown) {
    const key = entry.groupKey ?? entry.group ?? '';
    const list = groups.get(key) ?? [];
    list.push(entry);
    groups.set(key, list);
  }
  const hasCluster = [...groups.values()].some(list => list.length > 1 && list[0].group);

  const row = 'flex flex-wrap items-start gap-x-4 gap-y-2 text-[0.6875rem] text-muted-foreground';

  const content = !hasCluster
    ? shown.map(entry => (
      <Dot key={entry.key} entry={entry} dim={dimmed(entry.key)} latched={latchedSet.has(entry.key) && !dimmed(entry.key)} onHighlight={onHighlight} onToggle={onToggle} />
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
            <Dot key={entry.key} entry={entry} short dim={dimmed(entry.key)} latched={latchedSet.has(entry.key) && !dimmed(entry.key)} onHighlight={onHighlight} onToggle={onToggle} />
          ))}
        </span>
      ) : (
        <span key={groupKey || list[0].key} className="inline-flex flex-wrap items-center gap-x-3 gap-y-1">
          {list.map(entry => (
            <Dot key={entry.key} entry={entry} dim={dimmed(entry.key)} latched={latchedSet.has(entry.key) && !dimmed(entry.key)} onHighlight={onHighlight} onToggle={onToggle} />
          ))}
        </span>
      )
    ));

  return <div className={`${row} pt-1`}>{content}</div>;
}
