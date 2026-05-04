import { useState, useMemo, useEffect } from 'react';
import { GITHUB_SPONSORS_URL } from '@/lib/donate-config';
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
  Pin,
  User,
  ChevronRight,
  ChevronDown,
  ArrowLeft,
  Tag,
  Bell,
  ExternalLink,
  Copy,
} from 'lucide-react';
import type { HomeKitHome, PinnedTab, UserSettingsData, GetSettingsResponse } from '@/lib/graphql/types';
import { isCommunity } from '@/lib/config';
import { getCloud } from '@/lib/cloud';

// Cloud components — resolved at render time (not module-load time)
// because initCloud() is async and hasn't completed when static imports run.
import { DisplaySection } from './DisplaySection';

import { ApiAccessSection } from './ApiAccessSection';
import { WebhooksSection } from './WebhooksSection';
import { SharedItemsSection } from './SharedItemsSection';
import { HomesSection } from './HomesSection';
import { HomeDetailView } from './HomeDetailView';
// SelfHostedRelaySection imported from @homecast/cloud above
import { TabBarSection } from './TabBarSection';
import { AccountSection } from './AccountSection';
import { NotificationsSection } from './NotificationsSection';

export type SettingsTab = 'plan' | 'smart-deals' | 'display' | 'notifications' | 'api-access' | 'webhooks' | 'sharing' | 'homes' | 'self-hosted-relay' | 'tab-bar' | 'account';

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
  // Tab bar (mobile)
  pinnedTabs: PinnedTab[];
  handleUnpinTab: (type: string, id: string) => void;
  handleUpdateTabName: (type: string, id: string, customName: string | undefined) => void;
  handleReorderTabs: (reordered: PinnedTab[]) => void;
  maxPinnedTabs: number;
  onReplayTutorial?: () => void;
  // Notifications (cloud-only)
  notificationProps?: React.ComponentProps<typeof NotificationsSection>;
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

  const isMobile = useIsMobile();
  const [activeTab, setActiveTab] = useState<SettingsTab>(initialTab || 'plan');
  // On mobile, null means showing the menu list; a tab value means showing that section
  const [mobileSection, setMobileSection] = useState<SettingsTab | null>(null);
  // Desktop: which home is selected within the Homes section (null = show Homes list)
  const [selectedHomeId, setSelectedHomeId] = useState<string | null>(null);

  // Reset to initial tab when dialog opens
  useEffect(() => {
    if (open) {
      setActiveTab(initialTab || 'plan');
      setMobileSection(null);
      setSelectedHomeId(null);
    }
  }, [open, initialTab]);

  // Clear home selection whenever neither the desktop tab nor the mobile section is on 'homes'
  useEffect(() => {
    if (activeTab !== 'homes' && mobileSection !== 'homes' && selectedHomeId) setSelectedHomeId(null);
  }, [activeTab, mobileSection, selectedHomeId]);

  // If developer mode is toggled off and we're on a developer-only tab, fall back to plan
  useEffect(() => {
    if (!developerMode && (activeTab === 'api-access' || activeTab === 'webhooks')) {
      setActiveTab('plan');
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

    if (isRelayCapable() && SelfHostedRelaySection) {
      items.push({ id: 'self-hosted-relay', label: 'Relay', group: 'Device', icon: Cloud });
    }

    if (isInMobileApp) {
      items.push({ id: 'tab-bar', label: 'Tab Bar', group: 'Device', icon: Pin });
    }

    items.push({ id: 'account', label: 'Account', group: 'Account', icon: User });

    return items;
  }, [developerMode, isInMacApp, isInMobileApp, isRelayCapable, launchAtLoginSupported, showSmartDeals]);

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
                  href={window.location.origin}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={openExternalUrl(window.location.origin)}
                  className="inline-flex items-center gap-1.5 text-xs font-medium text-primary hover:underline font-mono truncate"
                >
                  {window.location.origin}
                  <ExternalLink className="h-3 w-3 shrink-0" />
                </a>
                <button
                  type="button"
                  onClick={() => props.copyToClipboard(window.location.origin)}
                  className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                  aria-label="Copy local portal URL"
                >
                  <Copy className="h-3 w-3" />
                  Copy
                </button>
              </div>
            </div>
            <div className="rounded-lg border p-3 space-y-2">
              <p className="text-sm font-medium">Support Homecast</p>
              <p className="text-xs text-muted-foreground">
                Homecast Community is free and open. If you find it useful, consider supporting the project.
              </p>
              <a
                href={GITHUB_SPONSORS_URL}
                target="_blank"
                rel="noopener noreferrer"
                onClick={openExternalUrl(GITHUB_SPONSORS_URL)}
                className="inline-flex items-center gap-1.5 text-xs font-medium text-primary hover:underline"
              >
                Sponsor on GitHub →
              </a>
            </div>
            <div className="rounded-lg border p-3 space-y-2">
              <p className="text-sm font-medium">Want remote access & cloud features?</p>
              <p className="text-xs text-muted-foreground">
                Switch to Homecast Cloud for remote access from anywhere, cloud sync, and more.
              </p>
              <a
                href="https://homecast.cloud/pricing"
                target="_blank"
                rel="noopener noreferrer"
                onClick={openExternalUrl('https://homecast.cloud/pricing')}
                className="inline-flex items-center gap-1.5 text-xs font-medium text-primary hover:underline"
              >
                View plans →
              </a>
            </div>
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
        const selectedHome = selectedHomeId
          ? props.homes.find(h => h.id === selectedHomeId)
          : null;
        if (selectedHome) {
          return (
            <HomeDetailView
              home={selectedHome}
              developerMode={props.developerMode}
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
            onSelectHome={setSelectedHomeId}
          />
        );
      }
      case 'self-hosted-relay':
        return SelfHostedRelaySection ? (
          <SelfHostedRelaySection
            accountType={props.accountType}
          />
        ) : (
          <div className="text-sm text-muted-foreground p-4">Relay settings are not available in Community mode.</div>
        );
      case 'notifications':
        return props.notificationProps ? (
          <NotificationsSection {...props.notificationProps} />
        ) : null;
      case 'tab-bar':
        return (
          <TabBarSection
            pinnedTabs={props.pinnedTabs}
            handleUnpinTab={props.handleUnpinTab}
            handleUpdateTabName={props.handleUpdateTabName}
            handleReorderTabs={props.handleReorderTabs}
            maxPinnedTabs={props.maxPinnedTabs}
          />
        );
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
  const selectedHome = selectedHomeId ? props.homes.find(h => h.id === selectedHomeId) : null;
  const mobileTitle = mobileSection === 'homes' && selectedHome ? selectedHome.name : (mobileSection ? activeLabel : 'Settings');
  const handleMobileBack = () => {
    if (mobileSection === 'homes' && selectedHomeId) {
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
            <div className="flex-1 overflow-y-auto scrollable-content border-t">
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
              {/* Sidebar */}
              <nav className="w-44 shrink-0 border-r overflow-y-auto py-1">
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
                              if (isHomesRow) setSelectedHomeId(null);
                            }}
                            className={cn(
                              "w-full flex items-center gap-2 px-3 py-1.5 text-sm transition-colors rounded-none",
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
                          {homesExpanded && props.homes.map((home) => (
                            <button
                              key={home.id}
                              onClick={() => {
                                setActiveTab('homes');
                                setSelectedHomeId(home.id);
                              }}
                              className={cn(
                                "w-full flex items-center gap-2 pl-9 pr-3 py-1 text-xs transition-colors rounded-none",
                                selectedHomeId === home.id
                                  ? "bg-muted font-medium text-foreground"
                                  : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"
                              )}
                            >
                              <span className="flex-1 text-left truncate">{home.name}</span>
                            </button>
                          ))}
                        </div>
                      );
                    })}
                  </div>
                ))}
              </nav>

              {/* Content area */}
              <div className="flex-1 min-w-0 overflow-y-auto scrollable-content">
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
