import { ChevronRight, Menu, X } from 'lucide-react';
import { RANGES, type AnalyticsScope, type AnalyticsSettings } from './scope';

/**
 * The one bar: what this screen is, where you are in it, and how far back you
 * are looking — all on a single line.
 *
 * It used to be two, the host's title bar and then, below a gap, the
 * breadcrumb and the range. That spent a strip of a chart screen restating a
 * word that never changes. The title now leads the same row the breadcrumb
 * walks along, one size up so it reads as the screen's name rather than as
 * the first step of the trail.
 *
 * The range belongs to the session, not the view: picking 7d and then opening
 * a room used to drop you back to 24h, because each view owned its own copy.
 * The breadcrumb is the way back up — every step is a scope you can click,
 * which is also how an accessory reaches its own room.
 */
export default function ScopeHeader({
  title,
  onOpenNav,
  onClose,
  crumbs,
  settings,
  onSettings,
  onSelect,
}: {
  /** The screen's name, leading the row. */
  title?: string;
  /** Opens the tree on a phone, where it cannot be a permanent column. */
  onOpenNav?: () => void;
  /** Closes the host dialog. Ours rather than the dialog's own, so it sits
   *  inside the safe area with everything else instead of over the notch. */
  onClose?: () => void;
  crumbs: Array<{ label: string; scope: AnalyticsScope }>;
  settings: AnalyticsSettings;
  onSettings: (next: Partial<AnalyticsSettings>) => void;
  onSelect: (scope: AnalyticsScope) => void;
}) {
  return (
    // 56px and centred: the text gets equal air above and below rather than
    // sitting tight against the rule, and everything in the row — burger,
    // title, breadcrumb, range, close — shares one centre line. The close is
    // OURS rather than the dialog's, so it lives inside the safe area with
    // the rest instead of floating at the window's true top corner, over the
    // notch on a phone.
    <div className="flex min-h-14 flex-wrap items-center gap-x-3 gap-y-2">
      {/* On a phone the row cannot hold a title, a trail, five range buttons
          and a close: the trail lost, which is the one part that says where
          you are. The title goes (the screen is obviously analytics) and the
          range drops to its own line, leaving the breadcrumb the width. */}
      <nav className="order-1 flex min-w-0 flex-1 items-center gap-1 text-sm leading-6">
        {onOpenNav && (
          // The tree is the only way DOWN — the breadcrumb only walks up — so
          // hiding it on a phone left no way into a room at all.
          <button
            className="-ml-1 shrink-0 rounded p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground md:hidden"
            onClick={onOpenNav}
            aria-label="Open navigation"
          >
            <Menu className="h-5 w-5" />
          </button>
        )}
        {title && <span className="hidden shrink-0 text-base font-semibold leading-6 sm:inline">{title}</span>}
        {crumbs.map((crumb, i) => {
          const last = i === crumbs.length - 1;
          return (
            <span key={`${crumb.label}-${i}`} className="flex min-w-0 items-center gap-0.5">
              {(i > 0 || title) && (
                // The title is hidden by CSS below sm, so the chevron that
                // separates it from the first crumb has to hide the same way
                // — otherwise a phone opens on a separator with nothing on
                // its left.
                <ChevronRight
                  className={`h-3.5 w-3.5 shrink-0 text-muted-foreground ${
                    i === 0 && title ? 'hidden sm:block' : ''
                  }`}
                />
              )}
              {last ? (
                <span className="truncate font-medium">{crumb.label}</span>
              ) : (
                <button
                  className="truncate text-muted-foreground transition-colors hover:text-foreground"
                  onClick={() => onSelect(crumb.scope)}
                >
                  {crumb.label}
                </button>
              )}
            </span>
          );
        })}
      </nav>

      <div className="order-3 flex basis-full justify-end sm:order-2 sm:basis-auto">
        <div className="inline-flex items-center rounded-lg bg-muted p-0.5">
        {RANGES.map(r => (
          <button
            key={r.label}
            onClick={() => onSettings({ rangeMs: r.ms })}
            className={`rounded-md px-2.5 py-1 text-[0.6875rem] transition-colors ${
              settings.rangeMs === r.ms
                ? 'bg-background font-medium text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {r.label}
          </button>
        ))}
        </div>
      </div>

      {onClose && (
        <button
          className="order-2 -mr-1 shrink-0 rounded-full p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground sm:order-3"
          onClick={onClose}
          aria-label="Close"
        >
          <X className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}
