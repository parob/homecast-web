import { useMemo, useState } from 'react';
import { AlertTriangle, Loader2, RefreshCw } from 'lucide-react';
import { getRecordableCharacteristics, type WritableChar } from '@/components/automations/characteristics';
import { resolveWidgetType } from '@/components/widgets/resolve-widget-type';
import { getAccessoryDisplayName } from '@/components/widgets/types';
import { isHiddenRoom, type AccessoryInfoEntry } from '@/history/categories';
import { isMockHistoryEnabled, mockAccessories, mockServiceGroups } from '@/history/mock';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import ScopeDashboard from './ScopeDashboard';
import ScopeHeader from './ScopeHeader';
import ScopeTree from './ScopeTree';
import { buildScopeTree, scopeCrumbs, type AnalyticsScopeState } from './scope';
import { useRecordedSeries } from './useRecordedSeries';
import { Button } from '@/components/ui/button';
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
/**
 * The mock has recordable characteristics rather than HomeKit services, so
 * its kind is inferred from what it records. Only the tree's icon depends on
 * this; getting it wrong costs a wrong glyph, not wrong data.
 */
function mockWidgetType(recordable: string[], isVirtual?: boolean): string {
  const has = (type: string) => recordable.includes(type);
  if (isVirtual) return 'virtual';
  if (has('brightness')) return 'lightbulb';
  if (has('lock_current_state')) return 'lock';
  if (has('rotation_speed')) return 'fan';
  if (has('eve_energy_watt')) return 'outlet';
  if (has('target_temperature') || has('heating_threshold')) return 'thermostat';
  if (has('motion_detected')) return 'motion_sensor';
  if (has('contact_state')) return 'contact_sensor';
  if (has('smoke_detected') || has('carbon_monoxide_level')) return 'smoke_alarm';
  if (has('current_temperature')) return 'thermostat';
  if (has('power_state')) return 'switch';
  return 'sensor';
}

