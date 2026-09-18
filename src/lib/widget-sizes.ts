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
 * The shape a sized tile holds itself to.
 *
 * **This, not `align-self: stretch`, is what makes the picture bigger**, and
 * the difference is worth writing down because the stretch version looked
 * right and shipped nothing. Both grids size their rows from content. A tile
 * that spans two columns of a two-column phone grid is *alone* in the rows it
 * spans, so there is no other content to size them: the tracks collapse to the
 * tile's own height and stretching it to fill them is a no-op. Measured, not
 * reasoned about — the tile went from 175px wide to 358px and stayed 97px
 * tall, which is a wide tile, not a big picture.
 *
 * An aspect ratio needs no cooperation from the tracks. It also happens to be
 * the honest answer for the widget that asked for this: a tile showing a
 * picture should be the shape of the picture.
 *
 * 16:9 for Large because that is what a landscape camera sends, and a 2×2 cell
 * at that ratio shows it nearly uncropped — which is the entire reason to
 * spend four cells on it. 3:4 for Tall, which is the portrait case, and comes
 * out close to two stacked rows at every column width we use.
 */
const ASPECT: Record<WidgetSize, string | undefined> = {
  regular: undefined,
  large: '16 / 9',
  tall: '3 / 4',
};

/**
 * The grid placement for a size, or `undefined` for `regular` — which must
 * stay undefined rather than `span 1`, so a grid with no resized tile in it
 * renders byte-identically to how it did before this feature existed.
 *
 * The row span is still emitted even though the aspect ratio is what sets the
 * height: it *reserves* the rows, so the tiles after it flow below rather than
 * being overlapped by a tile that is taller than the single track it was given.
 */
export function widgetSizeStyle(size: WidgetSize): {
  gridColumn: string;
  gridRow: string;
  aspectRatio: string;
} | undefined {
  if (size === 'regular') return undefined;
  const span = widgetSpan(size);
  return {
    gridColumn: `span ${span.columns}`,
    gridRow: `span ${span.rows}`,
    aspectRatio: ASPECT[size]!,
  };
}
