import { useCallback, useState } from 'react';
import { cn } from '@/lib/utils';
import { Folder, House, Layers, Loader2, Zap } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { getRoomIcon } from '@/components/widgets/roomIcons';
import { getAccessoryIcon } from '@/components/widgets/serviceIcons';
import { HOME_ACTION_TAB_ICONS } from '@/components/actions/icons';
import { ExpandedOverlay } from '@/components/shared/ExpandedOverlay';
import { MAX_PINNED_TABS, pinBehaviour, pinKey, type PinnedTab } from '@/lib/pinned-tabs';
import type { HomeKitAccessory } from '@/lib/graphql/types';
import type { HomeActionId } from '@/lib/summary-sections';

export { MAX_PINNED_TABS };

/**
 * Whether a pin still points at something.
 *
 * `missing` is deliberately not the same as "hide it". A relay that is merely
 * offline, or a home that has not synced yet, would otherwise silently empty
 * the user's tab bar — so an unresolved tab stays put, dimmed, and says so when
 * pressed. The cached `name` is what it draws in the meantime.
 */
export type PinnedTabStatus = 'ready' | 'loading' | 'missing';

/** Height reserved above the bar so a control panel never sits under it. */
const TAB_BAR_INSET = 76;

interface MobileTabBarProps {
  pinnedTabs: PinnedTab[];
  selectedHomeId: string | null;
  selectedRoomId: string | null;
  selectedCollectionId: string | null;
  selectedCollectionGroupId: string | null;
  onSelectHome: (homeId: string) => void;
  onSelectRoom: (homeId: string, roomId: string) => void;
  onSelectCollection: (collectionId: string) => void;
  onSelectCollectionGroup: (collectionId: string, groupId: string) => void;
  /** Runs a pinned scene or action. Resolves when it's done, for the spinner. */
  onActivate: (tab: PinnedTab) => Promise<void>;
  /** The control panel for a popover-type tab, or null while it can't resolve. */
  renderControl: (tab: PinnedTab) => React.ReactNode;
  /** Looks the pin's target up, so a dead one can be dimmed rather than dropped. */
  resolveStatus: (tab: PinnedTab) => PinnedTabStatus;
  /** For an accessory tab's icon — the same glyph its tile wears. */
  resolveAccessory: (tab: PinnedTab) => HomeKitAccessory | undefined;
  isDarkBackground?: boolean;
}

