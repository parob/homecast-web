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
  /** Smaller variant for the tab bar, where the target is only 44px wide. */
  size?: 'default' | 'sm';
}

export const EditBadge: React.FC<EditBadgeProps> = ({
  kind,
  onClick,
  label,
  className,
  size = 'default',
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
        size === 'sm' ? 'h-4 w-4' : 'h-6 w-6',
        className,
      )}
    >
      <Icon className={size === 'sm' ? 'h-2.5 w-2.5' : 'h-3.5 w-3.5'} />
    </button>
  );
};
