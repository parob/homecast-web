import React from 'react';
import { Eye, EyeOff, Pin, PinOff, Trash2 } from 'lucide-react';
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
  icon: React.ComponentType<{ className?: string }>;
  /** What the button reads. Rows get a shorter one — see `pinButton`. */
  label: string;
  /** The full phrasing, when the visible label had to be abbreviated to fit. */
  ariaLabel?: string;
  onClick: () => void;
  disabled?: boolean;
  /** `tile` sits over a widget; `row` is the shorter one for a sidebar line. */
  size?: 'tile' | 'row';
}

function EditActionButton({ icon: Icon, label, ariaLabel, onClick, disabled, size = 'tile' }: ActionButtonProps) {
  const swallow = (e: React.SyntheticEvent) => { e.stopPropagation(); e.preventDefault(); };
  return (
    <button
      type="button"
      aria-label={ariaLabel ?? label}
      disabled={disabled}
      onPointerDown={swallow}
      onMouseDown={swallow}
      onTouchStart={swallow}
      onClick={(e) => { swallow(e); if (!disabled) onClick(); }}
      className={cn(
        'pointer-events-auto flex items-center gap-1.5 rounded-full bg-zinc-800/95 font-semibold text-white shadow-lg',
        'transition-colors duration-fast hover:bg-zinc-700 active:bg-zinc-700',
        'disabled:opacity-50 disabled:hover:bg-zinc-800/95',
        size === 'tile' ? 'px-3 py-1.5 text-xs' : 'px-2 py-0.5 text-[11px]',
      )}
    >
      <Icon className={size === 'tile' ? 'h-3.5 w-3.5' : 'h-3 w-3'} />
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
      <EditActionButton
        icon={Trash2}
        label={size === 'row' ? 'Remove' : action.label}
        ariaLabel={action.label}
        onClick={action.onRemove}
        size={size}
      />
    );
  }
  return (
    <EditActionButton
      icon={action.isHidden ? Eye : EyeOff}
      label={action.isHidden ? 'Unhide' : 'Hide'}
      ariaLabel={`${action.isHidden ? 'Unhide' : 'Hide'} ${action.name}`}
      onClick={action.onToggle}
      size={size}
    />
  );
}

function pinButton(pin: ReturnType<typeof usePinAction>, size: 'tile' | 'row') {
  if (!pin) return null;
  // A sidebar row has a name to fit as well; "Pin to Tab Bar" beside "Hide"
  // leaves it nothing to truncate into. The icon and the full accessible name
  // carry the meaning the shortened label drops.
  const short = pin.pinned ? 'Unpin' : pin.full ? 'Full' : 'Pin';
  return (
    <EditActionButton
      icon={pin.pinned ? PinOff : Pin}
      label={size === 'row' ? short : pin.label}
      ariaLabel={pin.label}
      onClick={pin.toggle}
      disabled={pin.full}
      size={size}
    />
  );
}

/**
 * Centred over a widget: the primary action, and the pin below it.
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
    <div className="absolute inset-0 z-30 flex flex-col items-center justify-center gap-1.5 pointer-events-none">
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
    <div className="absolute right-1.5 top-1/2 z-30 flex -translate-y-1/2 items-center gap-1">
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
