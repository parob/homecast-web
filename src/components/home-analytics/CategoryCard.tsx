import { ChevronRight } from 'lucide-react';
import Sparkline from './Sparkline';
import { CATEGORY_ICONS } from './categoryIcons';
import type { CategoryId } from '@/history/categories';

/**
 * One compact overview card: a semantically-chosen headline (average home
 * temperature, lowest battery — never "the first series that happened to
 * sort first"), one line of context, and a trend where a trend means
 * something. The noisy "N series · N rooms · N monitoring" footprint rows
 * are gone — counts are inventory, not information.
 */
export default function CategoryCard({
  category,
  title,
  headline,
  headlineSuffix,
  sub,
  spark,
  onOpen,
}: {
  category: CategoryId;
  title: string;
  /** The number ("21.4°", "132"). */
  headline: string;
  /** Small text after the number ("events today"). */
  headlineSuffix?: string;
  /** One line of context ("warmest: Bedroom 2 · coldest: Kitchen"). */
  sub?: string;
  /** Trend values for the SAME metric as the headline. */
  spark?: number[];
  onOpen: () => void;
}) {
  const Icon = CATEGORY_ICONS[category];
  return (
    <button
      className="text-left border rounded-xl p-4 hover:bg-muted/50 transition-colors flex flex-col gap-2 group"
      onClick={onOpen}
    >
      <div className="flex items-center gap-2">
        <span className="h-7 w-7 rounded-lg bg-muted flex items-center justify-center shrink-0">
          <Icon className="h-4 w-4 text-muted-foreground" />
        </span>
        <span className="text-sm font-medium flex-1 truncate">{title}</span>
        <ChevronRight className="h-4 w-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
      </div>

      <p className="text-lg font-semibold tabular-nums leading-none">
        {headline}
        {headlineSuffix && (
          <span className="text-xs font-normal text-muted-foreground ml-1">{headlineSuffix}</span>
        )}
      </p>

      {spark && spark.length > 1 ? (
        <Sparkline values={spark} height={28} />
      ) : (
        <div style={{ height: 4 }} />
      )}

      {sub && <p className="text-[11px] text-muted-foreground">{sub}</p>}
    </button>
  );
}
