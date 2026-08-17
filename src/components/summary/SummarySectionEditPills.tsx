import { ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { EditActionButton } from '@/components/shared/EditActions';
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
 * A stand-in for the four live pills rather than a flag threaded through them,
 * because it has to do one thing they cannot: offer a *hidden* section back. A
 * hidden section renders no pill at all, and the live pills also hide themselves
 * when they have nothing to show — no scenes, no actions. Both are right in
 * normal use and both are a one-way door in an editor, where the way back would
 * otherwise be Settings.
 *
 * Each pill keeps its normal job. The label still opens and closes the section —
 * you are arranging the row, not frozen out of it — and a separate eye beside it
 * turns the section off. Two targets in one pill, which is why it is taller here
 * than the 20px live one.
 *
 * A hidden section's pill is the exception: there is nothing to open, since the
 * section itself does not render while hidden, so the whole pill turns it back on.
 */
/**
 * One shell for both states, so a pill does not change size as you hide and show
 * it. The padding lives here rather than on whatever each variant happens to put
 * inside — that is what made the hidden one 8px taller, and a row that jumps
 * under your thumb as you use it is the wrong thing to have built.
 */
const SHELL = 'inline-flex items-center gap-1.5 rounded-full py-1 pl-2.5 pr-1 text-xs font-medium transition-colors';

export function SummarySectionEditPills({
  layout, isDarkBackground, openSection, onToggleOpen, onToggleHidden,
}: {
  layout: HomeLayoutData | null | undefined;
  isDarkBackground?: boolean;
  /** Which section is expanded. The four are mutually exclusive. */
  openSection: SummarySectionId | null;
  onToggleOpen: (id: SummarySectionId) => void;
  onToggleHidden: (id: SummarySectionId, visible: boolean) => void;
}) {
  return (
    <>
      {SUMMARY_SECTION_ORDER.map((id) => {
        const label = SUMMARY_SECTION_META[id].label;
        const visible = isSummarySectionVisible(layout, id);
        const open = openSection === id;

        if (!visible) {
          return (
            <span
              key={id}
              className={cn(SHELL,
                isDarkBackground ? 'bg-black/25 text-white/40' : 'bg-muted text-muted-foreground/50',
              )}
            >
              <span>{label}</span>
              <EditActionButton
                size="row"
                label="Unhide"
                ariaLabel={`Unhide ${label}`}
                onClick={() => onToggleHidden(id, true)}
              />
            </span>
          );
        }

        return (
          <span
            key={id}
            className={cn(SHELL,
              isDarkBackground
                ? (open ? 'bg-white/25 text-white' : 'bg-black/25 text-white/90')
                : (open ? 'bg-primary/15 text-primary' : 'bg-muted text-muted-foreground'),
            )}
          >
            {/* self-stretch so the label's target still covers the pill's full
                height — the padding lives on the shell now, not in here. */}
            <button
              type="button"
              aria-expanded={open}
              onClick={() => onToggleOpen(id)}
              className="inline-flex items-center gap-1.5 self-stretch"
            >
              <span>{label}</span>
              <ChevronRight className={cn('h-3 w-3 transition-transform', open && 'rotate-90')} />
            </button>
            <EditActionButton
              size="row"
              label="Hide"
              ariaLabel={`Hide ${label}`}
              onClick={() => onToggleHidden(id, false)}
            />
          </span>
        );
      })}
    </>
  );
}
