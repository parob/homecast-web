import { useMemo } from 'react';
import { AlertTriangle, Loader2 } from 'lucide-react';
import { getRecordableCharacteristics } from '@/components/automations/characteristics';
import { organizeRecorded, type AccessoryInfoEntry } from '@/history/categories';
import { isMockHistoryEnabled, MOCK_ACCESSORIES, MOCK_SERVICE_GROUPS } from '@/history/mock';
import AnalyticsHome from './AnalyticsHome';
import CategoryView from './CategoryView';
import CustomView from './CustomView';
import { useRecordedSeries } from './useRecordedSeries';
import { Button } from '@/components/ui/button';
import type { AnalyticsNav } from './useAnalyticsNav';
import type { HomeKitAccessory, HomeKitServiceGroup } from '@/lib/graphql/types';

/**
 * Home Analytics — the whole surface behind one orchestrator, so it renders
 * identically inside the Dashboard's dialog (the primary home: warm caches,
 * accessories already loaded, no extra relay round-trips) and on the
 * standalone /analytics page (deep links, screenshots).
 *
 * Accessory data comes IN as a prop wherever the host already has it; this
 * component never fetches relay data itself. That distinction is why the
 * dialog is reliable where the first standalone version was flaky: a cold
 * page re-issued homes/accessories relay actions that fail while a relay is
 * busy or reconnecting.
 *
 * Navigation is a level stack owned by the HOST (useAnalyticsNav) so the
 * host can render the current title with an embedded back button in its own
 * chrome — the SettingsDialog drill-down convention.
 */
export default function AnalyticsContent({
  homeId,
  accessories,
  serviceGroups,
  nav,
}: {
  homeId: string | null;
  /** Host-provided accessory data — the component never fetches relay data. */
  accessories: HomeKitAccessory[] | null;
  serviceGroups?: HomeKitServiceGroup[] | null;
  nav: AnalyticsNav;
}) {
  const mock = isMockHistoryEnabled();
  const effectiveHomeId = mock ? 'MOCK-HOME' : homeId;
  const { recorded, loading: seriesLoading, error: seriesError, refetch } = useRecordedSeries(effectiveHomeId, mock);

  const accessoryInfo = useMemo(() => {
    const map = new Map<string, AccessoryInfoEntry>();
    if (mock) {
      for (const m of MOCK_ACCESSORIES) {
        map.set(m.accessoryId.toUpperCase(), { name: m.name, room: m.room, isVirtual: m.isVirtual });
      }
    } else {
      for (const acc of accessories ?? []) {
        map.set(acc.id.toUpperCase(), {
          name: acc.name,
          room: acc.roomName ?? null,
          isVirtual: Boolean((acc as { isVirtual?: boolean }).isVirtual),
        });
      }
    }
    return map;
  }, [accessories, mock]);

  const recordableByAccessory = useMemo(() => {
    const map = new Map<string, string[]>();
    if (mock) {
      for (const m of MOCK_ACCESSORIES) map.set(m.accessoryId, m.recordable);
    } else {
      for (const acc of accessories ?? []) {
        const types = getRecordableCharacteristics(acc).map(c => c.type);
        if (types.length > 0) map.set(acc.id, types);
      }
    }
    return map;
  }, [accessories, mock]);

  const groups = useMemo(() => {
    if (mock) return MOCK_SERVICE_GROUPS;
    return (serviceGroups ?? []).map(g => ({ id: g.id, name: g.name, memberIds: g.accessoryIds }));
  }, [serviceGroups, mock]);

  const organized = useMemo(
    () => organizeRecorded(recorded, accessoryInfo, groups, recordableByAccessory),
    [recorded, accessoryInfo, groups, recordableByAccessory],
  );

  if (seriesError) {
    return (
      <div className="border border-destructive/40 bg-destructive/5 rounded-lg p-3 flex items-center justify-between gap-3">
        <p className="text-xs text-destructive flex items-center gap-2 min-w-0">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span className="truncate">Couldn't load recorded series: {seriesError.message}</span>
        </p>
        <Button variant="outline" size="sm" className="h-7 text-xs shrink-0" onClick={() => void refetch()}>
          Retry
        </Button>
      </div>
    );
  }
  if (seriesLoading && recorded.length === 0) {
    return (
      <div className="py-16 flex justify-center text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    );
  }

  const current = nav.current;

  if (current.level === 'custom') {
    return (
      <CustomView
        homeId={effectiveHomeId}
        mock={mock}
        view={current.view}
        onViewChange={(view) => nav.replace({ level: 'custom', view })}
        accessories={accessories}
        recorded={recorded}
      />
    );
  }

  if (current.level === 'category') {
    const category = organized.find(c => c.id === current.category);
    if (!category) {
      return (
        <div className="py-16 text-center">
          <p className="text-sm text-muted-foreground">
            Nothing recorded in this category yet — charts build as devices
            report changes.
          </p>
        </div>
      );
    }
    return (
      <CategoryView
        homeId={effectiveHomeId}
        mock={mock}
        category={category}
        room={current.room}
        groupId={current.groupId}
        accessoryInfo={accessoryInfo}
        onRoomChange={(room) => nav.replace({ ...current, room })}
        onGroupChange={(groupId) => nav.replace({ ...current, groupId })}
        onCustomize={(view) => nav.push({ level: 'custom', view })}
      />
    );
  }

  if (organized.length === 0) {
    return (
      <div className="py-16 text-center">
        <p className="text-sm text-muted-foreground">
          Nothing recorded yet. Turn on History in Settings → History and
          Analytics will build as your devices report changes.
        </p>
      </div>
    );
  }

  return (
    <AnalyticsHome
      homeId={effectiveHomeId}
      mock={mock}
      organized={organized}
      onOpenCategory={(cat) => nav.push({ level: 'category', category: cat.id })}
    />
  );
}
