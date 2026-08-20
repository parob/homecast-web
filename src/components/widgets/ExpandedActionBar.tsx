import { LineChart, Pencil, Pin, PinOff, Share2, Tag } from 'lucide-react';

/**
 * The action row in an expanded widget panel: small round icon buttons in
 * the corner — analytics, prices, edit, share, pin — rather than a full-width bar
 * or a header icon.
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
  icon: 'analytics' | 'prices' | 'edit' | 'share' | 'pin' | 'unpin';
  label: string;
  onClick: () => void;
}

// `prices` takes the same Tag as the context menu's Price & Deals item — the
// cluster and the menu offer the same actions and should be recognisable as
// each other.
// `pin`/`unpin` moved here when touch lost its context menus: pinning to the tab
// bar was a menu item, and Edit Layout's badge is the only other route. The
// expanded panel is where a person is already studying the accessory, so it is
// where the rest of the menu's actions went too.
const ICONS = {
  analytics: LineChart,
  prices: Tag,
  edit: Pencil,
  share: Share2,
  pin: Pin,
  unpin: PinOff,
} as const;

export default function ExpandedActionBar({
  actions,
  onDark,
}: {
  actions: ExpandedAction[];
  onDark: boolean;
}) {
  if (actions.length === 0) return null;
  // Glass, not a grey disc: the tile is a translucent panel, and a flat
  // black-alpha circle on it read as a dead placeholder rather than a
  // control. A light fill plus a hairline ring sits on the surface.
  const tone = onDark
    ? 'bg-white/15 hover:bg-white/25 text-white ring-white/15'
    : 'bg-white/55 hover:bg-white/80 text-slate-900/80 hover:text-slate-900 ring-black/[0.06]';

  return (
    <div className="mt-3 flex items-center justify-end gap-1.5">
      {actions.map(action => {
        const Icon = ICONS[action.icon];
        return (
          <button
            key={action.key}
            className={`h-7 w-7 rounded-full flex items-center justify-center ring-1 shadow-sm backdrop-blur-sm transition-colors ${tone}`}
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
