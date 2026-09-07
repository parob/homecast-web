import React from 'react';
import { Eye, EyeOff, X } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * The little circular affordance that edit mode puts on a tile, a sidebar row or
 * a pinned tab: hide it, unhide it, or take it off the bar.
 *
 * One component rather than three inline buttons because two details are easy to
 * get wrong and expensive to debug, and both have already bitten this codebase:
 *
 * 1. **It must swallow the press.** Everything it sits on is itself clickable —
 *    a sidebar row navigates (`SortableRoomItem`'s `onClick={onSelect}`), a
 *    compact tile expands (`handleWidgetClick`). Stopping `click` alone is not
 *    enough: the tile's press animation and the sheet's dismissal both run off
 *    `pointerdown`, so that has to be stopped too.
 * 2. **It must live outside the drag handle.** dnd-kit's `listeners` start a drag
 *    on pointerdown; a badge rendered inside the element carrying them turns
 *    every tap into a 250ms long-press race. Callers render this as a *sibling*
 *    of the handle, absolutely positioned over it.
 */
export type EditBadgeKind = 'hide' | 'unhide' | 'remove';

const ICONS: Record<EditBadgeKind, React.ComponentType<{ className?: string }>> = {
  hide: EyeOff,
  unhide: Eye,
  remove: X,
};

const DEFAULT_LABELS: Record<EditBadgeKind, string> = {
  hide: 'Hide',
  unhide: 'Unhide',
  remove: 'Remove',
};

export interface EditBadgeProps {
  kind: EditBadgeKind;
  onClick: () => void;
  /** Accessible name. Worth passing — "Hide" alone is ambiguous in a grid. */
  label?: string;
  className?: string;
}

export const EditBadge: React.FC<EditBadgeProps> = ({
  kind,
  onClick,
  label,
  className,
}) => {
  const Icon = ICONS[kind];
  const swallow = (e: React.SyntheticEvent) => {
    e.stopPropagation();
    e.preventDefault();
  };

  return (
    <button
      type="button"
      aria-label={label || DEFAULT_LABELS[kind]}
      data-edit-badge={kind}
      onPointerDown={swallow}
      onMouseDown={swallow}
      onTouchStart={swallow}
      onClick={(e) => {
        swallow(e);
        onClick();
      }}
      className={cn(
        'z-30 flex items-center justify-center rounded-full shadow-md',
        'bg-zinc-700 text-white active:bg-zinc-600 hover:bg-zinc-600',
        'transition-colors duration-fast',
        // One size. There was an `h-4` `sm` for the tab bar and an `h-6`
        // default for everyone else, and the tab bar is the only caller left —
        // so `sm` was simply the size, and the "default" was nobody's.
        //
        // `h-5`, between the two. Against the fixed 20px root (lib/text-scale.ts)
        // that renders 25px, where `sm` rendered 20px — the size the report
        // called too small, and the one thing Edit Layout puts on a thing that
        // was smaller than all the others (see EditActions and its size test).
        //
        // Not the old `h-6` either, which is why this is a third value rather
        // than a deletion: a tab is ~63px wide on a full bar and carries a 25px
        // glyph up the middle, and at 30px the badge covered enough of it that
        // you could no longer tell a bedroom from a kitchen while arranging —
        // which is the one thing the bar is for in that mode.
        'h-5 w-5',
        className,
      )}
    >
      <Icon className="h-3 w-3" />
    </button>
  );
};
