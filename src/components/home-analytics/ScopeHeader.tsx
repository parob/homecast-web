import { ChevronRight } from 'lucide-react';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { RANGES, type AnalyticsScope, type AnalyticsSettings, type CompareMode } from './scope';

const COMPARE_OPTIONS: Array<{ value: CompareMode; label: string }> = [
  { value: 'none', label: 'No comparison' },
  { value: 'day', label: 'Previous day' },
  { value: 'week', label: 'Previous week' },
];

/**
 * Where you are and how you are looking at it — once, above everything.
 *
 * Range and comparison used to be re-declared by each view, so
 * moving from a category to a room quietly reset 7d back to 24h. They belong
 * to the session, not the screen. The breadcrumb is the way back up: every
 * step is a scope you can click, which is also how an accessory reaches its
 * own room without going through a category first.
 */
export default function ScopeHeader({
  crumbs,
  settings,
  onSettings,
  onSelect,
}: {
  crumbs: Array<{ label: string; scope: AnalyticsScope }>;
  settings: AnalyticsSettings;
  onSettings: (next: Partial<AnalyticsSettings>) => void;
  onSelect: (scope: AnalyticsScope) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 border-b pb-2">
      <nav className="flex min-w-0 flex-1 items-center gap-0.5 text-sm">
        {crumbs.map((crumb, i) => {
          const last = i === crumbs.length - 1;
          return (
            <span key={`${crumb.label}-${i}`} className="flex min-w-0 items-center gap-0.5">
              {i > 0 && <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
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

      <div className="inline-flex items-center rounded-lg bg-muted p-0.5">
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

      <Select value={settings.compare} onValueChange={(v) => onSettings({ compare: v as CompareMode })}>
        <SelectTrigger className="h-7 w-[150px] text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {COMPARE_OPTIONS.map(c => (
            <SelectItem key={c.value} value={c.value} className="text-xs">{c.label}</SelectItem>
          ))}
        </SelectContent>
      </Select>

    </div>
  );
}
