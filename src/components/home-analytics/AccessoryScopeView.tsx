import { useMemo } from 'react';
import { sortByHistoryImportance, type WritableChar } from '@/components/automations/characteristics';
import { AccessorySeriesSection } from './AccessorySections';
import ChartSkeleton, { SeriesProgress } from './ChartSkeleton';
import { useMultiSeriesHistory } from './useMultiSeriesHistory';
import type { AnalyticsSettings } from './scope';
import type { HistorySeriesRefInput } from '@/lib/graphql/types';

/**
 * One accessory, at the leaf of the tree — the same stack of per-characteristic
 * panels the popup shows, on the range the rest of the session is using.
 *
 * No range control of its own: arriving here from a room at 7d and being
 * silently reset to 24h is the disconnection this rework is about.
 */
export default function AccessoryScopeView({
  homeId,
  mock,
  accessoryId,
  name,
  types,
  charByType,
  settings,
}: {
  homeId: string | null;
  mock: boolean;
  accessoryId: string;
  name: string;
  /** Recorded characteristic types for this accessory, importance-ordered. */
  types: string[];
  charByType: Map<string, WritableChar>;
  settings: AnalyticsSettings;
}) {
  const toTs = settings.windowEnd;
  const fromTs = toTs - settings.rangeMs;

  const ordered = useMemo(() => {
    const chars = types.map(t => charByType.get(t)).filter((c): c is WritableChar => !!c);
    // Fall back to the raw list when the accessory's characteristics aren't
    // to hand (mock mode) — order then is whatever the recording gave us.
    return chars.length === types.length
      ? sortByHistoryImportance(chars).map(c => c.type)
      : types;
  }, [types, charByType]);

  const refs = useMemo<HistorySeriesRefInput[]>(
    () => ordered.map(type => ({ accessoryId, characteristicType: type })),
    [ordered, accessoryId],
  );
  const { data, loading, progress } = useMultiSeriesHistory(homeId, refs, fromTs, toTs, mock);

  if (loading && data.size === 0) return <ChartSkeleton panels={3} progress={progress} />;

  const sections = ordered.flatMap(type => {
    const entry = data.get(`${accessoryId.toUpperCase()}|${type}`);
    return entry ? [{ type, data: entry.main }] : [];
  });

  if (sections.length === 0) {
    return (
      <div className="py-16 text-center">
        <p className="text-sm text-muted-foreground">
          Nothing recorded for {name} yet — charts build as it reports changes.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {loading && <SeriesProgress progress={progress} />}
      {sections.map(section => (
        <AccessorySeriesSection
          key={section.type}
          raw={section.data}
          fromTs={fromTs}
          toTs={toTs}
          char={charByType.get(section.type)}
          gradientKey={accessoryId}
        />
      ))}
    </div>
  );
}
