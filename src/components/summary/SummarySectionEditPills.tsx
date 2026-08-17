import { Eye, EyeOff } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  SUMMARY_SECTION_ORDER,
  SUMMARY_SECTION_META,
  isSummarySectionVisible,
  type SummarySectionId,
} from '@/lib/summary-sections';
import type { HomeLayoutData } from '@/hooks/useEntityLayout';

/**
 * The summary row while Edit Layout is running.
 *
 * A deliberate stand-in for the four live pills rather than a flag threaded
 * through them, for two reasons:
 *
 * 1. **It has to show the hidden ones.** A hidden section does not render its
 *    pill at all, so a pill that could only hide would be a one-way door — the
 *    way back would be Settings. Editing reveals hidden things everywhere else;
 *    this keeps that promise. The live pills also each hide themselves when they
 *    have nothing to show (no scenes, no actions), which is right for normal use
 *    and wrong here: you cannot turn a section back on that refuses to draw.
 * 2. **It is inert.** These do not open anything. Expanding a section while
 *    arranging the row above it is the same mis-grab problem as a tile toggling
 *    a light, and the four live pills are mutually exclusive — opening one
 *    closes the others, which is a lot of movement under a thumb aiming at a
 *    small target.
 *
 * Each pill carries its own state: solid and legible when the section is on,
 * dimmed with an eye when it is off.
 */
export function SummarySectionEditPills({ layout, isDarkBackground, onToggle }: {
  layout: HomeLayoutData | null | undefined;
  isDarkBackground?: boolean;
  onToggle: (id: SummarySectionId, visible: boolean) => void;
}) {
  return (
    <>
      {SUMMARY_SECTION_ORDER.map((id) => {
        const visible = isSummarySectionVisible(layout, id);
        const label = SUMMARY_SECTION_META[id].label;
        return (
          <button
            key={id}
            type="button"
            aria-pressed={visible}
            aria-label={`${visible ? 'Hide' : 'Show'} ${label}`}
            onClick={() => onToggle(id, !visible)}
            // Roomier than the live pill: it has a second thing in it now, and
            // the live one is already only 20px tall.
            className={cn(
              'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1.5 text-xs font-medium transition-colors',
              isDarkBackground
                ? visible
                  ? 'bg-white/25 text-white'
                  : 'bg-black/25 text-white/40'
                : visible
                  ? 'bg-primary/15 text-primary'
                  : 'bg-muted text-muted-foreground/50',
            )}
          >
            <span>{label}</span>
            {visible
              ? <EyeOff className="h-3.5 w-3.5 shrink-0" />
              : <Eye className="h-3.5 w-3.5 shrink-0" />}
          </button>
        );
      })}
    </>
  );
}
