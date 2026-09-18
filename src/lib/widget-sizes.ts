/**
 * How much of the grid one tile takes.
 *
 * A camera is the reason this exists — a 16:9 still in a 1×1 tile is mostly
 * crop — but nothing here knows what a camera is. A widget declares what it
 * can usefully do with extra room (`WidgetSizeCapability`) and this module
 * answers which sizes it may take and what each one spans. Another widget opts
 * in by declaring a capability; it does not need this file changed.
 *
 * A leaf on purpose, like `home-cards.ts` and `automation-cards.ts`:
 * `HomeLayoutData` is declared in two modules that may not import each other,
 * so the stored shape is described here and neither of them owns it.
 *
 * ## Why sizes are stored per home rather than per room context
 *
 * `itemOrder` is per-context, because where a tile sits is a fact about that
 * grid. How big it is is a fact about the *accessory* — a doorbell worth two
 * columns in its room is worth two columns on the dashboard. Keying per
 * context would let the same camera be Large in one place and Regular in
 * another, which reads as a bug rather than a feature.
 */

/** Regular is 1×1 and is what every widget is until someone says otherwise. */
export type WidgetSize = 'regular' | 'large' | 'tall';

/** Columns and rows a size occupies. Regular is the 1×1 the grid already assumes. */
export interface WidgetSpan {
  columns: number;
  rows: number;
}

const SPANS: Record<WidgetSize, WidgetSpan> = {
  regular: { columns: 1, rows: 1 },
  large: { columns: 2, rows: 2 },
  tall: { columns: 1, rows: 2 },
};

export const WIDGET_SIZE_LABELS: Record<WidgetSize, string> = {
  regular: 'Regular',
  large: 'Large',
  tall: 'Tall',
};

export function widgetSpan(size: WidgetSize): WidgetSpan {
  return SPANS[size];
}

/**
 * What a widget can do with more room.
 *
 * Both default to false, so a widget that says nothing stays 1×1 and the
 * control is not offered on it at all. That is the deliberate half of
 * "generic": the storage and the catalog are general, but a widget only grows
 * once someone has decided what it shows in the extra space. A lock at 2×2 is
 * a lock with a lot of empty glass.
 */
export interface WidgetSizeCapability {
  /** Can fill a 2×2 cell — something worth seeing bigger. */
  large?: boolean;
  /** Can fill a 1×2 cell — content that is taller than it is wide. */
  tall?: boolean;
}

/**
 * The sizes this widget may be set to, in menu order.
 *
 * Always includes `regular`, so there is always a way back. A widget with no
 * capability gets `['regular']` alone, which is the signal to callers that
 * there is no choice to offer — see `offersWidgetSizeChoice`.
 */
export function availableWidgetSizes(capability: WidgetSizeCapability | undefined): WidgetSize[] {
  const sizes: WidgetSize[] = ['regular'];
  if (capability?.large) sizes.push('large');
  if (capability?.tall) sizes.push('tall');
  return sizes;
}

/** Is there more than one size to pick from? The gate for showing the control. */
export function offersWidgetSizeChoice(capability: WidgetSizeCapability | undefined): boolean {
  return availableWidgetSizes(capability).length > 1;
}

/**
 * A camera's capability, derived from the snapshot it actually returned.
 *
 * Deliberately not configuration. `CameraSnapshotResult` already carries
 * `width`/`height` and `CameraTilePreview` already reads them to pick its
 * crop, so the shape of the picture is known at render time for every camera —
 * including ones added later, with nothing to set up.
 *
 * Large is offered as soon as there is a picture at all. Tall is offered only
 * for a portrait picture, because a 1×2 cell showing a landscape still would
 * crop away more than the 1×1 it replaced — the opposite of the point.
 *
 * Before the first snapshot arrives there are no dimensions, and the honest
 * answer is Large only: we know it is a camera, we do not yet know its shape.
 */
export function cameraSizeCapability(
  picture: { width?: number | null; height?: number | null } | undefined,
): WidgetSizeCapability {
  const width = picture?.width ?? 0;
  const height = picture?.height ?? 0;
  return { large: true, tall: width > 0 && height > 0 && height > width };
}

/** The stored map: widget key → size. Absent key means `regular`. */
export type WidgetSizeMap = Record<string, WidgetSize>;

function isWidgetSize(value: unknown): value is WidgetSize {
  return value === 'regular' || value === 'large' || value === 'tall';
}

/**
 * The size stored for this key, ignoring whether the widget can currently take
 * it. `regular` for an absent key, and for a value written by a newer build
 * that this one does not understand.
 */
