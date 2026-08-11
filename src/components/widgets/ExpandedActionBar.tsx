import { LineChart, Pencil, Share2 } from 'lucide-react';

/**
 * The action row in an expanded widget panel: small round icon buttons in
 * the corner — analytics, edit, share — rather than a full-width bar or a
 * header icon.
 *
 * A header icon competed with the widget's own control for the top-right
 * slot; a full-width bar shouted louder than the controls above it. A
 * corner cluster reads as "things you can do with this accessory", which is
 * also where the actions that were context-menu-only belong.
 *
 * Colour comes from `onDark`, which callers derive the way WidgetWrapper
 * does: white only when the tile is OFF over a dark wallpaper. An ON tile
 * takes a pale accent fill and needs dark ink — using isDarkBackground
 * alone drew white icons on pale yellow.
 */
export interface ExpandedAction {
  key: string;
  icon: 'analytics' | 'edit' | 'share';
  label: string;
  onClick: () => void;
}

const ICONS = {
  analytics: LineChart,
  edit: Pencil,
  share: Share2,
} as const;

export default function ExpandedActionBar({
  actions,
  onDark,
}: {
  actions: ExpandedAction[];
  onDark: boolean;
}) {
  if (actions.length === 0) return null;
  const tone = onDark
    ? 'bg-white/15 hover:bg-white/25 text-white'
    : 'bg-black/10 hover:bg-black/20 text-slate-900';

  return (
    <div className="mt-3 flex items-center justify-end gap-1.5">
      {actions.map(action => {
        const Icon = ICONS[action.icon];
        return (
          <button
            key={action.key}
            className={`h-8 w-8 rounded-full flex items-center justify-center transition-colors ${tone}`}
            onClick={(e) => { e.stopPropagation(); action.onClick(); }}
            onPointerDown={(e) => e.stopPropagation()}
            aria-label={action.label}
            title={action.label}
          >
            <Icon className="h-3.5 w-3.5" />
          </button>
        );
      })}
    </div>
  );
}
