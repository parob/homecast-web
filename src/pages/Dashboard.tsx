import React, { useState, useMemo, useCallback, useEffect, useLayoutEffect, useRef, useTransition } from 'react';
import { cn } from '@/lib/utils';
import { config, isCommunity } from '@/lib/config';
import { flushSync } from 'react-dom';
import { Navigate, useSearchParams, useLocation, useNavigate } from 'react-router-dom';
import { useQuery, useLazyQuery, useMutation, useApolloClient } from '@apollo/client/react';
import {
  DndContext,
  closestCenter,
  pointerWithin,
  rectIntersection,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
  DragEndEvent,
  DragStartEvent,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
  rectSortingStrategy,
  defaultAnimateLayoutChanges,
  type AnimateLayoutChanges,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useAuth } from '@/contexts/AuthContext';
import { GET_SESSIONS, SET_SERVICE_GROUP, GET_SETTINGS, UPDATE_SETTINGS, GET_COLLECTIONS, GET_CONNECTION_DEBUG_INFO, GET_ROOM_GROUPS, GET_STORED_ENTITY_LAYOUT, GET_STORED_ENTITIES, GET_ACCOUNT, GET_PENDING_INVITATIONS, GET_VERSION, GET_MY_ENROLLMENTS, GET_PUSH_TOKENS, GET_NOTIFICATION_PREFERENCES } from '@/lib/graphql/queries';
import { SET_CHARACTERISTIC, UPDATE_COLLECTION, DELETE_COLLECTION, DELETE_ROOM_GROUP, UPDATE_ROOM_GROUP, CREATE_CHECKOUT_SESSION, CREATE_PORTAL_SESSION, DOWNGRADE_TO_STANDARD, ACCEPT_HOME_INVITATION, REJECT_HOME_INVITATION, DISMISS_HOME, REGISTER_PUSH_TOKEN, UNREGISTER_PUSH_TOKEN, SET_NOTIFICATION_PREFERENCE, SEND_TEST_NOTIFICATION } from '@/lib/graphql/mutations';
import type { GetSessionsResponse, Session, HomeKitHome, HomeKitAccessory, HomeKitRoom, HomeKitServiceGroup, GetServiceGroupsResponse, SetServiceGroupResponse, SetCharacteristicResponse, GetSettingsResponse, UpdateSettingsResponse, UserSettingsData, PinnedTab, Collection, CollectionGroup, CollectionPayload, GetConnectionDebugInfoResponse, StoredEntity, RoomGroupData, GetCollectionsResponse, GetStoredEntitiesResponse, UpdateCollectionResponse, BackgroundSettings, GetStoredEntityLayoutResponse, GetAccountResponse, CreateCheckoutSessionResponse, CreatePortalSessionResponse, DowngradeToStandardResponse, GetPendingInvitationsResponse, AcceptHomeInvitationResponse, RejectHomeInvitationResponse, MyCloudManagedEnrollmentsResponse, GetPushTokensResponse, GetNotificationPreferencesResponse, RegisterPushTokenResponse, SetNotificationPreferenceResponse, SendTestNotificationResponse } from '@/lib/graphql/types';
import { getDisplayName, parseCollectionPayload, DEVICE_SETTING_KEYS, getDeviceSettings } from '@/lib/graphql/types';
import { useAccessoryUpdates } from '@/hooks/useAccessoryUpdates';
import { serverConnection, getDeviceId } from '@/server/connection';
import { HomecastError } from '@/server/websocket';
import HomeKit, { isRelayCapable, isRelayEnabled } from '@/native/homekit-bridge';
import { setAccessoryLimit as setRelayAccessoryLimit, setAllowedAccessoryIds as setRelayAllowedIds } from '@/relay/local-handler';
import { useHomes, useRooms, useAccessories, useAccessoriesForHomes, useServiceGroups, useAllServiceGroups, updateAccessoryCharacteristicInCache, markPendingUpdate, markGroupPendingUpdate, invalidateHomeKitCache, normalizeAccessories } from '@/hooks/useHomeKitData';
import { useEntitySync } from '@/hooks/useEntitySync';
import { useHomeLayout, useRoomLayout, useCollectionLayout, useCollectionGroupLayout, useRoomGroupLayout } from '@/hooks/useEntityLayout';
import type { HomeLayoutData, RoomLayoutData } from '@/lib/graphql/types';
import { MasonryGrid } from '@/components/MasonryGrid';
import { AreaSummary } from '@/components/summary';
import { AutomationsSection } from '@/components/automations/AutomationsSection';
import { SortableItem } from '@/components/shared/SortableItem';
import { LazyWidget } from '@/components/shared/LazyWidget';
import { DraggableGrid, useDraggableGrid } from '@/components/shared/DraggableGrid';
import { ExpandedOverlay } from '@/components/shared/ExpandedOverlay';
import { AdBanner } from '@/components/ads/AdBanner';
import { DealsProvider, useDeals } from '@/contexts/DealsContext';
import { DealBadge } from '@/components/widgets/DealBadge';
import { findDealForAccessory } from '@/lib/deals';
import { ErrorWithTrace } from '@/components/shared/ErrorWithTrace';
import { getCloud } from '@/lib/cloud';
import { AccessorySearch } from '@/components/AccessorySearch';
import { AccessoryWidget, ServiceGroupWidget, getCharacteristic, getAllCharacteristics, formatCharacteristicType, formatCharacteristicValue, hasServiceType, getPrimaryServiceType, normalizeServiceType, getRoomIcon } from '@/components/widgets';
import { SliderControl } from '@/components/widgets/shared';
import { getIconColor, DEFAULT_ICON_COLOR } from '@/components/widgets/iconColors';
import { WidgetColorContext } from '@/components/widgets/WidgetCard';
import { WebhookListView } from '@/components/webhooks';
import { MobileTabBar, MAX_PINNED_TABS } from '@/components/layout/MobileTabBar';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { AnimatedCollapse } from '@/components/ui/animated-collapse';
import { Switch } from '@/components/ui/switch';
import { Slider } from '@/components/ui/slider';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
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
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  Home, House, RefreshCw, Lightbulb,
  Thermometer, Loader2, Power, Sun, Moon, Lock,
  Wind, Droplets, AlertCircle, DoorOpen, DoorClosed, Camera,
  Plug, Speaker, Tv, Globe, Layers, ChevronDown, ChevronUp, ChevronRight, Blinds,
  Copy, Check, Link, Key, Menu, X, LockOpen, LockKeyhole, GripVertical, Pencil, Server, RotateCcw,
  LayoutGrid, Grid3X3, List, Settings, LogOut, SquarePen, Maximize2, Minimize2, AlertTriangle, FolderPlus, Plus,
  Eye, EyeOff, Trash2, Share2, MoreVertical, Bug, ImageIcon, Users, WifiOff, Search, ArrowDown, Pin, PinOff, FlaskConical, Cloud
} from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
  ContextMenuSeparator,
} from '@/components/ui/context-menu';
import { toast } from 'sonner';
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { useIsMobile } from '@/hooks/use-mobile';
import { CollectionList, CollectionDetail } from '@/components/collections';
import { ShareDialog } from '@/components/shared/ShareDialog';
import { SettingsDialog, type SettingsTab } from '@/components/settings/SettingsDialog';
import { CreateRoomGroupDialog } from '@/components/room-groups';
import { EditRoomGroupDialog } from '@/components/room-groups/EditRoomGroupDialog';
import { AppHeader } from '@/components/layout/AppHeader';
import { StagingSyncLabel, CommunityBadge } from '@/components/layout/StagingBanner';
import { RelayStatusBadge } from '@/components/layout/RelayStatusBadge';
import { BackgroundImage } from '@/components/BackgroundImage';
import { BackgroundSettingsDialog } from '@/components/BackgroundSettingsDialog';
import { AccessorySelectionDialog } from '@/components/AccessorySelectionDialog';
import { useBackgroundDarkness } from '@/hooks/useBackgroundDarkness';
import PullToRefresh from 'react-simple-pull-to-refresh';
import { BackgroundContext } from '@/contexts/BackgroundContext';
import { getAutoPresetId, PRESET_IMAGES, PRESET_SOLID_COLORS, PRESET_GRADIENTS, getDominantColor, applyBrightnessToHex } from '@/lib/colorUtils';
// Cloud admin components — resolved at render time (not module-load time)
// because initCloud() is async and hasn't completed when static imports run.
import { OnboardingOverlay } from '@/components/OnboardingOverlay';
import { TutorialDialog } from '@/components/TutorialDialog';
import type { SetupPath } from '@/components/OnboardingOverlay';
import { SetupState, EnrollmentTrackerCard } from '@/components/SetupState';
import { getPricing, getRegion } from '@/lib/pricing';

const formatTimeAgo = (date: Date): string => {
  const now = new Date();
  const seconds = Math.floor((now.getTime() - date.getTime()) / 1000);

  if (seconds < 10) return 'Just now';
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
};

// Characteristic metadata for dynamic UI rendering
type CharacteristicMeta = {
  controlType: 'toggle' | 'slider' | 'readonly' | 'hidden';
  label: string;
  unit?: string;
  min?: number;
  max?: number;
  icon?: React.ReactNode;
};

const CHARACTERISTIC_META: Record<string, CharacteristicMeta> = {
  // Power controls (toggle)
  'on': { controlType: 'toggle', label: 'Power' },
  'power-state': { controlType: 'toggle', label: 'Power' },

  // Sliders
  'brightness': { controlType: 'slider', label: 'Brightness', unit: '%', min: 0, max: 100 },
  'hue': { controlType: 'slider', label: 'Hue', unit: '°', min: 0, max: 360 },
  'saturation': { controlType: 'slider', label: 'Saturation', unit: '%', min: 0, max: 100 },
  'color_temperature': { controlType: 'slider', label: 'Color Temp', unit: 'K', min: 140, max: 500 },
  'volume': { controlType: 'slider', label: 'Volume', unit: '%', min: 0, max: 100 },
  'rotation_speed': { controlType: 'slider', label: 'Speed', unit: '%', min: 0, max: 100 },
  'target_temperature': { controlType: 'slider', label: 'Target Temp', unit: '°C', min: 10, max: 35 },
  'target_position': { controlType: 'slider', label: 'Position', unit: '%', min: 0, max: 100 },

  // Thermostat
  'heating_cooling_current': { controlType: 'readonly', label: 'Mode' },
  'heating_cooling_target': { controlType: 'slider', label: 'Target Mode', min: 0, max: 3 },
  'heating_threshold': { controlType: 'slider', label: 'Heat To', unit: '°C', min: 10, max: 35 },
  'cooling_threshold': { controlType: 'slider', label: 'Cool To', unit: '°C', min: 10, max: 35 },
  'target_humidity': { controlType: 'slider', label: 'Target Humidity', unit: '%', min: 0, max: 100 },
  'temperature_units': { controlType: 'readonly', label: 'Units' },
  'active': { controlType: 'toggle', label: 'Active' },
  'in_use': { controlType: 'readonly', label: 'In Use' },
  'is_configured': { controlType: 'readonly', label: 'Configured' },
  'program_mode': { controlType: 'readonly', label: 'Program Mode' },

  // Lock
  'lock_current_state': { controlType: 'readonly', label: 'Lock State' },
  'lock_target_state': { controlType: 'toggle', label: 'Lock' },

  // Door/Window
  'current_position': { controlType: 'readonly', label: 'Position', unit: '%' },
  'position_state': { controlType: 'readonly', label: 'Moving' },

  // Security
  'security_system_current_state': { controlType: 'readonly', label: 'Security State' },
  'security_system_target_state': { controlType: 'slider', label: 'Set Security', min: 0, max: 3 },

  // Fan
  'rotation_direction': { controlType: 'toggle', label: 'Direction' },
  'mute': { controlType: 'toggle', label: 'Mute' },

  // Read-only sensors
  'current_temperature': { controlType: 'readonly', label: 'Temperature', unit: '°C' },
  'relative_humidity': { controlType: 'readonly', label: 'Humidity', unit: '%' },
  'current_humidity': { controlType: 'readonly', label: 'Humidity', unit: '%' },
  'battery_level': { controlType: 'readonly', label: 'Battery', unit: '%' },
  'charging_state': { controlType: 'readonly', label: 'Charging' },
  'status_low_battery': { controlType: 'readonly', label: 'Low Battery' },
  'water_level': { controlType: 'readonly', label: 'Water Level', unit: '%' },
  'motion_detected': { controlType: 'readonly', label: 'Motion' },
  'contact_state': { controlType: 'readonly', label: 'Contact' },
  'occupancy_detected': { controlType: 'readonly', label: 'Occupancy' },
  'smoke_detected': { controlType: 'readonly', label: 'Smoke' },
  'carbon_monoxide_detected': { controlType: 'readonly', label: 'CO Detected' },
  'carbon_dioxide_detected': { controlType: 'readonly', label: 'CO₂ Detected' },
  'outlet_in_use': { controlType: 'readonly', label: 'In Use' },
  'status_active': { controlType: 'readonly', label: 'Active' },

  // Hidden (not useful to display)
  'name': { controlType: 'hidden', label: 'Name' },
  'manufacturer': { controlType: 'hidden', label: 'Manufacturer' },
  'model': { controlType: 'hidden', label: 'Model' },
  'serial_number': { controlType: 'hidden', label: 'Serial' },
  'firmware_revision': { controlType: 'hidden', label: 'Firmware' },
  'hardware_revision': { controlType: 'hidden', label: 'Hardware' },
  'identify': { controlType: 'hidden', label: 'Identify' },
};

const getCharacteristicMeta = (type: string): CharacteristicMeta => {
  return CHARACTERISTIC_META[type] || { controlType: 'readonly', label: type };
};

// Parse JSON-encoded characteristic value from server
// Values come as JSON strings: "true", "1", "22.5", "\"text\""
const parseCharacteristicValue = (value: any): any => {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') return value; // Already parsed
  try {
    return JSON.parse(value);
  } catch {
    return value; // Return as-is if not valid JSON
  }
};

// Detect if running inside Mac app WebView (as a function to check dynamically)
// Check for webkit messageHandlers (iOS/macOS) or global flag set by Mac app
const checkIsInMacApp = () => {
  if (typeof window === 'undefined') return false;
  const w = window as any;
  // Explicitly check for Mac app flag first (excludes iOS)
  if (w.isHomecastMacApp) return true;
  // Check for macOS standalone mode (PWA-like)
  if (w.navigator?.standalone && /Mac/.test(navigator.userAgent)) return true;
  // Check webkit messageHandlers but exclude iOS
  if (w.webkit?.messageHandlers?.homecast && !w.isHomecastIOSApp) return true;
  return false;
};

// Detect if running inside a mobile native app WebView (iOS or Android)
const checkIsInMobileApp = () => {
  if (typeof window === 'undefined') return false;
  const w = window as any;
  // iOS native app
  if (w.isHomecastIOSApp) return true;
  // iOS standalone mode (home screen PWA)
  if (w.navigator?.standalone && /iPhone|iPad|iPod/.test(navigator.userAgent)) return true;
  // Android native app (Tauri)
  if (w.isHomecastAndroidApp) return true;
  return false;
};

// Detect if running on a touch-primary device (any mobile browser, native app, PWA)
const checkIsTouchDevice = () => {
  if (typeof window === 'undefined') return false;
  if (checkIsInMobileApp()) return true;
  // pointer: coarse = primary input is a finger (phones, tablets) — excludes
  // laptops with touchscreens (primary pointer is trackpad/mouse = "fine")
  return window.matchMedia('(pointer: coarse)').matches;
};

// Drop indicator line for visual drag feedback
const DropIndicatorLine: React.FC<{ isInGroup?: boolean }> = ({ isInGroup }) => (
  <div className={`h-1 bg-primary rounded-full my-1 ${isInGroup ? 'ml-4' : ''}`} />
);

// Sortable room item for drag-and-drop reordering
interface SortableRoomItemProps {
  room: HomeKitRoom;
  isSelected: boolean;
  hideAccessoryCounts: boolean;
  onSelect: () => void;
  isHiddenUi?: boolean;
  onToggleVisibility?: () => void;
  showHiddenItems?: boolean;
  onToggleShowHidden?: () => void;
  onShare?: () => void;
  onBackgroundSettings?: () => void;
  onPin?: () => void;
  isPinned?: boolean;
  pinFull?: boolean;
  isDarkBackground?: boolean;
  dragDisabled?: boolean;
  disableContextMenu?: boolean;
  editMode?: boolean;
}

const SortableRoomItem: React.FC<SortableRoomItemProps> = ({ room, isSelected, hideAccessoryCounts, onSelect, isHiddenUi, onToggleVisibility, showHiddenItems, onToggleShowHidden, onShare, onBackgroundSettings, onPin, isPinned, pinFull, isDarkBackground, dragDisabled, disableContextMenu, editMode }) => {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: room.id, disabled: dragDisabled, animateLayoutChanges: animateLayoutChangesNoSnapBack });

  const style = {
    transform: CSS.Translate.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  const contentOpacity = isHiddenUi ? 'opacity-40' : '';
  const RoomIcon = getRoomIcon(room.name);

  const wiggleOffset = editMode ? { '--wiggle-offset': `${(room.id.charCodeAt(0) % 5) * 0.05}deg` } as React.CSSProperties : undefined;

  const innerContent = (
    <div ref={setNodeRef} style={style} className="relative cursor-pointer" data-sortable-id={room.id} onClick={onSelect}>
      <div className={editMode ? 'wiggle' : ''} style={wiggleOffset}>
        <button
          {...attributes}
          {...listeners}
          onClick={(e) => { e.stopPropagation(); onSelect(); }}
          className={`relative flex w-full items-center gap-2 rounded-[12px] px-3 py-2 text-left text-sm transition-colors overflow-visible ${isDragging ? 'cursor-grabbing' : ''} ${contentOpacity} ${
            isDarkBackground
              ? `${isSelected ? 'bg-primary text-primary-foreground' : 'text-white hover:bg-white/10'}`
              : `${isSelected ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'}`
          }`}
        >
          <RoomIcon className="h-4 w-4" />
          <span className="flex-1 truncate text-left">{room.name}</span>
          {!hideAccessoryCounts && (
            <span className={`text-xs ${isDarkBackground ? 'text-white/60' : 'text-muted-foreground'}`}>
              {room.accessoryCount}
            </span>
          )}
        </button>
      </div>
    </div>
  );

  if (disableContextMenu) return innerContent;

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        {innerContent}
      </ContextMenuTrigger>
      <ContextMenuContent>
        {onShare && (
          <ContextMenuItem onClick={onShare}>
            <Share2 className="h-4 w-4 mr-2" />
            Share Room
          </ContextMenuItem>
        )}
        {onPin && (
          <ContextMenuItem onClick={onPin} disabled={!isPinned && pinFull}>
            {isPinned ? (
              <>
                <PinOff className="h-4 w-4 mr-2" />
                Unpin from Tab Bar
              </>
            ) : pinFull ? (
              <>
                <Pin className="h-4 w-4 mr-2" />
                Tab Bar Full ({MAX_PINNED_TABS}/{MAX_PINNED_TABS})
              </>
            ) : (
              <>
                <Pin className="h-4 w-4 mr-2" />
                Pin to Tab Bar
              </>
            )}
          </ContextMenuItem>
        )}
        {onToggleVisibility && (
          <ContextMenuItem onClick={onToggleVisibility}>
            {isHiddenUi ? (
              <>
                <Eye className="h-4 w-4 mr-2" />
                Unhide Room
              </>
            ) : (
              <>
                <EyeOff className="h-4 w-4 mr-2" />
                Hide Room
              </>
            )}
          </ContextMenuItem>
        )}
        {onBackgroundSettings && (
          <ContextMenuItem onClick={onBackgroundSettings}>
            <ImageIcon className="h-4 w-4 mr-2" />
            Set Room Background
          </ContextMenuItem>
        )}
        {(onShare || onToggleVisibility || onBackgroundSettings) && onToggleShowHidden && <ContextMenuSeparator />}
        {onToggleShowHidden && (
          <ContextMenuItem onClick={onToggleShowHidden}>
            {showHiddenItems ? (
              <>
                <EyeOff className="h-4 w-4 mr-2" />
                Hide Hidden Items
              </>
            ) : (
              <>
                <Eye className="h-4 w-4 mr-2" />
                Show Hidden Items
              </>
            )}
          </ContextMenuItem>
        )}
      </ContextMenuContent>
    </ContextMenu>
  );
};

// Custom animate layout changes that skips animation on drop to prevent snap-back
const animateLayoutChangesNoSnapBack: AnimateLayoutChanges = (args) => {
  // Skip animation when the item was just dropped (causes snap-back)
  if (args.wasDragging) return false;
  return defaultAnimateLayoutChanges(args);
};

// Tree item structure for sidebar rooms/room groups
interface TreeItem {
  id: string;
  type: 'room' | 'roomGroup';
  data: HomeKitRoom | { id: string; entityId: string; name: string; roomIds: string[]; roomCount: number };
  children: TreeItem[];
}

// Sortable room group item for sidebar display (expandable with rooms inside)
interface SortableRoomGroupItemProps {
  id: string;
  group: { id: string; entityId: string; name: string; roomIds: string[]; roomCount: number };
  isExpanded: boolean;
  hasSelectedChild?: boolean;
  onToggleExpand: () => void;
  onEdit?: () => void;
  onShare?: () => void;
  onDelete?: () => void;
  onBackgroundSettings?: () => void;
  hideAccessoryCounts?: boolean;
  isDarkBackground?: boolean;
  children?: React.ReactNode;
  dropZone?: 'before' | 'inside' | 'after' | null;
  editMode?: boolean;
}

const SortableRoomGroupItem: React.FC<SortableRoomGroupItemProps> = ({
  id,
  group,
  isExpanded,
  hasSelectedChild,
  onToggleExpand,
  onEdit,
  onShare,
  onDelete,
  onBackgroundSettings,
  hideAccessoryCounts,
  isDarkBackground,
  children,
  dropZone,
  editMode,
}) => {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id, animateLayoutChanges: animateLayoutChangesNoSnapBack });

  const style = {
    transform: CSS.Translate.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  const roomGroupWiggleOffset = editMode ? { '--wiggle-offset': `${(group.id.charCodeAt(0) % 5) * 0.05}deg` } as React.CSSProperties : undefined;

  return (
    // Outer container moves with transform, but doesn't capture drag events
    <div ref={setNodeRef} style={style} data-room-group-entity-id={group.entityId} data-sortable-id={id}>
      {dropZone === 'before' && <div className="h-1 bg-primary rounded-full mb-1" />}
      {/* Only the header has drag listeners */}
      <div {...attributes} {...listeners} className={`cursor-pointer ${editMode ? 'wiggle' : ''}`} style={roomGroupWiggleOffset} onClick={(e) => { e.preventDefault(); onToggleExpand(); }}>
        <ContextMenu>
          <ContextMenuTrigger asChild>
            <button
              onClick={(e) => {
                e.stopPropagation();
                e.preventDefault();
                onToggleExpand();
              }}
              className={`relative flex w-full items-center gap-2 rounded-[12px] px-3 py-2 text-left text-sm transition-colors ${isDragging ? 'cursor-grabbing' : ''} ${
                isDarkBackground
                  ? `${hasSelectedChild ? 'text-white bg-white/10' : 'text-white hover:bg-white/10'}`
                  : `${hasSelectedChild ? 'bg-muted' : 'hover:bg-muted'}`
              } ${dropZone === 'inside' ? 'ring-2 ring-primary ring-inset' : ''}`}
            >
              <Layers className="h-4 w-4" />
              <span className="flex-1 truncate text-left">{group.name}</span>
              {!hideAccessoryCounts && (
                <span className={`text-xs ${isDarkBackground ? 'text-white/60' : 'text-muted-foreground'}`}>
                  {group.roomCount}
                </span>
              )}
            </button>
          </ContextMenuTrigger>
          <ContextMenuContent>
            <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground">
              {group.name}
            </div>
            {onEdit && (
              <ContextMenuItem onClick={onEdit}>
                <Pencil className="h-4 w-4 mr-2" />
                Edit Room Group
              </ContextMenuItem>
            )}
            {onShare && (
              <ContextMenuItem onClick={onShare}>
                <Share2 className="h-4 w-4 mr-2" />
                Share Room Group
              </ContextMenuItem>
            )}
            {onDelete && (
              <ContextMenuItem onClick={onDelete} className="text-destructive focus:text-destructive">
                <Trash2 className="h-4 w-4 mr-2" />
                Delete Room Group
              </ContextMenuItem>
            )}
            {onBackgroundSettings && (
              <ContextMenuItem onClick={onBackgroundSettings}>
                <ImageIcon className="h-4 w-4 mr-2" />
                Set Room Group Background
              </ContextMenuItem>
            )}
          </ContextMenuContent>
        </ContextMenu>
      </div>
      {/* Children inside the container so they move with the group */}
      {children}
      {dropZone === 'after' && <div className="h-1 bg-primary rounded-full mt-1" />}
    </div>
  );
};

// Sortable room item for inside room groups (simpler version)
interface SortableGroupRoomItemProps {
  id: string; // Explicit sortable ID (prefixed for grouped rooms)
  room: HomeKitRoom;
  isSelected: boolean;
  hideAccessoryCounts?: boolean;
  onSelect: () => void;
  onBackgroundSettings?: () => void;
  disabled?: boolean;
  editMode?: boolean;
}

const SortableGroupRoomItem: React.FC<SortableGroupRoomItemProps> = ({
  id,
  room,
  isSelected,
  hideAccessoryCounts,
  onSelect,
  onBackgroundSettings,
  disabled,
  editMode,
}) => {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id, animateLayoutChanges: animateLayoutChangesNoSnapBack, disabled });

  const style = {
    transform: CSS.Translate.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  const RoomIcon = getRoomIcon(room.name);
  const groupRoomWiggleOffset = editMode ? { '--wiggle-offset': `${(room.id.charCodeAt(0) % 5) * 0.05}deg` } as React.CSSProperties : undefined;

  return (
    <div ref={setNodeRef} style={style} data-sortable-id={id} className="cursor-pointer" onClick={onSelect}>
      <div className={editMode ? 'wiggle' : ''} style={groupRoomWiggleOffset}>
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <button
            {...attributes}
            {...listeners}
            onClick={(e) => { e.stopPropagation(); onSelect(); }}
            className={`relative flex w-full items-center gap-2 rounded-[12px] px-3 py-2 text-left text-sm transition-colors ${
              isDragging ? 'cursor-grabbing' : ''
            } ${isSelected ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'}`}
          >
            <RoomIcon className="h-4 w-4" />
            <span className="flex-1 truncate">{room.name}</span>
            {!hideAccessoryCounts && (
              <span className="text-xs text-muted-foreground">
                {room.accessoryCount}
              </span>
            )}
          </button>
        </ContextMenuTrigger>
        <ContextMenuContent>
          {onBackgroundSettings && (
            <ContextMenuItem onClick={onBackgroundSettings}>
              <ImageIcon className="h-4 w-4 mr-2" />
              Set Room Background
            </ContextMenuItem>
          )}
        </ContextMenuContent>
      </ContextMenu>
      </div>
    </div>
  );
};

// Sortable home item for drag-and-drop reordering
interface SortableHomeItemProps {
  onShare?: () => void;
  home: HomeKitHome;
  isSelected: boolean;
  hasSelectedChild?: boolean;
  hideAccessoryCounts: boolean;
  onSelect: () => void;
  isHiddenUi?: boolean;
  onToggleVisibility?: () => void;
  onDismiss?: () => void;
  isLoading?: boolean;
  showHiddenItems?: boolean;
  onToggleShowHidden?: () => void;
  onCreateRoomGroup?: () => void;
  onBackgroundSettings?: () => void;
  onCloudRelay?: () => void;
  onPin?: () => void;
  isPinned?: boolean;
  pinFull?: boolean;
  dragDisabled?: boolean;
  disableContextMenu?: boolean;
  children?: React.ReactNode;
  isDarkBackground?: boolean;
  editMode?: boolean;
}

const SortableHomeItem: React.FC<SortableHomeItemProps> = ({ home, isSelected, hasSelectedChild, hideAccessoryCounts, onSelect, isHiddenUi, onToggleVisibility, onDismiss, isLoading, showHiddenItems, onToggleShowHidden, onShare, onCreateRoomGroup, onBackgroundSettings, onCloudRelay, onPin, isPinned, pinFull, dragDisabled, disableContextMenu, children, isDarkBackground, editMode }) => {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: home.id, disabled: dragDisabled });

  const style = {
    transform: CSS.Translate.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  const contentOpacity = isHiddenUi ? 'opacity-40' : '';
  const wiggleOffset = editMode ? { '--wiggle-offset': `${(home.id.charCodeAt(0) % 5) * 0.05}deg` } as React.CSSProperties : undefined;

  const buttonContent = (
    <div ref={setNodeRef} style={style} className="relative cursor-pointer" onClick={onSelect}>
      <div className={editMode ? 'wiggle' : ''} style={wiggleOffset}>
        <button
          {...attributes}
          {...listeners}
          onClick={(e) => { e.stopPropagation(); onSelect(); }}
          disabled={isLoading}
          className={`relative flex w-full items-center gap-2 rounded-[12px] px-3 py-2 text-left text-sm transition-colors overflow-visible ${isDragging ? 'cursor-grabbing' : ''} ${contentOpacity} ${
            isDarkBackground
              ? `${hasSelectedChild ? 'text-white bg-white/10' : isSelected ? 'bg-primary text-primary-foreground' : 'text-white hover:bg-white/10'}`
              : `${hasSelectedChild ? 'bg-muted' : isSelected ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'}`
          }`}
        >
          {isLoading && isSelected ? <Loader2 className="h-4 w-4 animate-spin" /> : <House className="h-4 w-4" />}
          <span className="flex-1 truncate text-left">{home.name}</span>
          {home.role && home.role !== 'owner' && (
            home.isCloudManaged
              ? <TooltipProvider delayDuration={300}>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span className="inline-flex"><Cloud className={`h-3 w-3 ${isDarkBackground ? 'text-white/50' : isSelected && !hasSelectedChild ? 'text-primary-foreground/60' : 'text-muted-foreground'}`} /></span>
                    </TooltipTrigger>
                    <TooltipContent side="bottom"><p className="text-xs">Cloud Relay{home.ownerEmail ? ` · ${home.ownerEmail}` : ''}</p></TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              : <TooltipProvider delayDuration={300}>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span className="inline-flex"><Users className={`h-3 w-3 ${isDarkBackground ? 'text-white/50' : isSelected && !hasSelectedChild ? 'text-primary-foreground/60' : 'text-muted-foreground'}`} /></span>
                    </TooltipTrigger>
                    <TooltipContent side="bottom"><p className="text-xs">Shared by {home.ownerEmail || 'another user'}</p></TooltipContent>
                  </Tooltip>
                </TooltipProvider>
          )}
          {!hideAccessoryCounts && home.accessoryCount > 0 && (
            <span className={`text-xs ${isDarkBackground ? 'text-white/60' : isSelected && !hasSelectedChild ? 'text-primary-foreground/70' : 'text-muted-foreground'}`}>
              {home.accessoryCount}
            </span>
          )}
        </button>
      </div>
    </div>
  );

  if (disableContextMenu) return (
    <div>
      {buttonContent}
      {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions */}
      <div onClick={(e) => e.stopPropagation()}>
        {children}
      </div>
    </div>
  );

  return (
    <div>
      <ContextMenu>
        <ContextMenuTrigger asChild>
          {buttonContent}
        </ContextMenuTrigger>
        <ContextMenuContent>
          {onShare && (
            <ContextMenuItem onClick={onShare}>
              <Share2 className="h-4 w-4 mr-2" />
              Share Home
            </ContextMenuItem>
          )}
          {onCreateRoomGroup && (
            <ContextMenuItem onClick={onCreateRoomGroup}>
              <Layers className="h-4 w-4 mr-2" />
              Create Room Group
            </ContextMenuItem>
          )}
          {onPin && (
            <ContextMenuItem onClick={onPin} disabled={!isPinned && pinFull}>
              {isPinned ? (
                <>
                  <PinOff className="h-4 w-4 mr-2" />
                  Unpin from Tab Bar
                </>
              ) : pinFull ? (
                <>
                  <Pin className="h-4 w-4 mr-2" />
                  Tab Bar Full ({MAX_PINNED_TABS}/{MAX_PINNED_TABS})
                </>
              ) : (
                <>
                  <Pin className="h-4 w-4 mr-2" />
                  Pin to Tab Bar
                </>
              )}
            </ContextMenuItem>
          )}
          {onToggleVisibility && (
            <ContextMenuItem onClick={onToggleVisibility}>
              {isHiddenUi ? (
                <>
                  <Eye className="h-4 w-4 mr-2" />
                  Unhide Home
                </>
              ) : (
                <>
                  <EyeOff className="h-4 w-4 mr-2" />
                  Hide Home
                </>
              )}
            </ContextMenuItem>
          )}
          {onDismiss && (
            <ContextMenuItem onClick={onDismiss} className="text-destructive">
              <Trash2 className="h-4 w-4 mr-2" />
              Remove Home
            </ContextMenuItem>
          )}
          {onBackgroundSettings && (
            <ContextMenuItem onClick={onBackgroundSettings}>
              <ImageIcon className="h-4 w-4 mr-2" />
              Set Home Background
            </ContextMenuItem>
          )}
          {onCloudRelay && (
            <ContextMenuItem onClick={onCloudRelay}>
              <Cloud className="h-4 w-4 mr-2" />
              Cloud Relay
            </ContextMenuItem>
          )}
          {(onShare || onCreateRoomGroup || onToggleVisibility || onBackgroundSettings) && onToggleShowHidden && <ContextMenuSeparator />}
          {onToggleShowHidden && (
            <ContextMenuItem onClick={onToggleShowHidden}>
              {showHiddenItems ? (
                <>
                  <EyeOff className="h-4 w-4 mr-2" />
                  Hide Hidden Items
                </>
              ) : (
                <>
                  <Eye className="h-4 w-4 mr-2" />
                  Show Hidden Items
                </>
              )}
            </ContextMenuItem>
          )}
        </ContextMenuContent>
      </ContextMenu>
      {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions */}
      <div onClick={(e) => e.stopPropagation()}>
        {children}
      </div>
    </div>
  );
};

// Sortable group item for collection groups drag-and-drop reordering
interface SortableGroupItemProps {
  group: { id: string; name: string };
  isSelected: boolean;
  onSelect: () => void;
  accessoryCount?: number;
  hideAccessoryCounts?: boolean;
  onShare?: () => void;
  onSelectAccessories?: () => void;
  onRename?: () => void;
  onDelete?: () => void;
  onBackgroundSettings?: () => void;
  onPin?: () => void;
  isPinned?: boolean;
  pinFull?: boolean;
  isDarkBackground?: boolean;
  dragDisabled?: boolean;
  disableContextMenu?: boolean;
  editMode?: boolean;
}

const SortableGroupItem: React.FC<SortableGroupItemProps> = ({ group, isSelected, onSelect, accessoryCount = 0, hideAccessoryCounts, onShare, onSelectAccessories, onRename, onDelete, onBackgroundSettings, onPin, isPinned, pinFull, isDarkBackground, dragDisabled, disableContextMenu, editMode }) => {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: group.id, disabled: dragDisabled });

  const style = {
    transform: CSS.Translate.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  const groupItemWiggleOffset = editMode ? { '--wiggle-offset': `${(group.id.charCodeAt(0) % 5) * 0.05}deg` } as React.CSSProperties : undefined;

  const innerContent = (
    <div ref={setNodeRef} style={style} className="relative cursor-pointer" onClick={onSelect}>
      <div className={editMode ? 'wiggle' : ''} style={groupItemWiggleOffset}>
      <button
        {...attributes}
        {...listeners}
        onClick={(e) => { e.stopPropagation(); onSelect(); }}
        className={`relative flex w-full items-center gap-2 rounded-[12px] px-3 py-2 text-left text-sm transition-colors overflow-visible ${isDragging ? 'cursor-grabbing' : ''} ${
          isDarkBackground
            ? `${isSelected ? 'bg-primary text-primary-foreground' : 'text-white hover:bg-white/10'}`
            : `${isSelected ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'}`
        }`}
      >
        <Layers className="h-4 w-4" />
        <span className="flex-1 truncate text-left">{group.name}</span>
        {!hideAccessoryCounts && (
          <span className={`text-xs ${
            isDarkBackground
              ? 'text-white/70'
              : isSelected ? 'text-primary-foreground/70' : 'text-muted-foreground'
          }`}>
            {accessoryCount}
          </span>
        )}
      </button>
      </div>
    </div>
  );

  if (disableContextMenu) return innerContent;

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        {innerContent}
      </ContextMenuTrigger>
      <ContextMenuContent>
        <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground">
          {group.name}
        </div>
        {onShare && (
          <ContextMenuItem onClick={onShare}>
            <Share2 className="h-4 w-4 mr-2" />
            Share Group
          </ContextMenuItem>
        )}
        {onPin && (
          <ContextMenuItem onClick={onPin} disabled={!isPinned && pinFull}>
            {isPinned ? (
              <>
                <PinOff className="h-4 w-4 mr-2" />
                Unpin from Tab Bar
              </>
            ) : pinFull ? (
              <>
                <Pin className="h-4 w-4 mr-2" />
                Tab Bar Full ({MAX_PINNED_TABS}/{MAX_PINNED_TABS})
              </>
            ) : (
              <>
                <Pin className="h-4 w-4 mr-2" />
                Pin to Tab Bar
              </>
            )}
          </ContextMenuItem>
        )}
        {onSelectAccessories && (
          <ContextMenuItem onClick={onSelectAccessories}>
            <Plus className="h-4 w-4 mr-2" />
            Select Accessories
          </ContextMenuItem>
        )}
        {onRename && (
          <ContextMenuItem onClick={onRename}>
            <Pencil className="h-4 w-4 mr-2" />
            Rename Group
          </ContextMenuItem>
        )}
        {onDelete && (
          <ContextMenuItem onClick={onDelete} className="text-destructive focus:text-destructive">
            <Trash2 className="h-4 w-4 mr-2" />
            Delete Group
          </ContextMenuItem>
        )}
        {onBackgroundSettings && (
          <ContextMenuItem onClick={onBackgroundSettings}>
            <ImageIcon className="h-4 w-4 mr-2" />
            Set Group Background
          </ContextMenuItem>
        )}
      </ContextMenuContent>
    </ContextMenu>
  );
};

// SortableItem imported from shared components

// ExpandedOverlay imported from shared components

// Category order for sorting accessories by type
const CATEGORY_ORDER = [
  'Lights', 'Switches', 'Climate', 'Fans', 'Blinds & Shades',
  'Security', 'Doors', 'Sensors', 'Cameras', 'Audio',
  'Water', 'Buttons & Remotes', 'Bridges & Hubs', 'Other'
];

/** Renders a deal badge for an accessory. Must be inside DealsProvider so useDeals() reads the correct context. */
function AccessoryDealBadge({ accessory }: { accessory: import('@/lib/graphql/types').HomeKitAccessory }) {
  const { deals } = useDeals();
  if (!deals?.length) return null;
  const match = findDealForAccessory(accessory, deals);
  if (!match) return null;
  return <DealBadge deal={match.deal} isRelated={match.isRelated} />;
}

const Dashboard = () => {
  // Cloud admin components — resolved at render time so initCloud() has completed
  const _cloud = getCloud();
  const AdminDashboard = _cloud?.AdminDashboard ?? null;
  const AdminUsers = _cloud?.AdminUsers ?? null;
  const UserDetail = _cloud?.UserDetail ?? null;
  const AdminSessions = _cloud?.AdminSessions ?? null;
  const AdminWebhooks = _cloud?.AdminWebhooks ?? null;
  const AdminEnrollments = _cloud?.AdminEnrollments ?? null;
  const AdminDeals = _cloud?.AdminDeals ?? null;
  const AdminHomeKit = _cloud?.AdminHomeKit ?? null;
  const AdminDevices = _cloud?.AdminDevices ?? null;
  const AdminListings = _cloud?.AdminListings ?? null;
  const AdminActiveDeals = _cloud?.AdminActiveDeals ?? null;
  const AdminTasks = _cloud?.AdminTasks ?? null;
  const AdminApprovals = _cloud?.AdminApprovals ?? null;
  const AdminLogs = _cloud?.AdminLogs ?? null;
  const AdminObservability = _cloud?.AdminObservability ?? null;
  const AdminReliability = _cloud?.AdminReliability ?? null;
  const AdminInfrastructure = _cloud?.AdminInfrastructure ?? null;
  const AdminInfrastructurePods = _cloud?.AdminInfrastructurePods ?? null;
  const AdminInfrastructurePodDetail = _cloud?.AdminInfrastructurePodDetail ?? null;
  const AdminInfrastructureMqtt = _cloud?.AdminInfrastructureMqtt ?? null;
  const AdminInfrastructureDatabase = _cloud?.AdminInfrastructureDatabase ?? null;
  const AdminDebug = _cloud?.AdminDebug ?? null;
  const AdminDebugInfo = _cloud?.AdminDebugInfo ?? null;
  const AdminMetrics = _cloud?.AdminMetrics ?? null;
  const AdminAnalytics = _cloud?.AdminAnalytics ?? null;
  const AdminConnections = _cloud?.AdminConnections ?? null;
  const AdminSidebar = _cloud?.AdminSidebar ?? null;
  const TaskDialog = _cloud?.TaskDialog ?? null;
  const ManagedRelayDashboard = _cloud?.ManagedRelayDashboard ?? null;

  // Check if mobile viewport
  const isMobile = useIsMobile();
  // Router hooks for admin panel
  const location = useLocation();
  const navigate = useNavigate();
  // Apollo client for cache operations
  const apolloClient = useApolloClient();
  // Mobile sidebar open state
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // Check if in Mac app - use state so it can update after mount
  const [isInMacApp, setIsInMacApp] = useState(false);
  // Check if in iOS app - use state so it can update after mount
  const [isInMobileApp, setIsInIOSApp] = useState(false);
  // Touch-primary device (mobile Safari, native app, PWA) — gates DnD behind edit mode
  const [isTouchDevice, setIsTouchDevice] = useState(false);
  // Edit mode for drag-and-drop reordering (touch devices: off by default, must toggle on)
  const [editMode, setEditMode] = useState(false);
  // Track relay connection state (for Mac app mode)
  // In Community mode, there's no cloud WebSocket — the relay talks to HomeKit directly
  // Initialize from current relay state in case component mounts after relay is already connected
  const [serverConnected, setServerConnected] = useState(() => {
    if (isCommunity && isRelayCapable()) return true; // Relay Mac: always "connected" (local HomeKit)
    const state = serverConnection.getState();
    if (import.meta.env.DEV) console.log('[Dashboard] Initial relay state:', state.connectionState, 'relayStatus:', state.relayStatus);
    // For relay-capable devices, wait until relay role is assigned before considering
    // the connection "ready" for data fetching. This prevents a race condition where
    // hooks start fetching before isActiveRelay is set, causing requests to go through
    // the server instead of being handled locally.
    if (isRelayEnabled()) {
      return state.connectionState === 'connected' && state.relayStatus !== null;
    }
    return state.connectionState === 'connected';
  });
  // Track active relay status (server-controlled): true = this device is the active relay
  const [isActiveRelay, setIsActiveRelay] = useState(() => serverConnection.getRelayStatus() === true);

  useEffect(() => {
    // Check immediately and also after a short delay (WebKit bridge might not be ready)
    const check = () => {
      const w = window as any;
      const macResult = checkIsInMacApp();
      const iosResult = checkIsInMobileApp();
      if (import.meta.env.DEV) console.log('[Dashboard] App detection:', { mac: macResult, ios: iosResult }, {
        webkit: !!w.webkit,
        messageHandlers: !!w.webkit?.messageHandlers,
        homecast: !!w.webkit?.messageHandlers?.homecast,
        isHomecastMacApp: !!w.isHomecastMacApp,
        isHomecastIOSApp: !!w.isHomecastIOSApp,
        standalone: !!w.navigator?.standalone,
        userAgent: navigator.userAgent.substring(0, 50)
      });
      const touchResult = checkIsTouchDevice();
      return { mac: macResult, ios: iosResult, touch: touchResult };
    };
    const result = check();
    setIsInMacApp(result.mac);
    setIsInIOSApp(result.ios);
    setIsTouchDevice(result.touch);
    const timer = setTimeout(() => {
      const result = check();
      setIsInMacApp(result.mac);
      setIsInIOSApp(result.ios);
      setIsTouchDevice(result.touch);
    }, 100);
    return () => clearTimeout(timer);
  }, []);

  // Subscribe to relay connection state
  // In Community mode on relay Mac, skip — always "connected" via local HomeKit bridge
  useEffect(() => {
    if (isCommunity && isRelayCapable()) {
      setServerConnected(true);
      setIsActiveRelay(true);
      return;
    }
    if (import.meta.env.DEV) console.log('[Dashboard] Subscribing to relay state');
    const unsubscribe = serverConnection.subscribe((state) => {
      // For relay-enabled devices, defer "connected" until relay role is known
      const isConnected = isRelayEnabled()
        ? state.connectionState === 'connected' && state.relayStatus !== null
        : state.connectionState === 'connected';
      if (import.meta.env.DEV) console.log('[Dashboard] Server connection state:', state.connectionState, 'relayStatus:', state.relayStatus, '-> serverConnected:', isConnected);
      setServerConnected(isConnected);
      setIsActiveRelay(state.relayStatus === true);
    });
    return () => {
      if (import.meta.env.DEV) console.log('[Dashboard] Unsubscribing from relay state');
      unsubscribe();
    };
  }, []);


  const { user, isAuthenticated, isAdmin, hasStagingAccess, isLoading: authLoading, logout, resetAndUninstall } = useAuth();

  const [searchParams, setSearchParams] = useSearchParams();

  // Check if URL has collection - if so, don't load home from localStorage
  const urlCollectionId = searchParams.get('collection');

  const [selectedHomeId, setSelectedHomeIdRaw] = useState<string | null>(() => {
    // If URL has collection, don't select a home
    if (urlCollectionId) return null;
    // Check URL first, then localStorage
    const urlHome = searchParams.get('home');
    if (urlHome) return urlHome;
    return localStorage.getItem('homecast-selected-home');
  });
  // Selected collection (when viewing a collection instead of home accessories)
  const [selectedCollection, setSelectedCollection] = useState<Collection | null>(null);
  const [selectedCollectionId, setSelectedCollectionId] = useState<string | null>(() => {
    return urlCollectionId;
  });
  const [selectedEnrollmentId, setSelectedEnrollmentId] = useState<string | null>(() => {
    return searchParams.get('enrollment');
  });
  const [collectionsLoading, setCollectionsLoading] = useState(false);
  const [isManualRefreshing, setIsManualRefreshing] = useState(false);
  const refreshAllRef = useRef<() => void>(() => {});
  const pullMaxDeltaRef = useRef(0);
  const [hardReloadCountdown, setHardReloadCountdown] = useState<number | null>(null);
  const hardReloadTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const refetchCollectionsRef = useRef<(() => Promise<void>) | null>(null);
  // Pending home ID updates immediately for sidebar, while selectedHomeId transitions for content
  const [pendingHomeId, setPendingHomeId] = useState<string | null>(() => {
    // If URL has collection, don't select a home
    if (urlCollectionId) return null;
    // Check URL first (same as selectedHomeId), then localStorage
    const urlHome = searchParams.get('home');
    if (urlHome) return urlHome;
    return localStorage.getItem('homecast-selected-home');
  });
  // Update both pending and selected home IDs synchronously.
  // useTransition was causing 5s delays on the relay Mac because observation events
  // (low-priority transitions) kept getting queued ahead of the home switch.
  const isHomeSwitching = false; // No deferred state = no spinner needed

  const setSelectedHomeId = useCallback((homeId: string | null) => {
    setPendingHomeId(homeId);
    setSelectedHomeIdRaw(homeId);
  }, []);

  const [selectedRoomId, setSelectedRoomId] = useState<string | null>(() => {
    // If URL has collection, don't select a room
    if (urlCollectionId) return null;
    // Check URL first, then localStorage
    const urlRoom = searchParams.get('room');
    if (urlRoom) return urlRoom;
    return localStorage.getItem('homecast-selected-room');
  });

  // Search
  const [searchOpen, setSearchOpen] = useState(false);
  const searchInitialKeyRef = useRef('');

  // Delay showing the "Connecting..." overlay by 3s to avoid flashing during brief reconnects
  const [showConnectingOverlay, setShowConnectingOverlay] = useState(false);
  useEffect(() => {
    if (!isInMacApp) return;
    if (serverConnected) {
      setShowConnectingOverlay(false);
      return;
    }
    const timer = setTimeout(() => setShowConnectingOverlay(true), 3000);
    return () => clearTimeout(timer);
  }, [serverConnected, isInMacApp]);

  // Track connecting overlay state in a ref so the keyboard handler (empty deps) can read it
  const isConnectingOverlay = showConnectingOverlay || isManualRefreshing;
  const isConnectingOverlayRef = useRef(isConnectingOverlay);
  isConnectingOverlayRef.current = isConnectingOverlay;

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (isConnectingOverlayRef.current) return;
      // Cmd/Ctrl+K to open search
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        searchInitialKeyRef.current = '';
        setSearchOpen(true);
        return;
      }
      // Auto-type: open search when typing with no focused input
      const target = e.target as HTMLElement;
      const tag = target.tagName.toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select' || target.isContentEditable) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key.length !== 1) return; // Only printable characters
      searchInitialKeyRef.current = e.key;
      setSearchOpen(true);
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Track raw pull distance for hard-reload detection (pull super far = full page reload)
  useEffect(() => {
    let startY = 0;
    const onStart = (e: TouchEvent) => { startY = e.touches[0].clientY; pullMaxDeltaRef.current = 0; };
    const onMove = (e: TouchEvent) => {
      const delta = e.touches[0].clientY - startY;
      if (delta > pullMaxDeltaRef.current) pullMaxDeltaRef.current = delta;
    };
    document.addEventListener('touchstart', onStart, { passive: true });
    document.addEventListener('touchmove', onMove, { passive: true });
    return () => {
      document.removeEventListener('touchstart', onStart);
      document.removeEventListener('touchmove', onMove);
    };
  }, []);

  // Entity-based layout hooks (StoredEntity) - must be defined early as they're used in callbacks
  const {
    layout: homeLayout,
    layoutJson: homeLayoutJson,
    loading: homeLayoutLoading,
    updateLayout: updateHomeLayout,
    refetch: refetchHomeLayout,
  } = useHomeLayout(selectedHomeId);

  const {
    layout: roomLayout,
    layoutJson: roomLayoutJson,
    loading: roomLayoutLoading,
    updateLayout: updateRoomLayout,
    saveLayoutForEntity: saveRoomLayoutForEntity,
    refetch: refetchRoomLayout,
  } = useRoomLayout(selectedRoomId);

  // NOTE: Collection layout hooks moved below after selectedCollectionGroupId is defined

  // Helper to update URL params
  const updateUrlParams = useCallback((params: { collection?: string | null; home?: string | null; room?: string | null; enrollment?: string | null; settings?: string | null }) => {
    setSearchParams(prev => {
      const newParams = new URLSearchParams(prev);
      for (const [key, value] of Object.entries(params)) {
        if (value === undefined) continue;
        if (value) newParams.set(key, value);
        else newParams.delete(key);
      }
      return newParams;
    }, { replace: true });
  }, [setSearchParams]);

  // Track whether sidebar rooms/groups are expanded (for toggle on re-click)
  const [sidebarRoomsExpanded, setSidebarRoomsExpanded] = useState(true);
  const [sidebarGroupsExpanded, setSidebarGroupsExpanded] = useState(true);

  // Track which service groups are expanded
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  // Track which individual widget is expanded (for click-to-expand in compact mode)
  const [expandedWidgetId, setExpandedWidgetId] = useState<string | null>(null);
  // All user settings - loaded from backend, defaults applied until loaded
  const [compactMode, setCompactModeRaw] = useState<boolean>(true);
  const [isCompactModeTransitioning, startCompactModeTransition] = useTransition();
  const [hideInfoDevices, setHideInfoDevices] = useState<boolean>(true);
  const [hideAccessoryCounts, setHideAccessoryCounts] = useState<boolean>(true);
  const [layoutMode, setLayoutMode] = useState<'grid' | 'masonry'>('masonry');
  const [groupByRoom, setGroupByRoom] = useState<boolean>(true);
  const [groupByType, setGroupByType] = useState<boolean>(false);
  const [iconStyle, setIconStyle] = useState<'standard' | 'colourful'>('colourful');
  const [fontSize, setFontSize] = useState<'small' | 'medium' | 'large'>('large');
  const [autoBackgrounds, setAutoBackgrounds] = useState<boolean>(false);
  const [fullWidth, setFullWidth] = useState<boolean>(true);
  const [developerMode, setDeveloperMode] = useState<boolean>(false);
  const [roomOrderByHome, setRoomOrderByHome] = useState<Record<string, string[]>>({});
  const [homeOrder, setHomeOrder] = useState<string[]>([]);

  // Track which home the current accessories data belongs to (prevents flash when switching homes)
  const [accessoriesHomeId, setAccessoriesHomeId] = useState<string | null>(null);
  // Consolidated visibility settings (UI only)
  const [visibility, setVisibility] = useState<{
    ui: {
      hiddenHomes: string[];
      hiddenRooms: Record<string, string[]>;
      hiddenGroups: Record<string, string[]>;
      hiddenDevices: Record<string, Record<string, string[]>>;
    };
  }>({
    ui: { hiddenHomes: [], hiddenRooms: {}, hiddenGroups: {}, hiddenDevices: {} },
  });
  // Unified item order for groups and accessories (groups prefixed with 'group-')
  const [itemOrder, setItemOrder] = useState<Record<string, Record<string, string[]>>>({});
  // Collection item order (collectionId -> accessoryId[])
  const [collectionItemOrder, setCollectionItemOrder] = useState<Record<string, string[]>>({});
  // Mobile tab bar pinned items
  const [pinnedTabs, setPinnedTabs] = useState<PinnedTab[]>([]);

  // Temporarily show hidden items (homes, rooms, accessories) for unhiding
  const [showHiddenItems, setShowHiddenItems] = useState(false);
  // Version counter to force re-renders when visibility changes
  const [visibilityVersion, setVisibilityVersion] = useState(0);
  // Version counter to force re-renders when item order changes (for home view cache reads)
  const [itemOrderVersion, setItemOrderVersion] = useState(0);

  // Collection editing state (lifted from CollectionDetail for toolbar buttons)
  const [collectionAddingGroup, setCollectionAddingGroup] = useState(false);
  const [collectionAddItemsOpen, setCollectionAddItemsOpen] = useState(false);
  const [selectedCollectionGroupId, setSelectedCollectionGroupId] = useState<string | null>(null);

  // Last viewed navigation state (synced to server settings)
  const [lastView, setLastView] = useState<UserSettingsData['lastView']>();
  const lastViewRestoredRef = useRef(false);
  const hadUrlParamsRef = useRef(!!searchParams.get('home') || !!searchParams.get('collection'));
  const lastViewTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveSettingsRef = useRef<((updates: Partial<UserSettingsData>, settingName: string) => Promise<boolean>) | null>(null);

  // Debounced save for last viewed navigation state (defined early via ref so nav handlers can use it)
  const debouncedSaveLastView = useCallback((view: UserSettingsData['lastView']) => {
    setLastView(view);
    if (lastViewTimerRef.current) clearTimeout(lastViewTimerRef.current);
    lastViewTimerRef.current = setTimeout(() => {
      saveSettingsRef.current?.({ lastView: view }, 'lastView');
    }, 2000);
  }, []);

  // Cleanup debounce timer on unmount
  useEffect(() => {
    return () => {
      if (lastViewTimerRef.current) clearTimeout(lastViewTimerRef.current);
    };
  }, []);

  // Handle collection group selection (wraps setter + saves lastView)
  const handleSelectCollectionGroup = useCallback((groupId: string | null) => {
    setSelectedCollectionGroupId(groupId);
    if (selectedCollectionId) {
      debouncedSaveLastView(groupId
        ? { type: 'collection', collectionId: selectedCollectionId, collectionGroupId: groupId }
        : { type: 'collection', collectionId: selectedCollectionId }
      );
    }
  }, [selectedCollectionId, debouncedSaveLastView]);

  // Collection layout hooks (must be after selectedCollectionId and selectedCollectionGroupId are defined)
  const {
    layout: collectionLayout,
    layoutJson: collectionLayoutJson,
    loading: collectionLayoutLoading,
    updateLayout: updateCollectionLayout,
    refetch: refetchCollectionLayout,
  } = useCollectionLayout(selectedCollectionId);

  const {
    layout: collectionGroupLayout,
    layoutJson: collectionGroupLayoutJson,
    loading: collectionGroupLayoutLoading,
    updateLayout: updateCollectionGroupLayout,
    refetch: refetchCollectionGroupLayout,
  } = useCollectionGroupLayout(selectedCollectionGroupId);

  // Active icon style: use collection/group layout iconStyle when viewing a collection, otherwise global setting
  const activeIconStyle = useMemo((): 'standard' | 'colourful' => {
    if (selectedCollectionGroupId && collectionGroupLayout?.iconStyle) {
      const style = collectionGroupLayout.iconStyle;
      if (style === 'standard' || style === 'colourful') return style;
    }
    if (selectedCollectionId && collectionLayout?.iconStyle) {
      const style = collectionLayout.iconStyle;
      if (style === 'standard' || style === 'colourful') return style;
    }
    return iconStyle;
  }, [selectedCollectionGroupId, collectionGroupLayout?.iconStyle, selectedCollectionId, collectionLayout?.iconStyle, iconStyle]);

  // Sidebar group/collection editing state
  const [sidebarRenamingGroup, setSidebarRenamingGroup] = useState<{ id: string; name: string } | null>(null);
  const [sidebarDeletingGroupId, setSidebarDeletingGroupId] = useState<string | null>(null);
  const [sidebarRenamingCollection, setSidebarRenamingCollection] = useState<Collection | null>(null);
  const [sidebarDeletingCollection, setSidebarDeletingCollection] = useState<Collection | null>(null);
  const [sidebarShareCollection, setSidebarShareCollection] = useState<Collection | null>(null);
  const [sidebarShareGroup, setSidebarShareGroup] = useState<{ collectionId: string; groupId: string; groupName: string } | null>(null);
  const [sidebarShareRoom, setSidebarShareRoom] = useState<{ room: HomeKitRoom; homeId: string } | null>(null);
  const [sidebarShareHome, setSidebarShareHome] = useState<HomeKitHome | null>(null);
  const [sidebarShareAccessory, setSidebarShareAccessory] = useState<{ accessory: HomeKitAccessory; homeId: string } | null>(null);
  const [sidebarShareServiceGroup, setSidebarShareServiceGroup] = useState<{ group: HomeKitServiceGroup; accessories: HomeKitAccessory[]; homeId: string } | null>(null);

  // Room group state
  const [createRoomGroupDialogOpen, setCreateRoomGroupDialogOpen] = useState(false);
  const [createRoomGroupHome, setCreateRoomGroupHome] = useState<HomeKitHome | null>(null);
  const [editingRoomGroup, setEditingRoomGroup] = useState<{ groupId: string; groupName: string; roomIds: string[]; homeId: string } | null>(null);
  const [sidebarShareRoomGroup, setSidebarShareRoomGroup] = useState<{ groupId: string; groupName: string; homeId: string } | null>(null);
  const [sidebarDeletingRoomGroup, setSidebarDeletingRoomGroup] = useState<{ groupId: string; groupName: string } | null>(null);
  const [expandedRoomGroups, setExpandedRoomGroups] = useState<Set<string>>(new Set());

  // Background settings dialog state
  const [backgroundSettingsOpen, setBackgroundSettingsOpen] = useState(false);
  const [backgroundSettingsTarget, setBackgroundSettingsTarget] = useState<{
    type: 'home' | 'room' | 'collection' | 'collectionGroup' | 'roomGroup';
    id: string;
    name: string;
    parentId?: string; // For collectionGroup, stores the collection ID
  } | null>(null);

  // Background settings target layout hooks (use target ID, not selected ID)
  const backgroundTargetCollectionId = backgroundSettingsTarget?.type === 'collection' ? backgroundSettingsTarget.id : null;
  const backgroundTargetGroupId = backgroundSettingsTarget?.type === 'collectionGroup' ? backgroundSettingsTarget.id : null;
  const backgroundTargetHomeId = backgroundSettingsTarget?.type === 'home' ? backgroundSettingsTarget.id : null;
  const backgroundTargetRoomId = backgroundSettingsTarget?.type === 'room' ? backgroundSettingsTarget.id : null;
  const backgroundTargetRoomGroupId = backgroundSettingsTarget?.type === 'roomGroup' ? backgroundSettingsTarget.id : null;

  const { layout: bgTargetCollectionLayout, saveLayoutForEntity: saveBgCollectionLayout } = useCollectionLayout(backgroundTargetCollectionId);
  const { layout: bgTargetGroupLayout, saveLayoutForEntity: saveBgGroupLayout } = useCollectionGroupLayout(backgroundTargetGroupId);
  const { layout: bgTargetHomeLayout, saveLayoutForEntity: saveBgHomeLayout } = useHomeLayout(backgroundTargetHomeId);
  const { layout: bgTargetRoomLayout, saveLayoutForEntity: saveBgRoomLayout } = useRoomLayout(backgroundTargetRoomId);
  const { layout: bgTargetRoomGroupLayout, saveLayoutForEntity: saveBgRoomGroupLayout } = useRoomGroupLayout(backgroundTargetRoomGroupId);

  // Handle collection selection
  const handleSelectCollection = useCallback((collection: Collection | null) => {
    // Only toggle expand/collapse if we're already viewing this collection's main page (not a group)
    if (collection && selectedCollectionId === collection.id && selectedCollectionGroupId === null) {
      setSidebarGroupsExpanded(prev => !prev);
      return;
    }
    setSidebarGroupsExpanded(true);
    setSelectedCollection(collection);
    setSelectedCollectionId(collection?.id ?? null);
    setSelectedCollectionGroupId(null);
    updateUrlParams({
      collection: collection?.id ?? null,
      home: null,
      room: null,
      enrollment: null
    });
    if (collection) {
      // Clear home/room/enrollment selection when selecting a collection
      setSelectedHomeId(null);
      setPendingHomeId(null);
      setSelectedRoomId(null);
      setSelectedEnrollmentId(null);
      localStorage.removeItem('homecast-selected-home');
      localStorage.removeItem('homecast-selected-room');
      debouncedSaveLastView({ type: 'collection', collectionId: collection.id });
    }
  }, [updateUrlParams, selectedCollectionId, selectedCollectionGroupId, debouncedSaveLastView]);

  // Handle home selection (clear collection)
  const handleSelectHome = useCallback((homeId: string) => {
    // Only toggle expand/collapse if we're already viewing this home's main page (not a room, not a collection)
    if (pendingHomeId === homeId && selectedRoomId === null && selectedCollectionId === null) {
      setSidebarRoomsExpanded(prev => !prev);
      return;
    }
    setSidebarRoomsExpanded(true);
    setPendingHomeId(homeId);
    setSelectedHomeId(homeId);
    localStorage.setItem('homecast-selected-home', homeId);
    setSelectedRoomId(null);
    localStorage.removeItem('homecast-selected-room');
    // Clear collection and enrollment
    setSelectedCollection(null);
    setSelectedCollectionId(null);
    setSelectedEnrollmentId(null);
    updateUrlParams({ collection: null, home: homeId, room: null, enrollment: null });
    debouncedSaveLastView({ type: 'home', homeId });
  }, [updateUrlParams, setSelectedHomeId, pendingHomeId, selectedRoomId, selectedCollectionId, debouncedSaveLastView]);

  // Handle room selection
  const handleSelectRoom = useCallback((roomId: string | null) => {
    setSelectedRoomId(roomId);
    if (roomId) {
      localStorage.setItem('homecast-selected-room', roomId);
      updateUrlParams({ room: roomId });
    } else {
      localStorage.removeItem('homecast-selected-room');
      updateUrlParams({ room: null });
    }
    // Only save lastView if the room actually changed — avoids unnecessary
    // UpdateSettings mutation which triggers settings_updated broadcast and
    // causes accessories to reload
    if (pendingHomeId && roomId !== selectedRoomId) {
      debouncedSaveLastView(roomId
        ? { type: 'home', homeId: pendingHomeId, roomId }
        : { type: 'home', homeId: pendingHomeId }
      );
    }
  }, [updateUrlParams, pendingHomeId, selectedRoomId, debouncedSaveLastView]);

  // Search navigation callback
  const handleSearchNavigate = useCallback((homeId: string, roomId?: string) => {
    setSearchOpen(false);
    if (homeId !== selectedHomeId) {
      handleSelectHome(homeId);
    }
    if (roomId) {
      handleSelectRoom(roomId);
    }
  }, [selectedHomeId, handleSelectHome, handleSelectRoom]);

  // Sidebar drag state - tracks which item is being dragged and its context
  const [sidebarActiveId, setSidebarActiveId] = useState<string | null>(null);
  // Track if we're dragging within a group (stores the group's entityId) or at root level (null)
  const [sidebarDragGroupContext, setSidebarDragGroupContext] = useState<string | null>(null);

  // Home and collection drag state (separate from tree drag)
  const [draggingHomeId, setDraggingHomeId] = useState<string | null>(null);
  const [draggingCollectionId, setDraggingCollectionId] = useState<string | null>(null);
  const [collectionDragActive, setCollectionDragActive] = useState(false);

  // Track active drag for showing room warning
  const [activeDragId, setActiveDragId] = useState<string | null>(null);
  const [activeDragRoomName, setActiveDragRoomName] = useState<string | null>(null);
  const [dragOverValid, setDragOverValid] = useState(true);
  const dragRoomBoundsRef = useRef<DOMRect | null>(null);
  const lastDragOverValidRef = useRef(true);
  // Track previous subscription scope to detect when we need to refresh stale data
  const prevSubscriptionScopeRef = useRef<{ type: string; id: string } | null>(null);

  // Track if drag is outside room bounds (only updates state when value changes)
  useEffect(() => {
    if (!activeDragId || !groupByRoom) return;

    const handlePointerMove = (e: PointerEvent | MouseEvent) => {
      const bounds = dragRoomBoundsRef.current;
      if (bounds) {
        const isOutside = e.clientY < bounds.top - 20 || e.clientY > bounds.bottom + 20;
        const newValid = !isOutside;
        // Only update state if value changed (prevents re-renders on every move)
        if (newValid !== lastDragOverValidRef.current) {
          lastDragOverValidRef.current = newValid;
          setDragOverValid(newValid);
        }
      }
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('mousemove', handlePointerMove);

    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('mousemove', handlePointerMove);
    };
  }, [activeDragId, groupByRoom]);

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsInitialTab, setSettingsInitialTab] = useState<SettingsTab | undefined>();

  // Open Settings to a specific tab if ?settings= is in the URL
  useEffect(() => {
    const tab = searchParams.get('settings') as SettingsTab | null;
    if (tab) {
      setSettingsInitialTab(tab);
      setSettingsOpen(true);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const [launchAtLogin, setLaunchAtLogin] = useState(false);
  const [launchAtLoginSupported, setLaunchAtLoginSupported] = useState(false);

  // Fetch launch-at-login status when settings dialog opens (Mac app only)
  useEffect(() => {
    if (!settingsOpen || !isInMacApp) return;
    HomeKit.getLaunchAtLogin()
      .then(({ launchAtLogin: enabled }) => {
        setLaunchAtLogin(enabled);
        setLaunchAtLoginSupported(true);
      })
      .catch(() => setLaunchAtLoginSupported(false));
  }, [settingsOpen, isInMacApp]);
  // State for Cloud Relay prefilled home name
  const [cloudRelayPrefilledHome, setCloudRelayPrefilledHome] = useState<string | undefined>();
  // Track when user just completed cloud checkout so we can auto-open the enroll dialog
  const [cloudCheckoutJustCompleted, setCloudCheckoutJustCompleted] = useState(false);
  // State for onboarding overlay
  const [showOnboarding, setShowOnboarding] = useState(false);
  // State for tutorial walkthrough
  const [showTutorial, setShowTutorial] = useState(false);
  // Track which setting failed to save (for showing error tooltip)
  const [settingSaveError, setSettingSaveError] = useState<string | null>(null);

  // DnD sensors for room reordering
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 5,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );
  // Touch-friendly sensors: long-press to drag, allows normal scrolling
  // TouchSensor uses native touch events (not mapped pointer events) — avoids
  // iOS Safari race where pointercancel fires before the delay completes.
  const touchSensors = useSensors(
    useSensor(TouchSensor, {
      activationConstraint: {
        delay: 250,
        tolerance: 5,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );
  const disabledSensors = useSensors();
  // On touch devices, drag-and-drop is disabled unless edit mode is active (prevents scroll interference)
  const dndEnabled = !isTouchDevice || editMode;
  const activeSensors = !dndEnabled ? disabledSensors : isTouchDevice ? touchSensors : sensors;

  // Debug accessory state (triggered via right-click menu for admins)
  const [debugAccessory, setDebugAccessory] = useState<HomeKitAccessory | null>(null);
  const [debugHome, setDebugHome] = useState<{ type: 'home' | 'room' | 'collection'; data: any } | null>(null);
  const [debugCopied, setDebugCopied] = useState(false);

  // Admin panel state - derived from URL
  const isAdminRoute = location.pathname.startsWith('/portal/admin');
  const adminSubPath = isAdminRoute ? location.pathname.replace('/portal/admin', '') || '/' : '/';
  const [adminSidebarOpen, setAdminSidebarOpen] = useState(false);

  // Get auth token from localStorage for WebSocket connection
  const authToken = localStorage.getItem('homecast-token');

  // Subscribe to real-time accessory updates via WebSocket
  const { isConnected: isWebSocketConnected, serverInfo } = useAccessoryUpdates(authToken, selectedHomeId);

  // Subscribe to real-time updates based on current view
  // - Specific room selected: subscribe to that room only
  // - Home view (no room): subscribe to entire home
  // Active relay does NOT subscribe - it's the source of events
  // Standby relay-capable devices DO subscribe (they're consumers like browsers)
  useEffect(() => {
    if (isActiveRelay || !selectedHomeId || !isWebSocketConnected) {
      return;
    }

    const scope = selectedRoomId
      ? { type: 'room' as const, id: selectedRoomId }
      : { type: 'home' as const, id: selectedHomeId };

    // When widening scope (room → home) or switching rooms, we missed updates
    // for accessories outside the previous room — refetch to get fresh values
    const prev = prevSubscriptionScopeRef.current;
    if (prev?.type === 'room' && (scope.type === 'home' || scope.id !== prev.id)) {
      invalidateHomeKitCache('accessories', { prefix: true });
    }
    prevSubscriptionScopeRef.current = scope;

    serverConnection.subscribeToScopes([scope]);

    return () => {
      serverConnection.unsubscribeFromScopes([scope]);
    };
  }, [selectedHomeId, selectedRoomId, isWebSocketConnected, isActiveRelay]);

  // Sessions query (no polling - manual refresh or WebSocket updates)
  const { data: sessionsData, loading: sessionsLoading, refetch: refetchSessions } = useQuery<GetSessionsResponse>(
    GET_SESSIONS,
    { skip: !isAuthenticated, fetchPolicy: 'cache-first', nextFetchPolicy: 'cache-first' }
  );

  // Memoize sessions - Apollo returns stable references when data hasn't changed
  const sessions: Session[] = useMemo(() => {
    return sessionsData?.sessions || [];
  }, [sessionsData?.sessions]);
  // All returned sessions are active - filter to device sessions only (Mac app relays)
  const deviceSessions = sessions.filter((s) => s.sessionType === 'device');
  const hasDeviceSession = deviceSessions.length > 0;
  // In Mac app mode with relay connected, we ARE the device - can proceed with queries
  // In Community mode, all clients have device access (WS routes to local HomeKit)
  const hasDeviceAccess = isCommunity || hasDeviceSession || (isInMacApp && serverConnected);

  // Debug: log hasDeviceAccess changes
  useEffect(() => {
    if (import.meta.env.DEV) console.log('[Dashboard] hasDeviceAccess:', hasDeviceAccess, '(hasDeviceSession:', hasDeviceSession, ', isInMacApp:', isInMacApp, ', serverConnected:', serverConnected, ')');
  }, [hasDeviceAccess, hasDeviceSession, isInMacApp, serverConnected]);

  // Refetch sessions when relay connects/disconnects so hasDeviceAccess updates immediately.
  // Also poll sessions when no device is connected — the reconnect broadcast only reaches
  // web clients on the same Cloud Run instance as the relay, so cross-instance reconnects
  // need polling to detect.
  const refetchSessionsRef = useRef(refetchSessions);
  refetchSessionsRef.current = refetchSessions;
  useEffect(() => {
    const unsubscribe = serverConnection.subscribeToBroadcasts((message) => {
      if (message.type === 'relay_status_update') {
        if (import.meta.env.DEV) console.log('[Dashboard] Relay status update, refetching sessions');
        refetchSessionsRef.current();
      }
    });
    return unsubscribe;
  }, []);

  // Poll sessions every 10s while no device is connected (pause when tab is hidden)
  useEffect(() => {
    if (hasDeviceAccess) return;

    let intervalId: ReturnType<typeof setInterval> | null = null;

    const startPolling = () => {
      if (intervalId) return;
      refetchSessionsRef.current();
      intervalId = setInterval(() => {
        refetchSessionsRef.current();
      }, 10000);
    };

    const stopPolling = () => {
      if (intervalId) {
        clearInterval(intervalId);
        intervalId = null;
      }
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        startPolling();
      } else {
        stopPolling();
      }
    };

    if (document.visibilityState === 'visible') {
      startPolling();
    }

    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      stopPolling();
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [hasDeviceAccess]);

  // Connection debug info (lazy query - only fetched when debug menu opens)
  const [fetchDebugInfo, { data: debugInfoData, loading: debugInfoLoading }] = useLazyQuery<GetConnectionDebugInfoResponse>(
    GET_CONNECTION_DEBUG_INFO,
    { fetchPolicy: 'network-only' }
  );

  // User settings query
  const { data: settingsData, loading: settingsLoading, refetch: refetchSettings } = useQuery<GetSettingsResponse>(
    GET_SETTINGS,
    { skip: !isAuthenticated, fetchPolicy: 'cache-first', nextFetchPolicy: 'cache-first' }
  );

  // Account info query (plan, limits)
  const { data: accountData, refetch: refetchAccount } = useQuery<GetAccountResponse>(
    GET_ACCOUNT,
    { skip: !isAuthenticated, fetchPolicy: 'cache-and-network' }
  );
  const accountType = accountData?.account?.accountType || user?.accountType || 'free';
  const accessoryLimit = accountData?.account?.accessoryLimit ?? (accountType === 'free' ? 10 : null);
  const showAdsenseBanner = !!(accountData?.account?.adsenseAdsEnabled) && !(window as any).isHomecastApp;
  const showSmartDeals = !!(accountData?.account?.smartDealsEnabled);
  const hasSubscription = !!(accountData?.account?.hasSubscription);
  const cloudSignupsAvailable = accountData?.account?.cloudSignupsAvailable ?? true;
  const dealsEffectivelyEnabled = showSmartDeals && (() => {
    if (accountType === 'free') return true;
    if (!settingsData?.settings?.data) return true;
    try { return JSON.parse(settingsData.settings.data).smartDealsEnabled !== false; }
    catch { return true; }
  })();

  // Cloud enrollments (for sidebar pending entries)
  const { data: enrollmentsData, startPolling: startEnrollmentPolling, stopPolling: stopEnrollmentPolling } = useQuery<MyCloudManagedEnrollmentsResponse>(
    GET_MY_ENROLLMENTS,
    { skip: accountType !== 'cloud', fetchPolicy: 'cache-and-network' }
  );
  const pendingEnrollments = useMemo(() => {
    const all = enrollmentsData?.myCloudManagedEnrollments || [];
    return all.filter(e => e.status !== 'active' && e.status !== 'cancelled');
  }, [enrollmentsData]);

  // Auto-poll enrollments while pending (so tracker card auto-updates on status change)
  useEffect(() => {
    if (pendingEnrollments.length > 0) {
      startEnrollmentPolling(15000);
    } else {
      stopEnrollmentPolling();
    }
  }, [pendingEnrollments.length, startEnrollmentPolling, stopEnrollmentPolling]);

  // Server version
  const { data: versionData } = useQuery<{ version: string }>(GET_VERSION, { fetchPolicy: 'cache-first' });
  const serverVersion = versionData?.version;

  // Production versions (for staging sync indicator)
  const [prodVersions, setProdVersions] = useState<{ server?: string; web?: string }>({});
  const [prodFetched, setProdFetched] = useState(false);
  useEffect(() => {
    if (!config.isStaging) return;
    Promise.allSettled([
      fetch('https://api.homecast.cloud/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: '{ version }' }),
      }).then(r => r.json()).then(d => d?.data?.version as string | undefined),
      fetch('https://homecast.cloud/version.json')
        .then(r => r.json()).then(d => d?.version as string | undefined),
    ]).then(([srv, web]) => {
      setProdVersions({
        server: srv.status === 'fulfilled' ? srv.value : undefined,
        web: web.status === 'fulfilled' ? web.value : undefined,
      });
      setProdFetched(true);
    });
  }, []);

  // Billing mutations
  const [createCheckoutMutation] = useMutation<CreateCheckoutSessionResponse>(CREATE_CHECKOUT_SESSION);
  const [createPortalMutation] = useMutation<CreatePortalSessionResponse>(CREATE_PORTAL_SESSION);
  const [downgradeMutation] = useMutation<DowngradeToStandardResponse>(DOWNGRADE_TO_STANDARD);
  const pricing = getPricing();
  const pricingRegion = getRegion();

  // Onboarding check is below, after homes data is declared

  // Accessory selection dialog state
  const [accessorySelectionOpen, setAccessorySelectionOpen] = useState(false);
  const [allUnfilteredAccessories, setAllUnfilteredAccessories] = useState<HomeKitAccessory[]>([]);

  // Handle checkout return from billing provider
  useEffect(() => {
    const checkoutStatus = searchParams.get('checkout');
    const checkoutType = searchParams.get('type');
    if (checkoutStatus === 'success') {
      const isCloudCheckout = checkoutType === 'cloud' || checkoutType === 'cloud_managed';
      const expectedType = isCloudCheckout ? 'cloud' : 'standard';

      // Poll account status — Stripe webhook may not have processed yet
      let attempts = 0;
      const poll = setInterval(async () => {
        attempts++;
        const result = await refetchAccount?.();
        const newType = result?.data?.account?.accountType;
        if (newType === expectedType || (newType && newType !== 'free' && !isCloudCheckout)) {
          clearInterval(poll);
          if (isCloudCheckout) {
            toast.success('Cloud plan activated!');
            setCloudCheckoutJustCompleted(true);
            setSettingsInitialTab('homes');
            setSettingsOpen(true);
          } else {
            toast.success('Upgrade successful! You now have unlimited accessories.');
          }
        } else if (attempts >= 10) {
          clearInterval(poll);
          toast.success('Payment received! Your plan will update shortly.');
        }
      }, 2000);
      setSearchParams(prev => {
        const next = new URLSearchParams(prev);
        next.delete('checkout');
        next.delete('type');
        return next;
      });
    } else if (checkoutStatus === 'cancelled') {
      setSearchParams(prev => {
        const next = new URLSearchParams(prev);
        next.delete('checkout');
        next.delete('type');
        return next;
      });
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps -- run once on mount

  // Collections query (for "apply to all" background feature)
  const { data: allCollectionsData } = useQuery<GetCollectionsResponse>(
    GET_COLLECTIONS,
    { skip: !isAuthenticated, fetchPolicy: 'cache-first' }
  );
  const allCollections = allCollectionsData?.collections || [];

  // Update settings when loaded from backend
  useEffect(() => {
    if (settingsData?.settings?.data) {
      try {
        const parsed: UserSettingsData = JSON.parse(settingsData.settings.data);
        // Read per-device display settings (falls back to legacy flat fields for migration)
        const display = getDeviceSettings(parsed, getDeviceId());
        if (typeof display.compactMode === 'boolean') setCompactModeRaw(display.compactMode);
        if (typeof display.hideInfoDevices === 'boolean') setHideInfoDevices(display.hideInfoDevices);
        if (typeof display.hideAccessoryCounts === 'boolean') setHideAccessoryCounts(display.hideAccessoryCounts);
        // Layout picker hidden — always masonry for now (may reintroduce later)
        // if (display.layoutMode === 'grid' || display.layoutMode === 'masonry') setLayoutMode(display.layoutMode);
        if (typeof display.groupByRoom === 'boolean') setGroupByRoom(display.groupByRoom);
        if (typeof display.groupByType === 'boolean') setGroupByType(display.groupByType);
        // Handle iconStyle with migration from old values
        if (display.iconStyle === 'standard' || display.iconStyle === 'colourful') {
          setIconStyle(display.iconStyle);
        } else if ((display.iconStyle as string) === 'colored' || (display.iconStyle as string) === 'basic') {
          // Migrate old 'colored' or 'basic' to new 'standard' (colored icons only)
          setIconStyle('standard');
        }
        if (display.fontSize === 'small' || display.fontSize === 'medium' || display.fontSize === 'large') {
          setFontSize(display.fontSize);
        }
        if (typeof display.autoBackgrounds === 'boolean') setAutoBackgrounds(display.autoBackgrounds);
        if (typeof display.fullWidth === 'boolean') setFullWidth(display.fullWidth);
        // Global settings (shared across all devices)
        if (Array.isArray(parsed.homeOrder)) setHomeOrder(parsed.homeOrder);
        if (parsed.roomOrderByHome && typeof parsed.roomOrderByHome === 'object') setRoomOrderByHome(parsed.roomOrderByHome);
        if (typeof parsed.developerMode === 'boolean') setDeveloperMode(parsed.developerMode);

        // Load unified item order (or migrate from legacy deviceOrder/groupOrder)
        if (parsed.itemOrder && typeof parsed.itemOrder === 'object') {
          setItemOrder(parsed.itemOrder);
        } else if (parsed.deviceOrder || parsed.groupOrder) {
          // Migration: merge legacy deviceOrder and groupOrder into itemOrder
          const migratedOrder: Record<string, Record<string, string[]>> = {};
          const deviceOrd = parsed.deviceOrder || {};
          const groupOrd = parsed.groupOrder || {};
          const allHomeIds = new Set([...Object.keys(deviceOrd), ...Object.keys(groupOrd)]);
          for (const homeId of allHomeIds) {
            migratedOrder[homeId] = {};
            const allContextIds = new Set([
              ...Object.keys(deviceOrd[homeId] || {}),
              ...Object.keys(groupOrd[homeId] || {}),
            ]);
            for (const contextId of allContextIds) {
              const groups = (groupOrd[homeId]?.[contextId] || []).map((id: string) => `group-${id}`);
              const devices = deviceOrd[homeId]?.[contextId] || [];
              migratedOrder[homeId][contextId] = [...groups, ...devices];
            }
          }
          setItemOrder(migratedOrder);
        }
        // Load consolidated visibility settings
        if (parsed.visibility && typeof parsed.visibility === 'object') {
          setVisibility({
            ui: {
              hiddenHomes: parsed.visibility.ui?.hiddenHomes || [],
              hiddenRooms: parsed.visibility.ui?.hiddenRooms || {},
              hiddenGroups: parsed.visibility.ui?.hiddenGroups || {},
              hiddenDevices: parsed.visibility.ui?.hiddenDevices || {},
            },
          });
        }
        // Load collection item order
        if (parsed.collectionItemOrder && typeof parsed.collectionItemOrder === 'object') {
          setCollectionItemOrder(parsed.collectionItemOrder);
        }
        // Load pinned tabs (per-device)
        if (Array.isArray(display.pinnedTabs)) {
          setPinnedTabs(display.pinnedTabs);
        }
        // Restore last viewed navigation state (per-device, one-shot, skipped if URL params present)
        if (!lastViewRestoredRef.current && display.lastView) {
          lastViewRestoredRef.current = true;
          if (!hadUrlParamsRef.current) {
            const lv = display.lastView;
            if (lv.type === 'home' && lv.homeId) {
              setSelectedHomeId(lv.homeId);
              setPendingHomeId(lv.homeId);
              localStorage.setItem('homecast-selected-home', lv.homeId);
              if (lv.roomId) {
                setSelectedRoomId(lv.roomId);
                localStorage.setItem('homecast-selected-room', lv.roomId);
              }
            } else if (lv.type === 'collection' && lv.collectionId) {
              setSelectedCollectionId(lv.collectionId);
              setSelectedHomeId(null);
              setPendingHomeId(null);
              if (lv.collectionGroupId) {
                setSelectedCollectionGroupId(lv.collectionGroupId);
              }
            }
          }
          setLastView(display.lastView);
        }
      } catch {
        // Invalid JSON, keep defaults
      }
    }
  }, [settingsData]);

  // Sync accessory limit and selection to relay local-handler (only when active relay)
  useEffect(() => {
    if (!isActiveRelay) return;
    setRelayAccessoryLimit(accessoryLimit);
  }, [accessoryLimit, isActiveRelay]);

  useEffect(() => {
    if (!isActiveRelay) return;
    if (settingsData?.settings?.data) {
      try {
        const parsed = JSON.parse(settingsData.settings.data);
        if (Array.isArray(parsed.includedAccessoryIds)) {
          setRelayAllowedIds(parsed.includedAccessoryIds);
        }
      } catch { /* ignore */ }
    }
  }, [settingsData, isActiveRelay]);

  // Settings mutation
  const [updateSettingsMutation] = useMutation<UpdateSettingsResponse>(UPDATE_SETTINGS, {
    update(cache, { data }) {
      if (data?.updateSettings?.success && data.updateSettings.settings) {
        cache.writeQuery<GetSettingsResponse>({
          query: GET_SETTINGS,
          data: { settings: data.updateSettings.settings },
        });
      }
    },
  });

  // Pending invitations
  const { data: pendingInvitationsData, refetch: refetchPendingInvitations } = useQuery<GetPendingInvitationsResponse>(GET_PENDING_INVITATIONS, { pollInterval: 30000 });
  const [acceptInvitationMutation] = useMutation<AcceptHomeInvitationResponse>(ACCEPT_HOME_INVITATION);
  const [rejectInvitationMutation] = useMutation<RejectHomeInvitationResponse>(REJECT_HOME_INVITATION);
  const [dismissHomeMutation] = useMutation(DISMISS_HOME);
  const pendingInvitations = pendingInvitationsData?.pendingInvitations ?? [];
  const [pendingInvitationsOpen, setPendingInvitationsOpen] = useState(false);

  // Push notifications (cloud only)
  const { data: pushTokensData, refetch: refetchPushTokens } = useQuery<GetPushTokensResponse>(GET_PUSH_TOKENS, { skip: isCommunity });
  const { data: notifPrefsData, refetch: refetchNotifPrefs } = useQuery<GetNotificationPreferencesResponse>(GET_NOTIFICATION_PREFERENCES, { skip: isCommunity });
  const [registerPushTokenMutation] = useMutation<RegisterPushTokenResponse>(REGISTER_PUSH_TOKEN);
  const [unregisterPushTokenMutation] = useMutation(UNREGISTER_PUSH_TOKEN);
  const [setNotifPrefMutation] = useMutation<SetNotificationPreferenceResponse>(SET_NOTIFICATION_PREFERENCE);
  const [sendTestNotifMutation] = useMutation<SendTestNotificationResponse>(SEND_TEST_NOTIFICATION);

  // Auto-open/close invitations modal based on pending invitations
  useEffect(() => {
    if (pendingInvitations.length > 0) {
      setPendingInvitationsOpen(true);
    } else {
      setPendingInvitationsOpen(false);
    }
  }, [pendingInvitations.length]);

  // Get included IDs from settings (for free plan filtering)
  // Declared here (before saveSettings) to avoid TDZ in useCallback dependency array
  const includedAccessoryIds = useMemo(() => {
    if (settingsData?.settings?.data) {
      try {
        const parsed = JSON.parse(settingsData.settings.data);
        if (Array.isArray(parsed.includedAccessoryIds)) return parsed.includedAccessoryIds as string[];
      } catch { /* ignore */ }
    }
    return [] as string[];
  }, [settingsData]);

  const includedServiceGroupIds = useMemo(() => {
    if (settingsData?.settings?.data) {
      try {
        const parsed = JSON.parse(settingsData.settings.data);
        if (Array.isArray(parsed.includedServiceGroupIds)) return parsed.includedServiceGroupIds as string[];
      } catch { /* ignore */ }
    }
    return [] as string[];
  }, [settingsData]);

  // Save settings helper - serializes current state + updates to JSON blob
  // Per-device display settings are nested under devices[deviceId], global settings at top level
  // Returns true on success, false on failure (shows error tooltip or toast)
  const saveSettings = useCallback(async (updates: Partial<UserSettingsData>, settingName: string, useToast = false): Promise<boolean> => {
    const deviceId = getDeviceId();

    // Start from the full server blob to preserve other devices' settings
    let fullBlob: UserSettingsData = {};
    if (settingsData?.settings?.data) {
      try { fullBlob = JSON.parse(settingsData.settings.data); } catch { /* ignore */ }
    }

    // Split updates into device-specific vs global
    const deviceUpdates: Record<string, unknown> = {};
    const globalUpdates: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(updates)) {
      if ((DEVICE_SETTING_KEYS as readonly string[]).includes(key)) {
        deviceUpdates[key] = value;
      } else {
        globalUpdates[key] = value;
      }
    }

    // Current device display state
    const currentDeviceSettings = {
      compactMode, hideInfoDevices, hideAccessoryCounts, layoutMode,
      groupByRoom, groupByType, iconStyle, fontSize, autoBackgrounds,
      fullWidth, pinnedTabs, lastView,
    };

    // Current global state
    const currentGlobalSettings = {
      homeOrder, roomOrderByHome, itemOrder, collectionItemOrder,
      visibility, includedAccessoryIds, includedServiceGroupIds, developerMode,
    };

    // Merge: global at top level, device settings nested under devices[deviceId]
    const merged: UserSettingsData = {
      ...currentGlobalSettings,
      ...globalUpdates,
      devices: {
        ...(fullBlob.devices || {}),
        [deviceId]: { ...currentDeviceSettings, ...deviceUpdates },
      },
    };

    try {
      const mergedJson = JSON.stringify(merged);
      await updateSettingsMutation({
        variables: { data: mergedJson },
        optimisticResponse: {
          updateSettings: {
            __typename: 'UpdateSettingsResult',
            success: true,
            settings: { __typename: 'UserSettings', data: mergedJson },
          },
        },
      });
      return true;
    } catch (error) {
      console.error('Failed to save settings:', error);
      if (useToast) {
        toast.error('Failed to save');
      } else {
        setSettingSaveError(settingName);
        setTimeout(() => setSettingSaveError(null), 3000);
      }
      return false;
    }
  }, [compactMode, hideInfoDevices, hideAccessoryCounts, layoutMode, groupByRoom, groupByType, iconStyle, fontSize, autoBackgrounds, fullWidth, homeOrder, roomOrderByHome, itemOrder, collectionItemOrder, pinnedTabs, visibility, includedAccessoryIds, includedServiceGroupIds, developerMode, lastView, settingsData, updateSettingsMutation]);

  // Keep saveSettingsRef in sync so debouncedSaveLastView (defined early) can call it
  saveSettingsRef.current = saveSettings;

  // === Pin to tab bar helpers ===
  const isTabPinned = useCallback((type: PinnedTab['type'], id: string) => {
    return pinnedTabs.some(t => t.type === type && t.id === id);
  }, [pinnedTabs]);

  const handlePinTab = useCallback((tab: PinnedTab) => {
    if (pinnedTabs.length >= MAX_PINNED_TABS) return;
    if (isTabPinned(tab.type, tab.id)) return;
    const newPins = [...pinnedTabs, tab];
    setPinnedTabs(newPins);
    saveSettings({ pinnedTabs: newPins }, 'pinnedTabs');
  }, [pinnedTabs, isTabPinned, saveSettings]);

  const handleUnpinTab = useCallback((type: PinnedTab['type'], id: string) => {
    const newPins = pinnedTabs.filter(t => !(t.type === type && t.id === id));
    setPinnedTabs(newPins);
    saveSettings({ pinnedTabs: newPins }, 'pinnedTabs');
  }, [pinnedTabs, saveSettings]);

  const handleUpdateTabName = useCallback((type: string, id: string, customName: string | undefined) => {
    const newPins = pinnedTabs.map(t =>
      t.type === type && t.id === id ? { ...t, customName } : t
    );
    setPinnedTabs(newPins);
    saveSettings({ pinnedTabs: newPins }, 'pinnedTabs');
  }, [pinnedTabs, saveSettings]);

  const handleReorderTabs = useCallback((reordered: PinnedTab[]) => {
    setPinnedTabs(reordered);
    saveSettings({ pinnedTabs: reordered }, 'pinnedTabs');
  }, [saveSettings]);

  // === UI Visibility check functions ===
  // When showHiddenItems is true, these return false so hidden items are shown
  const isDeviceHidden = useCallback((homeId: string, contextId: string, accessoryId: string): boolean => {
    if (showHiddenItems) return false;
    // Read from cache for the specific room (works in both home view and room view)
    if (contextId && contextId !== 'all') {
      try {
        const cached = apolloClient.readQuery<GetStoredEntityLayoutResponse>({
          query: GET_STORED_ENTITY_LAYOUT,
          variables: { entityType: 'room', entityId: contextId },
        });
        if (cached?.storedEntityLayout?.layoutJson) {
          const layout: RoomLayoutData = JSON.parse(cached.storedEntityLayout.layoutJson);
          return layout?.visibility?.hiddenAccessories?.includes(accessoryId) ?? false;
        }
      } catch {
        // No cached layout
      }
    }
    return false;
  }, [showHiddenItems, apolloClient]);

  // Returns actual hidden state regardless of showHiddenItems (for badge display)
  const isDeviceActuallyHidden = useCallback((homeId: string, contextId: string, accessoryId: string): boolean => {
    // Read from cache for the specific room
    if (contextId && contextId !== 'all') {
      try {
        const cached = apolloClient.readQuery<GetStoredEntityLayoutResponse>({
          query: GET_STORED_ENTITY_LAYOUT,
          variables: { entityType: 'room', entityId: contextId },
        });
        if (cached?.storedEntityLayout?.layoutJson) {
          const layout: RoomLayoutData = JSON.parse(cached.storedEntityLayout.layoutJson);
          return layout?.visibility?.hiddenAccessories?.includes(accessoryId) ?? false;
        }
      } catch {
        // No cached layout
      }
    }
    return false;
  }, [apolloClient]);

  const isRoomHidden = useCallback((homeId: string, roomId: string): boolean => {
    if (showHiddenItems) return false;
    // Check entity layout (StoredEntity) for hidden rooms
    if (homeId === selectedHomeId) {
      return homeLayout?.visibility?.hiddenRooms?.includes(roomId) ?? false;
    }
    return false;
  }, [showHiddenItems, selectedHomeId, homeLayout]);

  const isHomeHidden = useCallback((homeId: string): boolean => {
    if (showHiddenItems) return false;
    return visibility.ui.hiddenHomes.includes(homeId);
  }, [visibility, showHiddenItems]);

  const isGroupHidden = useCallback((homeId: string, groupId: string, contextId?: string): boolean => {
    if (showHiddenItems) return false;
    // Check room entity layout (StoredEntity) for hidden groups
    // Read from Apollo cache using contextId (roomId) to work in home view
    if (contextId && contextId !== 'all') {
      try {
        const cached = apolloClient.readQuery<GetStoredEntityLayoutResponse>({
          query: GET_STORED_ENTITY_LAYOUT,
          variables: { entityType: 'room', entityId: contextId },
        });
        if (cached?.storedEntityLayout?.layoutJson) {
          const layout: RoomLayoutData = JSON.parse(cached.storedEntityLayout.layoutJson);
          return layout?.visibility?.hiddenGroups?.includes(groupId) ?? false;
        }
      } catch {
        // No cached layout
      }
    }
    return false;
  }, [showHiddenItems, apolloClient]);

  // Returns actual hidden state for groups regardless of showHiddenItems (for badge display)
  const isGroupActuallyHidden = useCallback((homeId: string, groupId: string, contextId?: string): boolean => {
    // Check room entity layout (StoredEntity) for hidden groups
    // Read from Apollo cache using contextId (roomId) to work in home view
    if (contextId && contextId !== 'all') {
      try {
        const cached = apolloClient.readQuery<GetStoredEntityLayoutResponse>({
          query: GET_STORED_ENTITY_LAYOUT,
          variables: { entityType: 'room', entityId: contextId },
        });
        if (cached?.storedEntityLayout?.layoutJson) {
          const layout: RoomLayoutData = JSON.parse(cached.storedEntityLayout.layoutJson);
          return layout?.visibility?.hiddenGroups?.includes(groupId) ?? false;
        }
      } catch {
        // No cached layout
      }
    }
    return false;
  }, [apolloClient]);

  const isRoomActuallyHidden = useCallback((homeId: string, roomId: string): boolean => {
    // Check entity layout (StoredEntity) for hidden rooms
    if (homeId === selectedHomeId) {
      return homeLayout?.visibility?.hiddenRooms?.includes(roomId) ?? false;
    }
    return false;
  }, [selectedHomeId, homeLayout]);

  const isHomeActuallyHidden = useCallback((homeId: string): boolean => {
    return visibility.ui.hiddenHomes.includes(homeId);
  }, [visibility]);

  // === Toggle visibility (works for UI visibility edit mode) ===
  const toggleVisibility = useCallback((
    type: 'home' | 'room' | 'group' | 'device',
    _mode: 'ui' | 'server' | null,  // kept for call site compatibility, always uses 'ui'
    homeId: string,
    targetId?: string,
    contextId?: string
  ) => {
    // Deep copy ui object to ensure React detects the change
    const newVisibility = {
      ...visibility,
      ui: { ...visibility.ui }
    };
    const target = newVisibility.ui;

    switch (type) {
      case 'home': {
        const isHidden = target.hiddenHomes.includes(homeId);
        target.hiddenHomes = isHidden
          ? target.hiddenHomes.filter(id => id !== homeId)
          : [...target.hiddenHomes, homeId];
        break;
      }
      case 'room': {
        if (!targetId) return;
        // Room visibility is stored in entity layout (StoredEntity) only
        if (homeId === selectedHomeId) {
          const currentHidden = homeLayout?.visibility?.hiddenRooms || [];
          const isHidden = currentHidden.includes(targetId);
          const newHiddenRooms = isHidden
            ? currentHidden.filter(id => id !== targetId)
            : [...currentHidden, targetId];
          updateHomeLayout(prev => ({
            ...prev,
            visibility: {
              ...prev?.visibility,
              hiddenRooms: newHiddenRooms,
            },
          })).catch(err => console.error('Failed to save room visibility to entity layout:', err));
        }
        return; // Don't save to user settings for room visibility
      }
      case 'group': {
        if (!targetId || !contextId) return;
        // Group visibility is stored in room entity layout (StoredEntity)
        // Read current layout from Apollo cache using contextId (roomId)
        let currentLayout: RoomLayoutData | null = null;
        try {
          const cached = apolloClient.readQuery<GetStoredEntityLayoutResponse>({
            query: GET_STORED_ENTITY_LAYOUT,
            variables: { entityType: 'room', entityId: contextId },
          });
          if (cached?.storedEntityLayout?.layoutJson) {
            currentLayout = JSON.parse(cached.storedEntityLayout.layoutJson);
          }
        } catch {
          // No cached layout
        }
        const currentHiddenGroups = currentLayout?.visibility?.hiddenGroups || [];
        const isGroupHidden = currentHiddenGroups.includes(targetId);
        const newHiddenGroups = isGroupHidden
          ? currentHiddenGroups.filter(id => id !== targetId)
          : [...currentHiddenGroups, targetId];
        const newGroupLayout: RoomLayoutData = {
          ...currentLayout,
          visibility: {
            ...currentLayout?.visibility,
            hiddenGroups: newHiddenGroups,
          },
        };
        saveRoomLayoutForEntity(contextId, newGroupLayout).catch(err => console.error('Failed to save group visibility to room layout:', err));
        return; // Don't save to user settings for group visibility
      }
      case 'device': {
        if (!targetId || !contextId) return;
        // Device/accessory visibility is stored in room entity layout (StoredEntity)
        // Read current layout from Apollo cache using contextId (roomId)
        let currentDeviceLayout: RoomLayoutData | null = null;
        try {
          const cached = apolloClient.readQuery<GetStoredEntityLayoutResponse>({
            query: GET_STORED_ENTITY_LAYOUT,
            variables: { entityType: 'room', entityId: contextId },
          });
          if (cached?.storedEntityLayout?.layoutJson) {
            currentDeviceLayout = JSON.parse(cached.storedEntityLayout.layoutJson);
          }
        } catch {
          // No cached layout
        }
        const currentHiddenAccessories = currentDeviceLayout?.visibility?.hiddenAccessories || [];
        const isAccessoryHidden = currentHiddenAccessories.includes(targetId);
        const newHiddenAccessories = isAccessoryHidden
          ? currentHiddenAccessories.filter(id => id !== targetId)
          : [...currentHiddenAccessories, targetId];
        const newDeviceLayout: RoomLayoutData = {
          ...currentDeviceLayout,
          visibility: {
            ...currentDeviceLayout?.visibility,
            hiddenAccessories: newHiddenAccessories,
          },
        };
        saveRoomLayoutForEntity(contextId, newDeviceLayout).catch(err => console.error('Failed to save accessory visibility to room layout:', err));
        return; // Don't save to user settings for device visibility
      }
    }

    // Update local state immediately (optimistic)
    setVisibility(newVisibility);
    // Increment version to force re-renders
    setVisibilityVersion(v => v + 1);
    // Defer save to server to keep UI responsive
    setTimeout(() => saveSettings({ visibility: newVisibility }, 'visibility'), 0);
  }, [visibility, saveSettings, selectedHomeId, homeLayout, updateHomeLayout, apolloClient, saveRoomLayoutForEntity]);

  // Get ordered items (groups and accessories mixed) for a context
  // Uses room entity layout (StoredEntity) for ordering
  const getOrderedItems = useCallback((
    homeId: string,
    contextId: string,
    groups: HomeKitServiceGroup[],
    accessories: HomeKitAccessory[],
    currentEditMode?: 'ui' | null
  ): Array<{ type: 'group'; data: HomeKitServiceGroup } | { type: 'accessory'; data: HomeKitAccessory }> => {
    // Always read from Apollo cache for consistent behavior in both home view and room view
    let effectiveRoomLayout: RoomLayoutData | null = null;
    if (contextId && contextId !== 'all') {
      try {
        const cached = apolloClient.readQuery<GetStoredEntityLayoutResponse>({
          query: GET_STORED_ENTITY_LAYOUT,
          variables: { entityType: 'room', entityId: contextId },
        });
        if (cached?.storedEntityLayout?.layoutJson) {
          effectiveRoomLayout = JSON.parse(cached.storedEntityLayout.layoutJson);
        }
      } catch {
        // No cached layout
      }
    }

    const order = effectiveRoomLayout?.itemOrder || [];

    // Build items array with type info
    const items: Array<{ type: 'group'; data: HomeKitServiceGroup } | { type: 'accessory'; data: HomeKitAccessory }> = [
      ...groups.map(g => ({ type: 'group' as const, data: g, id: `group-${g.id}` })),
      ...accessories.map(a => ({ type: 'accessory' as const, data: a, id: a.id })),
    ];

    // Helper to check if an item is hidden (using room entity layout)
    const isItemHidden = (item: typeof items[0]): boolean => {
      if (item.type === 'group') {
        return effectiveRoomLayout?.visibility?.hiddenGroups?.includes(item.data.id) ?? false;
      } else {
        return effectiveRoomLayout?.visibility?.hiddenAccessories?.includes(item.data.id) ?? false;
      }
    };

    let sortedItems: typeof items;

    if (!order || order.length === 0) {
      // Default order: groups first, then accessories
      sortedItems = items;
    } else {
      const orderMap = new Map(order.map((id, idx) => [id, idx]));
      sortedItems = [...items].sort((a, b) => {
        const aId = a.type === 'group' ? `group-${a.data.id}` : a.data.id;
        const bId = b.type === 'group' ? `group-${b.data.id}` : b.data.id;
        const aIdx = orderMap.get(aId);
        const bIdx = orderMap.get(bId);
        if (aIdx !== undefined && bIdx !== undefined) return aIdx - bIdx;
        if (aIdx !== undefined) return -1;
        if (bIdx !== undefined) return 1;
        return 0;
      });
    }

    // Always push hidden items to the end when showHiddenItems is true
    if (showHiddenItems) {
      const visibleItems = sortedItems.filter(item => !isItemHidden(item));
      const hiddenItems = sortedItems.filter(item => isItemHidden(item));
      return [...visibleItems, ...hiddenItems];
    }

    return sortedItems;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showHiddenItems, apolloClient, itemOrderVersion]);

  // Handle drag end for reordering (unified for groups and accessories)
  // Saves to room entity layout (StoredEntity)
  const handleItemDragEnd = useCallback(async (
    event: DragEndEvent,
    homeId: string,
    contextId: string,
    currentItemIds: string[]
  ) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const activeId = String(active.id);
    const overId = String(over.id);

    const oldIndex = currentItemIds.indexOf(activeId);
    const newIndex = currentItemIds.indexOf(overId);
    if (oldIndex === -1 || newIndex === -1) return;

    const reordered = arrayMove(currentItemIds, oldIndex, newIndex);

    // Save to room entity layout (StoredEntity)
    try {
      await updateRoomLayout(prev => ({
        ...prev,
        itemOrder: reordered,
      }));
    } catch (err) {
      console.error('Failed to save item order to room layout:', err);
    }
  }, [updateRoomLayout]);

  // Handle saving collection item order
  const handleSaveCollectionItemOrder = useCallback(async (collectionId: string, order: string[]) => {
    const newCollectionItemOrder = {
      ...collectionItemOrder,
      [collectionId]: order,
    };
    setCollectionItemOrder(newCollectionItemOrder);
    await saveSettings({ collectionItemOrder: newCollectionItemOrder }, 'collectionItemOrder');
  }, [collectionItemOrder, saveSettings]);

  // Relay hooks for HomeKit data (works in both Mac app and browser mode via WebSocket)
  const { data: relayHomesData, loading: relayHomesLoading, refetch: relayRefetchHomes } = useHomes({ skip: !serverConnected });
  // Don't fetch relay data until we know a relay device is available — prevents premature
  // requests that fail because the server can't route to the relay yet.
  // Also check homes data (relayConnected) as a faster signal than GET_SESSIONS polling.
  const anyHomeRelayConnected = (relayHomesData || []).some(h => h.relayConnected === true);
  const skipRelayData = !serverConnected || (!hasDeviceAccess && !anyHomeRelayConnected);
  const { data: relayRoomsData, loading: relayRoomsLoading, refetch: relayRefetchRooms } = useRooms(selectedHomeId, { skip: skipRelayData });
  const { data: relayAccessoriesData, loading: relayAccessoriesLoading, error: relayAccessoriesError, refetch: relayRefetchAccessories } = useAccessories(selectedHomeId, { skip: skipRelayData });
  const { data: relayServiceGroupsData, refetch: relayRefetchServiceGroups } = useServiceGroups(selectedHomeId, { skip: skipRelayData });
  // All home IDs for cross-home data fetching (search, collections, service groups)
  const allHomeIds = useMemo(() => (relayHomesData || []).map(h => h.id), [relayHomesData]);
  // All accessories across all homes — fetches per-home so routing works for cloud/shared users
  const { data: allAccessoriesDataRaw, refetch: refetchAllAccessories } = useAccessoriesForHomes(allHomeIds, { skip: skipRelayData });
  // useAccessoriesForHomes returns [] for empty homeIds (homes still loading);
  // downstream code expects null to indicate "not yet loaded"
  const allAccessoriesData = allHomeIds.length === 0 ? null : allAccessoriesDataRaw;
  // All service groups across all homes (for search)
  const { data: allServiceGroupsData, refetch: refetchAllServiceGroups } = useAllServiceGroups(allHomeIds, { skip: skipRelayData });

  // Slot-based accessory count for free plan (each service group = 1 slot)
  // Ref preserves the last computed value so count doesn't inflate when relay disconnects
  const usedAccessorySlotsRef = useRef<number>(0);
  const usedAccessorySlots = useMemo(() => {
    if (accountType !== 'free' || includedAccessoryIds.length === 0) return includedAccessoryIds.length;
    const groupIds = new Set(includedServiceGroupIds);
    if (groupIds.size === 0) return includedAccessoryIds.length;
    if (!allServiceGroupsData) return usedAccessorySlotsRef.current;
    const groupCoveredIds = new Set<string>();
    for (const group of allServiceGroupsData) {
      if (groupIds.has(group.id)) {
        for (const id of group.accessoryIds) groupCoveredIds.add(id);
      }
    }
    const individualCount = includedAccessoryIds.filter(id => !groupCoveredIds.has(id)).length;
    const slots = groupIds.size + individualCount;
    usedAccessorySlotsRef.current = slots;
    return slots;
  }, [accountType, includedAccessoryIds, includedServiceGroupIds, allServiceGroupsData]);

  // Force refetch all data when hasDeviceAccess becomes true (relay comes online)
  const prevHasDeviceAccessRef = useRef(hasDeviceAccess);
  useEffect(() => {
    if (hasDeviceAccess && !prevHasDeviceAccessRef.current) {
      if (import.meta.env.DEV) console.log('[Dashboard] hasDeviceAccess became true, refetching all data...');
      relayRefetchHomes();
      refetchAllAccessories();
      refetchAllServiceGroups();
      // Also refetch rooms, accessories, and service groups if a home is selected
      if (selectedHomeId) {
        relayRefetchRooms();
        relayRefetchAccessories();
        relayRefetchServiceGroups();
      }
    }
    prevHasDeviceAccessRef.current = hasDeviceAccess;
  }, [hasDeviceAccess, selectedHomeId, relayRefetchHomes, relayRefetchRooms, relayRefetchAccessories, relayRefetchServiceGroups, refetchAllAccessories, refetchAllServiceGroups]);

  // Combined data - use relay data when connected
  const homesData = relayHomesData ? { homes: relayHomesData } : null;
  // In Community mode on relay Mac, don't block on loading — data arrives quickly via local bridge.
  // On first launch the HomeKit bridge may take a moment; show empty sidebar rather than infinite spinner.
  const homesLoading = relayHomesLoading && !relayHomesData && !(isCommunity && isRelayCapable());
  const refetchHomes = relayRefetchHomes;

  // Onboarding: check if user has completed onboarding (cloud mode only)
  useEffect(() => {
    if (isCommunity) return; // Community mode doesn't need cloud onboarding
    if (!settingsData?.settings?.data || !isAuthenticated) return;
    // Wait for homes to load before deciding — a shared home member
    // who never did onboarding shouldn't see the overlay
    if (homesLoading) return;
    try {
      const parsed = JSON.parse(settingsData.settings.data) as import('@/lib/graphql/types').UserSettingsData;
      const completed = parsed.onboarding?.completed || parsed.onboardingCompleted;
      if (!completed && accountType !== 'waitlist' && accountType !== 'managed' && !user?.isAdmin) {
        // If user already has homes (owned or shared), skip onboarding
        if (homesData && homesData.homes.length > 0) return;
        setShowOnboarding(true);
      }
    } catch { /* ignore parse errors */ }
  }, [settingsData, isAuthenticated, accountType, user?.isAdmin, homesData, homesLoading]);

  // Tutorial: show after setup is complete and user has homes
  useEffect(() => {
    if (!settingsData?.settings?.data || !isAuthenticated) return;
    if (homesLoading || showOnboarding) return;
    try {
      const parsed = JSON.parse(settingsData.settings.data) as import('@/lib/graphql/types').UserSettingsData;
      if (parsed.tutorialCompleted) return;
      // In cloud mode, wait for onboarding to be done first
      if (!isCommunity && !parsed.onboarding?.completed && !parsed.onboardingCompleted) return;
      // Only show if user has at least one home
      if (!homesData || homesData.homes.length === 0) return;
      setShowTutorial(true);
    } catch { /* ignore parse errors */ }
  }, [settingsData, isAuthenticated, homesLoading, showOnboarding, homesData]);

  const roomsData = relayRoomsData ? { rooms: relayRoomsData } : null;
  const roomsLoading = relayRoomsLoading && !relayRoomsData;
  const refetchRooms = relayRefetchRooms;

  // Fetch ALL accessories (bypassing free plan filter) when selection dialog opens
  useEffect(() => {
    if (!accessorySelectionOpen) return;
    if (isRelayCapable()) {
      // Relay mode: fetch all accessories via local handler (bypasses server-side limit)
      const homesForFetch = homesData?.homes || [];
      if (homesForFetch.length === 0) return;
      Promise.all(
        homesForFetch.map(home =>
          serverConnection.request<{ accessories: HomeKitAccessory[] }>('accessories.list', { homeId: home.id, includeValues: true, includeAll: true })
            .then(r => normalizeAccessories(r.accessories || []))
            .catch(() => [])
        )
      ).then(results => setAllUnfilteredAccessories(results.flat()));
    } else if (allAccessoriesData && allAccessoriesData.length > 0) {
      // Client mode: snapshot current data so real-time updates don't churn the picker
      setAllUnfilteredAccessories([...allAccessoriesData]);
    }
  }, [accessorySelectionOpen]);

  // Fetch room groups for the selected home
  const { data: roomGroupsData, loading: roomGroupsLoading, refetch: refetchRoomGroups } = useQuery<{ roomGroups: StoredEntity[] }>(
    GET_ROOM_GROUPS,
    {
      skip: !selectedHomeId,
      variables: { homeId: selectedHomeId },
      fetchPolicy: 'cache-first',
      nextFetchPolicy: 'cache-first',
    }
  );

  // Parse room groups into a usable format
  const roomGroups = useMemo(() => {
    if (!roomGroupsData?.roomGroups) return [];
    return roomGroupsData.roomGroups.map((entity) => {
      const data: RoomGroupData = entity.dataJson ? JSON.parse(entity.dataJson) : { name: 'Room Group', roomIds: [] };
      const roomIds = data.roomIds || [];
      return {
        id: entity.id,
        entityId: entity.entityId,
        name: data.name,
        roomIds,
        roomCount: roomIds.length,
      };
    });
  }, [roomGroupsData]);

  // Compute set of room IDs that are in any room group (for filtering from main list)
  const roomIdsInGroups = useMemo(() => {
    const ids = new Set<string>();
    for (const group of roomGroups) {
      for (const roomId of group.roomIds) {
        // Normalize the ID for comparison
        ids.add(roomId.toLowerCase().replace(/-/g, ''));
      }
    }
    return ids;
  }, [roomGroups]);

  // Delete room group mutation
  const [deleteRoomGroupMutation] = useMutation(DELETE_ROOM_GROUP);

  const handleDeleteRoomGroup = useCallback(async () => {
    if (!sidebarDeletingRoomGroup) return;
    try {
      await deleteRoomGroupMutation({
        variables: { groupId: sidebarDeletingRoomGroup.groupId },
      });
      toast.success('Room group deleted');
      setSidebarDeletingRoomGroup(null);
      refetchRoomGroups();
    } catch (err) {
      console.error('Failed to delete room group:', err);
      toast.error('Failed to delete room group');
    }
  }, [sidebarDeletingRoomGroup, deleteRoomGroupMutation, refetchRoomGroups]);

  // Update room group mutation (for reordering rooms within a group)
  const [updateRoomGroupMutation] = useMutation(UPDATE_ROOM_GROUP);

  const handleUpdateRoomGroupRooms = useCallback(async (groupId: string, newRoomIds: string[]) => {
    try {
      await updateRoomGroupMutation({
        variables: { groupId, roomIds: newRoomIds },
      });
      refetchRoomGroups();
    } catch (err) {
      console.error('Failed to update room group:', err);
      toast.error('Failed to update room group');
    }
  }, [updateRoomGroupMutation, refetchRoomGroups]);

  // Toggle room group expansion
  const toggleRoomGroupExpanded = useCallback((groupId: string) => {
    setExpandedRoomGroups((prev) => {
      const next = new Set(prev);
      if (next.has(groupId)) {
        next.delete(groupId);
      } else {
        next.add(groupId);
      }
      return next;
    });
  }, []);

  // Combined accessories data - use relay data
  const accessoriesData = relayAccessoriesData ? { accessories: relayAccessoriesData } : null;
  const accessoriesLoading = relayAccessoriesLoading;
  const accessoriesError = relayAccessoriesError;
  const refetchAccessories = relayRefetchAccessories;

  // Track when we last fetched for this home
  useEffect(() => {
    if (selectedHomeId && accessoriesData?.accessories && !accessoriesLoading) {
      setAccessoriesHomeId(selectedHomeId);
    }
  }, [selectedHomeId, accessoriesData, accessoriesLoading]);

  // Clear manual refresh overlay when loading finishes
  useEffect(() => {
    if (isManualRefreshing && !accessoriesLoading && !collectionsLoading) {
      setIsManualRefreshing(false);
    }
  }, [isManualRefreshing, accessoriesLoading, collectionsLoading]);

  // Auto-refresh page if connecting overlay is stuck for 10 minutes
  useEffect(() => {
    if (!isConnectingOverlay) return;
    const timer = setTimeout(() => {
      window.location.reload();
    }, 10 * 60 * 1000);
    return () => clearTimeout(timer);
  }, [isConnectingOverlay]);

  // Combined service groups data - use relay data
  const serviceGroupsData = relayServiceGroupsData ? { serviceGroups: relayServiceGroupsData } : null;
  const refetchServiceGroups = relayRefetchServiceGroups;

  // Sync homes and rooms to backend for layout storage
  useEntitySync(homesData?.homes, roomsData?.rooms, selectedHomeId);

  // Fetch all room layouts to populate cache for home view item ordering
  const { data: roomLayoutsData } = useQuery<GetStoredEntitiesResponse>(GET_STORED_ENTITIES, {
    variables: { entityType: 'room' },
    fetchPolicy: 'cache-and-network',
  });

  // Populate Apollo cache with individual room layouts for getOrderedItems to read
  useEffect(() => {
    if (!roomLayoutsData?.storedEntities) return;
    for (const entity of roomLayoutsData.storedEntities) {
      apolloClient.writeQuery({
        query: GET_STORED_ENTITY_LAYOUT,
        variables: { entityType: 'room', entityId: entity.entityId },
        data: {
          storedEntityLayout: {
            __typename: 'StoredEntityLayout',
            id: entity.id,
            entityType: entity.entityType,
            entityId: entity.entityId,
            parentId: entity.parentId,
            dataJson: entity.dataJson,
            layoutJson: entity.layoutJson,
            updatedAt: entity.updatedAt,
          }
        }
      });
    }
  }, [roomLayoutsData, apolloClient]);

  const [setCharacteristic] = useMutation<SetCharacteristicResponse>(SET_CHARACTERISTIC);
  const [setServiceGroup] = useMutation<SetServiceGroupResponse>(SET_SERVICE_GROUP);
  const [updateCollectionMutation] = useMutation<UpdateCollectionResponse>(UPDATE_COLLECTION);
  const [deleteCollectionMutation] = useMutation<{ deleteCollection: boolean }>(DELETE_COLLECTION);

  // Stable ref for homeId lookups — avoids putting allAccessoriesData in callback deps
  const allAccessoriesRef = useRef(allAccessoriesData);
  allAccessoriesRef.current = allAccessoriesData;

  // Update a characteristic value in the local cache (relay hooks cache)
  // This is used for optimistic updates, so isServerUpdate is false to always apply
  const updateCharacteristicInCache = useCallback((accessoryId: string, characteristicType: string, newValue: any) => {
    // Get homeId from selectedHomeId or look up from allAccessoriesData (for collections view)
    const homeId = selectedHomeId || allAccessoriesRef.current?.find(a => a.id === accessoryId)?.homeId;
    if (!homeId) return;
    // The newValue is already JSON-stringified by callers, so parse it first
    const parsedValue = typeof newValue === 'string' ? JSON.parse(newValue) : newValue;
    // Pass isServerUpdate=false so optimistic updates always apply immediately
    updateAccessoryCharacteristicInCache(homeId, accessoryId, characteristicType, parsedValue, false);
  }, [selectedHomeId]);

  const homes = homesData?.homes || [];
  const rooms = roomsData?.rooms || [];
  const accessories = (accessoriesData?.accessories || []) as HomeKitAccessory[];
  const serviceGroups = serviceGroupsData?.serviceGroups || [];

  // Broader access check: user has content access if they have a device, shared homes,
  // or any home with an active relay (homes.list includes relayConnected from DB)
  const hasSharedHomes = homes.some(h => h.role && h.role !== 'owner');
  const anyRelayConnected = homes.some(h => h.relayConnected === true);
  const hasContentAccess = hasDeviceAccess || hasSharedHomes || anyRelayConnected;

  // Selected home role - used to enforce view-only permissions
  const selectedHomeRole = useMemo(() => {
    if (!selectedHomeId) return 'owner';
    const home = homes.find(h => h.id === selectedHomeId);
    return (home?.role as string) || 'owner';
  }, [selectedHomeId, homes]);
  const isViewOnly = selectedHomeRole === 'view';
  const canShare = selectedHomeRole === 'owner' || selectedHomeRole === 'admin';

  // Check if selected shared home's relay is offline
  const selectedHomeRelayOffline = useMemo(() => {
    if (!selectedHomeId) return false;
    const home = homes.find(h => h.id === selectedHomeId);
    if (!home || !home.role || home.role === 'owner') return false;
    return home.relayConnected === false;
  }, [selectedHomeId, homes]);

  // Home name lookup map
  const homeNameMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const home of homes) {
      map.set(home.id, home.name);
    }
    return map;
  }, [homes]);
  const getHomeName = useCallback((homeId?: string) => homeId ? homeNameMap.get(homeId) : undefined, [homeNameMap]);

  // Auto-refresh when there are no homes and no accessories (every 5 seconds when page is visible)
  useEffect(() => {
    const hasNoData = homes.length === 0 && accessories.length === 0;
    if (!hasNoData || !hasContentAccess) return;

    let intervalId: ReturnType<typeof setInterval> | null = null;

    const startPolling = () => {
      if (intervalId) return;
      intervalId = setInterval(() => {
        refetchHomes();
        if (selectedHomeId) {
          refetchAccessories();
        }
      }, 5000);
    };

    const stopPolling = () => {
      if (intervalId) {
        clearInterval(intervalId);
        intervalId = null;
      }
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        // Refetch immediately when becoming visible
        refetchHomes();
        if (selectedHomeId) {
          refetchAccessories();
        }
        startPolling();
      } else {
        stopPolling();
      }
    };

    // Start polling if page is currently visible
    if (document.visibilityState === 'visible') {
      startPolling();
    }

    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      stopPolling();
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [homes.length, accessories.length, hasContentAccess, selectedHomeId, refetchHomes, refetchAccessories]);

  // Refetch settings + accessories when relay changes accessory selection (free plan)
  useEffect(() => {
    const unsubscribe = serverConnection.subscribeToBroadcasts((message) => {
      if (message.type === 'settings_updated') {
        if (import.meta.env.DEV) console.log('[Dashboard] Settings updated, refetching');
        refetchSettings();
        invalidateHomeKitCache('accessories', { prefix: true });
        refetchAccessories();
      }
    });
    return unsubscribe;
  }, [refetchSettings, refetchAccessories]);

  // Sort homes by custom order or alphabetically
  const sortedHomes = useMemo(() => {
    if (homeOrder.length === 0) {
      return [...homes].sort((a, b) => a.name.localeCompare(b.name));
    }
    const orderMap = new Map(homeOrder.map((id, idx) => [id, idx]));
    return [...homes].sort((a, b) => {
      const aIdx = orderMap.get(a.id);
      const bIdx = orderMap.get(b.id);
      if (aIdx !== undefined && bIdx !== undefined) return aIdx - bIdx;
      if (aIdx !== undefined) return -1;
      if (bIdx !== undefined) return 1;
      return a.name.localeCompare(b.name);
    });
  }, [homes, homeOrder]);

  // Edit mode for sidebar - null when viewing a collection (collection edit doesn't affect sidebar)
  

  // Count filtered accessories per home (for free plan, only count included accessories)
  // Ref preserves the last computed value so sidebar doesn't flash all homes during cache re-fetches
  const filteredAccessoryCountByHomeRef = useRef<Map<string, number> | null>(null);
  const filteredAccessoryCountByHome = useMemo(() => {
    if (accountType !== 'free') return null;
    if (!allAccessoriesData) return filteredAccessoryCountByHomeRef.current;
    const includedSet = includedAccessoryIds.length > 0 ? new Set(includedAccessoryIds) : null;
    const counts = new Map<string, number>();
    for (const acc of allAccessoriesData) {
      if (acc.homeId && (!includedSet || includedSet.has(acc.id))) {
        counts.set(acc.homeId, (counts.get(acc.homeId) || 0) + 1);
      }
    }
    filteredAccessoryCountByHomeRef.current = counts;
    return counts;
  }, [accountType, allAccessoriesData, includedAccessoryIds]);

  // Filter hidden homes when not showing hidden items
  const visibleHomes = useMemo(() => {
    // Build set of shared home names to suppress stale owned duplicates
    const sharedHomeNames = new Set(
      sortedHomes.filter(h => h.role && h.role !== 'owner').map(h => h.name.toLowerCase())
    );
    const pendingEnrollmentNames = new Set(
      pendingEnrollments.map(e => e.homeName.toLowerCase())
    );
    return sortedHomes.filter(h => {
      if (!showHiddenItems && visibility.ui.hiddenHomes.includes(h.id)) return false;
      if (filteredAccessoryCountByHome && filteredAccessoryCountByHome.get(h.id) === undefined) return false;
      // Always hide owned homes superseded by a pending cloud enrollment
      if (h.role === 'owner' && pendingEnrollmentNames.has(h.name.toLowerCase())) return false;
      // Hide stale owned homes that are superseded by a shared/cloud-managed home (only when relay disconnected)
      if (h.role === 'owner' && !h.relayConnected && sharedHomeNames.has(h.name.toLowerCase())) return false;
      return true;
    });
  }, [sortedHomes, visibility.ui.hiddenHomes, showHiddenItems, filteredAccessoryCountByHome, pendingEnrollments]);

  // Calculate hidden counts for edit mode badges (including cascading hidden devices, avoiding double-counting)
  const hiddenCounts = useMemo(() => {
    // Count explicitly hidden devices, excluding those already in hidden rooms/homes
    const countExplicitDevices = () => {
      const devices = visibility.ui.hiddenDevices;
      const hiddenHomeIds = new Set(visibility.ui.hiddenHomes);
      const hiddenRoomsMap = visibility.ui.hiddenRooms;
      let count = 0;
      for (const homeId in devices) {
        // Skip if home is already hidden (devices counted via home)
        if (hiddenHomeIds.has(homeId)) continue;
        for (const contextId in devices[homeId]) {
          // Skip if room is already hidden (devices counted via room)
          if (hiddenRoomsMap[homeId]?.includes(contextId)) continue;
          count += (devices[homeId][contextId] || []).length;
        }
      }
      return count;
    };

    // Count devices in hidden rooms (cascading), excluding rooms in hidden homes
    const countDevicesInHiddenRooms = () => {
      const hiddenRooms = visibility.ui.hiddenRooms;
      const hiddenHomeIds = new Set(visibility.ui.hiddenHomes);
      let count = 0;
      for (const homeId in hiddenRooms) {
        // Skip if home is already hidden (devices counted via home)
        if (hiddenHomeIds.has(homeId)) continue;
        const hiddenRoomIds = hiddenRooms[homeId] || [];
        for (const roomId of hiddenRoomIds) {
          const room = rooms.find(r => r.id === roomId);
          if (room) {
            count += room.accessoryCount || 0;
          }
        }
      }
      return count;
    };

    // Count devices in hidden homes (cascading)
    const countDevicesInHiddenHomes = () => {
      const hiddenHomeIds = visibility.ui.hiddenHomes;
      let count = 0;
      for (const homeId of hiddenHomeIds) {
        const home = homes.find(h => h.id === homeId);
        if (home) {
          count += home.accessoryCount || 0;
        }
      }
      return count;
    };

    // Count explicitly hidden rooms, excluding those in hidden homes
    const countExplicitRooms = () => {
      const hiddenRooms = visibility.ui.hiddenRooms;
      const hiddenHomeIds = new Set(visibility.ui.hiddenHomes);
      let count = 0;
      for (const homeId in hiddenRooms) {
        // Skip if home is already hidden (rooms counted via home)
        if (hiddenHomeIds.has(homeId)) continue;
        count += (hiddenRooms[homeId] || []).length;
      }
      return count;
    };

    // Count rooms in hidden homes (cascading)
    const countRoomsInHiddenHomes = () => {
      const hiddenHomeIds = visibility.ui.hiddenHomes;
      let count = 0;
      for (const homeId of hiddenHomeIds) {
        const home = homes.find(h => h.id === homeId);
        if (home) {
          count += home.roomCount || 0;
        }
      }
      return count;
    };

    // Count explicitly hidden groups, excluding those in hidden homes
    const countGroups = () => {
      const groups = visibility.ui.hiddenGroups;
      const hiddenHomeIds = new Set(visibility.ui.hiddenHomes);
      let count = 0;
      for (const homeId in groups) {
        if (hiddenHomeIds.has(homeId)) continue;
        count += (groups[homeId] || []).length;
      }
      return count;
    };

    // Calculate total hidden devices (no double counting)
    const getTotalHiddenDevices = () => {
      const explicit = countExplicitDevices();
      const inHiddenRooms = countDevicesInHiddenRooms();
      const inHiddenHomes = countDevicesInHiddenHomes();
      return explicit + inHiddenRooms + inHiddenHomes;
    };

    // Calculate total hidden rooms (no double counting)
    const getTotalHiddenRooms = () => {
      const explicit = countExplicitRooms();
      const inHiddenHomes = countRoomsInHiddenHomes();
      return explicit + inHiddenHomes;
    };

    return {
      ui: {
        homes: (visibility.ui.hiddenHomes || []).length,
        rooms: getTotalHiddenRooms(),
        groups: countGroups(),
        devices: getTotalHiddenDevices(),
      },
    };
  }, [visibility, rooms, homes]);

  // Handle home drag start - track which home is being dragged
  const handleHomeDragStart = useCallback((event: { active: { id: string | number } }) => {
    setDraggingHomeId(String(event.active.id));
  }, []);

  // Handle home drag end
  const handleHomeDragEnd = useCallback(async (event: DragEndEvent) => {
    setDraggingHomeId(null);
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const oldIndex = sortedHomes.findIndex(h => h.id === active.id);
    const newIndex = sortedHomes.findIndex(h => h.id === over.id);

    if (oldIndex === -1 || newIndex === -1) return;

    const newOrder = arrayMove(sortedHomes.map(h => h.id), oldIndex, newIndex);

    // Optimistic update - apply immediately, revert on failure
    const previous = homeOrder;
    setHomeOrder(newOrder);
    const success = await saveSettings({ homeOrder: newOrder }, 'homeOrder', true);
    if (!success) setHomeOrder(previous);
  }, [sortedHomes, homeOrder, saveSettings]);

  // Sort rooms by custom order (per home) or alphabetically
  // Uses entity layout (StoredEntity) for room order
  const sortedRooms = useMemo(() => {
    if (!selectedHomeId) return [...rooms].sort((a, b) => a.name.localeCompare(b.name));
    const order = homeLayout?.roomOrder || [];
    if (order.length === 0) {
      // No custom order, sort alphabetically
      return [...rooms].sort((a, b) => a.name.localeCompare(b.name));
    }
    // Sort by custom order, with any new rooms at the end (alphabetically)
    const orderMap = new Map(order.map((id, idx) => [id, idx]));
    return [...rooms].sort((a, b) => {
      const aIdx = orderMap.get(a.id);
      const bIdx = orderMap.get(b.id);
      if (aIdx !== undefined && bIdx !== undefined) return aIdx - bIdx;
      if (aIdx !== undefined) return -1;
      if (bIdx !== undefined) return 1;
      return a.name.localeCompare(b.name);
    });
  }, [rooms, selectedHomeId, homeLayout?.roomOrder]);

  // Count filtered accessories per room (for free plan sidebar filtering)
  const filteredAccessoryCountByRoom = useMemo(() => {
    if (accountType !== 'free') return null;
    const counts = new Map<string, number>();
    for (const acc of accessories) {
      if (acc.roomId) {
        counts.set(acc.roomId, (counts.get(acc.roomId) || 0) + 1);
      }
    }
    return counts;
  }, [accountType, accessories]);

  // Room IDs that have at least one allowed accessory (for free plan room group filtering)
  const allowedRoomIds = useMemo(() => {
    if (!filteredAccessoryCountByRoom) return null;
    return new Set(filteredAccessoryCountByRoom.keys());
  }, [filteredAccessoryCountByRoom]);

  // Filter hidden rooms when not in edit mode, and exclude rooms that are in room groups
  const visibleRooms = useMemo(() => {
    if (!selectedHomeId) return sortedRooms;
    if (false) return sortedRooms; // Show all in edit mode
    return sortedRooms.filter(r => {
      // Exclude hidden rooms
      if (isRoomHidden(selectedHomeId, r.id)) return false;
      // Exclude rooms that are in a room group
      const normalizedId = r.id.toLowerCase().replace(/-/g, '');
      if (roomIdsInGroups.has(normalizedId)) return false;
      // Hide rooms with no filtered accessories on free plan
      if (filteredAccessoryCountByRoom && !filteredAccessoryCountByRoom.has(r.id)) return false;
      return true;
    });
  }, [sortedRooms, selectedHomeId, isRoomHidden, roomIdsInGroups, filteredAccessoryCountByRoom]);

  // Optimistic state for sidebar order (for smooth drag-and-drop)
  const [optimisticSidebarOrder, setOptimisticSidebarOrder] = useState<string[] | null>(null);
  // Optimistic state for room group room orders (groupEntityId -> roomIds)
  const [optimisticGroupRoomOrders, setOptimisticGroupRoomOrders] = useState<Record<string, string[]>>({});

  // Create combined sidebar items (rooms + room groups + rooms inside groups) for unified sorting
  // Build sidebar as a tree structure (rooms and room groups with children)
  const sidebarTree = useMemo((): TreeItem[] => {
    // Build lookup maps for fast access
    const roomMap = new Map(visibleRooms.map(r => [r.id, r]));
    const allRoomsMap = new Map(rooms.map(r => [r.id.toLowerCase().replace(/-/g, ''), r]));
    const groupMap = new Map(roomGroups.map(g => [`room-group-${g.entityId}`, g]));

    // Use optimistic order if available, otherwise use saved order
    const savedOrder = optimisticSidebarOrder || homeLayout?.roomOrder || [];

    // Helper to get room IDs for a group (uses optimistic order if available)
    const getGroupRoomIds = (group: typeof roomGroups[0]) => {
      return optimisticGroupRoomOrders[group.entityId] || group.roomIds;
    };

    // Helper to build children for a room group, filtering out empty rooms on free plan
    const buildGroupChildren = (group: typeof roomGroups[0]): TreeItem[] => {
      const children: TreeItem[] = [];
      for (const roomId of getGroupRoomIds(group)) {
        const normalizedId = roomId.toLowerCase().replace(/-/g, '');
        const room = allRoomsMap.get(normalizedId);
        if (!room) continue;
        // On free plan, skip rooms with no included accessories
        if (allowedRoomIds && !allowedRoomIds.has(room.id)) continue;
        children.push({
          id: room.id,
          type: 'room',
          data: room,
          children: [],
        });
      }
      return children;
    };

    const items: TreeItem[] = [];
    const usedIds = new Set<string>();

    // First, add items in saved order
    for (const id of savedOrder) {
      if (usedIds.has(id)) continue;

      if (id.startsWith('room-group-')) {
        const group = groupMap.get(id);
        if (group) {
          const children = buildGroupChildren(group);
          // Hide empty room groups on free plan
          if (allowedRoomIds && children.length === 0) continue;
          items.push({
            id,
            type: 'roomGroup',
            data: group,
            children,
          });
          usedIds.add(id);
        }
      } else if (!id.startsWith('in-group-')) {
        const room = roomMap.get(id);
        if (room) {
          items.push({
            id: room.id,
            type: 'room',
            data: room,
            children: [],
          });
          usedIds.add(room.id);
        }
      }
    }

    // Add any remaining rooms not in saved order (at the end, sorted by name)
    const remainingRooms = visibleRooms
      .filter(r => !usedIds.has(r.id))
      .sort((a, b) => a.name.localeCompare(b.name));
    for (const room of remainingRooms) {
      items.push({
        id: room.id,
        type: 'room',
        data: room,
        children: [],
      });
    }

    // Add any remaining room groups not in saved order (at the end)
    for (const group of roomGroups) {
      const id = `room-group-${group.entityId}`;
      if (!usedIds.has(id)) {
        const children = buildGroupChildren(group);
        // Hide empty room groups on free plan
        if (allowedRoomIds && children.length === 0) continue;
        items.push({
          id,
          type: 'roomGroup',
          data: group,
          children,
        });
        usedIds.add(id);
      }
    }

    return items;
  }, [visibleRooms, rooms, roomGroups, homeLayout?.roomOrder, optimisticSidebarOrder, optimisticGroupRoomOrders, allowedRoomIds]);

  // Get root-level sortable IDs (rooms and room groups at top level)
  const sidebarRootIds = useMemo(() => {
    return sidebarTree.map(item => item.id);
  }, [sidebarTree]);

  // Get room IDs for a specific group (for in-group dragging)
  const getGroupRoomIds = useCallback((groupEntityId: string) => {
    const group = sidebarTree.find(item => item.id === `room-group-${groupEntityId}`);
    if (group?.type === 'roomGroup') {
      return group.children.map(child => child.id);
    }
    return [];
  }, [sidebarTree]);

  // Get sortable IDs based on current drag context
  const sidebarSortableIds = useMemo(() => {
    if (sidebarDragGroupContext) {
      // Dragging within a group - only that group's rooms are sortable
      return getGroupRoomIds(sidebarDragGroupContext);
    }
    // Dragging at root level - root items are sortable
    return sidebarRootIds;
  }, [sidebarDragGroupContext, sidebarRootIds, getGroupRoomIds]);

  // Clear optimistic state when layout updates from server
  useEffect(() => {
    if (homeLayout?.roomOrder) {
      setOptimisticSidebarOrder(null);
    }
  }, [homeLayout?.roomOrder]);

  // Clear optimistic group room orders when roomGroups updates from server
  useEffect(() => {
    setOptimisticGroupRoomOrders({});
  }, [roomGroups]);

  // Helper to get group by entityId
  const getGroupByEntityId = useCallback((entityId: string) => {
    return roomGroups.find(g => g.entityId === entityId);
  }, [roomGroups]);

  // Handle sidebar drag start - determine drag context (within group or at root)
  const handleSidebarDragStart = useCallback((event: DragStartEvent) => {
    const activeId = String(event.active.id);
    setSidebarActiveId(activeId);

    // Check if this item is inside a group
    for (const item of sidebarTree) {
      if (item.type === 'roomGroup') {
        const group = item.data as { entityId: string };
        if (item.children.some(child => child.id === activeId)) {
          // Dragging a room inside a group
          setSidebarDragGroupContext(group.entityId);
          return;
        }
      }
    }
    // Dragging at root level
    setSidebarDragGroupContext(null);
  }, [sidebarTree]);

  // Handle sidebar drag end - simple reordering within context
  const handleSidebarDragEnd = useCallback(async (event: DragEndEvent) => {
    const { active, over } = event;

    // Reset state
    const groupContext = sidebarDragGroupContext;
    setSidebarActiveId(null);
    setSidebarDragGroupContext(null);

    if (!over || active.id === over.id || !selectedHomeId) return;

    const activeId = String(active.id);
    const overId = String(over.id);

    if (groupContext) {
      // Reordering within a group
      const group = roomGroups.find(g => g.entityId === groupContext);
      if (!group) return;

      const roomIds = optimisticGroupRoomOrders[groupContext] || group.roomIds;
      const normalizedActiveId = activeId.toLowerCase().replace(/-/g, '');
      const normalizedOverId = overId.toLowerCase().replace(/-/g, '');

      const oldIndex = roomIds.findIndex(id => id.toLowerCase().replace(/-/g, '') === normalizedActiveId);
      const newIndex = roomIds.findIndex(id => id.toLowerCase().replace(/-/g, '') === normalizedOverId);

      if (oldIndex !== -1 && newIndex !== -1 && oldIndex !== newIndex) {
        const newRoomIds = arrayMove(roomIds, oldIndex, newIndex);
        setOptimisticGroupRoomOrders(prev => ({ ...prev, [groupContext]: newRoomIds }));
        handleUpdateRoomGroupRooms(groupContext, newRoomIds);
      }
    } else {
      // Reordering at root level
      const rootIds = sidebarTree.map(item => item.id);
      const oldIndex = rootIds.indexOf(activeId);
      const newIndex = rootIds.indexOf(overId);

      if (oldIndex !== -1 && newIndex !== -1 && oldIndex !== newIndex) {
        const newOrder = arrayMove(rootIds, oldIndex, newIndex);
        setOptimisticSidebarOrder(newOrder);
        await updateHomeLayout(prev => ({ ...prev, roomOrder: newOrder }));
      }
    }
  }, [sidebarDragGroupContext, sidebarTree, selectedHomeId, updateHomeLayout, handleUpdateRoomGroupRooms, optimisticGroupRoomOrders, roomGroups]);

  // Clear state on drag cancel
  const handleSidebarDragCancel = useCallback(() => {
    setSidebarActiveId(null);
    setSidebarDragGroupContext(null);
  }, []);

  // Parse collection payload to get groups for sidebar
  const collectionPayload = useMemo((): CollectionPayload => {
    if (!selectedCollection) return { groups: [], items: [] };
    return parseCollectionPayload(selectedCollection.payload);
  }, [selectedCollection]);

  // Count items per group for display
  const collectionGroupItemCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const group of collectionPayload.groups) {
      counts[group.id] = collectionPayload.items.filter(item => item.group_id === group.id).length;
    }
    return counts;
  }, [collectionPayload]);

  // Derived values for search prioritization
  const selectedRoomName = useMemo(() => {
    if (!selectedRoomId) return null;
    return rooms.find(r => r.id === selectedRoomId)?.name || null;
  }, [selectedRoomId, rooms]);

  const searchCollectionItemIds = useMemo(() => {
    if (!selectedCollectionId || collectionPayload.items.length === 0) return null;
    const ids = new Set<string>();
    for (const item of collectionPayload.items) {
      if (item.accessory_id) ids.add(item.accessory_id);
      if (item.service_group_id) ids.add(item.service_group_id);
    }
    return ids.size > 0 ? ids : null;
  }, [selectedCollectionId, collectionPayload.items]);

  // Handle collection group drag end (reorder groups)
  const handleCollectionGroupDragEnd = useCallback(async (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id || !selectedCollection) return;

    const groups = collectionPayload.groups;
    const oldIndex = groups.findIndex(g => g.id === active.id);
    const newIndex = groups.findIndex(g => g.id === over.id);

    if (oldIndex === -1 || newIndex === -1) return;

    const newGroups = arrayMove(groups, oldIndex, newIndex);
    const newPayload: CollectionPayload = {
      ...collectionPayload,
      groups: newGroups,
    };

    // Optimistically update the selected collection
    const updatedCollection = {
      ...selectedCollection,
      payload: JSON.stringify(newPayload),
    };
    setSelectedCollection(updatedCollection);

    // Save to backend
    try {
      await updateCollectionMutation({
        variables: {
          collectionId: selectedCollection.id,
          payload: JSON.stringify(newPayload),
        },
      });
    } catch {
      // Revert on failure
      setSelectedCollection(selectedCollection);
      toast.error('Failed to reorder groups');
    }
  }, [selectedCollection, collectionPayload, updateCollectionMutation]);

  // Handle sidebar group rename
  const handleSidebarGroupRename = useCallback(async (newName: string) => {
    if (!selectedCollection || !sidebarRenamingGroup || !newName.trim()) return;
    const updatedGroups = collectionPayload.groups.map(g =>
      g.id === sidebarRenamingGroup.id ? { ...g, name: newName.trim() } : g
    );
    const newPayload = { ...collectionPayload, groups: updatedGroups };
    try {
      const result = await updateCollectionMutation({
        variables: { collectionId: selectedCollection.id, payload: JSON.stringify(newPayload) },
      });
      if (result.data?.updateCollection) {
        setSelectedCollection(result.data.updateCollection);
        toast.success('Group renamed');
      }
    } catch {
      toast.error('Failed to rename group');
    }
    setSidebarRenamingGroup(null);
  }, [selectedCollection, sidebarRenamingGroup, collectionPayload, updateCollectionMutation]);

  // Handle sidebar group delete
  const handleSidebarGroupDelete = useCallback(async () => {
    if (!selectedCollection || !sidebarDeletingGroupId) return;
    const updatedGroups = collectionPayload.groups.filter(g => g.id !== sidebarDeletingGroupId);
    const updatedItems = collectionPayload.items.map(item =>
      item.group_id === sidebarDeletingGroupId ? { ...item, group_id: undefined } : item
    );
    const newPayload = { ...collectionPayload, groups: updatedGroups, items: updatedItems };
    try {
      const result = await updateCollectionMutation({
        variables: { collectionId: selectedCollection.id, payload: JSON.stringify(newPayload) },
      });
      if (result.data?.updateCollection) {
        setSelectedCollection(result.data.updateCollection);
        if (selectedCollectionGroupId === sidebarDeletingGroupId) {
          handleSelectCollectionGroup(null);
        }
        toast.success('Group deleted');
      }
    } catch {
      toast.error('Failed to delete group');
    }
    setSidebarDeletingGroupId(null);
  }, [selectedCollection, sidebarDeletingGroupId, collectionPayload, selectedCollectionGroupId, updateCollectionMutation]);

  // Handle sidebar collection rename
  const handleSidebarCollectionRename = useCallback(async (newName: string) => {
    if (!sidebarRenamingCollection || !newName.trim()) return;
    try {
      const result = await updateCollectionMutation({
        variables: { collectionId: sidebarRenamingCollection.id, name: newName.trim() },
      });
      if (result.data?.updateCollection) {
        if (selectedCollection?.id === sidebarRenamingCollection.id) {
          setSelectedCollection(result.data.updateCollection);
        }
        refetchCollectionsRef.current?.();
        toast.success('Collection renamed');
      }
    } catch {
      toast.error('Failed to rename collection');
    }
    setSidebarRenamingCollection(null);
  }, [sidebarRenamingCollection, selectedCollection, updateCollectionMutation]);

  // Handle sidebar collection delete
  const handleSidebarCollectionDelete = useCallback(async () => {
    if (!sidebarDeletingCollection) return;
    try {
      const result = await deleteCollectionMutation({
        variables: { collectionId: sidebarDeletingCollection.id },
      });
      if (result.data?.deleteCollection) {
        if (selectedCollection?.id === sidebarDeletingCollection.id) {
          setSelectedCollection(null);
        }
        refetchCollectionsRef.current?.();
        toast.success('Collection deleted');
      }
    } catch {
      toast.error('Failed to delete collection');
    }
    setSidebarDeletingCollection(null);
  }, [sidebarDeletingCollection, selectedCollection, deleteCollectionMutation]);

  // Get set of accessory IDs that are in service groups.
  // Groups may reference members via `accessoryIds` or `serviceIds` — resolve
  // service IDs back to their owning accessory so either form dedupes the
  // accessory out of the ungrouped list.
  const groupedAccessoryIds = useMemo(() => {
    const ids = new Set<string>();
    const serviceOwner = new Map<string, string>();
    for (const acc of accessories) {
      for (const svc of acc.services ?? []) serviceOwner.set(svc.id, acc.id);
    }
    for (const g of serviceGroups) {
      for (const id of g.accessoryIds ?? []) ids.add(id);
      for (const sid of g.serviceIds ?? []) {
        const ownerId = serviceOwner.get(sid);
        if (ownerId) ids.add(ownerId);
      }
    }
    return ids;
  }, [serviceGroups, accessories]);

  // Toggle group expanded state (not persisted - always closed on refresh)
  const toggleGroupExpanded = useCallback((groupId: string) => {
    setExpandedGroups(prev => {
      const next = new Set(prev);
      if (next.has(groupId)) {
        next.delete(groupId);
      } else {
        next.add(groupId);
      }
      return next;
    });
  }, []);

  // Toggle compact mode (optimistic update with transition for smooth UI)
  const toggleCompactMode = useCallback((value: boolean) => {
    startCompactModeTransition(() => {
      setCompactModeRaw(value);
    });
    saveSettings({ compactMode: value }, 'compactMode');
  }, [saveSettings]);

  // Toggle hide info devices (optimistic)
  const toggleHideInfoDevices = useCallback((value: boolean) => {
    setHideInfoDevices(value);
    saveSettings({ hideInfoDevices: value }, 'hideInfoDevices');
  }, [saveSettings]);

  // Toggle hide accessory counts (optimistic)
  const toggleHideAccessoryCounts = useCallback((value: boolean) => {
    setHideAccessoryCounts(value);
    saveSettings({ hideAccessoryCounts: value }, 'hideAccessoryCounts');
  }, [saveSettings]);

  // Change layout mode (optimistic)
  const changeLayoutMode = useCallback((mode: 'grid' | 'masonry') => {
    setLayoutMode(mode);
    saveSettings({ layoutMode: mode }, 'layoutMode');
  }, [saveSettings]);

  // Toggle group by room (optimistic)
  const toggleGroupByRoom = useCallback((value: boolean) => {
    setGroupByRoom(value);
    saveSettings({ groupByRoom: value }, 'groupByRoom');
  }, [saveSettings]);

  // Toggle group by type (optimistic)
  const toggleGroupByType = useCallback((value: boolean) => {
    setGroupByType(value);
    saveSettings({ groupByType: value }, 'groupByType');
  }, [saveSettings]);

  const toggleDeveloperMode = useCallback((value: boolean) => {
    setDeveloperMode(value);
    saveSettings({ developerMode: value }, 'developerMode');
  }, [saveSettings]);

  // Apply font size to root element
  useEffect(() => {
    const sizes = { small: '14px', medium: '16px', large: '18px' };
    document.documentElement.style.fontSize = sizes[fontSize];
  }, [fontSize]);

  // Sidebar widths scale with font size
  const sidebarWidth = fontSize === 'small' ? 200 : fontSize === 'large' ? 248 : 218;
  const mobileSidebarWidth = fontSize === 'small' ? 250 : fontSize === 'large' ? 296 : 266;

  // Change font size (optimistic)
  const changeFontSize = useCallback((size: 'small' | 'medium' | 'large') => {
    setFontSize(size);
    saveSettings({ fontSize: size }, 'fontSize');
  }, [saveSettings]);

  // Change icon style (optimistic)
  const changeIconStyle = useCallback((style: 'standard' | 'colourful') => {
    setIconStyle(style);
    saveSettings({ iconStyle: style }, 'iconStyle');
    // Also save to collection layout if viewing a collection (for shared views)
    if (selectedCollectionId && updateCollectionLayout) {
      updateCollectionLayout((prev) => ({ ...prev, iconStyle: style }));
    }
  }, [saveSettings, selectedCollectionId, updateCollectionLayout]);

  // Toggle auto backgrounds (optimistic)
  const toggleAutoBackgrounds = useCallback((value: boolean) => {
    setAutoBackgrounds(value);
    saveSettings({ autoBackgrounds: value }, 'autoBackgrounds');
  }, [saveSettings]);

  // Toggle full width (optimistic, browser-only)
  const toggleFullWidth = useCallback((value: boolean) => {
    setFullWidth(value);
    saveSettings({ fullWidth: value }, 'fullWidth');
  }, [saveSettings]);

  // Helper to copy text - uses native app when in WebView, falls back to clipboard API
  const copyToClipboard = useCallback((text: string): boolean => {
    const win = window as Window & { webkit?: { messageHandlers?: { homecast?: { postMessage: (msg: { action: string; text?: string }) => void } } } };
    if (win.webkit?.messageHandlers?.homecast) {
      win.webkit.messageHandlers.homecast.postMessage({ action: 'copy', text });
    } else {
      navigator.clipboard.writeText(text);
    }
    return true;
  }, []);

  // Copy URL to clipboard with a unique key
  // Open settings to a specific tab
  const openSettingsTo = useCallback((tab: SettingsTab) => {
    setSettingsInitialTab(tab);
    setSettingsOpen(true);
    updateUrlParams({ settings: tab });
  }, [updateUrlParams]);

  // Handle widget click to expand/collapse
  const handleWidgetClick = useCallback((widgetId: string) => {
    setExpandedWidgetId(prev => prev === widgetId ? null : widgetId);
  }, []);

  // Ref for collapse timeout
  const collapseTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Collapse with small delay when mouse leaves (allows time to enter expanded overlay)
  const handleWidgetMouseLeave = useCallback(() => {
    collapseTimeoutRef.current = setTimeout(() => {
      setExpandedWidgetId(null);
    }, 100);
  }, []);

  // Cancel pending collapse (when entering expanded overlay)
  const cancelCollapseTimeout = useCallback(() => {
    if (collapseTimeoutRef.current) {
      clearTimeout(collapseTimeoutRef.current);
      collapseTimeoutRef.current = null;
    }
  }, []);

  // Collapse expanded widget
  const collapseExpandedWidget = useCallback(() => {
    cancelCollapseTimeout();
    setExpandedWidgetId(null);
  }, [cancelCollapseTimeout]);

  // Handle group toggle (power on/off all accessories in group)
  const handleGroupToggle = useCallback(async (groupId: string, newValue: boolean, homeId?: string) => {
    const effectiveHomeId = homeId || selectedHomeId;
    if (!effectiveHomeId) return;
    const targetHome = homes.find(h => h.id === effectiveHomeId);
    if (isViewOnly || targetHome?.role === 'view') {
      toast.error('View-only access: you cannot control devices in this home');
      return;
    }

    // Mark this as a pending group update to prevent stale server updates from overwriting
    markGroupPendingUpdate(groupId, 'on', newValue);

    // Find all accessories in this group and update cache optimistically
    const group = serviceGroups.find(g => g.id === groupId) || allServiceGroupsData?.find(g => g.id === groupId);
    if (group) {
      for (const accessoryId of group.accessoryIds) {
        // Try both 'on' and 'power_state' characteristic types
        updateCharacteristicInCache(accessoryId, 'on', JSON.stringify(newValue));
        updateCharacteristicInCache(accessoryId, 'power_state', JSON.stringify(newValue));
      }
    }

    try {
      // Always use relay (local loopback in Mac app, WebSocket in browser)
      await serverConnection.request('serviceGroup.set', {
        homeId: effectiveHomeId,
        groupId,
        characteristicType: 'on',
        value: newValue
      });
      // Real-time updates via WebSocket will sync the values
    } catch (error: any) {
      console.error('Failed to toggle group:', error);
      const msg = error instanceof HomecastError
        ? `${error.code}: ${error.message}`
        : 'Failed to control group';
      toast.error(msg);
      // Revert optimistic update on error
      if (group) {
        for (const accessoryId of group.accessoryIds) {
          updateCharacteristicInCache(accessoryId, 'on', JSON.stringify(!newValue));
          updateCharacteristicInCache(accessoryId, 'power_state', JSON.stringify(!newValue));
        }
      }
    }
  }, [selectedHomeId, serviceGroups, allServiceGroupsData, homes, updateCharacteristicInCache, isViewOnly]);

  // Handle group slider (e.g., brightness for all accessories in group)
  const handleGroupSlider = useCallback(async (groupId: string, characteristicType: string, value: number, homeId?: string) => {
    const effectiveHomeId = homeId || selectedHomeId;
    if (!effectiveHomeId) return;
    const targetHome = homes.find(h => h.id === effectiveHomeId);
    if (isViewOnly || targetHome?.role === 'view') {
      toast.error('View-only access: you cannot control devices in this home');
      return;
    }

    // Mark this as a pending group update to prevent stale server updates from overwriting
    markGroupPendingUpdate(groupId, characteristicType, value);

    // Find all accessories in this group
    const group = serviceGroups.find(g => g.id === groupId) || allServiceGroupsData?.find(g => g.id === groupId);
    if (!group) return;

    // Capture previous values for revert
    const previousValues: Record<string, number | null> = {};
    for (const accessoryId of group.accessoryIds) {
      const accessory = accessories.find(a => a.id === accessoryId);
      if (accessory) {
        for (const service of accessory.services || []) {
          for (const char of service.characteristics || []) {
            if (char.characteristicType === characteristicType) {
              previousValues[accessoryId] = char.value !== undefined ? Number(char.value) : null;
              break;
            }
          }
        }
      }
    }

    // Update cache optimistically
    for (const accessoryId of group.accessoryIds) {
      updateCharacteristicInCache(accessoryId, characteristicType, JSON.stringify(value));
    }

    try {
      // Always use relay (local loopback in Mac app, WebSocket in browser)
      await serverConnection.request('serviceGroup.set', {
        homeId: effectiveHomeId,
        groupId,
        characteristicType,
        value
      });
      // Real-time updates via WebSocket will sync the values
    } catch (error: any) {
      console.error('Failed to set group slider:', error);
      const msg = error instanceof HomecastError
        ? `${error.code}: ${error.message}`
        : 'Failed to control group';
      toast.error(msg);
      // Revert optimistic update on error
      for (const accessoryId of group.accessoryIds) {
        const prevValue = previousValues[accessoryId];
        if (prevValue !== null && prevValue !== undefined) {
          updateCharacteristicInCache(accessoryId, characteristicType, JSON.stringify(prevValue));
        }
      }
    }
  }, [selectedHomeId, serviceGroups, allServiceGroupsData, homes, accessories, updateCharacteristicInCache, isViewOnly]);

  // Get averaged characteristics for a group (for tooltip display)
  const getGroupAverageCharacteristics = useCallback((group: HomeKitServiceGroup) => {
    const groupAccessories = accessories.filter(a => group.accessoryIds.includes(a.id));
    if (groupAccessories.length === 0) return [];

    // Collect all characteristic values by type
    const charValues: Record<string, { values: number[], type: string }> = {};
    const charTypes = ['brightness', 'color_temperature', 'target_position', 'current_position', 'current_temperature', 'target_temperature'];

    for (const acc of groupAccessories) {
      for (const service of acc.services || []) {
        for (const char of service.characteristics || []) {
          if (charTypes.includes(char.characteristicType)) {
            const val = parseFloat(String(char.value));
            if (!isNaN(val)) {
              if (!charValues[char.characteristicType]) {
                charValues[char.characteristicType] = { values: [], type: char.characteristicType };
              }
              charValues[char.characteristicType].values.push(val);
            }
          }
        }
      }
    }

    // Calculate averages
    return Object.entries(charValues).map(([type, data]) => ({
      type,
      value: Math.round(data.values.reduce((a, b) => a + b, 0) / data.values.length)
    }));
  }, [accessories]);

  // Auto-select home: use saved preference, or primary home, or first home
  // But NOT if a collection is selected
  // Uses visibleHomes so free-plan users don't land on a home with 0 included accessories
  useEffect(() => {
    // Don't auto-select home if viewing a collection or enrollment
    if (selectedCollectionId || selectedEnrollmentId) {
      return;
    }
    if (visibleHomes.length > 0) {
      // Check pendingHomeId (immediate) since selectedHomeId uses deferred transition
      // Verify it exists in visibleHomes (not just homes) so free-plan filtering is respected
      if (pendingHomeId && visibleHomes.some(h => h.id === pendingHomeId)) {
        return; // Keep current selection
      }
      // Otherwise, select primary or first visible home
      const primaryHome = visibleHomes.find(h => h.isPrimary);
      const homeToSelect = primaryHome?.id || visibleHomes[0].id;
      setSelectedHomeId(homeToSelect);
      setPendingHomeId(homeToSelect);
      localStorage.setItem('homecast-selected-home', homeToSelect);
    } else if (!homesLoading && pendingHomeId) {
      // No homes available (new user, all homes removed) — clear stale selection
      // so we don't fetch/display another user's background
      setSelectedHomeId(null);
      setPendingHomeId(null);
      localStorage.removeItem('homecast-selected-home');
      localStorage.removeItem('homecast-selected-room');
    }
    // Note: intentionally not including selectedHomeId to prevent oscillation during transitions
    // pendingHomeId is the source of truth for user intent
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibleHomes, pendingHomeId, homesLoading, selectedCollectionId, selectedEnrollmentId, setSelectedHomeId]);

  // Validate saved room belongs to current home's rooms
  // Skip during home transitions — rooms are stale (from the old home) until
  // the deferred selectedHomeId commits, so validating would incorrectly clear the room
  useEffect(() => {
    if (isHomeSwitching) return;
    if (rooms.length > 0 && selectedRoomId) {
      if (!rooms.some(r => r.id === selectedRoomId)) {
        setSelectedRoomId(null);
        localStorage.removeItem('homecast-selected-room');
      }
    }
  }, [rooms, selectedRoomId, isHomeSwitching]);

  // Group accessories by room
  const accessoriesByRoom = useMemo(() => {
    const grouped: Record<string, HomeKitAccessory[]> = {};
    for (const accessory of accessories) {
      const roomName = accessory.roomName || 'Unknown Room';
      if (!grouped[roomName]) {
        grouped[roomName] = [];
      }
      grouped[roomName].push(accessory);
    }
    return grouped;
  }, [accessories]);

  // Get service groups that have accessories in a specific room
  const getGroupsForRoom = useCallback((roomAccessories: HomeKitAccessory[]) => {
    const accessoryIds = new Set(roomAccessories.map(a => a.id));
    return serviceGroups.filter(group =>
      group.accessoryIds.some(id => accessoryIds.has(id))
    );
  }, [serviceGroups]);

  // Get accessories in a group
  const getAccessoriesInGroup = useCallback((group: HomeKitServiceGroup) => {
    return accessories.filter(a => group.accessoryIds.includes(a.id));
  }, [accessories]);

  // Check if all accessories in a group are on
  const isGroupOn = useCallback((group: HomeKitServiceGroup) => {
    const groupAccessories = getAccessoriesInGroup(group);
    return groupAccessories.some(accessory => {
      for (const service of accessory.services || []) {
        for (const char of service.characteristics || []) {
          if (char.characteristicType === 'on' || char.characteristicType === 'power_state') {
            const value = parseCharacteristicValue(char.value);
            if (value === true || value === 1) return true;
          }
        }
      }
      return false;
    });
  }, [getAccessoriesInGroup]);

  // Check if a group contains window covering devices
  const isWindowCoveringGroup = useCallback((group: HomeKitServiceGroup) => {
    const groupAccessories = getAccessoriesInGroup(group);
    return groupAccessories.length > 0 && groupAccessories.every(accessory =>
      hasServiceType(accessory, 'window_covering')
    );
  }, [getAccessoriesInGroup]);

  // Get the average position of all window coverings in a group
  const getGroupAveragePosition = useCallback((group: HomeKitServiceGroup) => {
    const groupAccessories = getAccessoriesInGroup(group);
    let total = 0;
    let count = 0;
    for (const accessory of groupAccessories) {
      const posChar = getCharacteristic(accessory, 'current_position');
      if (posChar) {
        const value = posChar.value;
        // Handle false/invalid values
        const numValue = (value === false || value === 'false' || value === null || value === undefined)
          ? 0
          : Number(value);
        if (!isNaN(numValue)) {
          total += numValue;
          count++;
        }
      }
    }
    return count > 0 ? Math.round(total / count) : 0;
  }, [getAccessoriesInGroup]);

  // Get the average brightness of all lights in a group
  const getGroupAverageBrightness = useCallback((group: HomeKitServiceGroup) => {
    const groupAccessories = getAccessoriesInGroup(group);
    let total = 0;
    let count = 0;
    for (const accessory of groupAccessories) {
      const brightnessChar = getCharacteristic(accessory, 'brightness');
      if (brightnessChar) {
        const value = brightnessChar.value;
        const numValue = value !== null && value !== undefined ? Number(value) : null;
        if (numValue !== null && !isNaN(numValue)) {
          total += numValue;
          count++;
        }
      }
    }
    return count > 0 ? Math.round(total / count) : null;
  }, [getAccessoriesInGroup]);

  // Check if a group is a light group (has dimmable lights)
  const isLightGroup = useCallback((group: HomeKitServiceGroup) => {
    const groupAccessories = getAccessoriesInGroup(group);
    return groupAccessories.some(acc =>
      hasServiceType(acc, 'lightbulb') && getCharacteristic(acc, 'brightness') !== null
    );
  }, [getAccessoriesInGroup]);

  // Categorize accessories by type
  const getAccessoryCategory = useCallback((accessory: HomeKitAccessory): string => {
    const category = accessory.category?.toLowerCase() || '';
    const serviceTypes = (accessory.services || []).map(s => s.serviceType.toLowerCase());

    if (category === 'bridge' || category === 'range extender') return 'Bridges & Hubs';
    if (serviceTypes.some(s => s.includes('sensor') || s.includes('contact'))) return 'Sensors';
    if (serviceTypes.some(s => s.includes('lock') || s.includes('security'))) return 'Security';
    if (serviceTypes.some(s => s === 'lightbulb')) return 'Lights';
    if (serviceTypes.some(s => (s.includes('switch') && !s.includes('programmable')) || s.includes('outlet'))) return 'Switches';
    if (serviceTypes.some(s => s.includes('thermostat') || s.includes('heater') || s.includes('cooler'))) return 'Climate';
    if (serviceTypes.some(s => s.includes('blind') || s.includes('window') || s.includes('covering'))) return 'Blinds & Shades';
    if (serviceTypes.some(s => s.includes('fan'))) return 'Fans';
    if (serviceTypes.some(s => s.includes('garage') || s.includes('door'))) return 'Doors';
    if (serviceTypes.some(s => s.includes('camera') || s.includes('doorbell'))) return 'Cameras';
    if (serviceTypes.some(s => s.includes('speaker') || s.includes('microphone'))) return 'Audio';
    if (serviceTypes.some(s => s.includes('valve') || s.includes('irrigation') || s.includes('faucet'))) return 'Water';
    if (serviceTypes.some(s => s.includes('button') || s.includes('programmable'))) return 'Buttons & Remotes';
    return 'Other';
  }, []);

  // Filter by selected room, apply visibility, and sort by custom order
  const filteredRooms = useMemo(() => {
    // Filter out hidden rooms (unless in edit mode)
    let visibleRooms = sortedRooms;
    if (selectedHomeId) {
      visibleRooms = sortedRooms.filter(r => !isRoomHidden(selectedHomeId, r.id));
    }
    const visibleRoomIds = new Set(visibleRooms.map(r => r.id));

    const entries = selectedRoomId
      ? Object.entries(accessoriesByRoom).filter(([_, accs]) =>
          accs.some(a => a.roomId === selectedRoomId)
        )
      : Object.entries(accessoriesByRoom).filter(([roomName]) => {
          // Filter by visible rooms
          const room = rooms.find(r => r.name === roomName);
          return room ? visibleRoomIds.has(room.id) : true;
        });

    // Create a map from room name to room ID for ordering
    const roomNameToId = new Map(rooms.map(r => [r.name, r.id]));

    // Sort by sortedRooms order
    const orderMap = new Map(visibleRooms.map((r, idx) => [r.id, idx]));

    // Sort rooms and accessories within each room by category, then apply custom device order
    return entries
      .sort(([aName], [bName]) => {
        const aId = roomNameToId.get(aName);
        const bId = roomNameToId.get(bName);
        const aIdx = aId !== undefined ? orderMap.get(aId) : undefined;
        const bIdx = bId !== undefined ? orderMap.get(bId) : undefined;
        if (aIdx !== undefined && bIdx !== undefined) return aIdx - bIdx;
        if (aIdx !== undefined) return -1;
        if (bIdx !== undefined) return 1;
        return aName.localeCompare(bName);
      })
      .map(([roomName, accs]): [string, HomeKitAccessory[]] => {
        const room = rooms.find(r => r.name === roomName);
        const contextId = selectedRoomId || (room?.id) || 'all';

        // Sort by category first
        let sorted = [...accs].sort((a, b) => {
          const aCat = getAccessoryCategory(a);
          const bCat = getAccessoryCategory(b);
          const aIdx = CATEGORY_ORDER.indexOf(aCat);
          const bIdx = CATEGORY_ORDER.indexOf(bCat);
          if (aIdx !== bIdx) return aIdx - bIdx;
          return a.name.localeCompare(b.name);
        });

        // Sorting is handled by getOrderedItems at render time

        return [roomName, sorted];
      });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedRoomId, accessoriesByRoom, rooms, sortedRooms, getAccessoryCategory, CATEGORY_ORDER, selectedHomeId, isRoomHidden, visibility, visibilityVersion]);

  // Get category for a service group (based on first accessory)
  const getGroupCategory = (group: HomeKitServiceGroup): string => {
    const groupAccessories = accessories.filter(a => group.accessoryIds.includes(a.id));
    if (groupAccessories.length === 0) return 'Other';
    return getAccessoryCategory(groupAccessories[0]);
  };

  // Check if accessory is an info-only device (bridge, range extender, sensors, etc.)
  const isInfoDevice = (accessory: HomeKitAccessory): boolean => {
    const category = accessory.category?.toLowerCase() || '';
    const hiddenCategories = ['bridge', 'range extender', 'rangeextender'];
    if (hiddenCategories.includes(category)) return true;
    // Service types that are info/sensor-only (no user-controllable actions)
    const infoOnlyServices = [
      'motion_sensor',
      'temperature_sensor',
      'light_sensor',
      'smoke_sensor',
      'carbon_monoxide_sensor',
      'contact_sensor',
      'leak_sensor',
      'occupancy_sensor',
      'humidity_sensor',
      'air_quality_sensor',
      'stateless_programmable_switch',
      'battery',
      'label',
      'accessory_information',
      'protocol_information',
    ];
    // Check if device has any controllable (non-info-only) services
    const hasControllableService = (accessory.services || []).some(
      s => s.serviceType && !infoOnlyServices.includes(s.serviceType)
    );
    return !hasControllableService;
  };

  // Filter accessories based on hideInfoDevices setting and user visibility preferences
  const filterAccessories = useCallback((accs: HomeKitAccessory[], contextId: string): HomeKitAccessory[] => {
    let filtered = accs;
    // Filter info devices unless viewing in edit mode
    if (hideInfoDevices) {
      filtered = filtered.filter(a => !isInfoDevice(a));
    }
    // Filter hidden devices and devices in hidden rooms (unless in edit mode where we show them dimmed)
    if (selectedHomeId) {
      filtered = filtered.filter(a => {
        // If the accessory's room is hidden, filter it out
        if (a.roomId && isRoomHidden(selectedHomeId, a.roomId)) return false;
        // Filter by individual device visibility
        return !isDeviceHidden(selectedHomeId, contextId, a.id);
      });
    }
    return filtered;
  }, [hideInfoDevices,  selectedHomeId, isDeviceHidden, isRoomHidden]);

  // Get effective value - just returns the server value (cache is the source of truth)
  // Must be defined before early returns to satisfy React hooks rules
  const getEffectiveValue = useCallback((_accessoryId: string, _characteristicType: string, serverValue: any) => {
    return serverValue;
  }, []);

  // These hooks must be defined before any early returns to satisfy React hooks rules
  const handleToggle = useCallback(async (accessoryId: string, characteristicType: string, currentValue: boolean) => {
    if (isViewOnly) {
      toast.error('View-only access: you cannot control devices in this home');
      return;
    }
    const newValue = !currentValue;

    // Mark this as a pending update to prevent stale server updates from overwriting
    markPendingUpdate(accessoryId, characteristicType, newValue);

    // Optimistic update - update cache directly (JSON-stringify to match cache format)
    updateCharacteristicInCache(accessoryId, characteristicType, JSON.stringify(newValue));

    // Get homeId from selectedHomeId or look up from accessory (for collection view)
    const homeId = selectedHomeId || accessories.find(a => a.id === accessoryId)?.homeId || allAccessoriesRef.current?.find(a => a.id === accessoryId)?.homeId;

    try {
      // Always use relay (local loopback in Mac app, WebSocket in browser)
      await serverConnection.request('characteristic.set', {
        accessoryId,
        characteristicType,
        value: newValue,
        homeId
      });
      // Cache already has the correct value from optimistic update
    } catch (error: any) {
      const msg = error instanceof HomecastError
        ? `${error.code}: ${error.message}`
        : (error.message || 'Failed to update device');
      toast.error(msg);
      // Revert optimistic update on error
      updateCharacteristicInCache(accessoryId, characteristicType, JSON.stringify(currentValue));
    }
  }, [updateCharacteristicInCache, selectedHomeId, accessories, isViewOnly]);

  const handleSlider = useCallback(async (accessoryId: string, characteristicType: string, value: number) => {
    if (isViewOnly) {
      toast.error('View-only access: you cannot control devices in this home');
      return;
    }
    // Mark this as a pending update to prevent stale server updates from overwriting
    markPendingUpdate(accessoryId, characteristicType, value);

    // Optimistic update - update cache directly (JSON-stringify to match cache format)
    updateCharacteristicInCache(accessoryId, characteristicType, JSON.stringify(value));

    // Get homeId from selectedHomeId or look up from accessory (for collection view)
    const homeId = selectedHomeId || accessories.find(a => a.id === accessoryId)?.homeId || allAccessoriesRef.current?.find(a => a.id === accessoryId)?.homeId;

    try {
      // Always use relay (local loopback in Mac app, WebSocket in browser)
      await serverConnection.request('characteristic.set', {
        accessoryId,
        characteristicType,
        value,
        homeId
      });
      // Cache already has the correct value from optimistic update
    } catch (error: any) {
      const msg = error instanceof HomecastError
        ? `${error.code}: ${error.message}`
        : (error.message || 'Failed to update');
      toast.error(msg);
    }
  }, [updateCharacteristicInCache, selectedHomeId, accessories, isViewOnly]);

  // Stable callback for toggling hidden items visibility (shared by all widgets)
  const handleToggleShowHidden = useCallback(() => {
    setShowHiddenItems(prev => !prev);
  }, []);

  // Track previous background to avoid flashing during loading
  const prevBackgroundRef = useRef<BackgroundSettings | null>(null);
  // Local override for immediate UI update after saving (bypasses Apollo cache delays)
  const [savedBackgroundOverride, setSavedBackgroundOverride] = useState<BackgroundSettings | null>(null);
  // Image luminance reported by BackgroundImage (synchronized with visual crossfade)
  const [bgImageLuminance, setBgImageLuminance] = useState<number | null>(null);
  // Average top-row color from image backgrounds (for iOS 26 Liquid Glass tinting)
  const [bgImageTopColor, setBgImageTopColor] = useState<string | null>(null);

  // Compute effective background: collectionGroup > collection > room > home (with inheritance)
  // NOTE: This hook MUST be before early returns to satisfy React's Rules of Hooks
  const effectiveBackground = useMemo((): BackgroundSettings | null => {
    // When viewing a collection
    if (selectedCollectionId) {
      // If group is selected but still loading, don't fall through yet
      if (selectedCollectionGroupId && collectionGroupLayoutLoading) {
        return prevBackgroundRef.current;
      }
      // Collection group background takes precedence
      if (selectedCollectionGroupId && collectionGroupLayout?.background && collectionGroupLayout.background.type !== 'none') {
        return collectionGroupLayout.background;
      }
      // If collection is still loading, don't fall through yet
      if (collectionLayoutLoading) {
        return prevBackgroundRef.current;
      }
      // Fall back to collection background
      if (collectionLayout?.background && collectionLayout.background.type !== 'none') {
        return collectionLayout.background;
      }
      return null;
    }
    // When viewing a home/room
    // If room is selected but still loading, don't fall through to home yet
    if (selectedRoomId && roomLayoutLoading) {
      return prevBackgroundRef.current;
    }
    // Room background takes precedence if set
    if (selectedRoomId && roomLayout?.background && roomLayout.background.type !== 'none') {
      return roomLayout.background;
    }
    // If home layout is still loading, hold previous background
    if (selectedHomeId && homeLayoutLoading) {
      return prevBackgroundRef.current;
    }
    // Fall back to home background
    if (selectedHomeId && homeLayout?.background && homeLayout.background.type !== 'none') {
      return homeLayout.background;
    }
    return null;
  }, [
    selectedRoomId, selectedHomeId, selectedCollectionId, selectedCollectionGroupId,
    roomLayout?.background, homeLayout?.background, collectionLayout?.background, collectionGroupLayout?.background,
    // Use raw JSON strings as stable dependencies - these change whenever any property changes
    roomLayoutJson, homeLayoutJson, collectionLayoutJson, collectionGroupLayoutJson,
    homeLayoutLoading, roomLayoutLoading, collectionLayoutLoading, collectionGroupLayoutLoading
  ]);

  // Update previous background ref after computing (for next render)
  useEffect(() => {
    if (effectiveBackground !== prevBackgroundRef.current) {
      prevBackgroundRef.current = effectiveBackground;
    }
  }, [effectiveBackground]);

  // Clear the saved background override when navigation changes
  // Use a ref to track previous values and only clear on actual navigation
  const prevNavRef = useRef({ selectedRoomId, selectedHomeId, selectedCollectionId, selectedCollectionGroupId });
  useEffect(() => {
    const prev = prevNavRef.current;
    const hasNavigated =
      prev.selectedRoomId !== selectedRoomId ||
      prev.selectedHomeId !== selectedHomeId ||
      prev.selectedCollectionId !== selectedCollectionId ||
      prev.selectedCollectionGroupId !== selectedCollectionGroupId;

    if (hasNavigated) {
      setSavedBackgroundOverride(null);
      setBgImageLuminance(null);
      setBgImageTopColor(null);
    }
    prevNavRef.current = { selectedRoomId, selectedHomeId, selectedCollectionId, selectedCollectionGroupId };
  }, [selectedRoomId, selectedHomeId, selectedCollectionId, selectedCollectionGroupId]);

  // Use override if set, otherwise use computed effective background
  const activeBackground = savedBackgroundOverride ?? effectiveBackground;

  // Current entity ID for auto backgrounds
  const currentEntityId = selectedCollectionGroupId || selectedCollectionId || selectedRoomId || selectedHomeId || undefined;

  // Compute the actual displayed background (including auto backgrounds) for dark mode detection
  const displayedBackground = useMemo(() => {
    // If explicit background is set (preset or custom), use it
    if (activeBackground && (activeBackground.type === 'preset' || activeBackground.type === 'custom')) {
      return activeBackground;
    }
    // If auto backgrounds enabled and we have an entity ID, generate auto preset
    if (autoBackgrounds && currentEntityId) {
      const autoPresetId = getAutoPresetId(currentEntityId);
      return {
        type: 'preset' as const,
        presetId: autoPresetId,
        blur: 10,
        brightness: 50,
      };
    }
    // No background
    return activeBackground;
  }, [activeBackground, autoBackgrounds, currentEntityId]);

  // Determine if there's an active background and if it's dark enough for light text
  const { hasBackground, isDarkBackground } = useBackgroundDarkness(displayedBackground, bgImageLuminance);
  // Light background: has background but not dark enough for dark mode styling
  const isLightBackground = hasBackground && !isDarkBackground;

  // Android Tauri app: sync status bar icon color with background darkness
  useEffect(() => {
    const w = window as Window & { HomecastAndroid?: { setStatusBarDarkIcons: (dark: boolean) => void } };
    w.HomecastAndroid?.setStatusBarDarkIcons(!isDarkBackground);
  }, [isDarkBackground]);

  // iOS 26 Safari Liquid Glass: set body background-color to match the active background.
  // Safari's translucent system bars tint from the body's background-color.
  const tintColor = useMemo(() => {
    const bg = displayedBackground;
    const brightness = bg?.brightness ?? 50;
    if (bg?.type === 'preset' && bg.presetId) {
      // Solid colors and gradients — weighted average + brightness
      if (PRESET_SOLID_COLORS[bg.presetId] || PRESET_GRADIENTS[bg.presetId]) {
        return getDominantColor(bg.presetId, brightness);
      }
      // Preset images — sampled top-5-rows color + brightness
      if (PRESET_IMAGES[bg.presetId]) {
        if (bgImageTopColor) return applyBrightnessToHex(bgImageTopColor, brightness);
        return isDarkBackground ? '#333333' : '#aaaaaa';
      }
    }
    if (bg?.type === 'custom') {
      if (bgImageTopColor) return applyBrightnessToHex(bgImageTopColor, bg?.brightness ?? 50);
      return isDarkBackground ? '#333333' : '#aaaaaa';
    }
    return '#ffffff';
  }, [displayedBackground, bgImageTopColor, isDarkBackground]);

  useEffect(() => {
    if (isInMobileApp) return;
    if (isInMacApp) {
      const w = window as any;
      w.webkit?.messageHandlers?.homecast?.postMessage({ action: 'backgroundColor', color: tintColor });
      return () => {
        // Clear explicit color so backgroundDark fallback resumes
        w.webkit?.messageHandlers?.homecast?.postMessage({ action: 'backgroundColor' });
      };
    }
    document.body.style.backgroundColor = tintColor;
    return () => {
      document.body.style.removeProperty('background-color');
    };
  }, [tintColor, isInMacApp, isInMobileApp]);

  // Helper to compute blur tint class for an accessory (used for ExpandedOverlay)
  const getAccessoryBlurTint = useCallback((accessory: HomeKitAccessory) => {
    if (activeIconStyle !== 'colourful') return undefined;

    // Gather all relevant characteristic data first (don't break early for climate devices)
    let isOn = false;
    let heaterCoolerState: number | null = null;
    let heatingThresholdValue: number | null = null;
    let coolingThresholdValue: number | null = null;
    let targetHCValidValues: number[] | undefined;

    for (const service of accessory.services || []) {
      for (const char of service.characteristics || []) {
        const charType = char.characteristicType;
        const value = getEffectiveValue(accessory.id, charType, char.value);

        // Standard on/power_state
        if (charType === 'on' || charType === 'power_state') {
          const on = value === true || value === 1 || value === '1' || value === 'true';
          if (on) isOn = true;
        }
        // Locks: locked (1) = on
        if (charType === 'lock_current_state') {
          const on = value === 1 || value === '1';
          if (on) isOn = true;
        }
        // Thermostats/climate: active state
        if (charType === 'active') {
          const on = value === 1 || value === '1' || value === true || value === 'true';
          if (on) isOn = true;
        }
        // Blinds: position > 0 = on
        if (charType === 'current_position') {
          const pos = typeof value === 'number' ? value : parseInt(value as string, 10);
          const on = !isNaN(pos) && pos > 0;
          if (on) isOn = true;
        }
        // Security system: armed states (0, 1, 2) = on, disarmed (3) = off
        if (charType === 'security_system_current_state') {
          const state = typeof value === 'number' ? value : parseInt(value as string, 10);
          const on = !isNaN(state) && state < 3; // 0=Stay, 1=Away, 2=Night are armed
          if (on) isOn = true;
        }
        // Track heater/cooler target state for dynamic color (1 = heat, 2 = cool)
        if (charType === 'target_heater_cooler_state') {
          const state = typeof value === 'number' ? value : parseInt(value as string, 10);
          if (!isNaN(state)) heaterCoolerState = state;
          targetHCValidValues = char.validValues;
        }
        // Track threshold values for capability detection
        if (charType === 'heating_threshold' && value !== null && value !== undefined) {
          heatingThresholdValue = typeof value === 'number' ? value : parseFloat(value as string);
        }
        if (charType === 'cooling_threshold' && value !== null && value !== undefined) {
          coolingThresholdValue = typeof value === 'number' ? value : parseFloat(value as string);
        }
      }
    }

    if (!isOn) return undefined;

    const serviceType = getPrimaryServiceType(accessory);

    // For heater_cooler, determine color based on capabilities (matching ThermostatWidget logic)
    if (serviceType === 'heater_cooler') {
      // Determine capabilities from validValues or threshold presence
      let hasHeatingCapability: boolean;
      let hasCoolingCapability: boolean;

      if (targetHCValidValues && targetHCValidValues.length > 0) {
        hasHeatingCapability = targetHCValidValues.includes(1);
        hasCoolingCapability = targetHCValidValues.includes(2);
      } else {
        // Fall back to checking if threshold values exist
        hasHeatingCapability = heatingThresholdValue !== null && !isNaN(heatingThresholdValue);
        hasCoolingCapability = coolingThresholdValue !== null && !isNaN(coolingThresholdValue);
      }

      // Heat-only device → always orange
      if (hasHeatingCapability && !hasCoolingCapability) {
        return getIconColor('thermostat').blurBg;
      }
      // Cool-only device → always blue
      if (hasCoolingCapability && !hasHeatingCapability) {
        return getIconColor('heater_cooler').blurBg;
      }
      // Both capabilities → color based on target mode
      if (heaterCoolerState === 1) {
        return getIconColor('thermostat').blurBg; // Heat mode → orange
      } else if (heaterCoolerState === 2) {
        return getIconColor('heater_cooler').blurBg; // Cool mode → blue
      }
      // Auto mode (0) or unknown → green/balanced
      return getIconColor('climate_balanced').blurBg;
    }

    const iconColor = getIconColor(serviceType);
    return iconColor?.blurBg;
  }, [activeIconStyle, getEffectiveValue]);

  // Handle saving background settings
  // NOTE: This hook MUST be before early returns to satisfy React's Rules of Hooks
  const handleSaveBackgroundSettings = useCallback(async (settings: BackgroundSettings) => {
    if (!backgroundSettingsTarget) return;

    const targetId = backgroundSettingsTarget.id;

    // Immediately update local override for instant UI response
    // Use flushSync to force synchronous update before async save
    flushSync(() => {
      setSavedBackgroundOverride(settings);
    });

    if (backgroundSettingsTarget.type === 'room') {
      await saveBgRoomLayout(targetId, {
        ...bgTargetRoomLayout,
        background: settings,
      });
      if (targetId === selectedRoomId) {
        refetchRoomLayout();
      }
    } else if (backgroundSettingsTarget.type === 'home') {
      await saveBgHomeLayout(targetId, {
        ...bgTargetHomeLayout,
        background: settings,
      });
      if (targetId === selectedHomeId) {
        refetchHomeLayout();
      }
    } else if (backgroundSettingsTarget.type === 'collection') {
      await saveBgCollectionLayout(targetId, {
        ...bgTargetCollectionLayout,
        background: settings,
      });
      if (targetId === selectedCollectionId) {
        refetchCollectionLayout();
      }
    } else if (backgroundSettingsTarget.type === 'collectionGroup') {
      await saveBgGroupLayout(targetId, {
        ...bgTargetGroupLayout,
        background: settings,
      });
      if (targetId === selectedCollectionGroupId) {
        refetchCollectionGroupLayout();
      }
    } else if (backgroundSettingsTarget.type === 'roomGroup') {
      await saveBgRoomGroupLayout(targetId, {
        ...bgTargetRoomGroupLayout,
        background: settings,
      });
    }
  }, [backgroundSettingsTarget, bgTargetRoomLayout, bgTargetHomeLayout, bgTargetCollectionLayout, bgTargetGroupLayout, bgTargetRoomGroupLayout, saveBgRoomLayout, saveBgHomeLayout, saveBgCollectionLayout, saveBgGroupLayout, saveBgRoomGroupLayout, selectedRoomId, selectedHomeId, selectedCollectionId, selectedCollectionGroupId, refetchRoomLayout, refetchHomeLayout, refetchCollectionLayout, refetchCollectionGroupLayout]);

  // Handle saving background to all homes
  const handleSaveBackgroundToAllHomes = useCallback(async (settings: BackgroundSettings) => {
    for (const home of homes) {
      await saveBgHomeLayout(home.id, { background: settings });
    }
    // Refetch current home layout if viewing one
    if (selectedHomeId) {
      refetchHomeLayout();
    }
  }, [homes, saveBgHomeLayout, selectedHomeId, refetchHomeLayout]);

  // Handle saving background to all rooms
  const handleSaveBackgroundToAllRooms = useCallback(async (settings: BackgroundSettings) => {
    for (const room of rooms) {
      await saveBgRoomLayout(room.id, { background: settings });
    }
    // Refetch current room layout if viewing one
    if (selectedRoomId) {
      refetchRoomLayout();
    }
  }, [rooms, saveBgRoomLayout, selectedRoomId, refetchRoomLayout]);

  // Handle saving background to all collections
  const handleSaveBackgroundToAllCollections = useCallback(async (settings: BackgroundSettings) => {
    for (const collection of allCollections) {
      await saveBgCollectionLayout(collection.id, { background: settings });
    }
    // Refetch current collection layout if viewing one
    if (selectedCollectionId) {
      refetchCollectionLayout();
    }
  }, [allCollections, saveBgCollectionLayout, selectedCollectionId, refetchCollectionLayout]);

  // Handle saving background to all groups in current collection
  const handleSaveBackgroundToAllGroups = useCallback(async (settings: BackgroundSettings) => {
    const groups = collectionPayload.groups || [];
    for (const group of groups) {
      await saveBgGroupLayout(group.id, { background: settings });
    }
    // Refetch current group layout if viewing one
    if (selectedCollectionGroupId) {
      refetchCollectionGroupLayout();
    }
  }, [collectionPayload.groups, saveBgGroupLayout, selectedCollectionGroupId, refetchCollectionGroupLayout]);

  // Handler for opening background settings from context menu
  const openBackgroundSettingsFromContext = useCallback(() => {
    if (selectedCollectionId && selectedCollectionGroupId) {
      const group = collectionPayload.groups.find(g => g.id === selectedCollectionGroupId);
      setBackgroundSettingsTarget({
        type: 'collectionGroup',
        id: selectedCollectionGroupId,
        name: group?.name || 'Group',
        parentId: selectedCollectionId,
      });
    } else if (selectedCollectionId) {
      const collection = selectedCollection;
      setBackgroundSettingsTarget({
        type: 'collection',
        id: selectedCollectionId,
        name: collection?.name || 'Collection',
      });
    } else if (selectedRoomId && selectedHomeId) {
      const room = rooms.find(r => r.id === selectedRoomId);
      setBackgroundSettingsTarget({
        type: 'room',
        id: selectedRoomId,
        name: room?.name || 'Room',
      });
    } else if (selectedHomeId) {
      const home = homes.find(h => h.id === selectedHomeId);
      setBackgroundSettingsTarget({
        type: 'home',
        id: selectedHomeId,
        name: home?.name || 'Home',
      });
    } else {
      return; // No entity selected
    }
    setBackgroundSettingsOpen(true);
  }, [selectedCollectionId, selectedCollectionGroupId, selectedRoomId, selectedHomeId, collectionPayload.groups, selectedCollection, rooms, homes]);

  const selectedHome = homes.find(h => h.id === selectedHomeId);

  const handleCloseAccessorySelection = useCallback(() => {
    setAccessorySelectionOpen(false);
  }, []);

  // Accessory selection save handler
  const handleAccessorySelectionSave = useCallback(async (selectedIds: string[], selectedServiceGroupIds: string[]) => {
    const success = await saveSettings({ includedAccessoryIds: selectedIds, includedServiceGroupIds: selectedServiceGroupIds }, 'includedAccessoryIds', true);
    if (success) {
      setAccessorySelectionOpen(false);
      refetchSettings();
      // Update relay local-handler
      if (isRelayCapable()) {
        setRelayAllowedIds(selectedIds);
      }
      // Invalidate and refetch accessories so sidebar/widgets update
      invalidateHomeKitCache('accessories', { prefix: true });
      refetchAccessories();
      toast.success('Accessory selection saved');
    }
  }, [saveSettings, refetchAccessories]);

  // Auto-open accessory selection when free plan and no selection exists (relay mode)
  const autoOpenedSelectionRef = useRef(false);
  useEffect(() => {
    if (accountType !== 'free') return;
    if (!isRelayCapable()) return;
    if (autoOpenedSelectionRef.current) return;
    if (!serverConnected) return;
    if (!settingsData) return; // Wait for settings to load
    if (includedAccessoryIds.length > 0) return; // Already has selection

    const homes = homesData?.homes;
    if (!homes || homes.length === 0) return;

    autoOpenedSelectionRef.current = true;
    setAccessorySelectionOpen(true);
  }, [accountType, serverConnected, settingsData, homesData, includedAccessoryIds]);

  // Upgrade handler
  const handleUpgrade = useCallback(async () => {
    try {
      const { data } = await createCheckoutMutation({ variables: { region: pricingRegion } });
      if (data?.createCheckoutSession?.url) {
        window.location.href = data.createCheckoutSession.url;
      } else if (data?.createCheckoutSession?.error) {
        toast.error(data.createCheckoutSession.error);
      }
    } catch (e) {
      toast.error('Failed to start checkout');
    }
  }, [createCheckoutMutation, pricingRegion]);

  // Smart Deal badge — rendered as a child component so it reads DealsContext from inside the provider
  const getDealBadge = useCallback((accessory: import('@/lib/graphql/types').HomeKitAccessory) => {
    if (!showSmartDeals) return null;
    return <AccessoryDealBadge accessory={accessory} />;
  }, [showSmartDeals]);

  // Manage subscription handler
  const handleManageSubscription = useCallback(async () => {
    try {
      const { data } = await createPortalMutation();
      if (data?.createPortalSession?.url) {
        window.location.href = data.createPortalSession.url;
      } else if (data?.createPortalSession?.error) {
        toast.error(data.createPortalSession.error);
      }
    } catch (e) {
      toast.error('Failed to open subscription management');
    }
  }, [createPortalMutation]);

  // Upgrade to Cloud handler
  const handleUpgradeToCloud = useCallback(async () => {
    try {
      const { data } = await createCheckoutMutation({ variables: { region: pricingRegion, plan: 'cloud' } });
      const result = data?.createCheckoutSession;
      if (result?.upgraded) {
        toast.success('Upgraded to Cloud plan!');
        // Refetch account data to update UI
        refetchAccount?.();
      } else if (result?.url) {
        window.location.href = result.url;
      } else if (result?.error) {
        toast.error(result.error);
      }
    } catch {
      toast.error('Failed to upgrade to Cloud');
    }
  }, [createCheckoutMutation, pricingRegion, refetchAccount]);

  // Downgrade to Standard handler
  const handleDowngradeToStandard = useCallback(async () => {
    if (!confirm('This will cancel your cloud relay enrollments and downgrade to Standard. Continue?')) return;
    try {
      const { data } = await downgradeMutation({ variables: { region: pricingRegion } });
      const result = data?.downgradeToStandard;
      if (result?.upgraded) {
        toast.success('Downgraded to Standard plan');
        refetchAccount?.();
      } else if (result?.error) {
        toast.error(result.error);
      }
    } catch {
      toast.error('Failed to downgrade');
    }
  }, [downgradeMutation, pricingRegion, refetchAccount]);

  // Onboarding completion handler
  const handleOnboardingComplete = useCallback(async (setupPath: SetupPath, enrollmentId?: string) => {
    setShowOnboarding(false);
    try {
      const currentSettings: import('@/lib/graphql/types').UserSettingsData = settingsData?.settings?.data ? JSON.parse(settingsData.settings.data) : {};
      const updated = {
        ...currentSettings,
        onboardingCompleted: true,
        onboarding: {
          completed: true,
          setupPath,
          ...(enrollmentId ? { pendingEnrollmentId: enrollmentId } : {}),
        },
      };
      await updateSettingsMutation({ variables: { data: JSON.stringify(updated) } });
    } catch { /* ignore save errors */ }
  }, [settingsData, updateSettingsMutation]);

  const handleSetupMac = useCallback(async () => {
    try {
      const currentSettings: import('@/lib/graphql/types').UserSettingsData = settingsData?.settings?.data ? JSON.parse(settingsData.settings.data) : {};
      const updated = {
        ...currentSettings,
        onboarding: {
          completed: currentSettings.onboarding?.completed ?? true,
          ...currentSettings.onboarding,
          setupPath: 'mac-relay' as const,
        },
      };
      await updateSettingsMutation({ variables: { data: JSON.stringify(updated) } });
    } catch { /* ignore save errors */ }
  }, [settingsData, updateSettingsMutation]);

  // Tutorial completion handler
  const handleTutorialComplete = useCallback(async () => {
    setShowTutorial(false);
    try {
      const currentSettings: import('@/lib/graphql/types').UserSettingsData = settingsData?.settings?.data ? JSON.parse(settingsData.settings.data) : {};
      const updated = { ...currentSettings, tutorialCompleted: true };
      await updateSettingsMutation({ variables: { data: JSON.stringify(updated) } });
    } catch { /* ignore save errors */ }
  }, [settingsData, updateSettingsMutation]);

  if (authLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  if (accountType === 'managed') {
    return <ManagedRelayDashboard />;
  }

  if (accountType === 'waitlist' && !isAdmin) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-4">
        <div className="max-w-sm w-full text-center space-y-4">
          <div className="flex justify-center">
            <img src="/icon-192.png" alt="Homecast" className="h-12 w-12 rounded-xl" />
          </div>
          <h1 className="text-xl font-semibold">You're on the waiting list</h1>
          <p className="text-sm text-muted-foreground">
            Your account has been created but is not yet activated. We'll let you know when you're in!
          </p>
          <Button variant="outline" size="sm" onClick={logout} className="mt-4">
            Log Out
          </Button>
        </div>
      </div>
    );
  }

  // Get all displayable characteristics from an accessory
  const getDisplayableCharacteristics = (accessory: HomeKitAccessory) => {
    const result: Array<{
      type: string;
      value: any;
      meta: CharacteristicMeta;
      isWritable: boolean;
    }> = [];

    for (const service of accessory.services || []) {
      // Skip accessory_information service (contains model, manufacturer, etc.)
      if (service.serviceType === 'accessory_information') continue;

      for (const char of service.characteristics || []) {
        const meta = getCharacteristicMeta(char.characteristicType);
        // Parse the JSON-encoded value from the server
        const parsedValue = parseCharacteristicValue(char.value);
        // Only include non-hidden characteristics that have values (or are writable controls)
        const isControl = meta.controlType === 'toggle' || meta.controlType === 'slider';
        if (meta.controlType !== 'hidden' && (parsedValue != null || isControl)) {
          result.push({
            type: char.characteristicType,
            value: parsedValue,
            meta,
            isWritable: char.isWritable ?? isControl,
          });
        }
      }
    }

    // Remove duplicates (same characteristic type)
    const seen = new Set<string>();
    return result.filter(c => {
      if (seen.has(c.type)) return false;
      seen.add(c.type);
      return true;
    });
  };

  const getAccessoryIcon = (category: string | undefined) => {
    switch ((category || '').toLowerCase()) {
      case 'lightbulb': return <Lightbulb className="h-4 w-4" />;
      case 'switch': return <Power className="h-4 w-4" />;
      case 'thermostat': return <Thermometer className="h-4 w-4" />;
      case 'fan': return <Wind className="h-4 w-4" />;
      case 'lock': return <Lock className="h-4 w-4" />;
      case 'sensor': return <Droplets className="h-4 w-4" />;
      case 'door': return <DoorOpen className="h-4 w-4" />;
      case 'outlet': return <Plug className="h-4 w-4" />;
      case 'camera': return <Camera className="h-4 w-4" />;
      case 'speaker': return <Speaker className="h-4 w-4" />;
      case 'tv': case 'television': return <Tv className="h-4 w-4" />;
      default: return <Power className="h-4 w-4" />;
    }
  };


  const refreshAll = () => {
    setIsManualRefreshing(true);
    refetchSessions();
    // Refetch collections if viewing a collection
    if (selectedCollection && refetchCollectionsRef.current) {
      refetchCollectionsRef.current();
    }
    if (hasContentAccess) {
      refetchHomes();
      if (selectedHomeId) {
        refetchRooms();
        refetchAccessories();
        refetchServiceGroups();
      }
    }
  };
  refreshAllRef.current = refreshAll;

  const startHardReloadCountdown = () => {
    if (hardReloadTimerRef.current) clearInterval(hardReloadTimerRef.current);
    setHardReloadCountdown(3);
    let remaining = 3;
    hardReloadTimerRef.current = setInterval(async () => {
      remaining--;
      if (remaining <= 0) {
        if (hardReloadTimerRef.current) clearInterval(hardReloadTimerRef.current);
        hardReloadTimerRef.current = null;
        if ('caches' in window) {
          await caches.keys().then(names => Promise.all(names.map(n => caches.delete(n))));
        }
        window.location.reload();
      } else {
        setHardReloadCountdown(remaining);
      }
    }, 1000);
  };

  const cancelHardReload = () => {
    if (hardReloadTimerRef.current) clearInterval(hardReloadTimerRef.current);
    hardReloadTimerRef.current = null;
    setHardReloadCountdown(null);
  };

  const handlePullRefresh = async () => {
    // Pull super far (500px+ raw finger distance) → hard reload countdown
    if (pullMaxDeltaRef.current > 500) {
      startHardReloadCountdown();
      return Promise.resolve();
    }

    refreshAll();
    // Resolve immediately — the blurred overlay handles the loading state
    return Promise.resolve();
  };



  // Right menu for header (three dots menu)
  const headerRightMenu = (
    <>
    {hasContentAccess && (
    <Button variant="ghost" size="icon" className={`h-10 w-10 focus-visible:ring-0 focus-visible:ring-offset-0 transition-colors duration-300 ${isDarkBackground ? '!bg-black/40 backdrop-blur-xl text-white hover:!bg-black/50' : '!bg-transparent hover:!bg-black/10'}`} disabled={isConnectingOverlay} onClick={() => { searchInitialKeyRef.current = ''; setSearchOpen(true); }}>
      <Search className="h-5 w-5" />
    </Button>
    )}
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button data-tour="header-menu" variant="ghost" size="icon" className={`relative h-10 w-10 -mr-[10px] focus-visible:ring-0 focus-visible:ring-offset-0 transition-colors duration-300 ${isDarkBackground ? '!bg-black/40 backdrop-blur-xl text-white hover:!bg-black/50' : '!bg-transparent hover:!bg-black/10'}`}>
          <MoreVertical className="h-5 w-5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[200px]">
        {selectedCollectionId && selectedCollectionGroupId && hasContentAccess ? (
          <div className="mx-1 my-1 rounded-lg bg-muted/50 overflow-hidden">
            <div className="flex items-center justify-between px-3 py-2">
              <span className="text-xs font-medium text-muted-foreground">
                {collectionPayload.groups.find(g => g.id === selectedCollectionGroupId)?.name || 'Group'}
              </span>
              <button
                onClick={refreshAll}
                disabled={accessoriesLoading || collectionsLoading}
                className="p-1 rounded hover:bg-muted disabled:opacity-50"
              >
                <RefreshCw className={`h-3.5 w-3.5 text-muted-foreground ${accessoriesLoading || collectionsLoading ? 'animate-spin' : ''}`} />
              </button>
            </div>
            <DropdownMenuItem onClick={() => {
              const collection = allCollections.find(c => c.id === selectedCollectionId);
              const collectionPayloadForGroup = collection ? parseCollectionPayload(collection.payload) : { groups: [], items: [] };
              const group = collectionPayloadForGroup.groups.find(g => g.id === selectedCollectionGroupId);
              if (group) setSidebarShareGroup({ collectionId: selectedCollectionId, groupId: selectedCollectionGroupId, groupName: group.name });
            }}>
              <Share2 className="h-4 w-4 mr-2" />
              Share
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setCollectionAddItemsOpen(true)}>
              <Plus className="h-4 w-4 mr-2" />
              Select Accessories
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => {
              const group = collectionPayload.groups.find(g => g.id === selectedCollectionGroupId);
              setBackgroundSettingsTarget({
                type: 'collectionGroup',
                id: selectedCollectionGroupId!,
                name: group?.name || 'Group',
                parentId: selectedCollectionId,
              });
              setBackgroundSettingsOpen(true);
            }}>
              <ImageIcon className="h-4 w-4 mr-2" />
              Background
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setShowHiddenItems(!showHiddenItems)}>
              {showHiddenItems ? (
                <>
                  <EyeOff className="h-4 w-4 mr-2" />
                  Hide Hidden
                </>
              ) : (
                <>
                  <Eye className="h-4 w-4 mr-2" />
                  Show Hidden
                </>
              )}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => {
              const group = collectionPayload.groups.find(g => g.id === selectedCollectionGroupId);
              if (group) setSidebarRenamingGroup({ id: group.id, name: group.name });
            }}>
              <Pencil className="h-4 w-4 mr-2" />
              Rename
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setSidebarDeletingGroupId(selectedCollectionGroupId!)} className="text-destructive focus:text-destructive">
              <Trash2 className="h-4 w-4 mr-2" />
              Delete
            </DropdownMenuItem>
          </div>
        ) : selectedCollectionId && hasContentAccess ? (
          <div className="mx-1 my-1 rounded-lg bg-muted/50 overflow-hidden">
            <div className="flex items-center justify-between px-3 py-2">
              <span className="text-xs font-medium text-muted-foreground">
                {selectedCollection?.name || 'Collection'}
              </span>
              <button
                onClick={refreshAll}
                disabled={accessoriesLoading || collectionsLoading}
                className="p-1 rounded hover:bg-muted disabled:opacity-50"
              >
                <RefreshCw className={`h-3.5 w-3.5 text-muted-foreground ${accessoriesLoading || collectionsLoading ? 'animate-spin' : ''}`} />
              </button>
            </div>
            <DropdownMenuItem onClick={() => {
              const collection = allCollections.find(c => c.id === selectedCollectionId);
              if (collection) setSidebarShareCollection(collection);
            }}>
              <Share2 className="h-4 w-4 mr-2" />
              Share
            </DropdownMenuItem>
            {isMobile && (
            <DropdownMenuItem
              onClick={() => {
                if (isTabPinned('collection', selectedCollectionId!)) {
                  handleUnpinTab('collection', selectedCollectionId!);
                } else if (selectedCollection) {
                  handlePinTab({ type: 'collection', id: selectedCollectionId!, name: selectedCollection.name });
                }
              }}
              disabled={!isTabPinned('collection', selectedCollectionId!) && pinnedTabs.length >= MAX_PINNED_TABS}
            >
              {isTabPinned('collection', selectedCollectionId!) ? (
                <>
                  <PinOff className="h-4 w-4 mr-2" />
                  Unpin from Tab Bar
                </>
              ) : pinnedTabs.length >= MAX_PINNED_TABS ? (
                <>
                  <Pin className="h-4 w-4 mr-2" />
                  Tab Bar Full ({MAX_PINNED_TABS}/{MAX_PINNED_TABS})
                </>
              ) : (
                <>
                  <Pin className="h-4 w-4 mr-2" />
                  Pin to Tab Bar
                </>
              )}
            </DropdownMenuItem>
            )}
            <DropdownMenuItem onClick={() => setCollectionAddItemsOpen(true)}>
              <Plus className="h-4 w-4 mr-2" />
              Select Accessories
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setCollectionAddingGroup(true)}>
              <FolderPlus className="h-4 w-4 mr-2" />
              Create Group
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => {
              setBackgroundSettingsTarget({
                type: 'collection',
                id: selectedCollectionId,
                name: selectedCollection?.name || 'Collection',
              });
              setBackgroundSettingsOpen(true);
            }}>
              <ImageIcon className="h-4 w-4 mr-2" />
              Background
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setShowHiddenItems(!showHiddenItems)}>
              {showHiddenItems ? (
                <>
                  <EyeOff className="h-4 w-4 mr-2" />
                  Hide Hidden
                </>
              ) : (
                <>
                  <Eye className="h-4 w-4 mr-2" />
                  Show Hidden
                </>
              )}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => {
              const collection = allCollections.find(c => c.id === selectedCollectionId);
              if (collection) setSidebarRenamingCollection(collection);
            }}>
              <Pencil className="h-4 w-4 mr-2" />
              Rename
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => {
              const collection = allCollections.find(c => c.id === selectedCollectionId);
              if (collection) setSidebarDeletingCollection(collection);
            }} className="text-destructive focus:text-destructive">
              <Trash2 className="h-4 w-4 mr-2" />
              Delete
            </DropdownMenuItem>
          </div>
        ) : selectedRoomId && selectedHomeId && hasContentAccess ? (
          <div className="mx-1 my-1 rounded-lg bg-muted/50 overflow-hidden">
            <div className="flex items-center justify-between px-3 py-2">
              <span className="text-xs font-medium text-muted-foreground">
                {rooms.find(r => r.id === selectedRoomId)?.name || 'Room'}
              </span>
              <button
                onClick={refreshAll}
                disabled={accessoriesLoading || collectionsLoading}
                className="p-1 rounded hover:bg-muted disabled:opacity-50"
              >
                <RefreshCw className={`h-3.5 w-3.5 text-muted-foreground ${accessoriesLoading || collectionsLoading ? 'animate-spin' : ''}`} />
              </button>
            </div>
            <DropdownMenuItem onClick={() => {
              const room = rooms.find(r => r.id === selectedRoomId);
              if (room) setSidebarShareRoom({ room, homeId: selectedHomeId! });
            }}>
              <Share2 className="h-4 w-4 mr-2" />
              Share
            </DropdownMenuItem>
            {isMobile && (
            <DropdownMenuItem
              onClick={() => {
                const room = rooms.find(r => r.id === selectedRoomId);
                if (isTabPinned('room', selectedRoomId!)) {
                  handleUnpinTab('room', selectedRoomId!);
                } else if (room) {
                  handlePinTab({ type: 'room', id: selectedRoomId!, name: room.name, homeId: selectedHomeId! });
                }
              }}
              disabled={!isTabPinned('room', selectedRoomId!) && pinnedTabs.length >= MAX_PINNED_TABS}
            >
              {isTabPinned('room', selectedRoomId!) ? (
                <>
                  <PinOff className="h-4 w-4 mr-2" />
                  Unpin from Tab Bar
                </>
              ) : pinnedTabs.length >= MAX_PINNED_TABS ? (
                <>
                  <Pin className="h-4 w-4 mr-2" />
                  Tab Bar Full ({MAX_PINNED_TABS}/{MAX_PINNED_TABS})
                </>
              ) : (
                <>
                  <Pin className="h-4 w-4 mr-2" />
                  Pin to Tab Bar
                </>
              )}
            </DropdownMenuItem>
            )}
            <DropdownMenuItem onClick={() => {
              const room = rooms.find(r => r.id === selectedRoomId);
              setBackgroundSettingsTarget({
                type: 'room',
                id: selectedRoomId!,
                name: room?.name || 'Room',
              });
              setBackgroundSettingsOpen(true);
            }}>
              <ImageIcon className="h-4 w-4 mr-2" />
              Background
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setShowHiddenItems(!showHiddenItems)}>
              {showHiddenItems ? (
                <>
                  <EyeOff className="h-4 w-4 mr-2" />
                  Hide Hidden
                </>
              ) : (
                <>
                  <Eye className="h-4 w-4 mr-2" />
                  Show Hidden
                </>
              )}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => toggleVisibility('room', 'ui', selectedHomeId!, selectedRoomId!)}>
              {isRoomActuallyHidden(selectedHomeId!, selectedRoomId!) ? (
                <>
                  <Eye className="h-4 w-4 mr-2" />
                  Unhide Room
                </>
              ) : (
                <>
                  <EyeOff className="h-4 w-4 mr-2" />
                  Hide Room
                </>
              )}
            </DropdownMenuItem>
          </div>
        ) : selectedHomeId && hasContentAccess ? (
          <div className="mx-1 my-1 rounded-lg bg-muted/50 overflow-hidden">
            <div className="flex items-center justify-between px-3 py-2">
              <span className="text-xs font-medium text-muted-foreground">
                {homes.find(h => h.id === selectedHomeId)?.name || 'Home'}
              </span>
              <button
                onClick={refreshAll}
                disabled={accessoriesLoading || collectionsLoading}
                className="p-1 rounded hover:bg-muted disabled:opacity-50"
              >
                <RefreshCw className={`h-3.5 w-3.5 text-muted-foreground ${accessoriesLoading || collectionsLoading ? 'animate-spin' : ''}`} />
              </button>
            </div>
            <DropdownMenuItem onClick={() => {
              const home = homes.find(h => h.id === selectedHomeId);
              if (home) setSidebarShareHome(home);
            }}>
              <Share2 className="h-4 w-4 mr-2" />
              Share
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => {
              const home = homes.find(h => h.id === selectedHomeId);
              if (home) { setCreateRoomGroupHome(home); setCreateRoomGroupDialogOpen(true); }
            }}>
              <Layers className="h-4 w-4 mr-2" />
              Create Room Group
            </DropdownMenuItem>
            {isMobile && (
            <DropdownMenuItem
              onClick={() => {
                const home = homes.find(h => h.id === selectedHomeId);
                if (isTabPinned('home', selectedHomeId!)) {
                  handleUnpinTab('home', selectedHomeId!);
                } else if (home) {
                  handlePinTab({ type: 'home', id: selectedHomeId!, name: home.name });
                }
              }}
              disabled={!isTabPinned('home', selectedHomeId!) && pinnedTabs.length >= MAX_PINNED_TABS}
            >
              {isTabPinned('home', selectedHomeId!) ? (
                <>
                  <PinOff className="h-4 w-4 mr-2" />
                  Unpin from Tab Bar
                </>
              ) : pinnedTabs.length >= MAX_PINNED_TABS ? (
                <>
                  <Pin className="h-4 w-4 mr-2" />
                  Tab Bar Full ({MAX_PINNED_TABS}/{MAX_PINNED_TABS})
                </>
              ) : (
                <>
                  <Pin className="h-4 w-4 mr-2" />
                  Pin to Tab Bar
                </>
              )}
            </DropdownMenuItem>
            )}
            <DropdownMenuItem onClick={() => {
              const home = homes.find(h => h.id === selectedHomeId);
              setBackgroundSettingsTarget({
                type: 'home',
                id: selectedHomeId!,
                name: home?.name || 'Home',
              });
              setBackgroundSettingsOpen(true);
            }}>
              <ImageIcon className="h-4 w-4 mr-2" />
              Background
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setShowHiddenItems(!showHiddenItems)}>
              {showHiddenItems ? (
                <>
                  <EyeOff className="h-4 w-4 mr-2" />
                  Hide Hidden
                </>
              ) : (
                <>
                  <Eye className="h-4 w-4 mr-2" />
                  Show Hidden
                </>
              )}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => toggleVisibility('home', 'ui', selectedHomeId!)}>
              {isHomeActuallyHidden(selectedHomeId!) ? (
                <>
                  <Eye className="h-4 w-4 mr-2" />
                  Unhide Home
                </>
              ) : (
                <>
                  <EyeOff className="h-4 w-4 mr-2" />
                  Hide Home
                </>
              )}
            </DropdownMenuItem>
          </div>
        ) : hasContentAccess ? (
          <>
            <DropdownMenuItem onClick={refreshAll} disabled={accessoriesLoading || collectionsLoading}>
              <RefreshCw className={`h-4 w-4 mr-2 ${accessoriesLoading || collectionsLoading ? 'animate-spin' : ''}`} />
              Refresh
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setShowHiddenItems(!showHiddenItems)}>
              {showHiddenItems ? (
                <>
                  <EyeOff className="h-4 w-4 mr-2" />
                  Hide Hidden Items
                </>
              ) : (
                <>
                  <Eye className="h-4 w-4 mr-2" />
                  Show Hidden Items
                </>
              )}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
          </>
        ) : null}
        {isTouchDevice && hasContentAccess && (
          <DropdownMenuItem onClick={() => setEditMode(!editMode)}>
            <Pencil className="h-4 w-4 mr-2" />
            {editMode ? 'Done Editing' : 'Edit Layout'}
          </DropdownMenuItem>
        )}
        <DropdownMenuItem onClick={() => setSettingsOpen(true)}>
          <Settings className="h-4 w-4 mr-2" />
          Settings
        </DropdownMenuItem>
        {hasStagingAccess && (
          <DropdownMenuItem onClick={() => {
            const targetEnv = config.isStaging ? 'production' : 'staging';
            const targetUrl = config.isStaging ? 'https://homecast.cloud/portal' : 'https://staging.homecast.cloud/portal';
            const w = window as Window & { homekit?: { call: (method: string, payload: Record<string, unknown>, callbackId: string) => void } };
            if (w.homekit?.call) {
              // Native iOS/Mac app: switch WebView URL via bridge
              w.homekit.call('settings.setEnvironment', { environment: targetEnv }, `env-switch-${Date.now()}`);
            } else {
              // Browser/Tauri: persist preference via cookie (shared across subdomains
              // unlike localStorage which is per-origin) and navigate directly
              document.cookie = 'homecast-env=' + targetEnv + ';domain=.homecast.cloud;path=/;max-age=31536000;secure;samesite=lax';
              localStorage.setItem('homecast-environment', targetEnv); // backward compat with old Tauri builds
              window.location.href = targetUrl;
            }
          }}>
            <FlaskConical className="h-4 w-4 mr-2" />
            {config.isStaging ? 'Switch to Production' : 'Switch to Staging'}
          </DropdownMenuItem>
        )}
        {isAdmin && !isCommunity && (
          <DropdownMenuItem onClick={() => navigate('/portal/admin')}>
            <Server className="h-4 w-4 mr-2" />
            Admin
          </DropdownMenuItem>
        )}
        {(!isCommunity || !isRelayCapable()) && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={isCommunity ? resetAndUninstall : logout}>
              <LogOut className="h-4 w-4 mr-2" />
              Sign Out
            </DropdownMenuItem>
          </>
        )}
        {hasStagingAccess && (() => {
          const appVer = window.homecastAppVersion;
          const appHash = window.homecastAppBuild && window.homecastAppBuild !== 'unknown' ? window.homecastAppBuild : null;
          const webVer = config.version !== 'dev' ? config.version : null;
          const srvVer = serverVersion && serverVersion !== 'dev' ? serverVersion : null;
          const lines: string[] = [];
          if (srvVer) {
            const status = !prodFetched ? '' : prodVersions.server ? (srvVer === prodVersions.server ? 'in sync' : `ahead (staging:${srvVer} prod:${prodVersions.server})`) : `unknown (staging:${srvVer})`;
            lines.push(`server: ${status || srvVer}`);
          }
          if (webVer) {
            const status = !prodFetched ? '' : prodVersions.web ? (webVer === prodVersions.web ? 'in sync' : `ahead (staging:${webVer} prod:${prodVersions.web})`) : `unknown (staging:${webVer})`;
            lines.push(`web: ${status || webVer}`);
          }
          if (appVer) lines.push(`app: ${appVer}${appHash ? ` (${appHash})` : ''}`);
          if (lines.length === 0) return null;
          return (
            <>
              <DropdownMenuSeparator />
              <div className="px-2 py-1.5 text-[11px] text-muted-foreground/50 select-text selectable space-y-0.5">
                {lines.map((line, i) => <div key={i}>{line}</div>)}
              </div>
            </>
          );
        })()}
      </DropdownMenuContent>
    </DropdownMenu>
    </>
  );

  return (
    <DealsProvider enabled={dealsEffectivelyEnabled} accessories={allAccessoriesData || []}>
    <BackgroundContext.Provider value={{ hasBackground, isDarkBackground }}>
        {/* Main container */}
        {/* Main container — 120vh extends behind iOS 26 Safari bottom Liquid Glass bar.
             Native app uses fixed inset-0 (no Liquid Glass bars in WKWebView). */}
        <div className={`${isInMobileApp || isInMacApp ? 'fixed inset-0' : 'relative'} bg-background`} style={isInMobileApp || isInMacApp ? undefined : { minHeight: '120vh' }}>
          <BackgroundImage
            settings={activeBackground}
            entityId={selectedCollectionGroupId || selectedCollectionId || selectedRoomId || selectedHomeId || undefined}
            autoBackgroundsEnabled={autoBackgrounds}
            onLuminanceChange={setBgImageLuminance}
            onTopColorChange={setBgImageTopColor}
          />


      <AppHeader isInMacApp={isInMacApp} isInMobileApp={isInMobileApp} fullWidth={fullWidth} rightMenu={headerRightMenu} leftBadge={<><StagingSyncLabel isDarkBackground={isDarkBackground} />{isRelayEnabled() && <RelayStatusBadge isDarkBackground={isDarkBackground} accountType={accountType} accessoryLimit={accessoryLimit} includedAccessoryCount={usedAccessorySlots} />}</>} isDarkBackground={isDarkBackground}>
          <div className="flex items-center gap-3 md:gap-3">
            {/* Mobile menu button - hidden during onboarding (no content) */}
            {isMobile && hasContentAccess && (
              <Sheet open={sidebarOpen} onOpenChange={setSidebarOpen}>
                <SheetTrigger asChild>
                  <Button data-tour="sidebar-menu" variant="ghost" size="icon" className={`h-8 w-8 bg-transparent transition-colors duration-300 ${isDarkBackground ? 'text-white hover:bg-white/30 active:bg-white/40' : 'hover:bg-black/30 active:bg-black/40'}`}>
                    <Menu className="h-5 w-5" />
                  </Button>
                </SheetTrigger>
                <SheetContent side="left" className={`p-0 overflow-x-hidden border-none safe-area-top safe-area-bottom safe-area-left ${isDarkBackground ? 'bg-black/40 backdrop-blur-xl' : 'bg-background'}`} style={{ width: mobileSidebarWidth }} aria-describedby={undefined}>
                  <SheetTitle className="sr-only">Navigation Menu</SheetTitle>
                  <div className="h-full flex flex-col overflow-hidden">
                    <div className="px-3 py-3 mt-3">
                      <div className="flex items-center gap-2">
                        <div className="flex items-center justify-center rounded-lg bg-primary" style={{ height: 32, width: 32 }}>
                          <Home className="text-primary-foreground" style={{ height: 16, width: 16 }} />
                        </div>
                        <div className="flex flex-col">
                          <span className={`font-semibold ${isDarkBackground ? 'text-white' : ''}`} style={{ fontSize: 16, lineHeight: 1.2 }}>Homecast</span>
                          {isCommunity && (
                            <span className={`text-[10px] font-medium ${isDarkBackground ? 'text-white/50' : 'text-muted-foreground'}`}>Community Edition</span>
                          )}
                        </div>
                      </div>
                    </div>
                    <div className={`p-3 overflow-y-auto flex-1 ${isDarkBackground ? 'text-white' : ''}`}>
                    {/* Homes Section */}
                    <div className="mb-6" data-tour="sidebar-homes">
                      {homesLoading ? (
                        <div className="flex items-center justify-center py-4">
                          <Loader2 className="h-4 w-4 animate-spin text-white" />
                        </div>
                      ) : (
                        <DndContext
                          sensors={activeSensors}
                          collisionDetection={closestCenter}
                          onDragStart={handleHomeDragStart}
                          onDragEnd={handleHomeDragEnd}
                        >
                          <SortableContext
                            items={visibleHomes.map(h => h.id)}
                            strategy={verticalListSortingStrategy}
                          >
                            <div className="space-y-1">
                              {visibleHomes.map((home) => (
                                  <SortableHomeItem
                                    key={home.id}
                                    home={home}
                                    isSelected={pendingHomeId === home.id}
                                    hasSelectedChild={selectedRoomId !== null && pendingHomeId === home.id}
                                    hideAccessoryCounts={hideAccessoryCounts}
                                    onSelect={() => {
                                      if (pendingHomeId !== home.id) {
                                        handleSelectHome(home.id);
                                      } else {
                                        // Same home: clear room/collection to go to home view
                                        setSelectedRoomId(null);
                                        localStorage.removeItem('homecast-selected-room');
                                        setSelectedCollection(null);
                                        setSelectedCollectionId(null);
                                        updateUrlParams({ room: null, collection: null });
                                      }
                                      setSidebarOpen(false);
                                    }}
                                    isHiddenUi={isHomeActuallyHidden(home.id)}
                                    onToggleVisibility={() => toggleVisibility('home', 'ui', home.id)}
                                    isLoading={isHomeSwitching && pendingHomeId === home.id}


                                    showHiddenItems={showHiddenItems}
                                    onToggleShowHidden={handleToggleShowHidden}
                                    onShare={home.role === 'owner' || home.role === 'admin' || !home.role ? () => { setSidebarShareHome(home); setSidebarOpen(false); } : undefined}
                                    onCreateRoomGroup={() => { setCreateRoomGroupHome(home); setCreateRoomGroupDialogOpen(true); setSidebarOpen(false); }}
                                    onBackgroundSettings={() => { setBackgroundSettingsTarget({ type: 'home', id: home.id, name: home.name }); setBackgroundSettingsOpen(true); setSidebarOpen(false); }}
                                    onCloudRelay={!isInMacApp && !isInMobileApp ? () => { setCloudRelayPrefilledHome(home.name); openSettingsTo('homes'); setSidebarOpen(false); } : undefined}
                                    onDismiss={home.role === 'owner' && !home.relayConnected ? async () => {
                                      try {
                                        await dismissHomeMutation({ variables: { homeId: home.id } });
                                        invalidateHomeKitCache();
                                        toast.success('Home removed');
                                      } catch { toast.error('Failed to remove home'); }
                                    } : undefined}
                                    onPin={isMobile ? () => isTabPinned('home', home.id) ? handleUnpinTab('home', home.id) : handlePinTab({ type: 'home', id: home.id, name: home.name }) : undefined}
                                    isPinned={isTabPinned('home', home.id)}
                                    pinFull={pinnedTabs.length >= MAX_PINNED_TABS}
                                    isDarkBackground={isDarkBackground}
                                    dragDisabled={!dndEnabled || !!sidebarActiveId}
                                    disableContextMenu={isTouchDevice && editMode}
                                    editMode={isTouchDevice && editMode}
                                  >
                                  <AnimatedCollapse open={pendingHomeId === home.id && selectedHomeId === home.id && sidebarRoomsExpanded}>
                                    <div className="ml-2 pt-1">
                                      {roomsLoading ? (
                                        <div className="flex items-center justify-center py-2">
                                          <Loader2 className="h-3 w-3 animate-spin text-white" />
                                        </div>
                                      ) : (
                                        <DndContext
                                          sensors={activeSensors}
                                          collisionDetection={closestCenter}
                                          onDragStart={handleSidebarDragStart}
                                          onDragEnd={handleSidebarDragEnd}
                                          onDragCancel={handleSidebarDragCancel}
                                        >
                                          <div className="max-h-[300px] overflow-y-auto scrollbar-hidden">
                                          <SortableContext
                                            items={sidebarSortableIds}
                                            strategy={verticalListSortingStrategy}
                                          >
                                            {sidebarTree.map((item) => {
                                              if (item.type === 'roomGroup') {
                                                const group = item.data as { id: string; entityId: string; name: string; roomIds: string[]; roomCount: number };
                                                const isExpanded = expandedRoomGroups.has(group.entityId);

                                                return (
                                                  <div key={item.id} className="mt-1 first:mt-0">
                                                    <SortableRoomGroupItem
                                                      id={item.id}
                                                      group={group}
                                                      isExpanded={isExpanded}
                                                      hasSelectedChild={selectedRoomId !== null && group.roomIds.includes(selectedRoomId)}
                                                      onToggleExpand={() => toggleRoomGroupExpanded(group.entityId)}
                                                      onEdit={() => {
                                                        setEditingRoomGroup({
                                                          groupId: group.entityId,
                                                          groupName: group.name,
                                                          roomIds: group.roomIds,
                                                          homeId: selectedHomeId!,
                                                        });
                                                        setSidebarOpen(false);
                                                      }}
                                                      onShare={canShare ? () => {
                                                        setSidebarShareRoomGroup({
                                                          groupId: group.entityId,
                                                          groupName: group.name,
                                                          homeId: selectedHomeId!,
                                                        });
                                                        setSidebarOpen(false);
                                                      } : undefined}
                                                      onDelete={() => {
                                                        setSidebarDeletingRoomGroup({
                                                          groupId: group.entityId,
                                                          groupName: group.name,
                                                        });
                                                        setSidebarOpen(false);
                                                      }}
                                                      onBackgroundSettings={() => { setBackgroundSettingsTarget({ type: 'roomGroup', id: group.entityId, name: group.name }); setBackgroundSettingsOpen(true); setSidebarOpen(false); }}
                                                      hideAccessoryCounts={hideAccessoryCounts}
                                                      isDarkBackground={isDarkBackground}
                                                      editMode={isTouchDevice && editMode}
                                                    >
                                                      {/* Rooms inside the group */}
                                                      <AnimatedCollapse open={isExpanded} disableTransition={!!sidebarActiveId}>
                                                        <div className="ml-4 pt-1 space-y-1">
                                                          {item.children.map((child) => {
                                                            const room = child.data as HomeKitRoom;
                                                            return (
                                                              <SortableGroupRoomItem
                                                                key={child.id}
                                                                id={child.id}
                                                                room={room}
                                                                isSelected={selectedRoomId === room.id}
                                                                hideAccessoryCounts={hideAccessoryCounts}
                                                                editMode={isTouchDevice && editMode}
                                                                onSelect={() => {
                                                                  handleSelectRoom(room.id);
                                                                  setSidebarOpen(false);
                                                                }}
                                                                onBackgroundSettings={() => { setBackgroundSettingsTarget({ type: 'room', id: room.id, name: room.name }); setBackgroundSettingsOpen(true); setSidebarOpen(false); }}
                                                              />
                                                            );
                                                          })}
                                                        </div>
                                                      </AnimatedCollapse>
                                                    </SortableRoomGroupItem>
                                                  </div>
                                                );
                                              } else {
                                                // Root-level room
                                                const room = item.data as HomeKitRoom;
                                                // Disable pointer events if we're dragging inside a group
                                                const disablePointer = sidebarActiveId !== null && sidebarDragGroupContext !== null;
                                                return (
                                                  <div
                                                    key={item.id}
                                                    className="mt-1 first:mt-0"
                                                    style={{ pointerEvents: disablePointer ? 'none' : undefined }}
                                                  >
                                                    <SortableRoomItem
                                                      room={room}
                                                      isSelected={selectedRoomId === room.id}
                                                      hideAccessoryCounts={hideAccessoryCounts}
                                                      onSelect={() => {
                                                        handleSelectRoom(room.id);
                                                        setSidebarOpen(false);
                                                      }}
                                                      isHiddenUi={selectedHomeId ? isRoomActuallyHidden(selectedHomeId, room.id) : false}
                                                      onToggleVisibility={() => selectedHomeId && toggleVisibility('room', 'ui', selectedHomeId, room.id)}


                                                      showHiddenItems={showHiddenItems}
                                                      onToggleShowHidden={handleToggleShowHidden}
                                                      onShare={selectedHomeId && canShare ? () => { setSidebarShareRoom({ room, homeId: selectedHomeId }); setSidebarOpen(false); } : undefined}
                                                      onBackgroundSettings={() => { setBackgroundSettingsTarget({ type: 'room', id: room.id, name: room.name }); setBackgroundSettingsOpen(true); setSidebarOpen(false); }}
                                                      onPin={isMobile && selectedHomeId ? () => isTabPinned('room', room.id) ? handleUnpinTab('room', room.id) : handlePinTab({ type: 'room', id: room.id, name: room.name, homeId: selectedHomeId }) : undefined}
                                                      isPinned={isTabPinned('room', room.id)}
                                                      pinFull={pinnedTabs.length >= MAX_PINNED_TABS}
                                                      isDarkBackground={isDarkBackground}
                                                      dragDisabled={!dndEnabled}
                                                      disableContextMenu={isTouchDevice && editMode}
                                                      editMode={isTouchDevice && editMode}
                                                    />
                                                  </div>
                                                );
                                              }
                                            })}
                                          </SortableContext>
                                          </div>
                                        </DndContext>
                                      )}
                                    </div>
                                  </AnimatedCollapse>
                                  </SortableHomeItem>
                              ))}
                              {/* Pending cloud enrollments */}
                              {pendingEnrollments.map((enrollment) => (
                                <button
                                  key={enrollment.id}
                                  className={`flex items-center gap-2 w-full rounded-[12px] px-3 py-2 text-left text-sm transition-colors ${
                                    selectedEnrollmentId === enrollment.id
                                      ? 'bg-primary text-primary-foreground'
                                      : isDarkBackground ? 'text-white hover:bg-white/10' : 'hover:bg-muted'
                                  }`}
                                  onClick={() => { setSelectedEnrollmentId(enrollment.id); setSelectedHomeId(null); setSelectedCollection(null); setSelectedCollectionId(null); updateUrlParams({ collection: null, home: null, room: null, enrollment: enrollment.id }); setSidebarOpen(false); }}
                                >
                                  <House className="h-4 w-4" />
                                  <span className="flex-1 truncate">{enrollment.homeName}</span>
                                  <Cloud className={`h-3 w-3 ${selectedEnrollmentId === enrollment.id ? 'text-primary-foreground/60' : isDarkBackground ? 'text-white/50' : 'text-muted-foreground'}`} />
                                  <Badge variant="secondary" className={`text-[9px] px-1 py-0 shrink-0 ${selectedEnrollmentId === enrollment.id ? 'bg-primary-foreground/20 text-primary-foreground' : 'bg-yellow-500/20 text-yellow-700 dark:text-yellow-400'}`}>
                                    {enrollment.status === 'pending' ? 'Setting up' : enrollment.status === 'invite_sent' ? 'Invite sent' : enrollment.status === 'needs_home_id' ? 'Action needed' : enrollment.status === 'awaiting_relay' ? 'Awaiting relay' : enrollment.status}
                                  </Badge>
                                </button>
                              ))}
                            </div>
                          </SortableContext>
                        </DndContext>
                      )}
                    </div>

                    {/* Collections Section */}
                    <div data-tour="sidebar-collections">
                    <CollectionList
                      selectedId={selectedCollectionId}
                      onSelect={(collection) => {
                        if (collection && selectedCollectionId !== collection.id) {
                          handleSelectCollection(collection);
                        }
                        setSidebarOpen(false);
                      }}
                      onLoadFromUrl={(collection) => setSelectedCollection(collection)}


                      onRefetchReady={(refetch) => { refetchCollectionsRef.current = refetch; }}
                      onLoadingChange={setCollectionsLoading}
                      groups={collectionPayload.groups}
                      selectedGroupId={selectedCollectionGroupId}
                      onGroupSelect={(groupId) => { handleSelectCollectionGroup(groupId); setSidebarOpen(false); }}
                      groupItemCounts={collectionGroupItemCounts}
                      hideAccessoryCounts={hideAccessoryCounts}
                      groupsExpanded={sidebarGroupsExpanded}
                      onShare={(collection) => { setSidebarShareCollection(collection); setSidebarOpen(false); }}
                      onSelectAccessories={() => { setCollectionAddItemsOpen(true); setSidebarOpen(false); }}
                      onCreateGroup={() => { setCollectionAddingGroup(true); setSidebarOpen(false); }}
                      onRename={(collection) => { setSidebarRenamingCollection(collection); setSidebarOpen(false); }}
                      onDelete={(collection) => { setSidebarDeletingCollection(collection); setSidebarOpen(false); }}
                      onBackgroundSettings={(collection) => {
                        setBackgroundSettingsTarget({ type: 'collection', id: collection.id, name: collection.name });
                        setBackgroundSettingsOpen(true);
                        setSidebarOpen(false);
                      }}
                      onPin={isMobile ? (collection) => isTabPinned('collection', collection.id) ? handleUnpinTab('collection', collection.id) : handlePinTab({ type: 'collection', id: collection.id, name: collection.name }) : undefined}
                      isPinned={(collectionId) => isTabPinned('collection', collectionId)}
                      pinFull={pinnedTabs.length >= MAX_PINNED_TABS}
                      isDarkBackground={isDarkBackground}
                      dragDisabled={!dndEnabled}
                      touchMode={isTouchDevice}
                      disableContextMenu={isTouchDevice && editMode}
                      editMode={isTouchDevice && editMode}
                      groupsContent={collectionPayload.groups.length > 0 ? (
                        <DndContext
                          sensors={activeSensors}
                          collisionDetection={closestCenter}
                          onDragEnd={handleCollectionGroupDragEnd}
                        >
                          <SortableContext
                            items={collectionPayload.groups.map(g => g.id)}
                            strategy={verticalListSortingStrategy}
                          >
                            {collectionPayload.groups.map((group) => (
                              <SortableGroupItem
                                key={group.id}
                                group={group}
                                isSelected={selectedCollectionGroupId === group.id}
                                onSelect={() => { handleSelectCollectionGroup(group.id); setSidebarOpen(false); }}
                                accessoryCount={collectionGroupItemCounts[group.id] || 0}
                                hideAccessoryCounts={hideAccessoryCounts}
                                onShare={selectedCollection ? () => { setSidebarShareGroup({ collectionId: selectedCollection.id, groupId: group.id, groupName: group.name }); setSidebarOpen(false); } : undefined}
                                onSelectAccessories={() => { handleSelectCollectionGroup(group.id); setCollectionAddItemsOpen(true); setSidebarOpen(false); }}
                                onRename={() => { setSidebarRenamingGroup({ id: group.id, name: group.name }); setSidebarOpen(false); }}
                                onDelete={() => { setSidebarDeletingGroupId(group.id); setSidebarOpen(false); }}
                                onBackgroundSettings={() => {
                                  setBackgroundSettingsTarget({ type: 'collectionGroup', id: group.id, name: group.name, parentId: selectedCollection?.id });
                                  setBackgroundSettingsOpen(true);
                                  setSidebarOpen(false);
                                }}
                                onPin={isMobile && selectedCollection ? () => isTabPinned('collectionGroup', group.id) ? handleUnpinTab('collectionGroup', group.id) : handlePinTab({ type: 'collectionGroup', id: group.id, name: group.name, collectionId: selectedCollection.id }) : undefined}
                                isPinned={isTabPinned('collectionGroup', group.id)}
                                pinFull={pinnedTabs.length >= MAX_PINNED_TABS}
                                isDarkBackground={isDarkBackground}
                                dragDisabled={!dndEnabled}
                                disableContextMenu={isTouchDevice && editMode}
                                editMode={isTouchDevice && editMode}
                              />
                            ))}
                          </SortableContext>
                        </DndContext>
                      ) : undefined}
                    />
                    </div>
                    </div>
                  </div>
                </SheetContent>
              </Sheet>
            )}
            <div className={`flex items-center justify-center rounded-lg md:hidden transition-colors duration-300 bg-primary ${isTouchDevice && editMode || (isMobile && hasContentAccess) ? 'hidden' : ''}`} style={{ height: 40, width: 40 }}>
              <Home className="transition-colors duration-300 text-primary-foreground" style={{ height: 20, width: 20 }} />
            </div>
            <span className={`font-semibold hidden sm:inline md:hidden transition-colors duration-300 ${isDarkBackground ? 'text-white' : ''} ${isTouchDevice && editMode || (isMobile && hasContentAccess) ? '!hidden' : ''}`} style={{ fontSize: 18 }}>Homecast</span>
          </div>
          {/* Center spacer */}
          <div className={`flex-1 ${isInMacApp ? 'window-no-drag' : ''}`} />
          <div className={`flex items-center gap-1 md:gap-1.5 ${isInMacApp ? 'window-no-drag' : ''}`}>
            {/* Settings Dialog */}
            <SettingsDialog
              open={settingsOpen}
              onOpenChange={(open) => { setSettingsOpen(open); if (!open) { setCloudCheckoutJustCompleted(false); updateUrlParams({ settings: null }); } }}
              initialTab={settingsInitialTab}
              accountType={accountType}
              usedAccessorySlots={usedAccessorySlots}
              accessoryLimit={accessoryLimit}
              userEmail={user?.email}
              isInMacApp={isInMacApp}
              isInMobileApp={isInMobileApp}
              pricing={pricing}
              handleUpgrade={handleUpgrade}
              handleUpgradeToCloud={handleUpgradeToCloud}
              handleDowngradeToStandard={handleDowngradeToStandard}
              handleManageSubscription={handleManageSubscription}
              hasSubscription={hasSubscription}
              cloudSignupsAvailable={cloudSignupsAvailable}
              isRelayCapable={isRelayCapable}
              setAccessorySelectionOpen={setAccessorySelectionOpen}
              showSmartDeals={showSmartDeals}
              settingsData={settingsData}
              saveSettings={saveSettings}
              hideInfoDevices={hideInfoDevices}
              toggleHideInfoDevices={toggleHideInfoDevices}
              hideAccessoryCounts={hideAccessoryCounts}
              toggleHideAccessoryCounts={toggleHideAccessoryCounts}
              groupByRoom={groupByRoom}
              toggleGroupByRoom={toggleGroupByRoom}
              groupByType={groupByType}
              toggleGroupByType={toggleGroupByType}
              layoutMode={layoutMode}
              changeLayoutMode={changeLayoutMode}
              fullWidth={fullWidth}
              toggleFullWidth={toggleFullWidth}
              compactMode={compactMode}
              toggleCompactMode={toggleCompactMode}
              fontSize={fontSize}
              changeFontSize={changeFontSize}
              iconStyle={iconStyle}
              changeIconStyle={changeIconStyle}
              autoBackgrounds={autoBackgrounds}
              toggleAutoBackgrounds={toggleAutoBackgrounds}
              settingSaveError={settingSaveError}
              developerMode={developerMode}
              toggleDeveloperMode={toggleDeveloperMode}
              logout={logout}
              resetAndUninstall={resetAndUninstall}
              serverVersion={serverVersion}
              homes={homes}
              copyToClipboard={copyToClipboard}
              cloudRelayPrefilledHome={cloudRelayPrefilledHome}
              autoOpenEnroll={cloudCheckoutJustCompleted}
              launchAtLogin={launchAtLogin}
              setLaunchAtLogin={setLaunchAtLogin}
              launchAtLoginSupported={launchAtLoginSupported}
              pinnedTabs={pinnedTabs}
              handleUnpinTab={handleUnpinTab}
              handleUpdateTabName={handleUpdateTabName}
              handleReorderTabs={handleReorderTabs}
              maxPinnedTabs={MAX_PINNED_TABS}
              onReplayTutorial={() => {
                setSettingsOpen(false);
                setTimeout(() => setShowTutorial(true), 300);
              }}
              notificationProps={isCommunity ? undefined : {
                pushTokens: pushTokensData?.pushTokens ?? [],
                preferences: notifPrefsData?.notificationPreferences ?? [],
                refetch: () => { refetchPushTokens(); refetchNotifPrefs(); },
                registerPushToken: async (vars) => {
                  await registerPushTokenMutation({ variables: vars });
                },
                unregisterPushToken: async (vars) => {
                  await unregisterPushTokenMutation({ variables: vars });
                },
                setNotificationPreference: async (vars) => {
                  await setNotifPrefMutation({ variables: vars });
                },
                sendTestNotification: async () => {
                  const { data } = await sendTestNotifMutation();
                  return data?.sendTestNotification ?? false;
                },
                userEmail: user?.email,
              }}
            />
          </div>
      </AppHeader>

      {/* Edit mode bubble - touch devices only, centered over header */}
      {isTouchDevice && editMode && (
        <div className="fixed top-0 left-0 right-0 z-[10002] safe-area-top pointer-events-none" style={{ height: 'calc(80px + var(--safe-area-top, 0px))' }}>
          <div className="flex items-center justify-center h-full">
            <button
              onClick={() => setEditMode(false)}
              className="pointer-events-auto flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-primary text-primary-foreground text-sm font-medium active:bg-primary/80"
            >
              Editing Layout
              <span className="text-xs font-semibold bg-white/20 px-1.5 py-0.5 rounded-full">Done</span>
            </button>
          </div>
        </div>
      )}

      {/* Mobile tab bar - floating bottom bubble */}
      {isMobile && pinnedTabs.length > 0 && (
        <MobileTabBar
          pinnedTabs={pinnedTabs}
          selectedHomeId={selectedHomeId}
          selectedRoomId={selectedRoomId}
          selectedCollectionId={selectedCollectionId}
          selectedCollectionGroupId={selectedCollectionGroupId}
          onSelectHome={(homeId) => handleSelectHome(homeId)}
          onSelectRoom={(homeId, roomId) => {
            if (homeId !== selectedHomeId) {
              handleSelectHome(homeId);
            }
            handleSelectRoom(roomId);
          }}
          onSelectCollection={(collectionId) => {
            const coll = allCollections.find(c => c.id === collectionId);
            if (coll) handleSelectCollection(coll);
          }}
          onSelectCollectionGroup={(collectionId, groupId) => {
            const coll = allCollections.find(c => c.id === collectionId);
            if (coll) {
              handleSelectCollection(coll);
              handleSelectCollectionGroup(groupId);
            }
          }}
          isDarkBackground={isDarkBackground}
        />
      )}

      <AccessorySearch
        open={searchOpen}
        onOpenChange={setSearchOpen}
        accessories={allAccessoriesData || []}
        homes={homes}
        serviceGroups={allServiceGroupsData || serviceGroups}
        onToggle={handleToggle}
        onSlider={handleSlider}
        getEffectiveValue={getEffectiveValue}
        onGroupToggle={handleGroupToggle}
        onGroupSlider={handleGroupSlider}
        onNavigate={handleSearchNavigate}
        iconStyle={activeIconStyle}
        disabled={isViewOnly}
        initialKey={searchInitialKeyRef.current}
        selectedHomeId={selectedHomeId}
        selectedRoomName={selectedRoomName}
        collectionItemIds={searchCollectionItemIds}
      />

      <div className={`${isInMobileApp || isInMacApp ? 'absolute inset-0' : 'relative min-h-[120vh]'} flex justify-center`}>
        <div className={`flex w-full ${isInMacApp || fullWidth ? '' : 'max-w-7xl'}`}>
        {/* Sidebar - hidden on mobile, shown via Sheet. Hidden entirely during onboarding (no content). */}
        <aside
          className={`hidden ${hasContentAccess ? 'md:block' : ''} ${isInMacApp ? 'pt-8' : isInMobileApp ? '' : 'pt-3'} pl-3 pr-1 pb-3 ${!(isInMobileApp || isInMacApp) ? 'sticky top-0 self-start h-screen' : ''}`}
          style={{ width: sidebarWidth, ...(isInMobileApp ? { paddingTop: 'calc(12px + var(--safe-area-top, 0px))' } : undefined) }}
        >
          <div className={`rounded-[20px] transition-all duration-300 ${!isDarkBackground ? 'shadow-[0_4px_20px_rgba(0,0,0,0.04)]' : ''}`}>
            <div className={`rounded-[20px] p-3 max-h-full overflow-y-auto scrollbar-hidden transition-all duration-300 ${isDarkBackground ? 'bg-black/40 backdrop-blur-xl text-white' : ''}`}>
              {/* Header in sidebar */}
              <div className="flex items-center gap-2 mb-4">
                <div className="flex items-center justify-center rounded-[10px] transition-colors duration-300 bg-primary" style={{ height: 32, width: 32 }}>
                  <Home className="transition-colors duration-300 text-primary-foreground" style={{ height: 16, width: 16 }} />
                </div>
                <div className="flex flex-col">
                  <span className="font-semibold" style={{ fontSize: 16, lineHeight: 1.2 }}>Homecast</span>
                  {isCommunity && (
                    <span className={`text-[10px] font-medium ${isDarkBackground ? 'text-white/50' : 'text-muted-foreground'}`}>Community Edition</span>
                  )}
                </div>
              </div>
              {/* Homes Section */}
              <div className="mb-6" data-tour="sidebar-homes">
                {homesLoading ? (
                  <div className="flex items-center justify-center py-4">
                    <Loader2 className={`h-4 w-4 animate-spin ${isDarkBackground ? 'text-white' : ''}`} />
                  </div>
                ) : (
                  <DndContext
                    sensors={activeSensors}
                    collisionDetection={closestCenter}
                    onDragStart={handleHomeDragStart}
                    onDragEnd={handleHomeDragEnd}
                  >
                    <SortableContext
                      items={visibleHomes.map(h => h.id)}
                      strategy={verticalListSortingStrategy}
                    >
                      <div className="space-y-1">
                        {visibleHomes.map((home) => (
                            <SortableHomeItem
                              key={home.id}
                              home={home}
                              isSelected={pendingHomeId === home.id}
                              hasSelectedChild={selectedRoomId !== null && pendingHomeId === home.id}
                              hideAccessoryCounts={hideAccessoryCounts}
                              onSelect={() => {
                                handleSelectHome(home.id);
                              }}
                              isHiddenUi={isHomeActuallyHidden(home.id)}
                              onToggleVisibility={() => toggleVisibility('home', 'ui', home.id)}
                              isLoading={isHomeSwitching && pendingHomeId === home.id}


                              showHiddenItems={showHiddenItems}
                              onToggleShowHidden={handleToggleShowHidden}
                              onShare={home.role === 'owner' || home.role === 'admin' || !home.role ? () => setSidebarShareHome(home) : undefined}
                              onCreateRoomGroup={() => { setCreateRoomGroupHome(home); setCreateRoomGroupDialogOpen(true); }}
                              onBackgroundSettings={() => { setBackgroundSettingsTarget({ type: 'home', id: home.id, name: home.name }); setBackgroundSettingsOpen(true); }}
                              onCloudRelay={!isInMacApp && !isInMobileApp ? () => { setCloudRelayPrefilledHome(home.name); openSettingsTo('homes'); } : undefined}
                              onDismiss={home.role === 'owner' && !home.relayConnected ? async () => {
                                try {
                                  await dismissHomeMutation({ variables: { homeId: home.id } });
                                  invalidateHomeKitCache();
                                  toast.success('Home removed');
                                } catch { toast.error('Failed to remove home'); }
                              } : undefined}
                              onPin={isMobile ? () => isTabPinned('home', home.id) ? handleUnpinTab('home', home.id) : handlePinTab({ type: 'home', id: home.id, name: home.name }) : undefined}
                              isPinned={isTabPinned('home', home.id)}
                              pinFull={pinnedTabs.length >= MAX_PINNED_TABS}
                              dragDisabled={!dndEnabled || !!sidebarActiveId}
                              disableContextMenu={isTouchDevice && editMode}
                              editMode={isTouchDevice && editMode}
                              isDarkBackground={isDarkBackground}
                            >
                            {/* Rooms nested under selected home */}
                            <AnimatedCollapse open={pendingHomeId === home.id && selectedHomeId === home.id && sidebarRoomsExpanded}>
                              <div className="ml-2 pt-1">
                                {roomsLoading ? (
                                  <div className="flex items-center justify-center py-2">
                                    <Loader2 className="h-3 w-3 animate-spin" />
                                  </div>
                                ) : (
                                  <DndContext
                                    sensors={activeSensors}
                                    collisionDetection={closestCenter}
                                    onDragStart={handleSidebarDragStart}
                                    onDragEnd={handleSidebarDragEnd}
                                    onDragCancel={handleSidebarDragCancel}
                                  >
                                    <div className="max-h-[300px] overflow-y-auto scrollbar-hidden">
                                    <SortableContext
                                      items={sidebarSortableIds}
                                      strategy={verticalListSortingStrategy}
                                    >
                                      {sidebarTree.map((item) => {
                                        if (item.type === 'roomGroup') {
                                          const group = item.data as { id: string; entityId: string; name: string; roomIds: string[]; roomCount: number };
                                          const isExpanded = expandedRoomGroups.has(group.entityId);

                                          return (
                                            <div key={item.id} className="mt-1 first:mt-0">
                                              <SortableRoomGroupItem
                                                id={item.id}
                                                group={group}
                                                isExpanded={isExpanded}
                                                hasSelectedChild={selectedRoomId !== null && group.roomIds.includes(selectedRoomId)}
                                                onToggleExpand={() => toggleRoomGroupExpanded(group.entityId)}
                                                onEdit={() => {
                                                  setEditingRoomGroup({
                                                    groupId: group.entityId,
                                                    groupName: group.name,
                                                    roomIds: group.roomIds,
                                                    homeId: selectedHomeId!,
                                                  });
                                                }}
                                                onShare={canShare ? () => {
                                                  setSidebarShareRoomGroup({
                                                    groupId: group.entityId,
                                                    groupName: group.name,
                                                    homeId: selectedHomeId!,
                                                  });
                                                } : undefined}
                                                onDelete={() => {
                                                  setSidebarDeletingRoomGroup({
                                                    groupId: group.entityId,
                                                    groupName: group.name,
                                                  });
                                                }}
                                                onBackgroundSettings={() => { setBackgroundSettingsTarget({ type: 'roomGroup', id: group.entityId, name: group.name }); setBackgroundSettingsOpen(true); }}
                                                hideAccessoryCounts={hideAccessoryCounts}
                                                isDarkBackground={isDarkBackground}
                                                editMode={isTouchDevice && editMode}
                                              >
                                                {/* Rooms inside the group */}
                                                <AnimatedCollapse open={isExpanded} disableTransition={!!sidebarActiveId}>
                                                  <div className="ml-4 pt-1 space-y-1">
                                                    {item.children.map((child) => {
                                                      const room = child.data as HomeKitRoom;
                                                      return (
                                                        <SortableGroupRoomItem
                                                          key={child.id}
                                                          editMode={isTouchDevice && editMode}
                                                          id={child.id}
                                                          room={room}
                                                          isSelected={selectedRoomId === room.id}
                                                          hideAccessoryCounts={hideAccessoryCounts}
                                                          onSelect={() => handleSelectRoom(room.id)}
                                                          onBackgroundSettings={() => { setBackgroundSettingsTarget({ type: 'room', id: room.id, name: room.name }); setBackgroundSettingsOpen(true); }}
                                                        />
                                                      );
                                                    })}
                                                  </div>
                                                </AnimatedCollapse>
                                              </SortableRoomGroupItem>
                                            </div>
                                          );
                                        } else {
                                          // Root-level room
                                          const room = item.data as HomeKitRoom;
                                          const disablePointer = sidebarActiveId !== null && sidebarDragGroupContext !== null;
                                          return (
                                            <div
                                              key={item.id}
                                              className="mt-1 first:mt-0"
                                              style={{ pointerEvents: disablePointer ? 'none' : undefined }}
                                            >
                                              <SortableRoomItem
                                                room={room}
                                                isSelected={selectedRoomId === room.id}
                                                hideAccessoryCounts={hideAccessoryCounts}
                                                onSelect={() => handleSelectRoom(room.id)}
                                                isHiddenUi={selectedHomeId ? isRoomActuallyHidden(selectedHomeId, room.id) : false}
                                                onToggleVisibility={() => selectedHomeId && toggleVisibility('room', 'ui', selectedHomeId, room.id)}


                                                showHiddenItems={showHiddenItems}
                                                onToggleShowHidden={handleToggleShowHidden}
                                                onShare={selectedHomeId && canShare ? () => setSidebarShareRoom({ room, homeId: selectedHomeId }) : undefined}
                                                onBackgroundSettings={() => { setBackgroundSettingsTarget({ type: 'room', id: room.id, name: room.name }); setBackgroundSettingsOpen(true); }}
                                                onPin={isMobile && selectedHomeId ? () => isTabPinned('room', room.id) ? handleUnpinTab('room', room.id) : handlePinTab({ type: 'room', id: room.id, name: room.name, homeId: selectedHomeId }) : undefined}
                                                isPinned={isTabPinned('room', room.id)}
                                                pinFull={pinnedTabs.length >= MAX_PINNED_TABS}
                                                isDarkBackground={isDarkBackground}
                                                dragDisabled={!dndEnabled}
                                                disableContextMenu={isTouchDevice && editMode}
                                                editMode={isTouchDevice && editMode}
                                              />
                                            </div>
                                          );
                                        }
                                      })}
                                    </SortableContext>
                                    </div>
                                  </DndContext>
                                )}
                              </div>
                            </AnimatedCollapse>
                            </SortableHomeItem>
                        ))}
                        {/* Pending cloud enrollments */}
                        {pendingEnrollments.map((enrollment) => (
                          <button
                            key={enrollment.id}
                            className={`flex items-center gap-2 w-full rounded-[12px] px-3 py-2 text-left text-sm transition-colors ${
                              selectedEnrollmentId === enrollment.id
                                ? 'bg-primary text-primary-foreground'
                                : isDarkBackground ? 'text-white hover:bg-white/10' : 'hover:bg-muted'
                            }`}
                            onClick={() => { setSelectedEnrollmentId(enrollment.id); setSelectedHomeId(null); setSelectedCollection(null); setSelectedCollectionId(null); updateUrlParams({ collection: null, home: null, room: null, enrollment: enrollment.id }); }}
                          >
                            <House className="h-4 w-4" />
                            <span className="flex-1 truncate">{enrollment.homeName}</span>
                            <Cloud className={`h-3 w-3 ${selectedEnrollmentId === enrollment.id ? 'text-primary-foreground/60' : isDarkBackground ? 'text-white/50' : 'text-muted-foreground'}`} />
                            <Badge variant="secondary" className={`text-[9px] px-1 py-0 shrink-0 ${selectedEnrollmentId === enrollment.id ? 'bg-primary-foreground/20 text-primary-foreground' : 'bg-yellow-500/20 text-yellow-700 dark:text-yellow-400'}`}>
                              {enrollment.status === 'pending' ? 'Setting up' : enrollment.status === 'invite_sent' ? 'Invite sent' : enrollment.status === 'needs_home_id' ? 'Action needed' : enrollment.status === 'awaiting_relay' ? 'Awaiting relay' : enrollment.status}
                            </Badge>
                          </button>
                        ))}
                      </div>
                    </SortableContext>
                  </DndContext>
                )}
              </div>

              {/* Collections Section - after Homes */}
              <div data-tour="sidebar-collections">
              <CollectionList
                selectedId={selectedCollectionId}
                onSelect={handleSelectCollection}
                onLoadFromUrl={(collection) => setSelectedCollection(collection)}
                onRefetchReady={(refetch) => { refetchCollectionsRef.current = refetch; }}
                onLoadingChange={setCollectionsLoading}
                groups={collectionPayload.groups}
                selectedGroupId={selectedCollectionGroupId}
                onGroupSelect={handleSelectCollectionGroup}
                groupItemCounts={collectionGroupItemCounts}
                hideAccessoryCounts={hideAccessoryCounts}
                groupsExpanded={sidebarGroupsExpanded}
                onShare={(collection) => setSidebarShareCollection(collection)}
                onSelectAccessories={() => setCollectionAddItemsOpen(true)}
                onCreateGroup={() => setCollectionAddingGroup(true)}
                onRename={(collection) => setSidebarRenamingCollection(collection)}
                onDelete={(collection) => setSidebarDeletingCollection(collection)}
                onBackgroundSettings={(collection) => {
                  setBackgroundSettingsTarget({ type: 'collection', id: collection.id, name: collection.name });
                  setBackgroundSettingsOpen(true);
                }}
                onPin={isMobile ? (collection) => isTabPinned('collection', collection.id) ? handleUnpinTab('collection', collection.id) : handlePinTab({ type: 'collection', id: collection.id, name: collection.name }) : undefined}
                isPinned={(collectionId) => isTabPinned('collection', collectionId)}
                pinFull={pinnedTabs.length >= MAX_PINNED_TABS}
                isDarkBackground={isDarkBackground}
                dragDisabled={!dndEnabled}
                touchMode={isTouchDevice}
                disableContextMenu={isTouchDevice && editMode}
                editMode={isTouchDevice && editMode}
                groupsContent={collectionPayload.groups.length > 0 ? (
                  <DndContext
                    sensors={activeSensors}
                    collisionDetection={closestCenter}
                    onDragEnd={handleCollectionGroupDragEnd}
                  >
                    <SortableContext
                      items={collectionPayload.groups.map(g => g.id)}
                      strategy={verticalListSortingStrategy}
                    >
                      {collectionPayload.groups.map((group) => (
                        <SortableGroupItem
                          key={group.id}
                          group={group}
                          isSelected={selectedCollectionGroupId === group.id}
                          onSelect={() => handleSelectCollectionGroup(group.id)}
                          accessoryCount={collectionGroupItemCounts[group.id] || 0}
                          hideAccessoryCounts={hideAccessoryCounts}
                          onShare={selectedCollection ? () => setSidebarShareGroup({ collectionId: selectedCollection.id, groupId: group.id, groupName: group.name }) : undefined}
                          onSelectAccessories={() => { handleSelectCollectionGroup(group.id); setCollectionAddItemsOpen(true); }}
                          onRename={() => setSidebarRenamingGroup({ id: group.id, name: group.name })}
                          onDelete={() => setSidebarDeletingGroupId(group.id)}
                          onBackgroundSettings={() => {
                            setBackgroundSettingsTarget({ type: 'collectionGroup', id: group.id, name: group.name, parentId: selectedCollection?.id });
                            setBackgroundSettingsOpen(true);
                          }}
                          onPin={isMobile && selectedCollection ? () => isTabPinned('collectionGroup', group.id) ? handleUnpinTab('collectionGroup', group.id) : handlePinTab({ type: 'collectionGroup', id: group.id, name: group.name, collectionId: selectedCollection.id }) : undefined}
                          isPinned={isTabPinned('collectionGroup', group.id)}
                          pinFull={pinnedTabs.length >= MAX_PINNED_TABS}
                          isDarkBackground={isDarkBackground}
                          dragDisabled={!dndEnabled}
                          disableContextMenu={isTouchDevice && editMode}
                          editMode={isTouchDevice && editMode}
                        />
                      ))}
                    </SortableContext>
                  </DndContext>
                ) : undefined}
              />
              </div>
            </div>
          </div>
        </aside>

        {/* Main Content */}
        <main className={`relative flex-1 min-w-0 ${isInMobileApp || isInMacApp ? 'overflow-hidden' : ''}`}>
          <div
            className={`${isInMobileApp || isInMacApp ? `absolute inset-0 ${(isTouchDevice && (activeDragId || sidebarActiveId)) || collectionDragActive ? 'overflow-hidden' : 'overflow-y-auto'} overscroll-contain scrollbar-hidden` : ''} overflow-x-hidden ${isInMacApp ? 'pt-[108px] pb-16' : isInMobileApp ? 'pb-4' : 'pt-[80px] pb-16'}`}
            style={isInMobileApp ? {
              paddingTop: 'calc(80px + var(--safe-area-top, 0px))',
              paddingBottom: isMobile && pinnedTabs.length > 0 ? 'calc(72px + var(--safe-area-bottom, 0px))' : 'calc(16px + var(--safe-area-bottom, 0px))'
            } : isMobile && pinnedTabs.length > 0 ? { paddingBottom: showAdsenseBanner ? '220px' : '120px' } : showAdsenseBanner ? { paddingBottom: '140px' } : undefined}
          >
            <PullToRefresh
              isPullable={!(isTouchDevice && editMode)}
              onRefresh={handlePullRefresh}
              pullDownThreshold={67}
              maxPullDownDistance={95}
              resistance={1}
              backgroundColor="transparent"
              refreshingContent={<Loader2 className="h-5 w-5 animate-spin text-muted-foreground mx-auto mt-3" />}
              pullingContent={<ArrowDown className="h-5 w-5 text-muted-foreground mx-auto mt-3" />}
            >
            <div className="px-3 pt-2 md:px-6 md:pt-3 min-h-[calc(100%+1px)]">
              {/* Pending Invitations Modal */}
              <Dialog open={pendingInvitationsOpen} onOpenChange={setPendingInvitationsOpen}>
                <DialogContent className="sm:max-w-lg" style={{ zIndex: 10010 }}>
                  <DialogHeader>
                    <DialogTitle>Home Invitations</DialogTitle>
                    <DialogDescription className="sr-only">Pending home sharing invitations</DialogDescription>
                  </DialogHeader>
                  <div className="space-y-3">
                    {pendingInvitations.map((invite) => (
                      <div key={invite.id} className="rounded-lg border p-3 space-y-3">
                        <div className="flex items-center gap-3">
                          <Home className="h-5 w-5 shrink-0 text-primary" />
                          <div className="min-w-0">
                            <p className="text-sm font-medium">
                              {invite.inviterName} invited you to <strong>{invite.homeName}</strong>
                            </p>
                            <p className="text-xs text-muted-foreground">
                              Role: {invite.role.charAt(0).toUpperCase() + invite.role.slice(1)}
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2 justify-end">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={async () => {
                              await rejectInvitationMutation({ variables: { homeId: invite.homeId } });
                              refetchPendingInvitations();
                            }}
                          >
                            Decline
                          </Button>
                          <Button
                            size="sm"
                            onClick={async () => {
                              await acceptInvitationMutation({ variables: { homeId: invite.homeId } });
                              refetchPendingInvitations();
                              invalidateHomeKitCache();
                            }}
                          >
                            Accept
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                </DialogContent>
              </Dialog>
              {/* Enrollment Setup View */}
              {selectedEnrollmentId && (() => {
                const enrollment = pendingEnrollments.find(e => e.id === selectedEnrollmentId)
                  || enrollmentsData?.myCloudManagedEnrollments?.find(e => e.id === selectedEnrollmentId);
                return enrollment || null;
              })() ? (
                <div className="flex justify-center py-8 px-4">
                  <div className="w-full max-w-md">
                    <EnrollmentTrackerCard
                      enrollment={(pendingEnrollments.find(e => e.id === selectedEnrollmentId)
                        || enrollmentsData?.myCloudManagedEnrollments?.find(e => e.id === selectedEnrollmentId))!}
                      isDarkBackground={isDarkBackground}
                    />
                  </div>
                </div>
              ) : selectedCollection && serverConnected ? (
                <CollectionDetail
                  collection={selectedCollection}
                  onBack={() => setSelectedCollection(null)}
                  onUpdate={(updatedCollection) => {
                    if (updatedCollection) {
                      setSelectedCollection(updatedCollection);
                    }
                  }}
                  compactMode={compactMode}
                  onCompactModeChange={toggleCompactMode}
                  layoutMode={layoutMode}
                  onRefresh={refreshAll}
                  onSettingsOpen={() => setSettingsOpen(true)}
                  collectionItemOrder={collectionItemOrder}
                  onSaveItemOrder={handleSaveCollectionItemOrder}
                  hideAccessoryCounts={hideAccessoryCounts}
                  addingGroup={collectionAddingGroup}
                  onAddingGroupChange={setCollectionAddingGroup}
                  addItemsOpen={collectionAddItemsOpen}
                  onAddItemsOpenChange={setCollectionAddItemsOpen}
                  selectedGroupId={selectedCollectionGroupId}
                  onToggle={handleToggle}
                  onSlider={handleSlider}
                  getEffectiveValue={getEffectiveValue}
                  includedAccessoryIds={accountType === 'free' ? includedAccessoryIds : null}
                  isDarkBackground={isDarkBackground}
                  iconStyle={activeIconStyle}
                  isTouchDevice={isTouchDevice}
                  editMode={editMode}
                  onDragActiveChange={setCollectionDragActive}
                  developerMode={developerMode}
                />
              ) : (selectedCollectionId && hasContentAccess) ? (
                /* Loading state while collection data is being fetched OR waiting for server connection */
                <div className="flex flex-col items-center justify-center py-12 gap-3">
                  <Loader2 className="h-8 w-8 animate-spin text-primary" />
                  <p className={`text-sm ${isDarkBackground ? "text-white/70" : "text-muted-foreground"}`}>
                    {!serverConnected ? 'Connecting to server\u2026' : 'Loading collection\u2026'}
                  </p>
                </div>
              ) : (!isCommunity && ((sessionsLoading && !sessionsData) || (!homesData && homesLoading) || (settingsLoading && !settingsData))) ? (
                <div className="flex flex-col items-center justify-center py-12 gap-3">
                  <Loader2 className="h-8 w-8 animate-spin text-primary" />
                  <p className={`text-sm ${isDarkBackground ? "text-white/70" : "text-muted-foreground"}`}>
                    Loading…
                  </p>
                </div>
              ) : !hasContentAccess ? (
                <SetupState
                  setupPath={(() => {
                    try {
                      const parsed = settingsData?.settings?.data ? JSON.parse(settingsData.settings.data) : {};
                      return parsed.onboarding?.setupPath;
                    } catch { return undefined; }
                  })()}
                  pendingEnrollmentId={(() => {
                    try {
                      const parsed = settingsData?.settings?.data ? JSON.parse(settingsData.settings.data) : {};
                      return parsed.onboarding?.pendingEnrollmentId;
                    } catch { return undefined; }
                  })()}
                  homes={homes}
                  isDarkBackground={isDarkBackground}
                  userEmail={user?.email}
                  isInMacApp={isInMacApp}
                  isInMobileApp={isInMobileApp}
                  onSetupCloud={() => openSettingsTo('homes')}
                  onSetupMac={handleSetupMac}
                  accountType={accountType}
                  cloudSignupsAvailable={cloudSignupsAvailable}
                />
              ) : selectedHomeRelayOffline ? (
                <SetupState
                  setupPath={undefined}
                  homes={homes}
                  isDarkBackground={isDarkBackground}
                  userEmail={user?.email}
                  isInMacApp={isInMacApp}
                  isInMobileApp={isInMobileApp}
                  onSetupCloud={() => openSettingsTo('homes')}
                  onSetupMac={handleSetupMac}
                  accountType={accountType}
                  cloudSignupsAvailable={cloudSignupsAvailable}
                />
              ) : (accessoriesLoading && !accessoriesData) ? (
                <div className="flex flex-col items-center justify-center py-12 gap-3">
                  <Loader2 className="h-8 w-8 animate-spin text-primary" />
                  <p className={`text-sm ${isDarkBackground ? "text-white/70" : "text-muted-foreground"}`}>
                    {!serverConnected ? 'Connecting to server\u2026' : 'Loading accessories\u2026'}
                  </p>
                </div>
              ) : accessoriesError && !accessoriesData ? (
                <ErrorWithTrace
                  title="Unable to load accessories"
                  message={
                    (accessoriesError as HomecastError)?.code === 'NO_DEVICE'
                    ? 'The Homecast Relay is offline. Make sure the Relay is running and connected.'
                    : (accessoriesError as HomecastError)?.code === 'AUTH_REQUIRED'
                    ? 'Authentication is required. Please sign in.'
                    : accessoriesError.message.includes('timed out')
                    ? 'The request timed out. The relay may be slow to respond.'
                    : 'Something went wrong while fetching your accessories.'
                  }
                  errorCode={(accessoriesError as HomecastError)?.code}
                  trace={(accessoriesError as HomecastError)?.trace}
                  className={isDarkBackground ? "bg-black/30 border-white/20" : ""}
                  isDarkBackground={isDarkBackground}
                  actions={
                    <Button variant="outline" size="sm" className={isDarkBackground ? "bg-white/10 border-white/30 text-white hover:bg-white/20" : ""} onClick={() => refetchAccessories()}>
                      <RefreshCw className="h-4 w-4 mr-2" />
                      Try again
                    </Button>
                  }
                />
              ) : filteredRooms.length === 0 && homes.length === 0 && (homesLoading || !homesData) ? (
                <div className="flex flex-col items-center justify-center py-12 gap-3">
                  <Loader2 className="h-8 w-8 animate-spin text-primary" />
                  <p className={`text-sm ${isDarkBackground ? "text-white/70" : "text-muted-foreground"}`}>
                    Loading homes…
                  </p>
                </div>
              ) : filteredRooms.length === 0 && (accessoriesLoading || roomsLoading) ? (
                <div className="flex flex-col items-center justify-center py-12 gap-3">
                  <Loader2 className="h-8 w-8 animate-spin text-primary" />
                  <p className={`text-sm ${isDarkBackground ? "text-white/70" : "text-muted-foreground"}`}>
                    Loading accessories…
                  </p>
                </div>
              ) : filteredRooms.length === 0 ? (
                <Card className={isDarkBackground ? "bg-black/30 border-white/20" : ""}>
                  <CardContent className={`flex flex-col items-center py-12 ${isDarkBackground ? "text-white" : ""}`}>
                    <Lightbulb className={`mb-4 h-12 w-12 ${isDarkBackground ? "text-white/60" : "text-muted-foreground"}`} />
                    <h3 className="mb-2 text-lg font-semibold">
                      {homes.length === 0 ? 'No HomeKit homes found' : 'No accessories found'}
                    </h3>
                    <p className={`text-center ${isDarkBackground ? "text-white/70" : "text-muted-foreground"}`}>
                      {homes.length === 0
                        ? 'Add a home and accessories in the Apple Home app to get started.'
                        : selectedRoomId
                          ? 'No accessories in this room.'
                          : 'Select a home to view accessories.'}
                    </p>
                  </CardContent>
                </Card>
              ) : (
                /* Accessories by Room (grid or masonry) */
                <div key={`${selectedHomeId}-${selectedRoomId || 'all'}`} style={{ animation: 'fade-slide-in 0.35s ease-out' }}>
                {/* Header with title */}
                <h2 className={`text-base font-bold truncate mb-4 ${isDarkBackground ? 'text-white' : 'text-muted-foreground'}`}>
                  {selectedRoomId ? (
                    (() => {
                      const parentGroup = roomGroups.find(g => g.roomIds.some(rid => rid.toLowerCase().replace(/-/g, '') === selectedRoomId.toLowerCase().replace(/-/g, '')));
                      const currentRoom = rooms.find(r => r.id === selectedRoomId);
                      const roomName = currentRoom?.name || 'Room';
                      return (
                        <>
                          <span className="opacity-60">{homes.find(h => h.id === selectedHomeId)?.name || 'Home'}</span>
                          <span className="mx-2 opacity-40">/</span>
                          {parentGroup && (
                            <>
                              <span className="opacity-60">{parentGroup.name}</span>
                              <span className="mx-2 opacity-40">/</span>
                            </>
                          )}
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <span className="cursor-pointer">{roomName}</span>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="start">
                              {selectedHomeId && canShare && (
                                <DropdownMenuItem onClick={() => {
                                  if (currentRoom) setSidebarShareRoom({ room: currentRoom, homeId: selectedHomeId });
                                }}>
                                  <Share2 className="h-4 w-4 mr-2" />
                                  Share Room
                                </DropdownMenuItem>
                              )}
                              {isMobile && selectedHomeId && (
                                <DropdownMenuItem
                                  onClick={() => {
                                    if (isTabPinned('room', selectedRoomId)) {
                                      handleUnpinTab('room', selectedRoomId);
                                    } else if (currentRoom) {
                                      handlePinTab({ type: 'room', id: selectedRoomId, name: roomName, homeId: selectedHomeId });
                                    }
                                  }}
                                  disabled={!isTabPinned('room', selectedRoomId) && pinnedTabs.length >= MAX_PINNED_TABS}
                                >
                                  {isTabPinned('room', selectedRoomId) ? (
                                    <>
                                      <PinOff className="h-4 w-4 mr-2" />
                                      Unpin from Tab Bar
                                    </>
                                  ) : pinnedTabs.length >= MAX_PINNED_TABS ? (
                                    <>
                                      <Pin className="h-4 w-4 mr-2" />
                                      Tab Bar Full ({MAX_PINNED_TABS}/{MAX_PINNED_TABS})
                                    </>
                                  ) : (
                                    <>
                                      <Pin className="h-4 w-4 mr-2" />
                                      Pin to Tab Bar
                                    </>
                                  )}
                                </DropdownMenuItem>
                              )}
                              {selectedHomeId && !isViewOnly && (
                                <DropdownMenuItem onClick={() => toggleVisibility('room', 'ui', selectedHomeId, selectedRoomId)}>
                                  {isRoomActuallyHidden(selectedHomeId, selectedRoomId) ? (
                                    <>
                                      <Eye className="h-4 w-4 mr-2" />
                                      Unhide Room
                                    </>
                                  ) : (
                                    <>
                                      <EyeOff className="h-4 w-4 mr-2" />
                                      Hide Room
                                    </>
                                  )}
                                </DropdownMenuItem>
                              )}
                              <DropdownMenuItem onClick={() => {
                                setBackgroundSettingsTarget({ type: 'room', id: selectedRoomId, name: roomName });
                                setBackgroundSettingsOpen(true);
                              }}>
                                <ImageIcon className="h-4 w-4 mr-2" />
                                Set Room Background
                              </DropdownMenuItem>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem onClick={() => setShowHiddenItems(!showHiddenItems)}>
                                {showHiddenItems ? (
                                  <>
                                    <EyeOff className="h-4 w-4 mr-2" />
                                    Hide Hidden Items
                                  </>
                                ) : (
                                  <>
                                    <Eye className="h-4 w-4 mr-2" />
                                    Show Hidden Items
                                  </>
                                )}
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </>
                      );
                    })()
                  ) : (
                    homes.find(h => h.id === selectedHomeId)?.name || 'Home'
                  )}
                </h2>
                {/* Area Summary - aggregated sensor readings */}
                <AreaSummary
                  accessories={filteredRooms.flatMap(([_, accs]) => accs)}
                  isDarkBackground={isDarkBackground}
                  className="mb-4"
                />
                {selectedHomeId && !selectedRoomId && (
                  <AutomationsSection homeId={selectedHomeId} compact={compactMode} isDarkBackground={isDarkBackground} hideAccessoryCounts={hideAccessoryCounts} />
                )}
                <div className={compactMode ? "space-y-3" : "space-y-8"}>
                  {(() => { let visibleRoomIdx = 0; return (
                  (groupByRoom ? filteredRooms : [['All Accessories', filteredRooms.flatMap(([_, accs]) => accs).sort((a, b) => {
                    const aCat = getAccessoryCategory(a);
                    const bCat = getAccessoryCategory(b);
                    const aIdx = CATEGORY_ORDER.indexOf(aCat);
                    const bIdx = CATEGORY_ORDER.indexOf(bCat);
                    if (aIdx !== bIdx) return aIdx - bIdx;
                    return a.name.localeCompare(b.name);
                  })] as [string, HomeKitAccessory[]]]).map(([roomName, roomAccessories]) => {
                    // Pre-compute visible items to skip empty rooms
                    const room = rooms.find(r => r.name === roomName);
                    const contextId = selectedRoomId || room?.id || 'all';
                    const roomGroups = getGroupsForRoom(roomAccessories)
                      .filter(group => !selectedHomeId || !isGroupHidden(selectedHomeId, group.id, contextId));
                    const ungrouped = roomAccessories.filter(accessory => !groupedAccessoryIds.has(accessory.id));
                    const displayAccessories = filterAccessories(ungrouped, contextId);

                    // Hide room if it has no visible items (unless showHiddenItems is on)
                    if (!showHiddenItems && roomGroups.length === 0 && displayAccessories.length === 0) return null;

                    const isFirstVisibleRoom = visibleRoomIdx === 0;
                    visibleRoomIdx++;

                    return (
                    <div key={roomName} data-room-container data-room-name={roomName} {...(isFirstVisibleRoom ? { 'data-tour': 'widget-area' } : {})}>
                      {/* Only show room name header when viewing all rooms (not a specific room) */}
                      {groupByRoom && !selectedRoomId && (() => {
                        return (
                          <div className={`flex items-center gap-2 ${compactMode ? 'mb-1.5 mt-1' : 'mb-3 mt-2'}`}>
                            <button
                              onClick={() => room && handleSelectRoom(room.id)}
                              className={`text-sm font-semibold selectable text-left transition-opacity hover:opacity-100 ${isDarkBackground ? 'text-white/70 hover:text-white' : 'text-muted-foreground/70 hover:text-muted-foreground'}`}
                            >
                              {roomName}
                              {!hideAccessoryCounts && ` (${roomAccessories.length})`}
                            </button>
                          </div>
                        );
                      })()}
                      {/* Compute context and ordered items for this room */}
                      {(() => {

                        // Get unified ordered items (groups and accessories interleaved)
                        const orderedItems = selectedHomeId && !groupByType
                          ? getOrderedItems(selectedHomeId, contextId, roomGroups, displayAccessories, null as any)
                          : [
                              ...roomGroups.map(g => ({ type: 'group' as const, data: g })),
                              ...displayAccessories.map(a => ({ type: 'accessory' as const, data: a })),
                            ];

                        // IDs for SortableContext (unified list)
                        const allItemIds = orderedItems.map(item =>
                          item.type === 'group' ? `group-${item.data.id}` : item.data.id
                        );

                        const useLazyWidgets = orderedItems.length > 30;

                        const gridContent = (
                      <MasonryGrid
                        enabled={layoutMode === 'masonry' && !compactMode && !isMobile}
                        compact={compactMode}
                        minColumnWidth={fontSize === 'small' ? 250 : 290}
                        className={
                          layoutMode === 'masonry' && !compactMode && !isMobile
                            ? ''
                            : compactMode
                              ? (fontSize === 'small'
                                ? 'grid items-start gap-2 grid-cols-[repeat(auto-fill,minmax(155px,1fr))]'
                                : 'grid items-start gap-2 grid-cols-[repeat(auto-fill,minmax(180px,1fr))]')
                              : (fontSize === 'small'
                                ? 'grid items-start gap-4 grid-cols-[repeat(auto-fill,minmax(280px,1fr))]'
                                : 'grid items-start gap-4 grid-cols-[repeat(auto-fill,minmax(320px,1fr))]')
                        }
                      >
                        {/* Unified rendering of groups and accessories - interleaved based on order */}
                        {!groupByType && orderedItems.map((item) => {
                          if (item.type === 'group') {
                            const group = item.data;
                            const groupAccessories = getAccessoriesInGroup(group);
                            // Use isGroupActuallyHidden for badge display and drag disabling (ignores showHiddenItems)
                            const groupHidden = selectedHomeId ? isGroupActuallyHidden(selectedHomeId, group.id, contextId) : false;
                            const groupHomeName = getHomeName(groupAccessories[0]?.homeId);

                            return (
                              <SortableItem key={`group-${group.id}`} id={`group-${group.id}`} disabled={groupHidden}>
                                <LazyWidget enabled={useLazyWidgets} height={compactMode ? 80 : 140}>
                                <ServiceGroupWidget
                                  group={group}
                                  accessories={groupAccessories}
                                  compact={compactMode}
                                  homeName={groupHomeName}
                                  roomName={roomName}
                                  onToggle={(checked) => handleGroupToggle(group.id, checked)}
                                  onSlider={(charType, value) => handleGroupSlider(group.id, charType, value)}
                                  onAccessoryToggle={handleToggle}
                                  onAccessorySlider={handleSlider}
                                  getEffectiveValue={getEffectiveValue}
                                  isHidden={groupHidden}
                                  onHide={() => selectedHomeId && toggleVisibility('group', 'ui', selectedHomeId, group.id, contextId)}
                                  hideLabel={groupHidden ? 'Unhide Group' : 'Hide Group'}
                                  showHiddenItems={showHiddenItems}
                                  onToggleShowHidden={handleToggleShowHidden}
                                  iconStyle={activeIconStyle}
                                  onShare={canShare ? () => selectedHomeId && setSidebarShareServiceGroup({ group, accessories: groupAccessories, homeId: groupAccessories[0]?.homeId || selectedHomeId }) : undefined}
                                  disableTooltip={isTouchDevice && editMode}
                                  editMode={isTouchDevice && editMode}
                                />
                                </LazyWidget>
                              </SortableItem>
                            );
                          } else {
                            // Accessory item
                            const accessory = item.data;
                          const isExpanded = compactMode && expandedWidgetId === accessory.id;
                          const isHidden = selectedHomeId ? isDeviceActuallyHidden(selectedHomeId, contextId, accessory.id) : false;
                          
                          const isCurrentlyHidden = isHidden;

                          const accessoryContent = compactMode ? (
                            // Compact mode: show compact widget with click-to-expand
                            <div
                              className={`relative 'cursor-pointer'`}
                              style={undefined}
                              onClick={() => handleWidgetClick(accessory.id)}
                              onMouseLeave={isExpanded ? handleWidgetMouseLeave : undefined}
                            >
                              {/* Compact widget (always visible as layout anchor) */}
                              <AccessoryWidget
                                              homeName={getHomeName(accessory.homeId)}
                                accessory={accessory}
                                onToggle={handleToggle}
                                onSlider={handleSlider}
                                getEffectiveValue={getEffectiveValue}
                                compact={true}

                                onDebug={isAdmin ? () => setDebugAccessory(accessory) : undefined}
                                iconStyle={activeIconStyle}
                                isHidden={isHidden}

                                onHide={() => selectedHomeId && toggleVisibility('device', 'ui', selectedHomeId, accessory.id, contextId)}
                                hideLabel={isHidden ? 'Unhide Accessory' : 'Hide Accessory'}
                                showHiddenItems={showHiddenItems}
                                onToggleShowHidden={handleToggleShowHidden}
                                onShare={canShare ? () => selectedHomeId && setSidebarShareAccessory({ accessory, homeId: accessory.homeId || selectedHomeId }) : undefined}
                                editMode={isTouchDevice && editMode}
                              />
                              {getDealBadge(accessory)}

                              {/* Expanded widget (floating overlay) */}
                              <ExpandedOverlay isExpanded={isExpanded} onClose={collapseExpandedWidget} onMouseEnter={cancelCollapseTimeout}>
                                <AccessoryWidget
                                              homeName={getHomeName(accessory.homeId)}
                                  accessory={accessory}
                                  onToggle={handleToggle}
                                  onSlider={handleSlider}
                                  getEffectiveValue={getEffectiveValue}
                                  compact={false}

                                  onDebug={isAdmin ? () => setDebugAccessory(accessory) : undefined}
                                  iconStyle={activeIconStyle}
                                  isHidden={isHidden}
                                  onHide={() => selectedHomeId && toggleVisibility('device', 'ui', selectedHomeId, accessory.id, contextId)}
                                  hideLabel={isHidden ? 'Unhide Accessory' : 'Hide Accessory'}
                                showHiddenItems={showHiddenItems}
                                onToggleShowHidden={handleToggleShowHidden}
                                onShare={canShare ? () => selectedHomeId && setSidebarShareAccessory({ accessory, homeId: accessory.homeId || selectedHomeId }) : undefined}
                                editMode={isTouchDevice && editMode}
                                />
                              </ExpandedOverlay>
                            </div>
                          ) : (
                            // Normal mode: show full widget directly
                            <div className="relative" style={undefined}>
                              <AccessoryWidget
                                              homeName={getHomeName(accessory.homeId)}
                                accessory={accessory}
                                onToggle={handleToggle}
                                onSlider={handleSlider}
                                getEffectiveValue={getEffectiveValue}
                                compact={false}

                                onDebug={isAdmin ? () => setDebugAccessory(accessory) : undefined}
                                iconStyle={activeIconStyle}
                                isHidden={isHidden}

                                onHide={() => selectedHomeId && toggleVisibility('device', 'ui', selectedHomeId, accessory.id, contextId)}
                                hideLabel={isHidden ? 'Unhide Accessory' : 'Hide Accessory'}
                                showHiddenItems={showHiddenItems}
                                onToggleShowHidden={handleToggleShowHidden}
                                onShare={canShare ? () => selectedHomeId && setSidebarShareAccessory({ accessory, homeId: accessory.homeId || selectedHomeId }) : undefined}
                                editMode={isTouchDevice && editMode}
                              />
                              {getDealBadge(accessory)}
                            </div>
                          );

                          return (
                            <SortableItem key={accessory.id} id={accessory.id} disabled={isHidden}>
                              <LazyWidget enabled={useLazyWidgets} height={compactMode ? 80 : 140}>
                                {accessoryContent}
                              </LazyWidget>
                            </SortableItem>
                          );
                          }
                        })}
                      </MasonryGrid>
                      );

                        // Render drag overlay content
                        const renderOverlay = (activeId: string) => {
                          // Find active accessory or group
                          const activeAccessory = !activeId.startsWith('group-')
                            ? roomAccessories.find(a => a.id === activeId)
                            : null;
                          const activeGroup = activeId.startsWith('group-')
                            ? roomGroups.find(g => `group-${g.id}` === activeId)
                            : null;

                          if (activeAccessory) {
                            return (
                              <div className="relative cursor-grabbing">
                                <AccessoryWidget
                                  homeName={getHomeName(activeAccessory.homeId)}
                                  accessory={activeAccessory}
                                  onToggle={() => {}}
                                  onSlider={() => {}}
                                  getEffectiveValue={getEffectiveValue}
                                  compact={compactMode}
                                  iconStyle={activeIconStyle}
                                />
                                {groupByRoom && !dragOverValid && (
                                  <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-[100]">
                                    <div className="bg-amber-500 text-white text-xs px-2 py-1 rounded-full whitespace-nowrap shadow-md">
                                      Use Apple Home app to change rooms
                                    </div>
                                  </div>
                                )}
                              </div>
                            );
                          }

                          if (activeGroup) {
                            const groupAccessories = getAccessoriesInGroup(activeGroup);
                            const groupHomeName = getHomeName(groupAccessories[0]?.homeId);
                            return (
                              <div className="relative cursor-grabbing">
                                <ServiceGroupWidget
                                  group={activeGroup}
                                  accessories={groupAccessories}
                                  compact={compactMode}
                                  homeName={groupHomeName}
                                  roomName={roomName}
                                  onToggle={() => {}}
                                  onSlider={() => {}}
                                  disableTooltip
                                  iconStyle={activeIconStyle}
                                />
                                {groupByRoom && !dragOverValid && (
                                  <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-[100]">
                                    <div className="bg-amber-500 text-white text-xs px-2 py-1 rounded-full whitespace-nowrap shadow-md">
                                      Use Apple Home app to change rooms
                                    </div>
                                  </div>
                                )}
                              </div>
                            );
                          }

                          return null;
                        };

                        // Handle reorder with save - uses entity layout system
                        const handleReorder = (newOrder: string[]) => {
                          if (!selectedHomeId) return;
                          // contextId is the roomId - save to room entity layout
                          const roomId = contextId;
                          if (!roomId || roomId === 'all') return;

                          // Read current room layout from cache
                          let currentLayout: RoomLayoutData = {};
                          try {
                            const cached = apolloClient.readQuery<GetStoredEntityLayoutResponse>({
                              query: GET_STORED_ENTITY_LAYOUT,
                              variables: { entityType: 'room', entityId: roomId },
                            });
                            if (cached?.storedEntityLayout?.layoutJson) {
                              currentLayout = JSON.parse(cached.storedEntityLayout.layoutJson);
                            }
                          } catch {
                            // No cached layout, start fresh
                          }

                          const newLayout: RoomLayoutData = {
                            ...currentLayout,
                            itemOrder: newOrder,
                          };

                          // Save to room entity layout (updates cache immediately, then persists)
                          if (import.meta.env.DEV) console.log('[Dashboard] Saving room item order:', { roomId, newLayout });
                          saveRoomLayoutForEntity(roomId, newLayout).catch(err => {
                            console.error('[Dashboard] Failed to save room item order:', err);
                            toast.error('Failed to save order');
                          });
                          // Trigger re-render to pick up new order from cache
                          setItemOrderVersion(v => v + 1);
                        };

                        return !groupByType && selectedHomeId ? (
                          <DraggableGrid
                            enabled={dndEnabled}
                            touchMode={isTouchDevice}
                            itemIds={allItemIds}
                            onReorder={handleReorder}
                            renderDragOverlay={renderOverlay}
                            onDragStart={(id) => {
                              setActiveDragId(id);
                              setActiveDragRoomName(roomName);
                              if (groupByRoom) {
                                const roomContainer = document.querySelector(`[data-room-name="${roomName}"]`);
                                if (roomContainer) {
                                  dragRoomBoundsRef.current = roomContainer.getBoundingClientRect();
                                }
                              }
                            }}
                            onDragEnd={() => {
                              setActiveDragId(null);
                              setActiveDragRoomName(null);
                              setDragOverValid(true);
                              lastDragOverValidRef.current = true;
                              dragRoomBoundsRef.current = null;
                            }}
                          >
                            {gridContent}
                          </DraggableGrid>
                        ) : gridContent;
                      })()}

                      {/* Group by type - render each category separately */}
                      {groupByType && (() => {
                        // Reuse pre-computed room context and visible items from outer scope
                        const ungroupedAccessories = displayAccessories;

                        // Categorize accessories and sort by widget type within each category
                        const accessoriesByCategory = ungroupedAccessories.reduce((acc, accessory) => {
                          const cat = getAccessoryCategory(accessory);
                          if (!acc[cat]) acc[cat] = [];
                          acc[cat].push(accessory);
                          return acc;
                        }, {} as Record<string, HomeKitAccessory[]>);

                        // Sort each category by primary service type so same widget types are together
                        Object.keys(accessoriesByCategory).forEach(cat => {
                          accessoriesByCategory[cat].sort((a, b) => {
                            const aType = getPrimaryServiceType(a) || 'zzz';
                            const bType = getPrimaryServiceType(b) || 'zzz';
                            return aType.localeCompare(bType);
                          });
                        });

                        // Categorize groups
                        const groupsByCategory = roomGroups.reduce((acc, group) => {
                          const cat = getGroupCategory(group);
                          if (!acc[cat]) acc[cat] = [];
                          acc[cat].push(group);
                          return acc;
                        }, {} as Record<string, HomeKitServiceGroup[]>);

                        // Get all categories that have either accessories or groups
                        const sortedCategories = CATEGORY_ORDER.filter(cat =>
                          (accessoriesByCategory[cat]?.length > 0) || (groupsByCategory[cat]?.length > 0)
                        );

                        return sortedCategories.map((category, catIndex) => (
                          <div key={category} className={catIndex > 0 ? (compactMode ? 'mt-2' : 'mt-4') : (compactMode ? 'mt-1' : 'mt-2')}>
                            <p className={`text-[10px] ${isDarkBackground ? 'text-white/50' : 'text-muted-foreground/50'} ${compactMode ? 'mb-1' : 'mb-2'}`}>
                              {category}
                            </p>
                            <MasonryGrid
                              enabled={layoutMode === 'masonry' && !compactMode && !isMobile}
                              compact={compactMode}
                              minColumnWidth={fontSize === 'small' ? 250 : 290}
                              className={
                                layoutMode === 'masonry' && !compactMode && !isMobile
                                  ? ''
                                  : compactMode
                                    ? (fontSize === 'small'
                                      ? 'grid items-start gap-2 grid-cols-[repeat(auto-fill,minmax(155px,1fr))]'
                                      : 'grid items-start gap-2 grid-cols-[repeat(auto-fill,minmax(180px,1fr))]')
                                    : (fontSize === 'small'
                                      ? 'grid items-start gap-4 grid-cols-[repeat(auto-fill,minmax(280px,1fr))]'
                                      : 'grid items-start gap-4 grid-cols-[repeat(auto-fill,minmax(320px,1fr))]')
                              }
                            >
                              {/* Groups in this category */}
                              {(groupsByCategory[category] || []).map((group) => {
                                const isBlindsGroup = isWindowCoveringGroup(group);
                                const isLightsGroup = isLightGroup(group);
                                const groupAccessories = getAccessoriesInGroup(group);
                                const actualGroupOn = isBlindsGroup ? getGroupAveragePosition(group) > 50 : isGroupOn(group);
                                const isExpanded = expandedGroups.has(group.id);
                                const groupPosition = isBlindsGroup ? getGroupAveragePosition(group) : 0;
                                const groupBrightness = isLightsGroup ? getGroupAverageBrightness(group) : null;
                                const isGroupWidgetExpanded = expandedWidgetId === `group-${group.id}`;

                                
                                
                                const showCompact = compactMode;
                                const groupOn = actualGroupOn;
                                const groupHidden = selectedHomeId ? isGroupHidden(selectedHomeId, group.id, contextId) : false;
                                

                                // Calculate how many accessories are on for partial state
                                const onCount = !isBlindsGroup ? groupAccessories.filter(accessory => {
                                  for (const service of accessory.services || []) {
                                    for (const char of service.characteristics || []) {
                                      if (char.characteristicType === 'on' || char.characteristicType === 'power_state') {
                                        const value = parseCharacteristicValue(char.value);
                                        if (value === true || value === 1) return true;
                                      }
                                    }
                                  }
                                  return false;
                                }).length : 0;
                                const isPartiallyOn = !isBlindsGroup && onCount > 0 && onCount < groupAccessories.length;

                                // Determine group service type for icon coloring
                                const groupServiceType = isBlindsGroup
                                  ? 'window_covering'
                                  : (groupAccessories[0] ? getPrimaryServiceType(groupAccessories[0]) : 'lightbulb') || 'lightbulb';
                                const groupIconColor = (activeIconStyle === 'standard' || activeIconStyle === 'colourful') ? getIconColor(groupServiceType) : null;
                                const groupIconBgClass = groupIconColor
                                  ? (groupOn ? groupIconColor.bg : groupIconColor.bgOff)
                                  : (groupOn ? 'bg-primary' : 'bg-muted');
                                const groupIconTextClass = groupIconColor
                                  ? (groupOn ? groupIconColor.text : groupIconColor.textOff)
                                  : (groupOn ? 'text-primary-foreground' : '');
                                // Card background based on service type when colourful mode is active (no hover change)
                                const groupCardBgClass = activeIconStyle === 'colourful' && groupIconColor && groupOn
                                  ? groupIconColor.cardBg
                                  : (groupOn ? 'bg-primary/15' : 'bg-muted/30');

                                // Create color context for group sliders
                                const groupColorContext = {
                                  colors: groupIconColor || DEFAULT_ICON_COLOR,
                                  isOn: groupOn,
                                  iconStyle: activeIconStyle,
                                };

                                // Get averaged characteristics for tooltip
                                const groupAvgChars = getGroupAverageCharacteristics(group);
                                const groupHomeName = getHomeName(groupAccessories[0]?.homeId);
                                const groupRoomName = groupAccessories[0]?.roomName;

                                return (
                                  <WidgetColorContext.Provider value={groupColorContext}>
                                  <TooltipProvider>
                                  <Tooltip delayDuration={300}>
                                  <TooltipTrigger asChild>
                                  <div
                                    key={`group-${group.id}`}
                                    className={`relative bg-card rounded-[20px] ${compactMode ? 'cursor-pointer' : ''} `}
                                    onClick={compactMode ? () => handleWidgetClick(`group-${group.id}`) : undefined}
                                    onMouseLeave={isGroupWidgetExpanded ? handleWidgetMouseLeave : undefined}
                                  >
                                    <div>
                                    {/* Compact group card */}
                                    <Card
                                      className={`relative ${groupCardBgClass} `}
                                    >
                                    <CardHeader className={showCompact ? 'p-2.5' : 'p-4 pb-2'}>
                                      <div className={`flex items-center justify-between ${showCompact ? 'gap-1.5' : 'gap-2'}`}>
                                        <div className={`flex items-center min-w-0 ${showCompact ? 'gap-1.5' : 'gap-2'}`}>
                                          <div className={`shrink-0 flex items-center justify-center ${
                                            showCompact ? 'h-6 w-6 rounded-md' : 'h-8 w-8 rounded-lg'
                                          } ${groupIconBgClass} ${groupIconTextClass} ${groupOn ? 'shadow-sm' : 'opacity-30'}`}>
                                            {isBlindsGroup
                                              ? <Blinds className={showCompact ? 'h-3 w-3' : 'h-4 w-4'} />
                                              : <Lightbulb className={showCompact ? 'h-3 w-3' : 'h-4 w-4'} />
                                            }
                                          </div>
                                          <div className="min-w-0">
                                            <CardTitle className={`truncate font-medium leading-tight selectable ${showCompact ? 'text-[11px]' : 'text-sm'}`}>
                                              {getDisplayName(group.name, roomName)}
                                            </CardTitle>
                                            <div className={`overflow-hidden ${showCompact ? 'max-h-0 opacity-0' : 'max-h-8 opacity-100'}`}>
                                              <CardDescription className="text-xs mt-0.5 flex items-center gap-1.5 selectable">
                                                {isBlindsGroup ? `${groupPosition}% open` : `${groupAccessories.length} device${groupAccessories.length !== 1 ? 's' : ''}`}
                                                {isPartiallyOn && (
                                                  <Badge variant="secondary" className={`text-[9px] px-1 py-0 h-4 ${activeIconStyle === 'colourful' && groupIconColor ? `${groupIconColor.accentMuted}` : ''}`}>
                                                    {onCount}/{groupAccessories.length} on
                                                  </Badge>
                                                )}
                                              </CardDescription>
                                            </div>
                                          </div>
                                        </div>
                                        {!isBlindsGroup && (
                                          <div className={`shrink-0 ${showCompact ? 'scale-75 origin-right' : ''}`} onClick={(e) => e.stopPropagation()}>
                                            <Switch
                                              checked={actualGroupOn}
                                              onCheckedChange={(checked) => handleGroupToggle(group.id, checked)}
                                              className="shrink-0"
                                              checkedColorClass={activeIconStyle === 'colourful' ? groupIconColor?.switchBg : undefined}
                                            />
                                          </div>
                                        )}
                                      </div>
                                    </CardHeader>
                                    <AnimatedCollapse open={!showCompact}>
                                      <CardContent className="px-4 pb-3 pt-1 space-y-2" onClick={(e) => e.stopPropagation()}>
                                        {isBlindsGroup && (
                                          <SliderControl
                                            label="All Blinds"
                                            value={groupPosition}
                                            step={5}
                                            unit="%"
                                            onCommit={(v) => handleGroupSlider(group.id, 'target_position', v)}
                                          />
                                        )}
                                        {isLightsGroup && actualGroupOn && groupBrightness !== null && (
                                          <SliderControl
                                            label="All Lights"
                                            value={groupBrightness}
                                            step={1}
                                            unit="%"
                                            onCommit={(v) => handleGroupSlider(group.id, 'brightness', v)}
                                          />
                                        )}
                                        {(
                                          <Button
                                            variant="ghost"
                                            className={`ml-auto h-7 px-2 gap-1 text-xs rounded-md text-muted-foreground ${activeIconStyle === 'colourful' && groupOn && groupIconColor ? `${groupIconColor.accentMuted} ${groupIconColor.accentMutedHover}` : 'bg-background hover:bg-muted'}`}
                                            onClick={() => toggleGroupExpanded(group.id)}
                                            disabled={false}
                                          >
                                            {isExpanded ? 'Hide devices' : 'Show devices'}
                                            {isExpanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                                          </Button>
                                        )}
                                      </CardContent>
                                    </AnimatedCollapse>
                                    <AnimatedCollapse open={isExpanded && !showCompact}>
                                      <CardContent className="px-3 pb-3 pt-0 relative z-50 isolate" onPointerDownCapture={(e) => e.stopPropagation()} onMouseDownCapture={(e) => e.stopPropagation()} onTouchStartCapture={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()}>
                                        <div className="space-y-2 pt-1">
                                          {groupAccessories.map((accessory) => {
                                            const isBlind = hasServiceType(accessory, 'window_covering');
                                            const characteristics = getDisplayableCharacteristics(accessory);
                                            const powerChar = characteristics.find(c => c.meta.controlType === 'toggle');
                                            const powerValue = powerChar ? getEffectiveValue(accessory.id, powerChar.type, powerChar.value) : null;
                                            const posChar = isBlind ? getCharacteristic(accessory, 'current_position') : null;
                                            const posValue = posChar?.value;
                                            const position = (posValue === false || posValue === 'false' || posValue === null || posValue === undefined)
                                              ? 0
                                              : Number(posValue) || 0;
                                            const accIsOn = isBlind ? position > 50 : (powerValue === true || powerValue === 1);
                                            const accServiceType = getPrimaryServiceType(accessory) || 'lightbulb';
                                            const accIconColor = (activeIconStyle === 'standard' || activeIconStyle === 'colourful') ? getIconColor(accServiceType) : null;
                                            const accIconBgClass = accIconColor
                                              ? (accIsOn ? accIconColor.bg : accIconColor.bgOff)
                                              : (accIsOn ? 'bg-primary/20 text-primary' : 'bg-muted');
                                            const accIconTextClass = accIconColor
                                              ? (accIsOn ? accIconColor.text : accIconColor.textOff)
                                              : '';
                                            // Card background for accessory item
                                            const accCardBgClass = activeIconStyle === 'colourful' && accIconColor && accIsOn
                                              ? accIconColor.accentMuted
                                              : (accIsOn ? 'bg-primary/10' : 'bg-background');
                                            const getServiceIcon = () => {
                                              switch (accServiceType) {
                                                case 'lightbulb': return <Lightbulb className="h-3 w-3" />;
                                                case 'switch': return <Power className="h-3 w-3" />;
                                                case 'outlet': return <Plug className="h-3 w-3" />;
                                                case 'fan': return <Wind className="h-3 w-3" />;
                                                case 'window_covering': return <Blinds className="h-3 w-3" />;
                                                case 'lock': return <Lock className="h-3 w-3" />;
                                                case 'thermostat': return <Thermometer className="h-3 w-3" />;
                                                case 'speaker': return <Speaker className="h-3 w-3" />;
                                                default: return <Power className="h-3 w-3" />;
                                              }
                                            };
                                            const isAccessoryExpanded = expandedWidgetId === `group-acc-${accessory.id}`;
                                            return (
                                              <div
                                                key={accessory.id}
                                                className="relative cursor-pointer"
                                                onClick={(e) => { e.stopPropagation(); handleWidgetClick(`group-acc-${accessory.id}`); }}
                                                onMouseLeave={isAccessoryExpanded ? handleWidgetMouseLeave : undefined}
                                              >
                                                <div className={`rounded-md px-2 py-1.5 ${accCardBgClass} ${isBlind ? 'space-y-2' : ''}`} onClick={(e) => { e.stopPropagation(); handleWidgetClick(`group-acc-${accessory.id}`); }}>
                                                  <div className="flex items-center justify-between">
                                                    <div className="flex items-center gap-2 min-w-0">
                                                      <div className={`flex h-6 w-6 shrink-0 items-center justify-center rounded ${accIconBgClass} ${accIconTextClass}`}>
                                                        {getServiceIcon()}
                                                      </div>
                                                      <span className="truncate text-xs">{getDisplayName(accessory.name, accessory.roomName)}</span>
                                                      {isBlind && (
                                                        <span className="text-[10px] text-muted-foreground">{position}%</span>
                                                      )}
                                                    </div>
                                                    {!isBlind && powerChar && (
                                                      <Switch
                                                        checked={accIsOn}
                                                        onCheckedChange={() => handleToggle(accessory.id, powerChar.type, accIsOn)}
                                                        disabled={!accessory.isReachable || isViewOnly}
                                                        className="scale-75"
                                                        checkedColorClass={activeIconStyle === 'colourful' ? accIconColor?.switchBg : undefined}
                                                        onClick={(e) => e.stopPropagation()}
                                                      />
                                                    )}
                                                  </div>
                                                  {isBlind && (
                                                    <div className="pl-8" onClick={(e) => e.stopPropagation()}>
                                                      <Slider
                                                        value={[position]}
                                                        min={0}
                                                        max={100}
                                                        step={5}
                                                        onValueCommit={(v) => handleSlider(accessory.id, 'target_position', v[0])}
                                                        disabled={!accessory.isReachable || isViewOnly}
                                                        className="w-full"
                                                      />
                                                    </div>
                                                  )}
                                                </div>
                                                <ExpandedOverlay isExpanded={isAccessoryExpanded} onClose={collapseExpandedWidget} onMouseEnter={cancelCollapseTimeout}>
                                                  <AccessoryWidget
                                              homeName={getHomeName(accessory.homeId)}
                                                    accessory={accessory}
                                                    onToggle={handleToggle}
                                                    onSlider={handleSlider}
                                                    getEffectiveValue={getEffectiveValue}
                                                    compact={false}

                                                    onDebug={isAdmin ? () => setDebugAccessory(accessory) : undefined}
                                                    iconStyle={activeIconStyle}
                                                  />
                                                </ExpandedOverlay>
                                              </div>
                                            );
                                          })}
                                        </div>
                                      </CardContent>
                                    </AnimatedCollapse>
                                    </Card>

                                    {/* Expanded group card (non-compact size) */}
                                    <ExpandedOverlay isExpanded={isGroupWidgetExpanded} onClose={collapseExpandedWidget} onMouseEnter={cancelCollapseTimeout}>
                                      <Card
                                        className={groupCardBgClass}
                                      >
                                        <CardHeader className="p-4 pb-2">
                                          <div className="flex items-center justify-between gap-2">
                                            <div className="flex items-center min-w-0 gap-2">
                                              <div className={`shrink-0 flex items-center justify-center h-8 w-8 rounded-lg ${groupIconBgClass} ${groupIconTextClass} ${groupOn ? 'shadow-sm' : 'opacity-30'}`}>
                                                {isBlindsGroup
                                                  ? <Blinds className="h-4 w-4" />
                                                  : <Lightbulb className="h-4 w-4" />
                                                }
                                              </div>
                                              <div className="min-w-0">
                                                <CardTitle className="truncate font-medium leading-tight text-sm">
                                                  {getDisplayName(group.name, roomName)}
                                                </CardTitle>
                                                <CardDescription className="text-xs mt-0.5 flex items-center gap-1.5">
                                                  {isBlindsGroup ? `${groupPosition}% open` : `${groupAccessories.length} device${groupAccessories.length !== 1 ? 's' : ''}`}
                                                  {isPartiallyOn && (
                                                    <Badge variant="secondary" className={`text-[9px] px-1 py-0 h-4 ${activeIconStyle === 'colourful' && groupIconColor ? `${groupIconColor.accentMuted}` : ''}`}>
                                                      {onCount}/{groupAccessories.length} on
                                                    </Badge>
                                                  )}
                                                </CardDescription>
                                              </div>
                                            </div>
                                            {!isBlindsGroup && (
                                              <div className="shrink-0" onClick={(e) => e.stopPropagation()}>
                                                <Switch
                                                  checked={actualGroupOn}
                                                  onCheckedChange={(checked) => handleGroupToggle(group.id, checked)}
                                                  className="shrink-0"
                                                  checkedColorClass={activeIconStyle === 'colourful' ? groupIconColor?.switchBg : undefined}
                                                />
                                              </div>
                                            )}
                                          </div>
                                        </CardHeader>
                                        <CardContent className="px-4 pb-3 pt-1 space-y-2" onClick={(e) => e.stopPropagation()}>
                                          {isBlindsGroup && (
                                            <SliderControl
                                              label="All Blinds"
                                              value={groupPosition}
                                              step={5}
                                              unit="%"
                                              onCommit={(v) => handleGroupSlider(group.id, 'target_position', v)}
                                            />
                                          )}
                                          {isLightsGroup && actualGroupOn && groupBrightness !== null && (
                                            <SliderControl
                                              label="All Lights"
                                              value={groupBrightness}
                                              step={1}
                                              unit="%"
                                              onCommit={(v) => handleGroupSlider(group.id, 'brightness', v)}
                                            />
                                          )}
                                          <Button
                                            variant="ghost"
                                            className={`ml-auto h-7 px-2 gap-1 text-xs rounded-md text-muted-foreground ${activeIconStyle === 'colourful' && groupOn && groupIconColor ? `${groupIconColor.accentMuted} ${groupIconColor.accentMutedHover}` : 'bg-background hover:bg-muted'}`}
                                            onClick={() => toggleGroupExpanded(group.id)}
                                          >
                                            {isExpanded ? 'Hide devices' : 'Show devices'}
                                            {isExpanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                                          </Button>
                                        </CardContent>
                                        <AnimatedCollapse open={isExpanded}>
                                          <CardContent className="px-3 pb-3 pt-0 relative z-50 isolate" onPointerDownCapture={(e) => e.stopPropagation()} onMouseDownCapture={(e) => e.stopPropagation()} onTouchStartCapture={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()}>
                                            <div className="space-y-2 pt-1">
                                              {groupAccessories.map((accessory) => {
                                                const isBlind = hasServiceType(accessory, 'window_covering');
                                                const characteristics = getDisplayableCharacteristics(accessory);
                                                const powerChar = characteristics.find(c => c.meta.controlType === 'toggle');
                                                const powerValue = powerChar ? getEffectiveValue(accessory.id, powerChar.type, powerChar.value) : null;
                                                const posChar = isBlind ? getCharacteristic(accessory, 'current_position') : null;
                                                const posValue = posChar?.value;
                                                const position = (posValue === false || posValue === 'false' || posValue === null || posValue === undefined)
                                                  ? 0
                                                  : Number(posValue) || 0;
                                                const accIsOn = isBlind ? position > 50 : (powerValue === true || powerValue === 1);
                                                const accServiceType = getPrimaryServiceType(accessory) || 'lightbulb';
                                                const accIconColor = (activeIconStyle === 'standard' || activeIconStyle === 'colourful') ? getIconColor(accServiceType) : null;
                                                const accIconBgClass = accIconColor
                                                  ? (accIsOn ? accIconColor.bg : accIconColor.bgOff)
                                                  : (accIsOn ? 'bg-primary/20 text-primary' : 'bg-muted');
                                                const accIconTextClass = accIconColor
                                                  ? (accIsOn ? accIconColor.text : accIconColor.textOff)
                                                  : '';
                                                // Card background for accessory item
                                                const accCardBgClass = activeIconStyle === 'colourful' && accIconColor && accIsOn
                                                  ? accIconColor.accentMuted
                                                  : (accIsOn ? 'bg-primary/10' : 'bg-background');
                                                const getServiceIcon = () => {
                                                  switch (accServiceType) {
                                                    case 'lightbulb': return <Lightbulb className="h-3 w-3" />;
                                                    case 'switch': return <Power className="h-3 w-3" />;
                                                    case 'outlet': return <Plug className="h-3 w-3" />;
                                                    case 'fan': return <Wind className="h-3 w-3" />;
                                                    case 'window_covering': return <Blinds className="h-3 w-3" />;
                                                    case 'lock': return <Lock className="h-3 w-3" />;
                                                    case 'thermostat': return <Thermometer className="h-3 w-3" />;
                                                    case 'speaker': return <Speaker className="h-3 w-3" />;
                                                    default: return <Power className="h-3 w-3" />;
                                                  }
                                                };
                                                const isAccessoryExpanded = expandedWidgetId === `group-acc-${accessory.id}`;
                                                return (
                                                  <div
                                                    key={accessory.id}
                                                    className="relative cursor-pointer"
                                                    onClick={(e) => { e.stopPropagation(); handleWidgetClick(`group-acc-${accessory.id}`); }}
                                                    onMouseLeave={isAccessoryExpanded ? handleWidgetMouseLeave : undefined}
                                                  >
                                                    <div className={`rounded-md px-2 py-1.5 ${accCardBgClass} ${isBlind ? 'space-y-2' : ''}`} onClick={(e) => { e.stopPropagation(); handleWidgetClick(`group-acc-${accessory.id}`); }}>
                                                      <div className="flex items-center justify-between">
                                                        <div className="flex items-center gap-2 min-w-0">
                                                          <div className={`flex h-6 w-6 shrink-0 items-center justify-center rounded ${accIconBgClass} ${accIconTextClass}`}>
                                                            {getServiceIcon()}
                                                          </div>
                                                          <span className="truncate text-xs">{getDisplayName(accessory.name, accessory.roomName)}</span>
                                                          {isBlind && (
                                                            <span className="text-[10px] text-muted-foreground">{position}%</span>
                                                          )}
                                                        </div>
                                                        {!isBlind && powerChar && (
                                                          <Switch
                                                            checked={accIsOn}
                                                            onCheckedChange={() => handleToggle(accessory.id, powerChar.type, accIsOn)}
                                                            disabled={!accessory.isReachable || isViewOnly}
                                                            className="scale-75"
                                                            checkedColorClass={activeIconStyle === 'colourful' ? accIconColor?.switchBg : undefined}
                                                            onClick={(e) => e.stopPropagation()}
                                                          />
                                                        )}
                                                      </div>
                                                      {isBlind && (
                                                        <div className="pl-8" onClick={(e) => e.stopPropagation()}>
                                                          <Slider
                                                            value={[position]}
                                                            min={0}
                                                            max={100}
                                                            step={5}
                                                            onValueCommit={(v) => handleSlider(accessory.id, 'target_position', v[0])}
                                                            disabled={!accessory.isReachable || isViewOnly}
                                                            className="w-full"
                                                          />
                                                        </div>
                                                      )}
                                                    </div>
                                                    <ExpandedOverlay isExpanded={isAccessoryExpanded} onClose={collapseExpandedWidget} onMouseEnter={cancelCollapseTimeout}>
                                                      <AccessoryWidget
                                              homeName={getHomeName(accessory.homeId)}
                                                        accessory={accessory}
                                                        onToggle={handleToggle}
                                                        onSlider={handleSlider}
                                                        getEffectiveValue={getEffectiveValue}
                                                        compact={false}

                                                        onDebug={isAdmin ? () => setDebugAccessory(accessory) : undefined}
                                                        iconStyle={activeIconStyle}
                                                      />
                                                    </ExpandedOverlay>
                                                  </div>
                                                );
                                              })}
                                            </div>
                                          </CardContent>
                                        </AnimatedCollapse>
                                      </Card>
                                    </ExpandedOverlay>
                                    </div>
                                  </div>
                                  </TooltipTrigger>
                                  {(groupHomeName || groupRoomName || groupAvgChars.length > 0) && (
                                    <TooltipContent side="bottom" align="center" className="w-56 p-3">
                                      <div className="space-y-1.5">
                                        {(groupHomeName || groupRoomName) && (
                                          <div className="text-xs text-muted-foreground pb-1 mb-1 border-b">
                                            {groupHomeName && groupRoomName
                                              ? `${groupHomeName} · ${groupRoomName}`
                                              : groupHomeName || groupRoomName}
                                          </div>
                                        )}
                                        <div className="flex justify-between text-xs">
                                          <span className="text-muted-foreground">Devices</span>
                                          <span>{groupAccessories.length}</span>
                                        </div>
                                        {groupAvgChars.map((char, i) => (
                                          <div key={i} className="flex justify-between text-xs">
                                            <span className="text-muted-foreground">
                                              {formatCharacteristicType(char.type)} (avg)
                                            </span>
                                            <span>{formatCharacteristicValue(char.type, char.value)}</span>
                                          </div>
                                        ))}
                                      </div>
                                    </TooltipContent>
                                  )}
                                  </Tooltip>
                                  </TooltipProvider>
                                  </WidgetColorContext.Provider>
                                );
                              })}
                              {/* Accessories in this category */}
                              {(accessoriesByCategory[category] || []).map((accessory) => {
                                const isExpanded = compactMode && expandedWidgetId === accessory.id;
                                const isHidden = selectedHomeId ? isDeviceActuallyHidden(selectedHomeId, contextId, accessory.id) : false;
                                
                                const isCurrentlyHidden = isHidden;

                                return compactMode ? (
                                  // Compact mode: show compact widget with click-to-expand
                                  <div
                                    key={accessory.id}
                                    className={`relative 'cursor-pointer'`}
                                    style={undefined}
                                    onClick={() => handleWidgetClick(accessory.id)}
                                    onMouseLeave={isExpanded ? handleWidgetMouseLeave : undefined}
                                  >
                                    {/* Compact widget */}
                                    <AccessoryWidget
                                              homeName={getHomeName(accessory.homeId)}
                                      accessory={accessory}
                                      onToggle={handleToggle}
                                      onSlider={handleSlider}
                                      getEffectiveValue={getEffectiveValue}
                                      compact={true}
                                      
                                      onDebug={isAdmin ? () => setDebugAccessory(accessory) : undefined}
                                      iconStyle={activeIconStyle}
                                      isHidden={isHidden}

                                      onHide={() => selectedHomeId && toggleVisibility('device', 'ui', selectedHomeId, accessory.id, contextId)}
                                      hideLabel={isHidden ? 'Unhide Accessory' : 'Hide Accessory'}
                                showHiddenItems={showHiddenItems}
                                onToggleShowHidden={handleToggleShowHidden}
                                onShare={canShare ? () => accessory.homeId && setSidebarShareAccessory({ accessory, homeId: accessory.homeId }) : undefined}
                                    />
                                    {getDealBadge(accessory)}

                                    {/* Expanded widget (floating overlay) */}
                                    <ExpandedOverlay isExpanded={isExpanded} onClose={collapseExpandedWidget} onMouseEnter={cancelCollapseTimeout}>
                                      <AccessoryWidget
                                              homeName={getHomeName(accessory.homeId)}
                                        accessory={accessory}
                                        onToggle={handleToggle}
                                        onSlider={handleSlider}
                                        getEffectiveValue={getEffectiveValue}
                                        compact={false}

                                        onDebug={isAdmin ? () => setDebugAccessory(accessory) : undefined}
                                        iconStyle={activeIconStyle}
                                        isHidden={isHidden}
                                        onHide={() => selectedHomeId && toggleVisibility('device', 'ui', selectedHomeId, accessory.id, contextId)}
                                        hideLabel={isHidden ? 'Unhide Accessory' : 'Hide Accessory'}
                                showHiddenItems={showHiddenItems}
                                onToggleShowHidden={handleToggleShowHidden}
                                onShare={canShare ? () => accessory.homeId && setSidebarShareAccessory({ accessory, homeId: accessory.homeId }) : undefined}
                                      />
                                    </ExpandedOverlay>
                                  </div>
                                ) : (
                                  // Normal mode: show full widget directly
                                  <div
                                    key={accessory.id}
                                    className="relative"
                                    style={undefined}
                                  >
                                    <AccessoryWidget
                                              homeName={getHomeName(accessory.homeId)}
                                      accessory={accessory}
                                      onToggle={handleToggle}
                                      onSlider={handleSlider}
                                      getEffectiveValue={getEffectiveValue}
                                      compact={false}

                                      onDebug={isAdmin ? () => setDebugAccessory(accessory) : undefined}
                                      iconStyle={activeIconStyle}
                                      isHidden={isHidden}

                                      onHide={() => selectedHomeId && toggleVisibility('device', 'ui', selectedHomeId, accessory.id, contextId)}
                                      hideLabel={isHidden ? 'Unhide Accessory' : 'Hide Accessory'}
                                showHiddenItems={showHiddenItems}
                                onToggleShowHidden={handleToggleShowHidden}
                                onShare={canShare ? () => accessory.homeId && setSidebarShareAccessory({ accessory, homeId: accessory.homeId }) : undefined}
                                    />
                                    {getDealBadge(accessory)}
                                  </div>
                                );
                              })}
                            </MasonryGrid>
                          </div>
                        ));
                      })()}
                    </div>
                    );
                  }))
                  ; })()}
                </div>
                </div>
              )}
            </div>
            </PullToRefresh>
          </div>
        </main>
        {showAdsenseBanner && <AdBanner onUpgrade={handleUpgrade} />}
        </div>
      </div>

      {/* Debug Dialog for grouped accessories */}
      <Dialog open={!!debugAccessory} onOpenChange={(open) => !open && setDebugAccessory(null)}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-auto">
          <DialogHeader>
            <DialogTitle>Debug: {debugAccessory?.name}</DialogTitle>
            <DialogDescription className="sr-only">Debug information for accessory</DialogDescription>
          </DialogHeader>
          {debugAccessory && (
            <div className="space-y-4 text-xs font-mono">
              <Button
                variant="outline"
                size="sm"
                className="h-7 gap-1.5 text-xs"
                onClick={() => {
                  const el = document.getElementById('debug-accessory-content');
                  if (el) {
                    copyToClipboard(el.innerText);
                    setDebugCopied(true);
                    setTimeout(() => setDebugCopied(false), 2000);
                  }
                }}
              >
                {debugCopied ? <><Check className="h-3.5 w-3.5 text-green-500" /> Copied</> : <><Copy className="h-3.5 w-3.5" /> Copy All</>}
              </Button>
              <div id="debug-accessory-content" className="space-y-4">
              <div>
                <p className="font-semibold text-sm mb-1">Derived Widget Config</p>
                <pre className="bg-muted p-2 rounded overflow-auto">
{JSON.stringify((() => {
  const parseValue = (v: any) => { try { return typeof v === 'string' ? JSON.parse(v) : v; } catch { return v; } };
  const getChar = (type: string) => {
    for (const s of debugAccessory.services) {
      for (const c of s.characteristics) {
        if (c.characteristicType === type) return { value: parseValue(c.value), isWritable: c.isWritable };
      }
    }
    return null;
  };

  const activeChar = getChar('active');
  const targetTempChar = getChar('target_temperature');
  const heatingThresholdChar = getChar('heating_threshold');
  const coolingThresholdChar = getChar('cooling_threshold');
  const targetHCStateChar = getChar('target_heater_cooler_state');

  const activeValue = activeChar?.value;
  const isActive = activeValue === true || activeValue === 1 || activeValue === 'true' || activeValue === '1' || activeChar === null;

  const effectiveTargetChar =
    (targetTempChar?.isWritable ? targetTempChar : null) ||
    (heatingThresholdChar?.isWritable ? heatingThresholdChar : null) ||
    targetTempChar ||
    heatingThresholdChar;
  const effectiveTargetType = effectiveTargetChar === targetTempChar ? 'target_temperature' : 'heating_threshold';

  const sliderShouldShow = effectiveTargetChar && isActive;
  const sliderDisabled = !debugAccessory.isReachable || !effectiveTargetChar?.isWritable;

  // Capability detection (mirrors ThermostatWidget logic)
  const isHeaterCooler = debugAccessory.services.some((s: any) =>
    s.serviceType === 'heater_cooler' || s.serviceType === '000000BC-0000-1000-8000-0026BB765291'
  );
  const heatingHasValue = heatingThresholdChar?.value !== null && heatingThresholdChar?.value !== undefined;
  const coolingHasValue = coolingThresholdChar?.value !== null && coolingThresholdChar?.value !== undefined;
  const hasHeatingCapability = heatingHasValue;
  const hasCoolingCapability = coolingHasValue;

  // Active service type determination (mirrors ThermostatWidget.getActiveServiceType)
  let activeServiceType: string | null = null;
  if (isHeaterCooler) {
    if (hasHeatingCapability && !hasCoolingCapability) {
      activeServiceType = 'thermostat'; // Heat-only → orange
    } else if (hasCoolingCapability && !hasHeatingCapability) {
      activeServiceType = 'heater_cooler'; // Cool-only → blue
    } else {
      // Both capabilities
      const targetMode = targetHCStateChar?.value;
      activeServiceType = !isActive ? 'climate_balanced' :
        targetMode === 1 ? 'thermostat' :
        targetMode === 2 ? 'heater_cooler' : 'climate_balanced';
    }
  }

  const expectedColor = activeServiceType === 'thermostat' ? 'orange' :
                        activeServiceType === 'heater_cooler' ? 'blue' :
                        activeServiceType === 'climate_balanced' ? 'green' : 'N/A';

  return {
    compactMode,
    compactModeHidesSlider: compactMode,
    activeChar: activeChar ? { value: activeChar.value, type: typeof activeChar.value } : null,
    isActive,
    targetTempChar: targetTempChar ? { value: targetTempChar.value, isWritable: targetTempChar.isWritable } : null,
    heatingThresholdChar: heatingThresholdChar ? { value: heatingThresholdChar.value, isWritable: heatingThresholdChar.isWritable } : null,
    coolingThresholdChar: coolingThresholdChar ? { value: coolingThresholdChar.value, isWritable: coolingThresholdChar.isWritable } : null,
    targetHCStateChar: targetHCStateChar ? { value: targetHCStateChar.value, isWritable: targetHCStateChar.isWritable, validValues: (() => {
      // Find validValues from raw characteristic
      for (const s of debugAccessory.services) {
        for (const c of s.characteristics) {
          if (c.characteristicType === 'target_heater_cooler_state') return c.validValues;
        }
      }
      return null;
    })() } : null,
    effectiveTargetType,
    effectiveTargetValue: effectiveTargetChar?.value,
    effectiveTargetIsWritable: effectiveTargetChar?.isWritable,
    sliderShouldShow,
    sliderDisabled,
    finalVerdict: compactMode ? 'HIDDEN (compact mode)' : !sliderShouldShow ? 'HIDDEN (condition not met)' : sliderDisabled ? 'SHOWN BUT DISABLED' : 'SHOWN AND ENABLED',
    // Capability & Color Detection
    isHeaterCooler,
    hasHeatingCapability,
    hasCoolingCapability,
    activeServiceType,
    expectedColor,
  };
})(), null, 2)}
                </pre>
              </div>
              <div>
                <p className="font-semibold text-sm mb-1">Accessory Info</p>
                <pre className="bg-muted p-2 rounded overflow-auto">
{JSON.stringify({ id: debugAccessory.id, name: debugAccessory.name, category: debugAccessory.category, isReachable: debugAccessory.isReachable, roomId: debugAccessory.roomId, roomName: debugAccessory.roomName }, null, 2)}
                </pre>
              </div>
              <div>
                <p className="font-semibold text-sm mb-1">Background State</p>
                <pre className="bg-muted p-2 rounded overflow-auto">
{JSON.stringify({
  hasPageBackground: !!effectiveBackground,
  isDarkBackground,
  effectiveBackgroundType: effectiveBackground?.type || 'none',
}, null, 2)}
                </pre>
              </div>
              <div>
                <p className="font-semibold text-sm mb-1">Widget Selection</p>
                <pre className="bg-muted p-2 rounded overflow-auto">
{JSON.stringify({
  detectedPrimaryServiceType: getPrimaryServiceType(debugAccessory),
  allServiceTypes: debugAccessory.services.map(s => ({
    serviceType: s.serviceType,
    normalized: normalizeServiceType(s.serviceType),
    name: s.name,
  })),
  categoryFromAccessory: debugAccessory.category,
}, null, 2)}
                </pre>
              </div>
              <div>
                <p className="font-semibold text-sm mb-1">Services & Characteristics (Raw)</p>
                {debugAccessory.services.map((service, si) => (
                  <div key={si} className="mb-3">
                    <p className="text-muted-foreground mb-1">Service: {service.serviceType} ({service.name})</p>
                    <pre className="bg-muted p-2 rounded overflow-auto">
{JSON.stringify(service.characteristics.map(c => ({
  type: c.characteristicType,
  value: c.value,
  isWritable: c.isWritable,
  isReadable: c.isReadable,
})), null, 2)}
                    </pre>
                  </div>
                ))}
              </div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Debug Dialog for homes/rooms/collections */}
      <Dialog open={!!debugHome} onOpenChange={(open) => !open && setDebugHome(null)}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-auto">
          <DialogHeader>
            <DialogTitle>Debug: {debugHome?.data?.name} ({debugHome?.type})</DialogTitle>
            <DialogDescription className="sr-only">Debug information for {debugHome?.type}</DialogDescription>
          </DialogHeader>
          {debugHome && (
            <div className="space-y-4 text-xs font-mono">
              <Button
                variant="outline"
                size="sm"
                className="h-7 gap-1.5 text-xs"
                onClick={() => {
                  const el = document.getElementById('debug-home-content');
                  if (el) {
                    copyToClipboard(el.innerText);
                    setDebugCopied(true);
                    setTimeout(() => setDebugCopied(false), 2000);
                  }
                }}
              >
                {debugCopied ? <><Check className="h-3.5 w-3.5 text-green-500" /> Copied</> : <><Copy className="h-3.5 w-3.5" /> Copy All</>}
              </Button>
              <div id="debug-home-content" className="space-y-4">
              <div>
                <p className="font-semibold text-sm mb-1">{debugHome.type === 'home' ? 'Home' : debugHome.type === 'room' ? 'Room' : 'Collection'} Info</p>
                <pre className="bg-muted p-2 rounded overflow-auto">
{JSON.stringify(debugHome.data, null, 2)}
                </pre>
              </div>
              {debugHome.type === 'home' && (
                <>
                  <div>
                    <p className="font-semibold text-sm mb-1">Visibility Settings</p>
                    <pre className="bg-muted p-2 rounded overflow-auto">
{JSON.stringify({
  homeHidden: visibility?.ui?.hiddenHomes?.includes(debugHome.data.id) ?? false,
  hiddenRooms: visibility?.ui?.hiddenRooms?.[debugHome.data.id] || [],
  hiddenGroups: visibility?.ui?.hiddenGroups?.[debugHome.data.id] || [],
  hiddenDevices: visibility?.ui?.hiddenDevices?.[debugHome.data.id] || {},
}, null, 2)}
                    </pre>
                  </div>
                  <div>
                    <p className="font-semibold text-sm mb-1">Item Order</p>
                    <pre className="bg-muted p-2 rounded overflow-auto max-h-48">
{JSON.stringify(itemOrder[debugHome.data.id] || {}, null, 2)}
                    </pre>
                  </div>
                  <div>
                    <p className="font-semibold text-sm mb-1">Room Order</p>
                    <pre className="bg-muted p-2 rounded overflow-auto">
{JSON.stringify(roomOrderByHome[debugHome.data.id] || [], null, 2)}
                    </pre>
                  </div>
                </>
              )}
              {debugHome.type === 'room' && selectedHomeId && (
                <>
                  <div>
                    <p className="font-semibold text-sm mb-1">Visibility Settings</p>
                    <pre className="bg-muted p-2 rounded overflow-auto">
{JSON.stringify({
  roomHidden: visibility?.ui?.hiddenRooms?.[selectedHomeId]?.includes(debugHome.data.id) ?? false,
  hiddenDevicesInRoom: visibility?.ui?.hiddenDevices?.[selectedHomeId]?.[debugHome.data.id] || [],
}, null, 2)}
                    </pre>
                  </div>
                  <div>
                    <p className="font-semibold text-sm mb-1">Item Order</p>
                    <pre className="bg-muted p-2 rounded overflow-auto">
{JSON.stringify(itemOrder[selectedHomeId]?.[debugHome.data.id] || [], null, 2)}
                    </pre>
                  </div>
                </>
              )}
              {debugHome.type === 'collection' && (
                <>
                  <div>
                    <p className="font-semibold text-sm mb-1">Payload (Parsed)</p>
                    <pre className="bg-muted p-2 rounded overflow-auto max-h-64">
{JSON.stringify((() => {
  try {
    return typeof debugHome.data.payload === 'string'
      ? JSON.parse(debugHome.data.payload)
      : debugHome.data.payload;
  } catch {
    return debugHome.data.payload;
  }
})(), null, 2)}
                    </pre>
                  </div>
                </>
              )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Sidebar Group Rename Dialog */}
      <Dialog open={!!sidebarRenamingGroup} onOpenChange={(open) => !open && setSidebarRenamingGroup(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rename Group</DialogTitle>
          </DialogHeader>
          <form onSubmit={(e) => {
            e.preventDefault();
            const formData = new FormData(e.currentTarget);
            handleSidebarGroupRename(formData.get('name') as string);
          }}>
            <input
              name="name"
              type="text"
              defaultValue={sidebarRenamingGroup?.name || ''}
              className="w-full px-3 py-2 border rounded-md bg-background"
              autoFocus
            />
            <div className="flex justify-end gap-2 mt-4">
              <Button type="button" variant="outline" onClick={() => setSidebarRenamingGroup(null)}>Cancel</Button>
              <Button type="submit">Rename</Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* Sidebar Group Delete Dialog */}
      <AlertDialog open={!!sidebarDeletingGroupId} onOpenChange={(open) => !open && setSidebarDeletingGroupId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete group?</AlertDialogTitle>
            <AlertDialogDescription>
              This will delete the group. Accessories in this group will be moved to ungrouped.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleSidebarGroupDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Sidebar Collection Rename Dialog */}
      <Dialog open={!!sidebarRenamingCollection} onOpenChange={(open) => !open && setSidebarRenamingCollection(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rename Collection</DialogTitle>
          </DialogHeader>
          <form onSubmit={(e) => {
            e.preventDefault();
            const formData = new FormData(e.currentTarget);
            handleSidebarCollectionRename(formData.get('name') as string);
          }}>
            <input
              name="name"
              type="text"
              defaultValue={sidebarRenamingCollection?.name || ''}
              className="w-full px-3 py-2 border rounded-md bg-background"
              autoFocus
            />
            <div className="flex justify-end gap-2 mt-4">
              <Button type="button" variant="outline" onClick={() => setSidebarRenamingCollection(null)}>Cancel</Button>
              <Button type="submit">Rename</Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* Sidebar Collection Delete Dialog */}
      <AlertDialog open={!!sidebarDeletingCollection} onOpenChange={(open) => !open && setSidebarDeletingCollection(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete collection?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete "{sidebarDeletingCollection?.name}" and all its groups.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleSidebarCollectionDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Sidebar Collection Share Dialog */}
      {sidebarShareCollection && (
        <ShareDialog
          entityType="collection"
          entityId={sidebarShareCollection.id}
          entityName={sidebarShareCollection.name}
          open={!!sidebarShareCollection}
          onOpenChange={(open) => !open && setSidebarShareCollection(null)}
          onUpdated={() => {
            // Refresh collections if needed
          }}
          onViewAllSharedItems={() => openSettingsTo('sharing')}
          allAccessories={allAccessoriesData && sidebarShareCollection.payload ? (() => {
            const p = parseCollectionPayload(sidebarShareCollection.payload);
            const itemIds = new Set(p.items.map(i => i.accessory_id).filter(Boolean));
            return allAccessoriesData.filter(a => itemIds.has(a.id));
          })() : undefined}
          developerMode={developerMode}
        />
      )}

      {/* Sidebar Collection Group Share Dialog */}
      {sidebarShareGroup && (
        <ShareDialog
          entityType="collection_group"
          entityId={sidebarShareGroup.groupId}
          entityName={sidebarShareGroup.groupName}
          homeId={sidebarShareGroup.collectionId}
          open={!!sidebarShareGroup}
          onOpenChange={(open) => !open && setSidebarShareGroup(null)}
          onViewAllSharedItems={() => openSettingsTo('sharing')}
          allAccessories={allAccessoriesData ? (() => {
            const col = allCollections.find(c => c.id === sidebarShareGroup.collectionId);
            if (!col) return undefined;
            const p = parseCollectionPayload(col.payload);
            const itemIds = new Set(
              p.items.filter(i => i.group_id === sidebarShareGroup.groupId).map(i => i.accessory_id).filter(Boolean)
            );
            return allAccessoriesData.filter(a => itemIds.has(a.id));
          })() : undefined}
          developerMode={developerMode}
        />
      )}

      {/* Sidebar Room Share Dialog */}
      {sidebarShareRoom && (
        <ShareDialog
          entityType="room"
          entityId={sidebarShareRoom.room.id}
          entityName={sidebarShareRoom.room.name}
          homeId={sidebarShareRoom.homeId}
          open={!!sidebarShareRoom}
          onOpenChange={(open) => !open && setSidebarShareRoom(null)}
          onViewAllSharedItems={() => openSettingsTo('sharing')}
          accessoryCount={sidebarShareRoom.room.accessoryCount}
          developerMode={developerMode}
        />
      )}

      {/* Sidebar Home Share Dialog */}
      {sidebarShareHome && (
        <ShareDialog
          entityType="home"
          entityId={sidebarShareHome.id}
          entityName={sidebarShareHome.name}
          open={!!sidebarShareHome}
          onOpenChange={(open) => !open && setSidebarShareHome(null)}
          onViewAllSharedItems={() => openSettingsTo('sharing')}
          roomCount={sidebarShareHome.roomCount}
          accessoryCount={sidebarShareHome.accessoryCount}
          callerRole={(sidebarShareHome.role as any) || 'owner'}
          ownerEmail={sidebarShareHome.ownerEmail || user?.email}
          developerMode={developerMode}
        />
      )}

      {/* Sidebar Accessory Share Dialog */}
      {sidebarShareAccessory && (
        <ShareDialog
          entityType="accessory"
          entityId={sidebarShareAccessory.accessory.id}
          entityName={sidebarShareAccessory.accessory.name}
          homeId={sidebarShareAccessory.homeId}
          open={!!sidebarShareAccessory}
          onOpenChange={(open) => !open && setSidebarShareAccessory(null)}
          onViewAllSharedItems={() => openSettingsTo('sharing')}
          availableCharacteristics={sidebarShareAccessory.accessory.services?.flatMap(s => s.characteristics?.map(c => c.characteristicType) || []) || []}
          developerMode={developerMode}
        />
      )}
      {sidebarShareServiceGroup && (
        <ShareDialog
          entityType="accessory_group"
          entityId={sidebarShareServiceGroup.group.id}
          entityName={sidebarShareServiceGroup.group.name}
          homeId={sidebarShareServiceGroup.homeId}
          open={!!sidebarShareServiceGroup}
          onOpenChange={(open) => !open && setSidebarShareServiceGroup(null)}
          onViewAllSharedItems={() => openSettingsTo('sharing')}
          availableCharacteristics={sidebarShareServiceGroup.accessories.flatMap(a => a.services?.flatMap(s => s.characteristics?.map(c => c.characteristicType) || []) || [])}
          developerMode={developerMode}
        />
      )}

      {/* Create Room Group Dialog */}
      {createRoomGroupHome && (
        <CreateRoomGroupDialog
          open={createRoomGroupDialogOpen}
          onOpenChange={setCreateRoomGroupDialogOpen}
          homeId={createRoomGroupHome.id}
          homeName={createRoomGroupHome.name}
          allowedRoomIds={allowedRoomIds}
          onCreated={() => {
            // Room group created successfully
            setCreateRoomGroupDialogOpen(false);
            setCreateRoomGroupHome(null);
            refetchRoomGroups();
          }}
        />
      )}

      {/* Edit Room Group Dialog */}
      {editingRoomGroup && (
        <EditRoomGroupDialog
          open={!!editingRoomGroup}
          onOpenChange={(open) => !open && setEditingRoomGroup(null)}
          homeId={editingRoomGroup.homeId}
          groupId={editingRoomGroup.groupId}
          groupName={editingRoomGroup.groupName}
          roomIds={editingRoomGroup.roomIds}
          allowedRoomIds={allowedRoomIds}
          onUpdated={() => {
            setEditingRoomGroup(null);
            refetchRoomGroups();
          }}
        />
      )}

      {/* Sidebar Room Group Share Dialog */}
      {sidebarShareRoomGroup && (
        <ShareDialog
          entityType="room_group"
          entityId={sidebarShareRoomGroup.groupId}
          entityName={sidebarShareRoomGroup.groupName}
          homeId={sidebarShareRoomGroup.homeId}
          open={!!sidebarShareRoomGroup}
          onOpenChange={(open) => !open && setSidebarShareRoomGroup(null)}
          onViewAllSharedItems={() => openSettingsTo('sharing')}
          developerMode={developerMode}
        />
      )}

      {/* Sidebar Room Group Delete Dialog */}
      <AlertDialog open={!!sidebarDeletingRoomGroup} onOpenChange={(open) => !open && setSidebarDeletingRoomGroup(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete room group?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete "{sidebarDeletingRoomGroup?.groupName}". This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteRoomGroup} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Admin Panel Dialog - Nearly Full Screen */}
      <Dialog open={isAdminRoute && !!_cloud} onOpenChange={(open) => !open && navigate('/portal')}>
        <DialogContent
          className="!max-w-[calc(100vw-48px)] !w-[calc(100vw-48px)] p-0 flex flex-col overflow-hidden"
          style={{
            zIndex: 10010,
            height: 'calc(100vh - 48px - var(--safe-area-top, 0px) - var(--safe-area-bottom, 0px))',
            maxHeight: 'calc(100vh - 48px - var(--safe-area-top, 0px) - var(--safe-area-bottom, 0px))',
          }}
          hideCloseButton
        >
          <DialogTitle className="sr-only">Admin Panel</DialogTitle>
          <div className="flex h-full selectable">
            {/* Admin Sidebar - desktop only */}
            {!isMobile && <AdminSidebar />}
            {/* Admin Content */}
            <div className="flex flex-1 flex-col overflow-hidden min-h-0">
              {isMobile && (
                <>
                  <Sheet open={adminSidebarOpen} onOpenChange={setAdminSidebarOpen}>
                    <SheetContent side="left" className="w-64 p-0 safe-area-top safe-area-bottom safe-area-left selectable" style={{ zIndex: 10020 }}>
                      <SheetTitle className="sr-only">Admin Navigation</SheetTitle>
                      <AdminSidebar onNavigate={() => setAdminSidebarOpen(false)} />
                    </SheetContent>
                  </Sheet>
                  <div className="flex items-center gap-3 border-b border-border px-4 py-3">
                    <Button variant="ghost" size="icon" onClick={() => setAdminSidebarOpen(true)}>
                      <Menu className="h-5 w-5" />
                    </Button>
                    <span className="text-sm font-semibold flex-1">Admin</span>
                    <Button variant="ghost" size="icon" onClick={() => navigate('/portal')}>
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                </>
              )}
              <main className={cn("flex-1 min-h-0 overflow-auto", isMobile ? "p-1" : "p-6")}>
                {adminSubPath === '/' && <AdminDashboard />}
                {adminSubPath.startsWith('/analytics') && <AdminAnalytics />}
                {adminSubPath === '/users' && <AdminUsers />}
                {adminSubPath.startsWith('/users/') && (
                  <UserDetail userId={adminSubPath.replace('/users/', '')} />
                )}
                {adminSubPath === '/sessions' && <AdminSessions />}
                {adminSubPath === '/enrollments' && <AdminEnrollments />}
                {adminSubPath === '/webhooks' && <AdminWebhooks />}

                {adminSubPath === '/deals' && <AdminDeals />}
                {adminSubPath === '/deals/homekit' && <AdminHomeKit />}
                {adminSubPath === '/deals/devices' && <AdminDevices />}
                {adminSubPath === '/deals/listings' && <AdminListings />}
                {adminSubPath === '/deals/active' && <AdminActiveDeals />}
                {adminSubPath === '/tasks' && <AdminTasks />}
                {adminSubPath === '/approvals' && <AdminApprovals />}
                {(adminSubPath === '/traces' || adminSubPath === '/observability') && <AdminObservability />}
                {adminSubPath === '/reliability' && AdminReliability && <AdminReliability />}
                {adminSubPath === '/infrastructure' && AdminInfrastructure && <AdminInfrastructure />}
                {adminSubPath === '/infrastructure/pods' && AdminInfrastructurePods && <AdminInfrastructurePods />}
                {adminSubPath.startsWith('/infrastructure/pods/') && AdminInfrastructurePodDetail && (
                  <AdminInfrastructurePodDetail podName={adminSubPath.replace('/infrastructure/pods/', '')} />
                )}
                {adminSubPath === '/infrastructure/mqtt' && AdminInfrastructureMqtt && <AdminInfrastructureMqtt />}
                {adminSubPath === '/infrastructure/database' && AdminInfrastructureDatabase && <AdminInfrastructureDatabase />}
                {adminSubPath === '/logs' && <AdminLogs />}
                {adminSubPath === '/debug' && (
                  <AdminDebugInfo
                    backgroundSettings={activeBackground}
                    isDarkBackground={isDarkBackground}
                  />
                )}
                {adminSubPath === '/debug/relay' && <AdminDebug tab="relay" />}
                {adminSubPath === '/debug/console' && <AdminDebug tab="console" />}
                {adminSubPath === '/debug/stats' && <AdminDebug tab="stats" />}
                {adminSubPath === '/debug/subscribers' && <AdminDebug tab="subscribers" />}
                {adminSubPath === '/debug/metrics' && <AdminMetrics />}
              </main>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Background Settings Dialog */}
      <BackgroundSettingsDialog
        open={backgroundSettingsOpen}
        onOpenChange={setBackgroundSettingsOpen}
        currentSettings={
          backgroundSettingsTarget?.type === 'room'
            ? bgTargetRoomLayout?.background
            : backgroundSettingsTarget?.type === 'home'
            ? bgTargetHomeLayout?.background
            : backgroundSettingsTarget?.type === 'collection'
            ? bgTargetCollectionLayout?.background
            : backgroundSettingsTarget?.type === 'collectionGroup'
            ? bgTargetGroupLayout?.background
            : backgroundSettingsTarget?.type === 'roomGroup'
            ? bgTargetRoomGroupLayout?.background
            : undefined
        }
        onSave={handleSaveBackgroundSettings}
        onSaveToAllHomes={homes.length > 1 ? handleSaveBackgroundToAllHomes : undefined}
        onSaveToAllRooms={rooms.length > 1 ? handleSaveBackgroundToAllRooms : undefined}
        onSaveToAllCollections={allCollections.length > 1 ? handleSaveBackgroundToAllCollections : undefined}
        onSaveToAllGroups={collectionPayload.groups?.length > 1 ? handleSaveBackgroundToAllGroups : undefined}
        entityName={backgroundSettingsTarget?.name}
        entityType={backgroundSettingsTarget?.type === 'collectionGroup' || backgroundSettingsTarget?.type === 'roomGroup' ? 'roomGroup' : backgroundSettingsTarget?.type}
        autoBackgroundsEnabled={autoBackgrounds}
        entityId={backgroundSettingsTarget?.id}
      />

      {/* Accessory Selection Dialog (free plan) */}
      <AccessorySelectionDialog
        open={accessorySelectionOpen}
        onSave={handleAccessorySelectionSave}
        limit={accessoryLimit || 10}
        allAccessories={allUnfilteredAccessories.length > 0 ? allUnfilteredAccessories : (allAccessoriesData || [])}
        homes={homes}
        initialSelection={includedAccessoryIds}
        initialServiceGroupSelection={includedServiceGroupIds}
        onCancel={handleCloseAccessorySelection}
        serviceGroups={allServiceGroupsData || []}
      />

      {/* Onboarding Overlay */}
      {showOnboarding && (
        <OnboardingOverlay
          isInMacApp={isInMacApp}
          isInMobileApp={isInMobileApp}
          onComplete={handleOnboardingComplete}
          onUpgradeStandard={handleUpgrade}
          userEmail={user?.email || ''}
          onInvalidateHomes={invalidateHomeKitCache}
          cloudSignupsAvailable={cloudSignupsAvailable}
        />
      )}

      {/* Tutorial Walkthrough */}
      <TutorialDialog
        open={showTutorial}
        onOpenChange={(open) => { if (!open) handleTutorialComplete(); }}
        onComplete={handleTutorialComplete}
      />
        </div>{/* close main container */}
    {/* Loading overlay */}
    <div className={cn(
      "fixed inset-0 z-[99999] flex items-center justify-center backdrop-blur-sm bg-black/20 transition-opacity duration-300",
      isConnectingOverlay ? "opacity-100" : "opacity-0 pointer-events-none"
    )}>
      <div className="flex flex-col items-center gap-4">
        <Loader2 className="h-8 w-8 animate-spin text-white" />
        <p className="text-white/80 text-sm">{isManualRefreshing ? 'Refreshing...' : 'Connecting...'}</p>
        <Button variant="ghost" size="sm" className="bg-white/10 text-white/60 hover:text-white hover:bg-white/20 mt-2" onClick={() => window.location.reload()}>
          <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
          Refresh page
        </Button>
      </div>
    </div>
    {/* Hard reload countdown */}
    {hardReloadCountdown !== null && (
      <div className="fixed inset-0 z-[100000] flex items-center justify-center bg-black/50 backdrop-blur-sm animate-in fade-in duration-200">
        <div className="bg-background border rounded-xl shadow-2xl p-6 mx-4 max-w-xs w-full text-center space-y-4">
          <RotateCcw className="h-8 w-8 text-primary mx-auto" />
          <div>
            <p className="font-semibold text-base">Hard Refresh</p>
            <p className="text-muted-foreground text-sm mt-1">Clearing cache and reloading in</p>
          </div>
          <p className="text-4xl font-bold tabular-nums text-primary">{hardReloadCountdown}</p>
          <Button variant="outline" className="w-full" onClick={cancelHardReload}>Cancel</Button>
        </div>
      </div>
    )}
    </BackgroundContext.Provider>
    </DealsProvider>
  );
};

export default Dashboard;
