// Shared shapes for the Home Analytics surface. In their own module so the
// nav hook, the orchestrator, and the Dashboard can all import them without
// a cycle.

export interface SeriesSel {
  accessoryId: string;
  characteristicType: string;
  /** Short distinguishing label (disambiguateSeriesLabels output). */
  label: string;
  /** Complete path (room · accessory · characteristic) for tooltips/stats. */
  fullLabel?: string;
  /** Room, when known — lets state strips group by room. */
  room?: string | null;
  /** Accessory name — lets chips and legends group under it, written once. */
  accessoryName?: string;
  /** Characteristic alone — what a chip shows INSIDE its accessory cluster. */
  charLabel?: string;
  unit: string | null;
  kind: 'numeric' | 'bool' | 'enum' | 'string';
}

/** A custom (user-assembled) view: any mix of series on one chart. */
export interface ExplorerView {
  title: string;
  series: SeriesSel[];
  aggregate: boolean;
}
