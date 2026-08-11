import { LineChart } from 'lucide-react';

/**
 * The analytics affordance inside an expanded widget panel: a full-width
 * footer button, never a header icon.
 *
 * A header icon competed with the widget's own control (a switch, a dial)
 * for the same top-right slot — on some widgets it read as having replaced
 * the control, and on the group panel there was no header slot at all. A
 * footer bar is unambiguous, appears in the same place on every panel type,
 * and carries its own contrast instead of borrowing muted-foreground on a
 * translucent material.
 */
export default function ExpandedAnalyticsBar({ onClick }: { onClick: () => void }) {
  return (
    <button
      className="mt-3 w-full flex items-center justify-center gap-1.5 rounded-lg py-2
                 text-xs font-medium bg-foreground/[0.07] hover:bg-foreground/[0.12]
                 text-foreground/80 hover:text-foreground transition-colors"
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <LineChart className="h-3.5 w-3.5" />
      Analytics
    </button>
  );
}
