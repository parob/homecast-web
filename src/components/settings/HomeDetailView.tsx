import { useEffect } from 'react';
import { Badge } from '@/components/ui/badge';
import { Home as HomeIcon } from 'lucide-react';
import { useHomes } from '@/hooks/useHomeKitData';
import type { HomeSettingsSectionId } from '@/lib/home-settings-sections';
import type { HomeKitHome } from '@/lib/graphql/types';
import { HomeScreenSection } from './HomeScreenSection';
import { HomeHistorySettings } from './HistorySection';
import { HomeOverviewSection } from './home/HomeOverviewSection';
import { HomeNotificationsSection } from './home/HomeNotificationsSection';
import { HomeMQTTSection } from './home/HomeMQTTSection';
import { HomeCamerasSection } from './home/HomeCamerasSection';
import { RemoveFromCloudRelay } from './home/RemoveFromCloudRelay';

/**
 * One home's settings, on one page.
 *
 * The overview leads (its Connection card carries Reliability too), every
 * section this home offers is stacked beneath it under its own heading, and the
 * one destructive action — leaving the cloud relay — comes last. They used to be pages of their own behind a third
 * navigation level — a tap in and a tap back for each handful of switches.
 *
 * The container keeps what every section shares: one live `home` object, polled
 * here rather than in each section so the poll can't be duplicated.
 */

interface HomeDetailViewProps {
  home: HomeKitHome;
  developerMode?: boolean;
  /** Sections available for this home, from `visibleHomeSettingsSections`. */
  sections: HomeSettingsSectionId[];
  /** `isCloudManagedHome` — only these homes can turn cameras on. */
  cloudManaged: boolean;
  /** Called after this home's cloud relay enrollment is removed (navigates back). */
  onCloudRelayRemoved?: () => void;
}

export function HomeDetailView({
  home: homeProp,
  developerMode,
  sections,
  cloudManaged,
  onCloudRelayRemoved,
}: HomeDetailViewProps) {
  // Keep the detail view fresh so relayLastSeenAt / relayConnected reflect the
  // live server state instead of a frozen snapshot taken at settings-open time.
  const { data: liveHomes, refetch: refetchHomes } = useHomes();
  useEffect(() => {
    const id = setInterval(() => { refetchHomes(); }, 15_000);
    return () => clearInterval(id);
  }, [refetchHomes]);
  const live = liveHomes?.find(h => h.id === homeProp.id);
  // Merge rather than swap. `useHomes` is typed against the native bridge's
  // HomeKitHome, whose `role` is a bare string and which has no `ownerEmail`
  // at all — taking its object wholesale both widened the role and dropped the
  // home owner off the overview. The poll only needs to win on the fields that
  // actually go stale, which are the relay's.
  const home: HomeKitHome = live ? { ...homeProp, ...live, role: homeProp.role } : homeProp;
  const isOwner = !home.role || home.role === 'owner';
  const isShared = !isOwner;
  const isAdmin = !home.role || home.role === 'owner' || home.role === 'admin';

  const renderSection = (section: HomeSettingsSectionId) => {
    switch (section) {
      case 'home-screen':
        return <HomeScreenSection home={home} />;
      case 'notifications':
        return <HomeNotificationsSection home={home} />;
      case 'analytics':
        return <HomeHistorySettings home={home} isAdmin={isAdmin} />;
      case 'cameras':
        return <HomeCamerasSection home={home} isAdmin={isAdmin} cloudManaged={cloudManaged} />;
      case 'mqtt':
        return <HomeMQTTSection home={home} isAdmin={isAdmin} />;
    }
  };

  return (
    <div className="space-y-4">
      {/* The desktop content pane has no chrome of its own, so the home's name
          leads the page. */}
      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
        <HomeIcon className="h-5 w-5 shrink-0 text-muted-foreground" />
        <h3 className="min-w-0 text-base font-semibold break-words">{home.name}</h3>
        {home.isPrimary && (
          <Badge variant="outline" className="text-[10px] px-1.5 py-0">Primary</Badge>
        )}
        {isShared && (
          <Badge variant="outline" className="text-[10px] px-1.5 py-0">Shared</Badge>
        )}
      </div>

      <HomeOverviewSection home={home} developerMode={developerMode} />

      {sections.map(id => (
        <section
          key={id}
          data-home-section={id}
          className="border-t pt-4"
        >
          {renderSection(id)}
        </section>
      ))}

      <RemoveFromCloudRelay home={home} onRemoved={onCloudRelayRemoved} />
    </div>
  );
}
