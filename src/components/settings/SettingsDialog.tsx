import { useState, useMemo, useEffect } from 'react';
import { cn } from '@/lib/utils';
import { useIsMobile } from '@/hooks/use-mobile';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import {
  CreditCard,
  Monitor,

  Key,
  Webhook,
  Share2,
  Cloud,
  Home as HomeIcon,
  User,
  ChevronRight,
  ChevronDown,
  ArrowLeft,
  Tag,
  Bell,
  LineChart,
  ExternalLink,
  Copy,
} from 'lucide-react';
import type { HomeKitHome, UserSettingsData, GetSettingsResponse } from '@/lib/graphql/types';
import { isCommunity } from '@/lib/config';
import { isMQTTAvailable } from '@/lib/mqtt-bridge';
import { invalidateHomeKitCache } from '@/hooks/useHomeKitData';
import {
  HOME_SETTINGS_SECTION_META,
  visibleHomeSettingsSections,
  type HomeSettingsSectionId,
} from '@/lib/home-settings-sections';
import { getCloud } from '@/lib/cloud';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';

// Cloud components — resolved at render time (not module-load time)
// because initCloud() is async and hasn't completed when static imports run.
import { DisplaySection } from './DisplaySection';

import { ApiAccessSection } from './ApiAccessSection';
import { WebhooksSection } from './WebhooksSection';
import { SharedItemsSection } from './SharedItemsSection';
import { HomesSection } from './HomesSection';
import { HomeDetailView } from './HomeDetailView';
// SelfHostedRelaySection imported from @homecast/cloud above
import { AccountSection } from './AccountSection';
import { NotificationsSection } from './NotificationsSection';
import { LocalModeSection } from './LocalModeSection';
import { isLocalCapable } from '@/native/homekit-bridge';

export type SettingsTab = 'plan' | 'smart-deals' | 'display' | 'notifications' | 'api-access' | 'webhooks' | 'sharing' | 'homes' | 'self-hosted-relay' | 'local-mode' | 'account';

interface MenuItem {
  id: SettingsTab;
  label: string;
  group: string;
  icon: typeof CreditCard;
}

export interface SettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialTab?: SettingsTab;
  // Account / billing
  accountType: string;
  usedAccessorySlots: number;
  accessoryLimit: number | null;
  userEmail: string | undefined;
  isInMacApp: boolean;
  isInMobileApp: boolean;
  pricing: { standard: { formatted: string }; cloud: { formatted: string } };
  handleUpgrade: () => Promise<void>;
  handleUpgradeToCloud: () => Promise<void>;
  handleDowngradeToStandard: () => Promise<void>;
  handleManageSubscription: () => Promise<void>;
  /** Which billing action (if any) is currently in flight — drives spinner + disable on Plan tab buttons. */
  billingBusy?: 'upgrade' | 'upgradeCloud' | 'downgrade' | 'manage' | null;
  /** Where the user's active sub came from. Used by the Plan tab to swap
   *  buttons + price labels for Apple-paid users in the web portal. */
  subscriptionSource?: 'stripe' | 'apple' | null;
  hasSubscription: boolean;
  cloudSignupsAvailable: boolean;
  isRelayCapable: () => boolean;
  setAccessorySelectionOpen: (open: boolean) => void;
  // Smart Deals
  showSmartDeals: boolean;
  settingsData: GetSettingsResponse | undefined;
  saveSettings: (updates: Partial<UserSettingsData>, settingName: string) => Promise<boolean>;
  // Display
  hideInfoDevices: boolean;
  toggleHideInfoDevices: (value: boolean) => void;
  hideAccessoryCounts: boolean;
  toggleHideAccessoryCounts: (value: boolean) => void;
  groupByRoom: boolean;
  toggleGroupByRoom: (value: boolean) => void;
  // Style
  layoutMode: 'grid' | 'masonry';
  changeLayoutMode: (mode: 'grid' | 'masonry') => void;
  fullWidth: boolean;
  toggleFullWidth: (value: boolean) => void;
  compactMode: boolean;
  toggleCompactMode: (value: boolean) => void;
  fontSize: 'small' | 'medium' | 'large';
  changeFontSize: (size: 'small' | 'medium' | 'large') => void;
  iconStyle: 'standard' | 'colourful';
  changeIconStyle: (style: 'standard' | 'colourful') => void;
  autoBackgrounds: boolean;
  toggleAutoBackgrounds: (value: boolean) => void;
  settingSaveError: string | null;
  // Developer
  developerMode: boolean;
  toggleDeveloperMode: (value: boolean) => void;
  // Auth
  logout: () => void;
  resetAndUninstall?: () => Promise<void>;
  serverVersion: string | undefined;
  // Homes
  homes: HomeKitHome[];
  copyToClipboard: (text: string) => boolean;
  // Cloud relay
  cloudRelayPrefilledHome?: string;
  autoOpenEnroll?: boolean;
  // Mac app
  launchAtLogin: boolean;
  setLaunchAtLogin: (value: boolean) => void;
  launchAtLoginSupported: boolean;
  onReplayTutorial?: () => void;
  onReplaySetup?: () => void;
}

