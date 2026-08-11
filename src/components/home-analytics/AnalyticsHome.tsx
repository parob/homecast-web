import type { OrganizedCategory } from '@/history/categories';
import CategoryTile from './CategoryTile';

/**
 * The Analytics landing: one rich tile per category with something recorded
 * (or being monitored). Rooms are a filter INSIDE a category — the grid
 * never repeats a category per room, which is how the old preset list
 * drowned.
 */
export default function AnalyticsHome({
  homeId,
  mock,
  organized,
  onOpenCategory,
}: {
  homeId: string | null;
  mock: boolean;
  organized: OrganizedCategory[];
  onOpenCategory: (category: OrganizedCategory) => void;
}) {
  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        Everything your home records, grouped by what it tells you. Open a
        category to compare rooms and accessories, or build a custom view from
        any category with Customize.
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
        {organized.map(cat => (
          <CategoryTile
            key={cat.id}
            homeId={homeId}
            mock={mock}
            category={cat}
            onOpen={() => onOpenCategory(cat)}
          />
        ))}
      </div>
    </div>
  );
}