export function storedWidgetSize(sizes: WidgetSizeMap | undefined, key: string): WidgetSize {
  const stored = sizes?.[key];
  return isWidgetSize(stored) ? stored : 'regular';
}

/**
 * The size to actually render at.
 *
 * A stored size the widget cannot currently take falls back to `regular` — a
 * camera set to Tall that starts reporting landscape, or a key whose widget
 * changed type. It is **not** pruned from storage, for the reason
 * `automation-cards.ts` writes down about unresolved keys: the capability is
 * derived from live data that may simply not have arrived yet, so a snapshot
 * that has not loaded would otherwise silently erase the user's choice. Render
 * small, remember the preference, restore it when the picture comes back.
 */
export function resolveWidgetSize(
  sizes: WidgetSizeMap | undefined,
  key: string,
  capability: WidgetSizeCapability | undefined,
): WidgetSize {
  const stored = storedWidgetSize(sizes, key);
  if (stored === 'regular') return 'regular';
  return availableWidgetSizes(capability).includes(stored) ? stored : 'regular';
}

/**
 * Set one widget's size.
 *
 * Setting `regular` **removes** the key rather than writing the string, so the
 * default stays expressed as absence. That is what lets the field be added with
 * no migration, and it keeps a home that has never used this from carrying a
 * map of every tile saying "normal".
 *
 * Returns `undefined` when nothing is left, so the field disappears from the
 * layout JSON entirely rather than persisting as `{}`.
 */
export function withWidgetSize(
  sizes: WidgetSizeMap | undefined,
  key: string,
  size: WidgetSize,
): WidgetSizeMap | undefined {
  const next: WidgetSizeMap = { ...(sizes ?? {}) };
  if (size === 'regular') delete next[key];
  else next[key] = size;
  return Object.keys(next).length > 0 ? next : undefined;
}

/**
 * The grid placement for a size, or `undefined` for `regular` — which must stay
 * undefined rather than `span 1`, so a grid with no resized tile in it renders
 * byte-identically to how it did before this feature existed.
 *
 * **The span and the stretch are only half of it.** Both dashboard grids size
 * their rows from content and are `items-start`, so this alone gives a tile that
 * claims a 2×2 area and keeps its old height inside it. The grid must also be
 * given an explicit row track — see `gridRowUnitStyle` — and the two go
 * together: neither does the job without the other.
 *
 * This replaced a fixed `aspect-ratio`, which was wrong in a way worth
 * recording because it *looked* right. 16/9 of a 358px phone column is 201px
 * and two rows plus the gap is 202px, so it matched at the one width it was
 * checked at; on a 648px desktop span the same ratio is 364px against two rows
 * of 288px. A tile that is "twice the height of the other widgets" has to be
 * defined in terms of the other widgets, not in terms of its own width.
 */
export function widgetSizeStyle(size: WidgetSize): {
  gridColumn: string;
  gridRow: string;
  alignSelf: 'stretch';
} | undefined {
  if (size === 'regular') return undefined;
  const span = widgetSpan(size);
  return {
    gridColumn: `span ${span.columns}`,
    gridRow: `span ${span.rows}`,
    alignSelf: 'stretch',
  };
}

/**
 * The explicit row track a grid needs before a spanning tile can have a height.
 *
 * `rowUnit` is the measured height of an ordinary tile in that grid (see
 * `useGridRowUnit`). With it, a 2-row span works out to exactly `2 × unit + gap`
 * — which is the definition of "twice the height of the other widgets", at any
 * column width, in compact mode or not.
 *
 * `undefined` when there is no sized tile in the grid, or nothing to measure.
 * Both mean *do not touch this grid*: setting a row track changes how every
 * tile in it is laid out, and a grid with nothing resized has no reason to pay
 * that. Returning undefined rather than a no-op value keeps the untouched case
 * on exactly the code path it was on before.
 */
export function gridRowUnitStyle(
  hasSizedWidget: boolean,
  rowUnit: number | null,
): { gridAutoRows: string } | undefined {
  if (!hasSizedWidget || !rowUnit || rowUnit <= 0) return undefined;
  return { gridAutoRows: `${rowUnit}px` };
}

/**
 * Does this grid contain anything that is not 1×1?
 *
 * The gate for the row track above. Asked rather than assumed so a home that has
 * never resized a tile is on exactly the code path it was on before.
 */
export function gridHasSizedWidget(sizes: WidgetSizeMap | undefined, keys: string[]): boolean {
  if (!sizes) return false;
  return keys.some(key => storedWidgetSize(sizes, key) !== 'regular');
}