export function SettingsDialog(props: SettingsDialogProps) {
  const {
    open,
    onOpenChange,
    initialTab,
    developerMode,
    isInMacApp,
    isInMobileApp,
    isRelayCapable,
    launchAtLoginSupported,
    showSmartDeals,
  } = props;

  // Cloud components — resolved at render time so initCloud() has completed
  const _cloud = getCloud();
  const PlanSection = _cloud?.PlanSection ?? null;
  const SmartDealsSection = _cloud?.SmartDealsSection ?? null;
  const SelfHostedRelaySection = _cloud?.SelfHostedRelaySection ?? null;

  // The relay's address on the LAN. window.location.origin is localhost on the
  // relay Mac, which means "this device" wherever it is read — so copying it to
  // a phone hands over a link to the phone. Only the server knows the answer,
  // and it reports it on /health.
  const [lanOrigin, setLanOrigin] = useState<string | null>(null);
  useEffect(() => {
    if (!isCommunity || !isRelayCapable()) return;
    let cancelled = false;
    fetch('/health', { signal: AbortSignal.timeout(4000) })
      .then(r => r.json())
      .then(d => {
        if (cancelled || !d?.lanAddress) return;
        setLanOrigin(`http://${d.lanAddress}:${d.port || window.location.port || 5656}`);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);
  const portalUrl = lanOrigin ?? window.location.origin;

  const isMobile = useIsMobile();
  const [activeTab, setActiveTab] = useState<SettingsTab>(initialTab || 'plan');
  // On mobile, null means showing the menu list; a tab value means showing that section
  const [mobileSection, setMobileSection] = useState<SettingsTab | null>(null);
  // Desktop: which home is selected within the Homes section (null = show Homes list)
  const [selectedHomeId, setSelectedHomeId] = useState<string | null>(null);
  // Third level: which of the selected home's sub-sections is open (null = its overview)
  const [homeSection, setHomeSection] = useState<HomeSettingsSectionId | null>(null);

  // Reset to initial tab when dialog opens
  useEffect(() => {
    if (open) {
      setActiveTab(initialTab || 'plan');
      setMobileSection(null);
      setSelectedHomeId(null);
      setHomeSection(null);
    }
  }, [open, initialTab]);

  // Clear home selection whenever neither the desktop tab nor the mobile section is on 'homes'
  useEffect(() => {
    if (activeTab !== 'homes' && mobileSection !== 'homes' && selectedHomeId) {
      setSelectedHomeId(null);
      setHomeSection(null);
    }
  }, [activeTab, mobileSection, selectedHomeId]);

  // If developer mode is toggled off and we're on a developer-only tab, fall back to plan
  useEffect(() => {
    if (!developerMode && (activeTab === 'api-access' || activeTab === 'webhooks' || activeTab === 'local-mode')) {
      setActiveTab('plan');
      setMobileSection((s) => (s === 'api-access' || s === 'webhooks' || s === 'local-mode' ? null : s));
    }
  }, [developerMode, activeTab]);

  const menuItems = useMemo(() => {
    const items: MenuItem[] = [
      { id: 'plan', label: isCommunity ? 'Community' : 'Plan', group: 'General', icon: isCommunity ? HomeIcon : CreditCard },
    ];

    if (showSmartDeals && !isCommunity) {
      items.push({ id: 'smart-deals', label: 'Smart Deals', group: 'General', icon: Tag });
    }

    items.push({ id: 'display', label: 'Display', group: 'General', icon: Monitor });

    if (!isCommunity) {
      items.push({ id: 'notifications', label: 'Notifications', group: 'General', icon: Bell });
    }

    items.push({ id: 'homes', label: 'Homes', group: 'General', icon: HomeIcon });
    items.push({ id: 'sharing', label: 'Sharing', group: 'General', icon: Share2 });

    if (developerMode) {
      items.push({ id: 'api-access', label: 'API Access', group: 'Developer', icon: Key });
      items.push({ id: 'webhooks', label: 'Webhooks', group: 'Developer', icon: Webhook });
    }

    // Cloud only. A self-hosted relay is a Mac relaying HomeKit *to Homecast*,
    // which is not a thing that happens in Community mode — there the Mac
    // serves your network directly and nothing leaves it. The pane showed
    // regardless, offering to "use this Mac as a relay to Homecast" on a
    // relay that does no such thing.
    if (!isCommunity && isRelayCapable() && SelfHostedRelaySection) {
      items.push({ id: 'self-hosted-relay', label: 'Relay', group: 'Device', icon: Cloud });
    }

    // Local Mode needs no configuring — it takes over when the relay can't
    // serve and steps back when it can, and the badge explains itself. The pane
    // only exists to override that, so it sits behind developer mode with the
    // other controls you reach for when you are testing rather than living in
    // the app. Hiding it does not disable Local Mode itself.
    //
    // Gated on isLocalCapable() rather than isRelayCapable(): the device that
    // most needs this is an iPhone, and iPhones are deliberately not
    // relay-capable.
    if (developerMode && isLocalCapable() && !isCommunity) {
      items.push({ id: 'local-mode', label: 'Local Mode', group: 'Device', icon: HomeIcon });
    }

    // The tab bar used to be configured here. It is edited on the bar itself in
    // Edit Layout now — this pane was gated on `isInMobileApp`, so a mobile
    // browser rendered the bar and had no way to reach its settings.

    items.push({ id: 'account', label: 'Account', group: 'Account', icon: User });

    return items;
  }, [developerMode, isInMacApp, isInMobileApp, isRelayCapable, launchAtLoginSupported, showSmartDeals]);

  // Which sub-sections a home offers, for both the sidebar's third level and
  // the mobile row list — one source so the two can't disagree.
  const homeSections = useMemo(
    () => visibleHomeSettingsSections({
      isCommunity,
      developerMode,
      mqttBridgeAvailable: isMQTTAvailable(),
    }),
    [developerMode],
  );

  // Clamp rather than reset: if developer mode goes off while the MQTT page is
  // open, drop to the home's overview instead of stranding the user on a page
  // that no longer has a row in the sidebar.
  const activeHomeSection = homeSection && homeSections.includes(homeSection) ? homeSection : null;
  useEffect(() => {
    if (homeSection && !homeSections.includes(homeSection)) setHomeSection(null);
  }, [homeSection, homeSections]);

  const selectHome = (homeId: string) => {
    setSelectedHomeId(homeId);
    setHomeSection(null);
  };

  // Group menu items by their group
  const groupedItems = useMemo(() => {
    const groups: { label: string; items: MenuItem[] }[] = [];
    let currentGroup: string | null = null;
    for (const item of menuItems) {
      if (item.group !== currentGroup) {
        currentGroup = item.group;
        groups.push({ label: item.group, items: [] });
      }
      groups[groups.length - 1].items.push(item);
    }
    return groups;
  }, [menuItems]);

  // Matched case-insensitively: home ids reach us from sources that disagree on
  // case (the relay and dashboard cache use uppercase, the cloud lowercase).
  // Resolving to nothing is a real state — a cloud-relay removal shrinks the
  // list under us — and falls back to the homes list rather than a blank pane.
  const selectedHome = selectedHomeId
    ? props.homes.find(h => h.id.toUpperCase() === selectedHomeId.toUpperCase()) ?? null
    : null;

  const openExternalUrl = (url: string) => (e: React.MouseEvent) => {
    const w = window as any;
    if (w.webkit?.messageHandlers?.homecast) {
      e.preventDefault();
      w.webkit.messageHandlers.homecast.postMessage({ action: 'openUrl', url });
    }
  };

  const renderSection = (tab: SettingsTab) => {
    switch (tab) {
      case 'plan':
        return isCommunity ? (
          <div className="space-y-4">
            <div>
              <h3 className="text-sm font-medium">Homecast Community</h3>
              <p className="text-xs text-muted-foreground mt-1">
                You're running the Community edition — fully local, no cloud dependency, unlimited accessories.
              </p>
            </div>
            <div className="rounded-lg border p-3 space-y-2">
              <p className="text-sm font-medium">Local portal</p>
              <p className="text-xs text-muted-foreground">
                Open Homecast from any device on your network at this address.
              </p>
              <div className="flex items-center gap-2">
                <a
                  href={portalUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={openExternalUrl(portalUrl)}
                  className="inline-flex items-center gap-1.5 text-xs font-medium text-primary hover:underline font-mono truncate"
                >
                  {portalUrl}
                  <ExternalLink className="h-3 w-3 shrink-0" />
                </a>
                <button
                  type="button"
                  onClick={() => props.copyToClipboard(portalUrl)}
                  className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                  aria-label="Copy local portal URL"
                >
                  <Copy className="h-3 w-3" />
                  Copy
                </button>
              </div>
            </div>
            {/* Inside the App Store build → link to the repo (anti-steering safe).
                In a regular browser → keep the GitHub Sponsors call-to-action. */}
            {(window as any).isHomecastApp ? (
              <div className="rounded-lg border p-3 space-y-2">
                <p className="text-sm font-medium">Open source</p>
                <p className="text-xs text-muted-foreground">
                  Homecast Community is open source under the MIT licence. View the source, file
                  issues, and follow development on GitHub.
                </p>
                <a
                  href="https://github.com/parob/homecast"
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={openExternalUrl('https://github.com/parob/homecast')}
                  className="inline-flex items-center gap-1.5 text-xs font-medium text-primary hover:underline"
                >
                  View on GitHub →
                </a>
              </div>
            ) : (
              <div className="rounded-lg border p-3 space-y-2">
                <p className="text-sm font-medium">Support Homecast</p>
                <p className="text-xs text-muted-foreground">
                  Homecast Community is free and open. If you find it useful, consider supporting the project.
                </p>
                <a
                  href="https://github.com/sponsors/parob"
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={openExternalUrl('https://github.com/sponsors/parob')}
                  className="inline-flex items-center gap-1.5 text-xs font-medium text-primary hover:underline"
                >
                  Sponsor on GitHub →
                </a>
              </div>
            )}
            <div className="rounded-lg border p-3 space-y-2">
              <p className="text-sm font-medium">Want remote access & cloud features?</p>
              <p className="text-xs text-muted-foreground">
                Switch to Homecast Cloud for remote access, sharing, and more. You'll need to reset
                this app and sign in with a Cloud account.
              </p>
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <button
                    type="button"
                    className="inline-flex items-center gap-1.5 text-xs font-medium text-primary hover:underline"
                  >
                    Reset & uninstall →
                  </button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Reset Homecast?</AlertDialogTitle>
                    <AlertDialogDescription asChild>
                      <div className="space-y-2 text-sm">
                        <p>This will:</p>
                        <ul className="list-disc list-inside space-y-1 text-muted-foreground">
                          <li>Sign you out of the Community account on this Mac</li>
                          <li>Erase all local Community data (homes, settings, automations, accessory layouts)</li>
                          <li>Stop the local relay server and clear cached web content</li>
                          <li>Return to the mode-selector screen, where you can pick Homecast Cloud</li>
                        </ul>
                        <p className="text-foreground font-medium pt-1">This cannot be undone.</p>
                      </div>
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction onClick={() => props.resetAndUninstall?.()}>
                      Reset & uninstall
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
            <p className="text-[11px] text-muted-foreground text-center pt-1">
              <a
                href="https://homecast.cloud/terms"
                target="_blank"
                rel="noopener noreferrer"
                onClick={openExternalUrl('https://homecast.cloud/terms')}
                className="text-primary hover:underline"
              >Terms of Use</a>
              {' · '}
              <a
                href="https://homecast.cloud/privacy"
                target="_blank"
                rel="noopener noreferrer"
                onClick={openExternalUrl('https://homecast.cloud/privacy')}
                className="text-primary hover:underline"
              >Privacy Policy</a>
            </p>
          </div>
        ) : PlanSection ? (
          <PlanSection
            accountType={props.accountType}
            usedAccessorySlots={props.usedAccessorySlots}
            accessoryLimit={props.accessoryLimit}
            isInMacApp={props.isInMacApp}
            isInMobileApp={props.isInMobileApp}
            pricing={props.pricing}
            handleUpgrade={props.handleUpgrade}
            handleUpgradeToCloud={props.handleUpgradeToCloud}
            handleDowngradeToStandard={props.handleDowngradeToStandard}
            handleManageSubscription={props.handleManageSubscription}
            billingBusy={props.billingBusy}
            subscriptionSource={props.subscriptionSource}
            hasSubscription={props.hasSubscription}
            cloudSignupsAvailable={props.cloudSignupsAvailable}
            isRelayCapable={props.isRelayCapable}
            setAccessorySelectionOpen={props.setAccessorySelectionOpen}
          />
        ) : null;
      case 'smart-deals':
        return SmartDealsSection ? (
          <SmartDealsSection
            accountType={props.accountType}
            isInMacApp={props.isInMacApp}
            isInMobileApp={props.isInMobileApp}
            handleUpgrade={props.handleUpgrade}
            settingsData={props.settingsData}
            saveSettings={props.saveSettings}
          />
        ) : null;
      case 'display':
        return (
          <DisplaySection
            hideInfoDevices={props.hideInfoDevices}
            toggleHideInfoDevices={props.toggleHideInfoDevices}
            hideAccessoryCounts={props.hideAccessoryCounts}
            toggleHideAccessoryCounts={props.toggleHideAccessoryCounts}
            groupByRoom={props.groupByRoom}
            toggleGroupByRoom={props.toggleGroupByRoom}
            layoutMode={props.layoutMode}
            changeLayoutMode={props.changeLayoutMode}
            fullWidth={props.fullWidth}
            toggleFullWidth={props.toggleFullWidth}
            compactMode={props.compactMode}
            toggleCompactMode={props.toggleCompactMode}
            fontSize={props.fontSize}
            changeFontSize={props.changeFontSize}
            iconStyle={props.iconStyle}
            changeIconStyle={props.changeIconStyle}
            autoBackgrounds={props.autoBackgrounds}
            toggleAutoBackgrounds={props.toggleAutoBackgrounds}
            settingSaveError={props.settingSaveError}
            isInMacApp={props.isInMacApp}
            isInMobileApp={props.isInMobileApp}
          />
        );
      case 'api-access':
        return (
          <ApiAccessSection
            homes={props.homes}
            copyToClipboard={props.copyToClipboard}
            accountType={props.accountType}
          />
        );
      case 'webhooks':
        return <WebhooksSection />;
      case 'sharing':
        return <SharedItemsSection developerMode={props.developerMode} />;
      case 'homes': {
        if (selectedHome) {
          return (
            <HomeDetailView
              home={selectedHome}
              developerMode={props.developerMode}
              section={activeHomeSection}
              sections={homeSections}
              onSelectSection={setHomeSection}
              showSectionList={isMobile}
              onCloudRelayRemoved={() => {
                setSelectedHomeId(null);
                setHomeSection(null);
                // The homes list is served from the client-side HomeKit cache —
                // drop it so the removed home disappears immediately rather than
                // lingering until the TTL expires.
                invalidateHomeKitCache('homes');
              }}
            />
          );
        }
        return (
          <HomesSection
            homes={props.homes}
            prefilledHomeName={props.cloudRelayPrefilledHome}
            autoOpenEnroll={props.autoOpenEnroll}
            accountType={props.accountType}
            handleUpgradeToCloud={props.handleUpgradeToCloud}
            isInMacApp={props.isInMacApp}
            isInMobileApp={props.isInMobileApp}
            cloudSignupsAvailable={props.cloudSignupsAvailable}
            developerMode={props.developerMode}
            onSelectHome={selectHome}
          />
        );
      }
      case 'self-hosted-relay':
        // Not just "is the component present" — a Community build that happens
        // to have the cloud package compiled in would otherwise render it.
        return !isCommunity && SelfHostedRelaySection ? (
          <SelfHostedRelaySection
            accountType={props.accountType}
          />
        ) : (
          <div className="text-sm text-muted-foreground p-4">Relay settings are not available in Community mode.</div>
        );
      case 'local-mode':
        return <LocalModeSection />;
      case 'notifications':
        return <NotificationsSection />;
      case 'account':
        return (
          <AccountSection
            userEmail={props.userEmail}
            developerMode={props.developerMode}
            toggleDeveloperMode={props.toggleDeveloperMode}
            settingSaveError={props.settingSaveError}
            logout={props.logout}
            resetAndUninstall={props.resetAndUninstall}
            serverVersion={props.serverVersion}
            onReplayTutorial={props.onReplayTutorial}
            onReplaySetup={props.onReplaySetup}
            showLaunchAtLogin={props.isInMacApp && props.launchAtLoginSupported}
            launchAtLogin={props.launchAtLogin}
            setLaunchAtLogin={props.setLaunchAtLogin}
          />
        );
      default:
        return null;
    }
  };

  const activeLabel = menuItems.find(i => i.id === (isMobile ? mobileSection : activeTab))?.label || 'Settings';

  // Mobile is a push stack three levels deep: menu → section → home → sub-section.
  // The title names the level you are on, and back pops exactly one.
  const inHomes = mobileSection === 'homes';
  const mobileTitle = inHomes && selectedHome
    ? (activeHomeSection ? HOME_SETTINGS_SECTION_META[activeHomeSection].label : selectedHome.name)
    : (mobileSection ? activeLabel : 'Settings');
  const handleMobileBack = () => {
    if (inHomes && activeHomeSection) {
      setHomeSection(null);
    } else if (inHomes && selectedHomeId) {
      setSelectedHomeId(null);
    } else {
      setMobileSection(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={cn(
          "max-h-[80vh] min-h-[60vh] flex flex-col p-0",
          isMobile ? "max-w-[95vw] sm:max-w-md" : "sm:max-w-3xl"
        )}
        style={{ zIndex: 10010 }}
      >
        {isMobile ? (
          // Mobile: drill-down navigation
          <>
            <DialogHeader className="shrink-0 px-6 pt-6 pb-2">
              <DialogTitle className="flex items-center gap-2">
                {mobileSection && (
                  <button
                    onClick={handleMobileBack}
                    className="p-1 -ml-1 rounded-md hover:bg-muted transition-colors"
                  >
                    <ArrowLeft className="h-4 w-4" />
                  </button>
                )}
                {mobileTitle}
              </DialogTitle>
              <DialogDescription className="sr-only">Configure display and server settings</DialogDescription>
            </DialogHeader>
            <div className="flex-1 overflow-y-auto border-t">
              {mobileSection ? (
                <div className="p-6">
                  {renderSection(mobileSection)}
                </div>
              ) : (
                <div className="py-1">
                  {groupedItems.map((group) => (
                    <div key={group.label}>
                      {group.label !== 'General' && (
                        <div className="px-4 pt-3 pb-1">
                          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{group.label}</p>
                        </div>
                      )}
                      {group.items.map((item) => {
                        const Icon = item.icon;
                        return (
                          <button
                            key={item.id}
                            onClick={() => setMobileSection(item.id)}
                            className="w-full flex items-center gap-3 px-4 py-2.5 text-sm hover:bg-muted/50 transition-colors"
                          >
                            <Icon className="h-4 w-4 text-muted-foreground" />
                            <span className="flex-1 text-left">{item.label}</span>
                            <ChevronRight className="h-4 w-4 text-muted-foreground" />
                          </button>
                        );
                      })}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        ) : (
          // Desktop: sidebar + content area
          <>
            <DialogHeader className="shrink-0 px-6 pt-6 pb-2">
              <DialogTitle>Settings</DialogTitle>
              <DialogDescription className="sr-only">Configure display and server settings</DialogDescription>
            </DialogHeader>
            <div className="flex flex-1 min-h-0 border-t">
              {/* Sidebar. w-52, not w-44: it now nests three levels deep
                  (Homes → a home → that home's sections) and every third-level
                  label truncated at the old width. Fixed rather than widening
                  on expand, because the dialog's width is fixed too — a
                  growing rail would take it out of the content pane and make
                  the whole page jump every time you opened a home. */}
              <nav className="w-52 shrink-0 border-r overflow-y-auto py-1">
                {groupedItems.map((group) => (
                  <div key={group.label}>
                    {group.label !== 'General' && (
                      <div className="px-3 pt-3 pb-1">
                        <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{group.label}</p>
                      </div>
                    )}
                    {group.items.map((item) => {
                      const Icon = item.icon;
                      const isHomesRow = item.id === 'homes';
                      const isActive = activeTab === item.id;
                      const homesExpanded = isHomesRow && activeTab === 'homes' && props.homes.length > 0;
                      return (
                        <div key={item.id}>
                          <button
                            onClick={() => {
                              setActiveTab(item.id);
                              if (isHomesRow) {
                                setSelectedHomeId(null);
                                setHomeSection(null);
                              }
                            }}
                            className={cn(
                              "w-[calc(100%-1rem)] mx-2 flex items-center gap-2 px-3 py-1.5 text-sm transition-colors rounded-lg",
                              isActive && !(isHomesRow && selectedHomeId)
                                ? "bg-muted font-medium text-foreground"
                                : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"
                            )}
                          >
                            <Icon className="h-4 w-4 shrink-0" />
                            <span className="flex-1 text-left">{item.label}</span>
                            {isHomesRow && props.homes.length > 0 && (
                              homesExpanded
                                ? <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                                : <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                            )}
                          </button>
                          {homesExpanded && props.homes.map((home) => {
                            const homeOpen = selectedHomeId === home.id;
                            return (
                              <div key={home.id}>
                                <button
                                  onClick={() => {
                                    setActiveTab('homes');
                                    selectHome(home.id);
                                  }}
                                  className={cn(
                                    "w-[calc(100%-1rem)] mx-2 flex items-center gap-2 pl-7 pr-3 py-1 text-xs transition-colors rounded-lg",
                                    homeOpen && !activeHomeSection
                                      ? "bg-muted font-medium text-foreground"
                                      : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"
                                  )}
                                >
                                  <span className="flex-1 text-left truncate">{home.name}</span>
                                  {homeSections.length > 0 && (
                                    homeOpen
                                      ? <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground" />
                                      : <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground" />
                                  )}
                                </button>
                                {/* Third level. Only the open home expands —
                                    expanding every home would put six rows per
                                    home in a rail that has to stay narrow. The
                                    left border does the indenting that another
                                    round of padding could no longer afford. */}
                                {homeOpen && homeSections.length > 0 && (
                                  <div className="ml-7 mr-2 border-l pl-1.5 py-0.5">
                                    {homeSections.map((id) => (
                                      <button
                                        key={id}
                                        onClick={() => setHomeSection(id)}
                                        title={HOME_SETTINGS_SECTION_META[id].label}
                                        className={cn(
                                          "w-full flex items-center px-2 py-1 text-xs transition-colors rounded-md",
                                          activeHomeSection === id
                                            ? "bg-muted font-medium text-foreground"
                                            : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"
                                        )}
                                      >
                                        <span className="flex-1 text-left truncate">
                                          {HOME_SETTINGS_SECTION_META[id].label}
                                        </span>
                                      </button>
                                    ))}
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      );
                    })}
                  </div>
                ))}
              </nav>

              {/* Content area */}
              <div className="flex-1 min-w-0 overflow-y-auto">
                <div className="p-6">
                  {renderSection(activeTab)}
                </div>
              </div>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
