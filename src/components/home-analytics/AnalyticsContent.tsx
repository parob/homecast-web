import { useMemo } from 'react';
import { AlertTriangle, Loader2 } from 'lucide-react';
import { getRecordableCharacteristics } from '@/components/automations/characteristics';
import { isHiddenRoom, organizeRecorded, type AccessoryInfoEntry } from '@/history/categories';
import { isMockHistoryEnabled, mockAccessories, mockServiceGroups } from '@/history/mock';
import { liveFromHomeKit, type LiveAccessory } from '@/history/summaries';
import ActivityView from './ActivityView';
import AnalyticsHome from './AnalyticsHome';
import BatteryView from './BatteryView';
import CategoryView from './CategoryView';
import CustomView from './CustomView';
import GroupView from './GroupView';
import MeasureView from './MeasureView';
import SafetyView from './SafetyView';
import UsageTable from './UsageTable';
import { useRecordedSeries } from './useRecordedSeries';
import { Button } from '@/components/ui/button';
import type { AnalyticsNav } from './useAnalyticsNav';
import type { HomeKitAccessory, HomeKitServiceGroup } from '@/lib/graphql/types';
import type { ExplorerView } from './types';

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
      for (const m of mockAccessories()) {
        map.set(m.accessoryId.toUpperCase(), {
          name: m.name, room: isHiddenRoom(m.room) ? null : m.room, isVirtual: m.isVirtual,
        });
      }
    } else {
      for (const acc of accessories ?? []) {
        map.set(acc.id.toUpperCase(), {
          name: acc.name,
          // Default Room is a bucket, not a place — analytics treats it as
          // roomless so it never becomes a chip or a room-average line.
          room: isHiddenRoom(acc.roomName) ? null : (acc.roomName ?? null),
          isVirtual: Boolean((acc as { isVirtual?: boolean }).isVirtual),
        });
      }
    }
    return map;
  }, [accessories, mock]);

  const recordableByAccessory = useMemo(() => {
    const map = new Map<string, string[]>();
    if (mock) {
      for (const m of mockAccessories()) map.set(m.accessoryId, m.recordable);
    } else {
      for (const acc of accessories ?? []) {
        const types = getRecordableCharacteristics(acc).map(c => c.type);
        if (types.length > 0) map.set(acc.id, types);
      }
    }
    return map;
  }, [accessories, mock]);

  const groups = useMemo(() => {
    if (mock) return mockServiceGroups();
    return (serviceGroups ?? []).map(g => ({ id: g.id, name: g.name, memberIds: g.accessoryIds }));
  }, [serviceGroups, mock]);

  // Live accessory state — the overview's headlines and safety board read
  // current values, not history.
  const live = useMemo<LiveAccessory[]>(() => {
    if (mock) {
      return mockAccessories().map(m => ({
        id: m.accessoryId, name: m.name, room: m.room, isVirtual: m.isVirtual, values: m.values ?? {},
      }));
    }
    return liveFromHomeKit(accessories ?? []).map(a => (
      isHiddenRoom(a.room) ? { ...a, room: null } : a
    ));
  }, [accessories, mock]);

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
            Nothing recorded in this category yet — charts build as accessories
            report changes.
          </p>
        </div>
      );
    }
    const onRoomChange = (room: string | null) => nav.replace({ ...current, room });
    const onCustomize = (view: ExplorerView) => nav.push({ level: 'custom', view });

    // Each category renders the way its data reads best: measures for
    // continuous quantities, timelines for activity, a ranked list for
    // batteries, a status board for safety.
    switch (category.id) {
      case 'climate':
        return (
          <MeasureView
            homeId={effectiveHomeId} mock={mock} category={category} room={current.room}
            accessoryInfo={accessoryInfo} onRoomChange={onRoomChange} onCustomize={onCustomize}
          />
        );
      case 'activity':
        return (
          <ActivityView
            homeId={effectiveHomeId} mock={mock} category={category} room={current.room}
            accessoryInfo={accessoryInfo} onRoomChange={onRoomChange} onCustomize={onCustomize}
          />
        );
      case 'energy':
        return (
          <div className="space-y-4">
            <MeasureView
              homeId={effectiveHomeId} mock={mock} category={category} room={current.room}
              accessoryInfo={accessoryInfo} onRoomChange={onRoomChange} onCustomize={onCustomize}
            />
            <UsageTable
              homeId={effectiveHomeId} mock={mock} category={category} room={current.room}
              accessoryInfo={accessoryInfo}
            />
          </div>
        );
      case 'battery':
        return <BatteryView category={category} live={live} onCustomize={onCustomize} />;
      case 'safety':
        return (
          <SafetyView
            homeId={effectiveHomeId} mock={mock} category={category} room={current.room}
            live={live} accessoryInfo={accessoryInfo}
            onRoomChange={onRoomChange} onCustomize={onCustomize}
          />
        );
      case 'groups':
        return (
          <GroupView
            homeId={effectiveHomeId} mock={mock} category={category} groupId={current.groupId}
            accessoryInfo={accessoryInfo} recorded={recorded}
            onGroupChange={(groupId) => nav.replace({ ...current, groupId })}
          />
        );
      default:
        return (
          <CategoryView
            homeId={effectiveHomeId}
            mock={mock}
            category={category}
            room={current.room}
            groupId={current.groupId}
            accessoryInfo={accessoryInfo}
            onRoomChange={onRoomChange}
            onGroupChange={(groupId) => nav.replace({ ...current, groupId })}
            onCustomize={onCustomize}
          />
        );
    }
  }

  if (organized.length === 0) {
    return (
      <div className="py-16 text-center">
        <p className="text-sm text-muted-foreground">
          Nothing recorded yet. Turn on History in Settings → Homes → your
          home, and
          Analytics will build as your accessories report changes.
        </p>
      </div>
    );
  }

  return (
    <AnalyticsHome
      homeId={effectiveHomeId}
      mock={mock}
      organized={organized}
      live={live}
      recorded={recorded}
      accessoryInfo={accessoryInfo}
      onOpenCategory={(category, room) => nav.push({ level: 'category', category, room: room ?? null })}
    />
  );
}
