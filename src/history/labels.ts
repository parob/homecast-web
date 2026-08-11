// Series labelling for Home Analytics.
//
// The truncation complaint had a deeper cause: labels carried tokens the
// view already implied ("Living Room Sensor · Temperature" × 4 in a view
// titled "Living Room climate"). The fix is shortening by construction —
// drop every token shared by ALL series in the view, keep what
// distinguishes — and never truncating what remains: chips wrap, legends
// show full names, tooltips carry the complete path.

/**
 * Boolean characteristics read better in their own vocabulary — "the door
 * was On" helps nobody. Shared by the History dialog and the Analytics
 * state strips; enum characteristics with real option lists enrich on top
 * (HistoryDialog has the accessory's WritableChar options, strips don't).
 */
export const BOOL_STATE_LABELS: Record<string, [string, string]> = {
  contact_state: ['Closed', 'Open'],
  motion_detected: ['Clear', 'Detected'],
  occupancy_detected: ['Empty', 'Occupied'],
  smoke_detected: ['Clear', 'Smoke'],
  carbon_monoxide_detected: ['Clear', 'CO detected'],
  carbon_dioxide_detected: ['Normal', 'CO₂ high'],
  leak_detected: ['Dry', 'Leak'],
  status_low_battery: ['OK', 'Low'],
  obstruction_detected: ['Clear', 'Obstructed'],
};

/** Best-effort state label without the accessory's enum options. */
export function stateValueLabel(type: string, value: number): string {
  const bool = BOOL_STATE_LABELS[type];
  if (bool) return bool[value === 0 ? 0 : 1];
  return value === 0 ? 'Off' : value === 1 ? 'On' : String(value);
}

export interface LabelInput {
  key: string;
  room: string | null;
  accessoryName: string;
  charLabel: string;
}

export interface SeriesLabel {
  /** Shortest distinguishing form — chips, chart legend entries. */
  short: string;
  /** Complete path (`room · accessory · characteristic`) — tooltips/stats. */
  full: string;
}

function tokensOf(item: LabelInput): string[] {
  const words = item.accessoryName.split(/\s+/).filter(Boolean);
  const out = [...words, item.charLabel];
  if (item.room) out.unshift(item.room);
  return out;
}

/**
 * Compute a {short, full} label per series such that shorts are unique and
 * carry only what distinguishes each series within THIS view.
 */
export function disambiguateSeriesLabels(items: LabelInput[]): Map<string, SeriesLabel> {
  const out = new Map<string, SeriesLabel>();
  if (items.length === 0) return out;

  const full = (item: LabelInput) =>
    [item.room, item.accessoryName, item.charLabel].filter(Boolean).join(' · ');

  if (items.length === 1) {
    const item = items[0];
    out.set(item.key, { short: full(item), full: full(item) });
    return out;
  }

  // Tokens present in EVERY series carry no information within the view.
  const tokenSets = items.map(item => new Set(tokensOf(item)));
  const shared = new Set(
    [...tokenSets[0]].filter(token => tokenSets.every(set => set.has(token))),
  );

  const shorten = (item: LabelInput): string => {
    const accessoryWords = item.accessoryName.split(/\s+/).filter(w => !shared.has(w));
    const parts: string[] = [];
    if (item.room && !shared.has(item.room)) parts.push(item.room);
    if (accessoryWords.length > 0) parts.push(accessoryWords.join(' '));
    if (!shared.has(item.charLabel)) parts.push(item.charLabel);
    // Everything was shared → fall back to the accessory name.
    return parts.length > 0 ? parts.join(' · ') : item.accessoryName;
  };

  const shorts = items.map(shorten);

  // Uniqueness pass: identical shorts get their distinguishing context back
  // (room first, then characteristic), then the full form as last resort.
  const counts = new Map<string, number>();
  for (const s of shorts) counts.set(s, (counts.get(s) ?? 0) + 1);

  items.forEach((item, i) => {
    let short = shorts[i];
    if ((counts.get(short) ?? 0) > 1) {
      const withRoom = item.room ? `${item.room} · ${short}` : short;
      const clash = items.some((other, j) =>
        j !== i && (other.room ? `${other.room} · ${shorts[j]}` : shorts[j]) === withRoom);
      short = clash ? full(item) : withRoom;
    }
    out.set(item.key, { short, full: full(item) });
  });

  return out;
}
