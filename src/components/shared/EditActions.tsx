import React from 'react';
import { cn } from '@/lib/utils';
import { usePinAction } from '@/contexts/PinnedTabsContext';
import type { PinnedTab } from '@/lib/pinned-tabs';

/**
 * The buttons Edit Layout puts on a thing you can arrange.
 *
 * One definition, used by accessory tiles, service-group tiles, sidebar rows and
 * collection rows. It started as three near-identical inline buttons; adding a
 * second action to each would have made six, and they had already begun to drift
 * — one was an icon-only circle, another a labelled pill, for the same job.
 *
 * Two rules every one of these must keep, both learned the hard way:
 *
 * 1. **Swallow the press.** Everything these sit on is itself clickable — a
 *    sidebar row navigates, a compact tile expands. Stopping `click` alone is
 *    not enough: press animations and sheet dismissal run off `pointerdown`.
 * 2. **Live outside the drag handle.** dnd-kit starts a drag on pointerdown, so
 *    a button inside the element carrying its listeners turns every tap into a
 *    250ms long-press race. Callers render these as a *sibling* of the handle.
 */

interface ActionButtonProps {
  /** What the button reads: one word, so two of them fit a compact tile. */
  label: string;
  /** The full phrasing, for screen readers and the tooltip. */
  ariaLabel: string;
  onClick: () => void;
  disabled?: boolean;
  /** `tile` sits over a widget; `row` is the smaller one for a sidebar line. */
  size?: 'tile' | 'row';
}

/**
 * Words, not glyphs.
 *
 * Exported so the summary-row pills use this exact button rather than a lookalike
 * — "the same style as the other hide buttons" is only true if it is the same
 * component.
 *
 * An eye and a pin needed a legend to explain them, which meant looking away
 * from the thing you were acting on to find out what you were about to do. One
 * word each says it outright. They are kept to a single word — "Hide", "Pin" —
 * because a compact tile is about 160px wide and has to hold two of them beside
 * the accessory's icon; the full phrasing survives as the accessible name.
 */
export function EditActionButton({ label, ariaLabel, onClick, disabled, size = 'tile' }: ActionButtonProps) {
  const swallow = (e: React.SyntheticEvent) => { e.stopPropagation(); e.preventDefault(); };
  return (
    <button
      type="button"
      aria-label={ariaLabel}
      title={ariaLabel}
      disabled={disabled}
      onPointerDown={swallow}
      onMouseDown={swallow}
      onTouchStart={swallow}
      onClick={(e) => { swallow(e); if (!disabled) onClick(); }}
      className={cn(
        'pointer-events-auto flex shrink-0 items-center justify-center rounded-full bg-zinc-800/95 font-semibold text-white shadow-lg',
        'transition-colors duration-fast hover:bg-zinc-700 active:bg-zinc-700',
        'disabled:opacity-50 disabled:hover:bg-zinc-800/95',
        size === 'tile' ? 'px-2 py-0.5 text-[10px]' : 'px-1.5 py-0.5 text-[10px]',
      )}
    >
      {label}
    </button>
  );
}

/**
 * What the primary action on a thing actually is.
 *
 * On the dashboard you hide an accessory — it stays in your home, it just stops
 * cluttering the view. In a collection there is nothing to hide: you chose what
 * went in, so the equivalent is taking it back out.
 *
 * Deliberately never wired to a virtual accessory's *delete*. That shares the
 * `onRemove` slot on WidgetCard, and putting an irreversible delete where every
 * other tile has a reversible hide is how someone loses a helper by aiming badly.
 */
export type PrimaryEditAction =
  | { kind: 'hide'; isHidden: boolean; onToggle: () => void; name: string }
  | { kind: 'remove'; label: string; onRemove: () => void }
  | null;

function primaryButton(action: PrimaryEditAction, size: 'tile' | 'row') {
  if (!action) return null;
  if (action.kind === 'remove') {
    return (
      <EditActionButton label="Remove" ariaLabel={action.label} onClick={action.onRemove} size={size} />
    );
  }
  const verb = action.isHidden ? 'Unhide' : 'Hide';
  return (
    <EditActionButton
      label={verb}
      ariaLabel={`${verb} ${action.name}`}
      onClick={action.onToggle}
      size={size}
    />
  );
}

function pinButton(pin: ReturnType<typeof usePinAction>, size: 'tile' | 'row') {
  if (!pin) return null;
  return (
    <EditActionButton
      // Still "Pin" when the bar is full — greyed out, not relabelled. "Full"
      // named the tab bar's problem on a button about this tile, so it read as
      // a state of the accessory. Disabled says the same thing without the
      // riddle, and the accessible name still explains why.
      label={pin.pinned ? 'Unpin' : 'Pin'}
      ariaLabel={pin.label}
      onClick={pin.toggle}
      disabled={pin.full}
      size={size}
    />
  );
}

/**
 * Tucked into the widget's top-right corner.
 *
 * That corner is empty precisely while editing — it holds the accessory's switch
 * the rest of the time, and edit mode takes the switch away. So these cover
 * nothing: the glyph stays top-left, the name and its readout stay below.
 *
 * Rendered by the caller *outside* the Card, so the dimming applied to a hidden
 * tile's content does not also grey out the button that undoes it.
 */
export function TileEditActions({ action, tab }: { action: PrimaryEditAction; tab?: PinnedTab | null }) {
  const pin = usePinAction(tab);
  const primary = primaryButton(action, 'tile');
  const pinned = pinButton(pin, 'tile');
  if (!primary && !pinned) return null;
  return (
    <div className="absolute right-2.5 top-2.5 z-30 flex items-center gap-1 pointer-events-none">
      {primary}
      {pinned}
    </div>
  );
}

/**
 * Trailing edge of a sidebar row: the primary action, and the pin to its right.
 *
 * The caller must add right padding to the row's own content so the name has
 * somewhere to truncate to rather than running underneath these.
 */
export function RowEditActions({ action, tab }: { action: PrimaryEditAction; tab?: PinnedTab | null }) {
  const pin = usePinAction(tab);
  const primary = primaryButton(action, 'row');
  const pinned = pinButton(pin, 'row');
  if (!primary && !pinned) return null;
  return (
    <div className="absolute right-2 top-1/2 z-30 flex -translate-y-1/2 items-center gap-1">
      {primary}
      {pinned}
    </div>
  );
}

/** A hidden thing you have no way to act on still has to say why it is greyed out. */
export function HiddenLabel() {
  return (
    <div className="absolute inset-0 z-20 flex items-center justify-center pointer-events-none">
      <span className="rounded-full bg-zinc-500/90 px-2.5 py-1 text-xs font-medium text-white shadow-sm">
        Hidden
      </span>
    </div>
  );
}