export default function AnalyticsContent({
  title,
  onBack,
  homeId,
  homeName = 'Home',
  homes,
  roomOrder,
  onSelectHome,
  accessories,
  serviceGroups,
  recordingEnabled,
  nav,
}: {
  /** The screen's name, leading the header row (the host used to own a bar of its own). */
  title?: string;
  /** Where the host's back arrow goes, if it has anywhere. */
  onBack?: () => void;
  homeId: string | null;
  /** Names the root of the breadcrumb and the top of the tree. */
  homeName?: string;
  /** Homes with Analytics on, so the tree can switch between them. */
  homes?: Array<{ id: string; name: string }>;
  /** Room names in the main navigation's order, so the two agree. */
  roomOrder?: string[];
  onSelectHome?: (id: string) => void;
  /** Host-provided accessory data — the component never fetches relay data. */
  accessories: HomeKitAccessory[] | null;
  serviceGroups?: HomeKitServiceGroup[] | null;
  /** Does this home have recording switched on? undefined = the host cannot say. */
  recordingEnabled?: boolean;
  nav: AnalyticsScopeState;
}) {
  const mock = isMockHistoryEnabled();
  const effectiveHomeId = mock ? 'MOCK-HOME' : homeId;
  const [navOpen, setNavOpen] = useState(false);
  const { recorded, loading: seriesLoading, error: seriesError, refetch } = useRecordedSeries(effectiveHomeId, mock);

  const accessoryInfo = useMemo(() => {
    const map = new Map<string, AccessoryInfoEntry>();
    if (mock) {
      for (const m of mockAccessories()) {
        map.set(m.accessoryId.toUpperCase(), {
          name: m.name, room: isHiddenRoom(m.room) ? null : m.room, isVirtual: m.isVirtual,
          widgetType: mockWidgetType(m.recordable, m.isVirtual),
        });
      }
    } else {
      for (const acc of accessories ?? []) {
        map.set(acc.id.toUpperCase(), {
          // The name a person set in Apple Home lives on the SERVICE, not on
          // the accessory — a VELUX sensor the dashboard calls "Velux Sensor"
          // is "Sensor switch" at accessory level. Every widget already reads
          // it this way; analytics was the one screen still showing the name
          // underneath.
          name: getAccessoryDisplayName(acc),
          widgetType: resolveWidgetType({
            category: acc.category ?? undefined,
            serviceTypes: (acc.services ?? []).map(svc => svc.serviceType),
          }).widgetType,
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

  // The accessory scope needs the real characteristics, not just their types:
  // an enum's own option labels beat a generic "2".
  const charByAccessory = useMemo(() => {
    const map = new Map<string, Map<string, WritableChar>>();
    for (const acc of accessories ?? []) {
      const chars = new Map<string, WritableChar>();
      for (const c of getRecordableCharacteristics(acc)) chars.set(c.type, c);
      if (chars.size > 0) map.set(acc.id.toUpperCase(), chars);
    }
    return map;
  }, [accessories]);

  const groups = useMemo(() => {
    if (mock) return mockServiceGroups();
    return (serviceGroups ?? []).map(g => ({ id: g.id, name: g.name, memberIds: g.accessoryIds }));
  }, [serviceGroups, mock]);

  const roomOrderKey = (roomOrder ?? []).join('\u0000');
  const tree = useMemo(
    () => buildScopeTree(recorded, accessoryInfo, groups, roomOrderKey ? roomOrderKey.split('\u0000') : []),
    [recorded, accessoryInfo, groups, roomOrderKey],
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
  // Two different nothings, and only one of them is the user's to act on.
  //
  // "No series at all, and we have finished asking" is the message below.
  // "Series exist but no accessory has arrived to hang them on" is a page
  // still loading — and telling someone to go and switch on a feature they
  // demonstrably already have on, because their accessories are two hundred
  // milliseconds behind, is worse than showing them a spinner.
  const nothingPlaced = tree.accessoryCount === 0;
  const stillArriving = seriesLoading
    || !effectiveHomeId
    || (!mock && accessories === null)
    // Series came back but no accessory has, so nothing can be placed yet.
    // Bounded by "and we have no accessories at all": if they HAVE arrived and
    // simply do not match, the series are orphans of deleted accessories, and
    // a spinner that never stops would be a worse answer than the message.
    || (nothingPlaced && recorded.length > 0 && (accessories?.length ?? 0) === 0);
  if (stillArriving && nothingPlaced) {
    return (
      <div className="py-16 flex justify-center text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    );
  }
  if (nothingPlaced) {
    return (
      <div className="py-16 text-center space-y-3">
        <p className="mx-auto max-w-sm text-sm text-muted-foreground">
          {/* Only send someone to a setting when we know it is the one at
              fault. Recording being ON with nothing stored yet is the
              ordinary state of a home that just switched it on, and telling
              them to go and switch on what they are already running reads as
              the screen being broken — which, when it appeared mid-load, it
              was. */}
          {recordingEnabled === false
            ? 'Analytics is off for this home. Turn it on in Settings → Homes → your home.'
            : 'Nothing recorded here yet — charts build as your accessories report changes.'}
        </p>
        <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => void refetch()}>
          <RefreshCw className="mr-1 h-3 w-3" /> Check again
        </Button>
      </div>
    );
  }

  const crumbs = scopeCrumbs(nav.scope, homeName, accessoryInfo, groups);

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <ScopeHeader
        title={title}
        onBack={onBack}
        onOpenNav={() => setNavOpen(true)}
        crumbs={crumbs}
        settings={nav.settings}
        onSettings={nav.setSettings}
        onSelect={nav.setScope}
      />
      {/* A permanent column would eat the width the charts need on a phone,
          but hiding it outright left no way down: the breadcrumb only walks
          up. Same tree, in a sheet, closing as soon as you have chosen. */}
      <Sheet open={navOpen} onOpenChange={setNavOpen}>
        <SheetContent side="left" className="w-72 p-4 md:hidden">
          <SheetHeader className="sr-only"><SheetTitle>Navigate analytics</SheetTitle></SheetHeader>
          <div className="h-full pt-6">
            <ScopeTree
              tree={tree}
              scope={nav.scope}
              homeName={homeName}
              homes={homes}
              homeId={homeId}
              onSelectHome={(id) => { onSelectHome?.(id); setNavOpen(false); }}
              onSelect={(scope) => { nav.setScope(scope); setNavOpen(false); }}
            />
          </div>
        </SheetContent>
      </Sheet>

      <div className="flex min-h-0 flex-1 gap-4">
        <div className="hidden w-52 shrink-0 md:block">
          <ScopeTree
            tree={tree}
            scope={nav.scope}
            homeName={homeName}
            homes={homes}
            homeId={homeId}
            onSelectHome={onSelectHome}
            onSelect={nav.setScope}
          />
        </div>
        <div className="min-w-0 flex-1 overflow-y-auto pr-1">
          <ScopeDashboard
            scope={nav.scope}
            settings={nav.settings}
            homeId={effectiveHomeId}
            mock={mock}
            recorded={recorded}
            accessoryInfo={accessoryInfo}
            charByAccessory={charByAccessory}
            groups={groups}
          />
        </div>
      </div>
    </div>
  );
}
