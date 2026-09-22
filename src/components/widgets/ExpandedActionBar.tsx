import { LineChart, Pencil, Share2, Tag, Trash2 } from 'lucide-react';

/**
 * The action row in an expanded widget panel: small labelled pills in the
 * corner — analytics, prices, edit, share — rather than a full-width bar
 * or a header icon.
 *
 * A header icon competed with the widget's own control for the top-right
 * slot; a full-width bar shouted louder than the controls above it. A
 * corner cluster reads as "things you can do with this accessory", which is
 * also where the actions that were context-menu-only belong.
 *
 * **Words, not glyphs.** These were icon-only circles, and were reported as
 * unreadable in as many words (homecast-cloud#162): "the buttons on the screen
 * are just icons it's not clear enough what they'll do". That is the same
 * finding `EditActions` already acts on for the badge cluster — a symbol makes
 * you look away from the thing you are acting on to find out what you are about
 * to do — so this row now answers the same way, and the two clusters read alike.
 *
 * The word is one word, and the fuller phrasing survives as the accessible name
 * and the tooltip. That is not a style rule, it is the panel's arithmetic: the
 * content box is about 360px on the phone this was reported from, and "Price &
 * Deals" plus "Delete Virtual Accessory" alone would eat it. The row wraps
 * rather than truncating or scrolling, so a virtual accessory carrying all five
 * still shows every word.
 *
 * Colour comes from `onDark`, which callers derive the way WidgetWrapper
 * does: white only when the tile is OFF over a dark wallpaper. An ON tile
 * takes a pale accent fill and needs dark ink — using isDarkBackground
 * alone drew white icons on pale yellow.
 */
export interface ExpandedAction {
  key: string;
  icon: 'analytics' | 'prices' | 'edit' | 'share' | 'delete';
  /** The word on the button. One word, so a row of them fits a phone panel. */
  label: string;
  /**
   * The full phrasing, for a screen reader and the tooltip — "Price & Deals"
   * behind `Prices`, "Delete Virtual Accessory" behind `Delete`. Omit it where
   * the word already says the whole thing.
   */
  ariaLabel?: string;
  onClick: () => void;
}

// `prices` takes the same Tag as the context menu's Price & Deals item — the
// cluster and the menu offer the same actions and should be recognisable as
// each other. The glyphs stay beside the words for that reason: the word says
// what the button does, the icon ties it to the same action somewhere else.
// There is deliberately no `pin`/`unpin` here any more. They came here when
// touch lost its context menus, on the argument that Edit Layout's badge was
// then the only other route — but that badge is a route, and reaching it is one
// hold on the tile. Reported as homecast-cloud#173: "Remove pin from the options
// when you expand any widget ... this should only be accessible in editing mode
// and that's enough". `EditActions`' `pinButton` keeps Pin/Unpin on the tile and
// on a sidebar row, and `MobileTabBar` keeps the ⊗ that unpins a tab; on the
// desktop pinning is not offered at all (`Dashboard`'s `enabled: isPhone`). The
// scene and shortcut cards have pinned from the badge alone since the menus
// went, so this is the panel catching up with them rather than a door closing.
//
// There is deliberately no `size` here any more. It cycled the tile between
// Regular, Large and Tall, and by #197 the same cycle was on Edit Layout's
// badge next to Hide and Pin (`EditActions`' `sizeButton`) and in the desktop
// context menu, which lists all three with the current one ticked. Reported as
// redundant in homecast-cloud#162 — "it's now next to the hide and pin button"
// — and removing it closes no door: both of those routes remain, one per
// platform, which is the rule the Automations grid states.
const ICONS = {
  analytics: LineChart,
  prices: Tag,
  edit: Pencil,
  share: Share2,
  delete: Trash2,
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
    // `flex-wrap` is load-bearing, not defensive: six pills do not fit one
    // phone row, and the alternatives are a truncated word — which is the
    // problem this row was changed to fix — or a sideways scroller inside a
    // panel that already scrolls vertically.
    <div className="mt-3 flex flex-wrap items-center justify-end gap-1.5">
      {actions.map(action => {
        const Icon = ICONS[action.icon];
        const name = action.ariaLabel ?? action.label;
        return (
          <button
            key={action.key}
            // `h-7`, the ring and the glass are the circles' — only the width
            // changed, so the row still sits at the height it did under the
            // controls above it.
            className={`h-7 px-2.5 rounded-full flex items-center gap-1.5 whitespace-nowrap text-xs font-medium leading-none ring-1 shadow-sm backdrop-blur-sm transition-colors ${tone}`}
            onClick={(e) => { e.stopPropagation(); action.onClick(); }}
            onPointerDown={(e) => e.stopPropagation()}
            aria-label={name}
            title={name}
          >
            <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden />
            {action.label}
          </button>
        );
      })}
    </div>
  );
}
