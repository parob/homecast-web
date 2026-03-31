import { cn } from '@/lib/utils';
import { House, Folder, Layers } from 'lucide-react';
import { getRoomIcon } from '@/components/widgets/roomIcons';
import type { PinnedTab } from '@/lib/graphql/types';

export const MAX_PINNED_TABS = 5;

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
  isDarkBackground,
}: MobileTabBarProps) {
  if (pinnedTabs.length === 0) return null;

  const getIcon = (tab: PinnedTab) => {
    switch (tab.type) {
      case 'home': return House;
      case 'room': return getRoomIcon(tab.name);
      case 'collection': return Folder;
      case 'collectionGroup': return Layers;
    }
  };

  const isActive = (tab: PinnedTab) => {
    switch (tab.type) {
      case 'home': return selectedHomeId === tab.id && !selectedRoomId && !selectedCollectionId;
      case 'room': return selectedRoomId === tab.id;
      case 'collection': return selectedCollectionId === tab.id && !selectedCollectionGroupId;
      case 'collectionGroup': return selectedCollectionGroupId === tab.id;
    }
  };

  const handleTap = (tab: PinnedTab) => {
    switch (tab.type) {
      case 'home': return onSelectHome(tab.id);
      case 'room': return onSelectRoom(tab.homeId!, tab.id);
      case 'collection': return onSelectCollection(tab.id);
      case 'collectionGroup': return onSelectCollectionGroup(tab.collectionId!, tab.id);
    }
  };

  return (
    <div className="fixed bottom-0 left-0 right-0 z-[10001] pointer-events-none safe-area-bottom">
      <div className="flex justify-center px-4 pb-2">
        <div
          className={cn(
            "pointer-events-auto flex items-center gap-1 px-2 py-1.5 rounded-[20px] backdrop-blur-xl transition-colors duration-300",
            isDarkBackground ? "bg-black/40" : "bg-white/70"
          )}
          style={{ maxWidth: 'calc(100% - 32px)' }}
        >
          {pinnedTabs.map((tab) => {
            const Icon = getIcon(tab);
            const active = isActive(tab);
            return (
              <button
                key={`${tab.type}-${tab.id}`}
                onClick={() => handleTap(tab)}
                className={cn(
                  "flex flex-col items-center gap-0.5 px-3 py-1.5 rounded-[14px] min-w-0 transition-colors",
                  active
                    ? isDarkBackground ? "bg-white/20" : "bg-black/10"
                    : "active:bg-white/10"
                )}
              >
                <Icon className={cn(
                  "h-5 w-5 shrink-0",
                  isDarkBackground ? "text-white" : active ? "text-foreground" : "text-muted-foreground"
                )} />
                <span className={cn(
                  "text-[10px] font-medium truncate",
                  isDarkBackground ? "text-white/80" : active ? "text-foreground" : "text-muted-foreground"
                )}>
                  {tab.customName || tab.name}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
