import {
  Activity as ActivityIcon,
  AlertTriangle,
  BatteryLow,
  ChevronRight,
  Flame,
  Snowflake,
  Timer,
  TrendingDown,
  TrendingUp,
  Wind,
} from 'lucide-react';
import type { Insight, InsightIcon } from '@/history/insights';

const ICONS: Record<InsightIcon, React.ComponentType<{ className?: string }>> = {
  warm: Flame,
  cold: Snowflake,
  'trend-up': TrendingUp,
  'trend-down': TrendingDown,
  battery: BatteryLow,
  activity: ActivityIcon,
  air: Wind,
  alert: AlertTriangle,
  usage: Timer,
};

/**
 * The overview's opening move: sentences, not series. Each card is one
 * computed fact with a link to the chart that explains it — the difference
 * between analytics and a data dump.
 */
export default function HighlightsStrip({
  insights,
  loading,
  onOpen,
}: {
  insights: Insight[];
  loading: boolean;
  onOpen: (insight: Insight) => void;
}) {
  if (loading && insights.length === 0) {
    return (
      <div className="space-y-2">
        <p className="text-[0.625rem] font-semibold uppercase tracking-wider text-muted-foreground">Highlights</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {[0, 1].map(i => (
            <div key={i} className="h-14 rounded-xl border bg-muted/30 animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  if (insights.length === 0) {
    return (
      <div className="space-y-2">
        <p className="text-[0.625rem] font-semibold uppercase tracking-wider text-muted-foreground">Highlights</p>
        <p className="text-xs text-muted-foreground border rounded-xl px-4 py-3">
          All quiet — nothing unusual in today's data.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <p className="text-[0.625rem] font-semibold uppercase tracking-wider text-muted-foreground">Highlights</p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {insights.map(insight => {
          const Icon = ICONS[insight.icon];
          const alert = insight.icon === 'alert';
          return (
            <button
              key={insight.id}
              onClick={() => onOpen(insight)}
              className={`text-left border rounded-xl px-3 py-2.5 flex items-center gap-3 transition-colors group ${
                alert ? 'border-destructive/50 bg-destructive/5 hover:bg-destructive/10' : 'hover:bg-muted/50'
              }`}
            >
              <span className={`h-8 w-8 rounded-lg flex items-center justify-center shrink-0 ${
                alert ? 'bg-destructive/10 text-destructive' : 'bg-muted text-muted-foreground'
              }`}>
                <Icon className="h-4 w-4" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-xs font-medium leading-snug">{insight.text}</span>
                {insight.detail && (
                  <span className="block text-[0.6875rem] text-muted-foreground mt-0.5">{insight.detail}</span>
                )}
              </span>
              <ChevronRight className="h-4 w-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
            </button>
          );
        })}
      </div>
    </div>
  );
}
