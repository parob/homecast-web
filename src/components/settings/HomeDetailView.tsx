import { useState, useEffect } from 'react';
import { Badge } from '@/components/ui/badge';
import { Home as HomeIcon } from 'lucide-react';
import { useHomes } from '@/hooks/useHomeKitData';
import {
  HOME_SETTINGS_SECTION_META,
  type HomeSettingsSectionId,
} from '@/lib/home-settings-sections';
import type { HomeKitHome } from '@/lib/graphql/types';
import { isCommunity } from '@/lib/config';
import { HomeScreenSection } from './HomeScreenSection';
import { HomeHistorySettings } from './HistorySection';
import { UptimeSection } from './UptimeSection';
import { HomeOverviewSection } from './home/HomeOverviewSection';
import { HomeActionsSection } from './home/HomeActionsSection';
import { HomeNotificationsSection } from './home/HomeNotificationsSection';
import { HomeMQTTSection } from './home/HomeMQTTSection';
import { HomeSectionList } from './home/HomeSectionList';

/**
 * One home's settings.
 *
 * This used to be a single flat scroll with every home-specific setting
 * stacked into it under bare headings. Each of those is now a page of its own,
 * selected by the host (`SettingsDialog`) — from a third level in the desktop
 * sidebar, or from the row list this renders on mobile, which has no sidebar.
 *
 * The container keeps what every page shares: one live `home` object, polled
 * here rather than in each sub-page so the poll can't be duplicated, and the
 * one-second tick that keeps relative-time labels moving between polls.
 */

interface HomeDetailViewProps {
  home: HomeKitHome;
  developerMode?: boolean;
  /** null = the overview. */
  section: HomeSettingsSectionId | null;
  /** Sub-sections available for this home, from `visibleHomeSettingsSections`. */
  sections: HomeSettingsSectionId[];
  onSelectSection: (id: HomeSettingsSectionId) => void;
  /** True where there is no sidebar to navigate from — i.e. mobile. */
  showSectionList: boolean;
  /** Called after this home's cloud relay enrollment is removed (navigates back). */
  onCloudRelayRemoved?: () => void;
}

export function HomeDetailView({
  home: homeProp,
  developerMode,
  section,
  sections,
  onSelectSection,
  showSectionList,
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
  // Tick every second so the "ago" label updates without waiting for a refetch.
  const [, setNow] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setNow(n => n + 1), 1_000);
    return () => clearInterval(id);
  }, []);

  const isOwner = !home.role || home.role === 'owner';
  const isShared = !isOwner;
  const isAdmin = !home.role || home.role === 'owner' || home.role === 'admin';

  const renderSection = () => {
    switch (section) {
      case 'home-screen':
        return <HomeScreenSection home={home} />;
      case 'actions':
        return <HomeActionsSection home={home} />;
      case 'notifications':
        return <HomeNotificationsSection home={home} />;
      case 'reliability':
        return isCommunity ? null : <UptimeSection homeId={home.id} />;
      case 'analytics':
        return <HomeHistorySettings home={home} />;
      case 'mqtt':
        return (
          <HomeMQTTSection
            home={home}
            isAdmin={isAdmin}
            relayOnline={home.relayConnected === true}
          />
        );
      default:
        return (
          <HomeOverviewSection
            home={home}
            developerMode={developerMode}
            onCloudRelayRemoved={onCloudRelayRemoved}
          >
            {showSectionList && <HomeSectionList sections={sections} onSelect={onSelectSection} />}
          </HomeOverviewSection>
        );
    }
  };

  return (
    <div className="space-y-4">
      {/* The home's name leads every page — the desktop content pane has no
          chrome of its own, and on mobile the dialog title shows the sub-section
          rather than which home it belongs to. */}
      <div className="flex items-center gap-2.5">
        <HomeIcon className="h-5 w-5 text-muted-foreground" />
        <h3 className="text-base font-semibold truncate">{home.name}</h3>
        {section && (
          <span className="text-base text-muted-foreground truncate">
            {HOME_SETTINGS_SECTION_META[section].label}
          </span>
        )}
        {!section && home.isPrimary && (
          <Badge variant="outline" className="text-[10px] px-1.5 py-0">Primary</Badge>
        )}
        {!section && isShared && (
          <Badge variant="outline" className="text-[10px] px-1.5 py-0">Shared</Badge>
        )}
      </div>

      {renderSection()}
    </div>
  );
}
