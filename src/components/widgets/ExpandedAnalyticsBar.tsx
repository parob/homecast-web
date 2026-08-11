import { LineChart } from 'lucide-react';
import { useBackgroundContext } from '@/contexts/BackgroundContext';

/**
 * The analytics affordance inside an expanded widget panel: a full-width
 * footer button, never a header icon.
 *
 * A header icon competed with the widget's own control (a switch, a dial)
 * for the same top-right slot — on some widgets it read as having replaced
 * the control, and on the group panel there was no header slot at all. A
 * footer bar is unambiguous and appears in the same place on every panel.
 *
 * Its colour comes from isDarkBackground, never from the theme foreground:
 * the panel is dark whenever the wallpaper behind it is, and `foreground`
 * stays dark in light mode — which is what drew this black-on-dark.
 */
export default function ExpandedAnalyticsBar({ onClick }: { onClick: () => void }) {
  const { isDarkBackground } = useBackgroundContext();
  return (
    <button
      className={`mt-3 w-full flex items-center justify-center gap-1.5 rounded-lg py-2 text-xs font-medium transition-colors ${
        isDarkBackground
          ? 'bg-white/15 hover:bg-white/25 text-white'
          : 'bg-black/10 hover:bg-black/20 text-slate-900'
      }`}
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <LineChart className="h-3.5 w-3.5" />
      Analytics
    </button>
  );
}
