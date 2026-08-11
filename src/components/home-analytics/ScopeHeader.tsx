import { ArrowLeft, ChevronRight } from 'lucide-react';
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
  onBack,
  crumbs,
  settings,
  onSettings,
  onSelect,
}: {
  /** The screen's name, leading the row. */
  title?: string;
  /** A back arrow before the title, where the host has somewhere to go back to. */
  onBack?: () => void;
  crumbs: Array<{ label: string; scope: AnalyticsScope }>;
  settings: AnalyticsSettings;
  onSettings: (next: Partial<AnalyticsSettings>) => void;
  onSelect: (scope: AnalyticsScope) => void;
}) {
  return (
    // Sized and padded to line up with the dialog's ✕, which floats over this
    // row's top right corner rather than sitting in it. That button is 32px
    // tall at top-[16px], so its centre is 32px down; the dialog opens its
    // body at pt-3, so a 40px row centres its contents on exactly that line.
    // pr-9 keeps the range control out from under it.
    <div className="flex min-h-10 flex-wrap items-center gap-x-3 gap-y-2 border-b pr-9">
      <nav className="flex min-w-0 flex-1 items-center gap-1 text-sm">
        {onBack && (
          <button
            className="-ml-1 shrink-0 rounded p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            onClick={onBack}
            aria-label="Back"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
        )}
        {title && <span className="shrink-0 text-base font-semibold">{title}</span>}
        {crumbs.map((crumb, i) => {
          const last = i === crumbs.length - 1;
          return (
            <span key={`${crumb.label}-${i}`} className="flex min-w-0 items-center gap-0.5">
              {(i > 0 || title) && <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
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

      <div className="inline-flex shrink-0 items-center rounded-lg bg-muted p-0.5">
        {RANGES.map(r => (
          <button
            key={r.label}
            onClick={() => onSettings({ rangeMs: r.ms })}
            className={`rounded-md px-2.5 py-1 text-[11px] transition-colors ${
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
  );
}