export function MobileTabBar({
  pinnedTabs,
  selectedHomeId,
  selectedRoomId,
  selectedCollectionId,
  selectedCollectionGroupId,
  onSelectHome,
  onSelectRoom,
  onSelectCollection,
  onSelectCollectionGroup,
  onActivate,
  renderControl,
  resolveStatus,
  resolveAccessory,
  isDarkBackground,
}: MobileTabBarProps) {
  /** Which popover tab is open, by pin key. At most one at a time. */
  const [openKey, setOpenKey] = useState<string | null>(null);
  /** Which run tab is mid-flight, by pin key. */
  const [runningKey, setRunningKey] = useState<string | null>(null);

  const runTab = useCallback(async (tab: PinnedTab) => {
    const key = pinKey(tab);
    setRunningKey(key);
    try {
      await onActivate(tab);
    } finally {
      // Guard against a second press having started something else meanwhile.
      setRunningKey(prev => (prev === key ? null : prev));
    }
  }, [onActivate]);

  if (pinnedTabs.length === 0) return null;

  const getIcon = (tab: PinnedTab): LucideIcon => {
    switch (tab.type) {
      case 'home': return House;
      case 'room': return getRoomIcon(tab.name);
      case 'collection': return Folder;
      case 'collectionGroup': return Layers;
      case 'scene': return Zap;
      // Keyed, not derived: the tab has to draw itself before the home's
      // accessories have loaded, and deriving would leave it blank until then.
      case 'action': return HOME_ACTION_TAB_ICONS[tab.id as HomeActionId] ?? Zap;
      case 'accessory': return getAccessoryIcon(resolveAccessory(tab));
      case 'serviceGroup': return Layers;
    }
  };

  /**
   * Three different meanings of "active", which is the whole point of the bar
   * holding three kinds of pin:
   *
   * - navigate — you are looking at it.
   * - popover  — its panel is open.
   * - run      — never latches. A tab that stayed lit after running "Everything
   *              off" would be claiming to be a place you are, which it isn't.
   */
  const isActive = (tab: PinnedTab): boolean => {
    switch (tab.type) {
      case 'home': return selectedHomeId === tab.id && !selectedRoomId && !selectedCollectionId;
      case 'room': return selectedRoomId === tab.id;
      case 'collection': return selectedCollectionId === tab.id && !selectedCollectionGroupId;
      case 'collectionGroup': return selectedCollectionGroupId === tab.id;
      case 'accessory':
      case 'serviceGroup': return openKey === pinKey(tab);
      case 'action':
      case 'scene': return runningKey === pinKey(tab);
    }
  };

  const handleTap = (tab: PinnedTab, status: PinnedTabStatus) => {
    if (status === 'missing') {
      void onActivate(tab); // Dashboard explains what's gone.
      return;
    }

    switch (pinBehaviour(tab.type)) {
      case 'navigate':
        setOpenKey(null);
        switch (tab.type) {
          case 'home': return onSelectHome(tab.id);
          case 'room': return onSelectRoom(tab.homeId!, tab.id);
          case 'collection': return onSelectCollection(tab.id);
          case 'collectionGroup': return onSelectCollectionGroup(tab.collectionId!, tab.id);
        }
        return;
      case 'popover': {
        const key = pinKey(tab);
        setOpenKey(prev => (prev === key ? null : key));
        return;
      }
      case 'run':
        if (runningKey) return; // Don't queue a second press on a slow relay.
        void runTab(tab);
        return;
    }
  };

  return (
    <div className="fixed bottom-0 left-0 right-0 z-[10001] pointer-events-none safe-area-bottom safe-area-x">
      <div className="flex justify-center px-4 pb-2">
        <div
          className={cn(
            "pointer-events-auto flex items-center gap-1 px-2 py-1.5 rounded-2xl transition-colors duration-300",
            isDarkBackground ? "material-regular-dark" : "material-regular"
          )}
          style={{ maxWidth: 'calc(100% - 32px)' }}
        >
          {pinnedTabs.map((tab) => {
            const key = pinKey(tab);
            const status = resolveStatus(tab);
            const Icon = getIcon(tab);
            const active = isActive(tab);
            const running = runningKey === key;
            const isOpen = openKey === key;
            const missing = status === 'missing';

            return (
              // The overlay anchors to this wrapper rather than the button: its
              // placeholder can't live inside a <button>, and anchoring here
              // makes a press on the open tab count as "inside", so tapping it
              // closes cleanly instead of closing then reopening.
              <div key={key} className="relative">
                <button
                  onClick={() => handleTap(tab, status)}
                  aria-current={active ? 'true' : undefined}
                  aria-disabled={missing || undefined}
                  className={cn(
                    "flex flex-col items-center gap-0.5 px-3 py-1.5 rounded-lg min-w-0 transition-colors",
                    active
                      ? isDarkBackground ? "bg-white/20" : "bg-black/10"
                      : "active:bg-white/10",
                    missing && "opacity-50",
                  )}
                >
                  {running ? (
                    <Loader2 className={cn(
                      "h-5 w-5 shrink-0 animate-spin",
                      isDarkBackground ? "text-white" : "text-foreground",
                    )} />
                  ) : (
                    <Icon className={cn(
                      "h-5 w-5 shrink-0",
                      isDarkBackground ? "text-white" : active ? "text-foreground" : "text-muted-foreground"
                    )} />
                  )}
                  <span className={cn(
                    "text-[10px] font-medium truncate",
                    isDarkBackground ? "text-white/80" : active ? "text-foreground" : "text-muted-foreground"
                  )}>
                    {tab.customName || tab.name}
                  </span>
                </button>

                {isOpen && !missing && (
                  <ExpandedOverlay
                    isExpanded
                    onClose={() => setOpenKey(null)}
                    bottomInset={TAB_BAR_INSET}
                  >
                    {renderControl(tab)}
                  </ExpandedOverlay>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
