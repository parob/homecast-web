import { useState, useMemo, useCallback, useRef, memo } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Check,
  Search,
  Loader2,
  Lightbulb,
  Power,
  Plug,
  Fan,
  Thermometer,
  Lock,
  DoorClosed,
  Activity,
  Video,
  Bell,
  Speaker,
  Droplets,
  Droplet,
  Wind,
  Shield,
  Blinds,
  CircleDot,
  Warehouse,
  Sun,
  AlertTriangle,
  Disc,
  Flower2,
  Users,
  type LucideIcon,
} from 'lucide-react';
import { getPrimaryServiceType } from '@/components/widgets';
import { getDisplayName } from '@/lib/graphql/types';
import type { HomeKitAccessory, HomeKitHome, HomeKitServiceGroup } from '@/lib/graphql/types';
import { createFuse, fuseSearch } from '@/lib/fuzzySearch';

// Map service types to icons
const SERVICE_TYPE_ICONS: Record<string, LucideIcon> = {
  lightbulb: Lightbulb,
  switch: Power,
  outlet: Plug,
  thermostat: Thermometer,
  heater_cooler: Thermometer,
  fan: Fan,
  air_purifier: Wind,
  humidifier_dehumidifier: Droplets,
  lock: Lock,
  security_system: Shield,
  door: DoorClosed,
  window: DoorClosed,
  window_covering: Blinds,
  garage_door: Warehouse,
  contact_sensor: DoorClosed,
  motion_sensor: Activity,
  occupancy_sensor: Activity,
  temperature_sensor: Thermometer,
  humidity_sensor: Droplets,
  light_sensor: Sun,
  smoke_sensor: AlertTriangle,
  carbon_monoxide_sensor: Wind,
  carbon_dioxide_sensor: Wind,
  leak_sensor: Droplet,
  air_quality_sensor: Wind,
  speaker: Speaker,
  smart_speaker: Speaker,
  microphone: Speaker,
  camera: Video,
  doorbell: Bell,
  valve: Droplets,
  faucet: Droplets,
  irrigation_system: Flower2,
  stateless_programmable_switch: Disc,
};

export function getAccessoryIcon(accessory: { services?: Array<{ serviceType: string }> }): LucideIcon {
  const serviceType = getPrimaryServiceType(accessory as any);
  if (serviceType && SERVICE_TYPE_ICONS[serviceType]) {
    return SERVICE_TYPE_ICONS[serviceType];
  }
  return CircleDot;
}

// Category display order
const CATEGORY_ORDER = [
  'Lights', 'Switches', 'Climate', 'Fans', 'Blinds & Shades',
  'Security', 'Doors', 'Sensors', 'Cameras', 'Audio',
  'Water', 'Buttons & Remotes', 'Bridges & Hubs', 'Other'
];

function getAccessoryCategory(accessory: HomeKitAccessory): string {
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
}

// --- Memoized row components ---

const ROW_HEIGHT = 44;

const AccessoryRow = memo(function AccessoryRow({
  accessory,
  isSelected,
  isDisabled,
  icon: Icon,
  displayName,
  homeName,
  onToggle,
}: {
  accessory: HomeKitAccessory;
  isSelected: boolean;
  isDisabled: boolean;
  icon: LucideIcon;
  displayName: string;
  homeName?: string;
  onToggle: (id: string) => void;
}) {
  return (
    <button
      onClick={() => !isDisabled && onToggle(accessory.id)}
      disabled={isDisabled}
      className={`w-full flex items-center gap-3 pl-4 pr-3 py-1.5 rounded-md text-left text-sm transition-colors ${isDisabled ? 'opacity-40 cursor-not-allowed' : 'hover:bg-muted'}`}
    >
      <div className={`h-4 w-4 rounded border flex items-center justify-center shrink-0 ${isSelected ? 'bg-primary border-primary' : 'border-muted-foreground'}`}>
        {isSelected && <Check className="h-3 w-3 text-primary-foreground" />}
      </div>
      <Icon className="h-4 w-4 text-muted-foreground shrink-0" />
      <div className="flex-1 min-w-0">
        <div className="truncate">{displayName}</div>
        <div className="text-xs text-muted-foreground truncate">
          {homeName && `${homeName} · `}
          {accessory.roomName}
          {accessory.category && ` · ${accessory.category}`}
        </div>
      </div>
    </button>
  );
});

const ServiceGroupRow = memo(function ServiceGroupRow({
  group,
  isSelected,
  isDisabled,
  homeName,
  onToggle,
}: {
  group: HomeKitServiceGroup;
  isSelected: boolean;
  isDisabled: boolean;
  homeName?: string;
  onToggle: (id: string) => void;
}) {
  return (
    <button
      onClick={() => !isDisabled && onToggle(group.id)}
      disabled={isDisabled}
      className={`w-full flex items-center gap-3 pl-4 pr-3 py-1.5 rounded-md text-left text-sm transition-colors ${isDisabled ? 'opacity-40 cursor-not-allowed' : 'hover:bg-muted'}`}
    >
      <div className={`h-4 w-4 rounded border flex items-center justify-center shrink-0 ${isSelected ? 'bg-primary border-primary' : 'border-muted-foreground'}`}>
        {isSelected && <Check className="h-3 w-3 text-primary-foreground" />}
      </div>
      <Users className="h-4 w-4 text-muted-foreground shrink-0" />
      <div className="flex-1 min-w-0">
        <div className="truncate">{group.name}</div>
        <div className="text-xs text-muted-foreground truncate">
          {homeName && `${homeName} · `}
          {group.accessoryIds.length} accessories · Group
        </div>
      </div>
    </button>
  );
});

// --- Main component ---

export interface AccessoryPickerProps {
  accessories: HomeKitAccessory[];
  homes: HomeKitHome[];
  selectedIds: Set<string>;
  onToggle: (accessoryId: string) => void;
  limit?: number;
  usedSlots?: number;
  loading?: boolean;
  serviceGroups?: HomeKitServiceGroup[];
  selectedServiceGroupIds?: Set<string>;
  onToggleServiceGroup?: (groupId: string) => void;
  serviceGroupHomeMap?: Map<string, string>;
}

export function AccessoryPicker({
  accessories,
  homes,
  selectedIds,
  onToggle,
  limit,
  usedSlots,
  loading,
  serviceGroups = [],
  selectedServiceGroupIds,
  onToggleServiceGroup,
  serviceGroupHomeMap,
}: AccessoryPickerProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [filterHome, setFilterHome] = useState<string>('all');
  const [filterRoom, setFilterRoom] = useState<string>('all');
  const [filterType, setFilterType] = useState<string>('all');

  // Home name lookup (used for filtering and display)
  const homeNameMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const home of homes) {
      map.set(home.id, home.name);
    }
    return map;
  }, [homes]);
  const getHomeName = useCallback((homeId?: string) => homeId ? homeNameMap.get(homeId) : undefined, [homeNameMap]);

  // Reset room filter when home changes
  const handleHomeChange = (value: string) => {
    setFilterHome(value);
    setFilterRoom('all');
  };

  // Get unique rooms for selected home
  const availableRooms = useMemo(() => {
    const roomMap = new Map<string, string>();
    for (const acc of accessories) {
      if (acc.roomId && acc.roomName) {
        if (filterHome === 'all' || acc.homeId === filterHome) {
          roomMap.set(acc.roomId, acc.roomName);
        }
      }
    }
    return Array.from(roomMap.entries()).map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
  }, [accessories, filterHome]);

  // Get unique types/categories
  const availableTypes = useMemo(() => {
    const types = new Set<string>();
    for (const acc of accessories) {
      types.add(getAccessoryCategory(acc));
    }
    return Array.from(types).sort((a, b) => {
      const aIdx = CATEGORY_ORDER.indexOf(a);
      const bIdx = CATEGORY_ORDER.indexOf(b);
      return aIdx - bIdx;
    });
  }, [accessories]);

  // Filter accessories by dropdown criteria, then fuzzy text search
  const dropdownFiltered = useMemo(() => {
    return accessories.filter(a => {
      if (filterHome !== 'all' && a.homeId !== filterHome) return false;
      if (filterRoom !== 'all' && a.roomId !== filterRoom) return false;
      if (filterType !== 'all' && getAccessoryCategory(a) !== filterType) return false;
      return true;
    });
  }, [accessories, filterHome, filterRoom, filterType]);

  const searchableAccessories = useMemo(() =>
    dropdownFiltered.map(a => ({
      ...a,
      _searchText: `${a.name} ${a.roomName || ''} ${getHomeName(a.homeId) || ''}`,
    })),
    [dropdownFiltered, getHomeName]
  );

  const accessoryFuse = useMemo(
    () => createFuse(searchableAccessories, ['_searchText']),
    [searchableAccessories]
  );

  const filteredAccessories = useMemo(() => {
    if (!searchQuery) return dropdownFiltered;
    return fuseSearch(accessoryFuse, searchQuery);
  }, [accessoryFuse, searchQuery, dropdownFiltered]);

  // Filter service groups (fuzzy text search)
  const searchableGroups = useMemo(() =>
    serviceGroups.map(group => {
      const groupHomeId = serviceGroupHomeMap?.get(group.id) || '';
      const homeName = getHomeName(groupHomeId) || '';
      return { ...group, _searchText: `${group.name} ${homeName}` };
    }),
    [serviceGroups, serviceGroupHomeMap, getHomeName]
  );

  const groupFuse = useMemo(
    () => createFuse(searchableGroups, ['_searchText']),
    [searchableGroups]
  );

  // Build a set of accessory IDs in the selected room (for room-filtering service groups)
  const accessoryIdsInRoom = useMemo(() => {
    if (filterRoom === 'all') return null;
    const ids = new Set<string>();
    for (const acc of accessories) {
      if (acc.roomId === filterRoom) ids.add(acc.id);
    }
    return ids;
  }, [accessories, filterRoom]);

  const filteredServiceGroups = useMemo(() => {
    let groups = searchQuery ? fuseSearch(groupFuse, searchQuery) : serviceGroups;
    // Hide empty service groups
    groups = groups.filter(g => g.accessoryIds.length > 0);
    // Apply home filter
    if (filterHome !== 'all' && serviceGroupHomeMap) {
      groups = groups.filter(g => serviceGroupHomeMap.get(g.id) === filterHome);
    }
    // Apply room filter — only show groups with at least one member in the selected room
    if (accessoryIdsInRoom) {
      groups = groups.filter(g => g.accessoryIds.some(id => accessoryIdsInRoom.has(id)));
    }
    return groups;
  }, [groupFuse, searchQuery, serviceGroups, filterHome, serviceGroupHomeMap, accessoryIdsInRoom]);

  // Exclude accessories that belong to any service group (they're selectable only via the group row)
  const groupedAccessoryIds = useMemo(() => {
    const ids = new Set<string>();
    for (const group of serviceGroups) {
      for (const id of group.accessoryIds) ids.add(id);
    }
    return ids;
  }, [serviceGroups]);

  const dedupedAccessories = useMemo(() => {
    return filteredAccessories.filter(acc => !groupedAccessoryIds.has(acc.id));
  }, [filteredAccessories, groupedAccessoryIds]);

  const limitReached = limit !== undefined && (usedSlots ?? selectedIds.size) >= limit;

  // Pre-compute icons and display names (stable unless accessories change)
  const accessoryMeta = useMemo(() => {
    const map = new Map<string, { icon: LucideIcon; displayName: string }>();
    for (const acc of accessories) {
      map.set(acc.id, {
        icon: getAccessoryIcon(acc),
        displayName: getDisplayName(acc.name, acc.roomName),
      });
    }
    return map;
  }, [accessories]);

  // Combine service groups + accessories into a single virtual list
  type VirtualItem = { type: 'group'; data: HomeKitServiceGroup } | { type: 'accessory'; data: HomeKitAccessory };
  const virtualItems = useMemo<VirtualItem[]>(() => {
    const items: VirtualItem[] = [];
    for (const group of filteredServiceGroups) {
      items.push({ type: 'group', data: group });
    }
    for (const accessory of dedupedAccessories) {
      items.push({ type: 'accessory', data: accessory });
    }
    return items;
  }, [filteredServiceGroups, dedupedAccessories]);

  const scrollRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: virtualItems.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 5,
  });

  const handleGroupToggle = useCallback((id: string) => {
    onToggleServiceGroup?.(id);
  }, [onToggleServiceGroup]);

  return (
    <div className="flex flex-col min-h-0 overflow-hidden">
      <div className="space-y-3 border-b shrink-0">
        <div className="relative px-3 pr-[48px] pt-3">
          <Search className="absolute left-[22px] top-[22px] h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search accessories..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-8 h-9"
            autoFocus={false}
          />
        </div>
        <div className="flex gap-2 px-3 pb-3">
          <Select value={filterHome} onValueChange={handleHomeChange}>
            <SelectTrigger className="h-8 text-xs flex-1">
              <SelectValue placeholder="All Homes" />
            </SelectTrigger>
            <SelectContent style={{ zIndex: 10100 }}>
              <SelectItem value="all">All Homes</SelectItem>
              {homes.map(home => (
                <SelectItem key={home.id} value={home.id}>{home.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={filterRoom} onValueChange={setFilterRoom} disabled={filterHome === 'all'}>
            <SelectTrigger className="h-8 text-xs flex-1">
              <SelectValue placeholder="All Rooms" />
            </SelectTrigger>
            <SelectContent style={{ zIndex: 10100 }}>
              <SelectItem value="all">All Rooms</SelectItem>
              {availableRooms.map(room => (
                <SelectItem key={room.id} value={room.id}>{room.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={filterType} onValueChange={setFilterType}>
            <SelectTrigger className="h-8 text-xs flex-1">
              <SelectValue placeholder="All Types" />
            </SelectTrigger>
            <SelectContent style={{ zIndex: 10100 }}>
              <SelectItem value="all">All Types</SelectItem>
              {availableTypes.map(type => (
                <SelectItem key={type} value={type}>{type}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-scroll scrollable-content">
        {loading ? (
          <div className="p-4 flex items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : virtualItems.length === 0 ? (
          <div className="p-4 text-center text-sm text-muted-foreground">
            No accessories found
          </div>
        ) : (
          <div className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
            {virtualizer.getVirtualItems().map((vItem) => {
              const item = virtualItems[vItem.index];
              if (item.type === 'group') {
                const group = item.data;
                const isSelected = selectedServiceGroupIds?.has(group.id) ?? false;
                const groupHomeId = serviceGroupHomeMap?.get(group.id) || '';
                const homeName = homeNameMap.get(groupHomeId);
                return (
                  <div
                    key={`group-${group.id}`}
                    style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: ROW_HEIGHT, transform: `translateY(${vItem.start}px)` }}
                  >
                    <ServiceGroupRow
                      group={group}
                      isSelected={isSelected}
                      isDisabled={!isSelected && limitReached}
                      homeName={homeName}
                      onToggle={handleGroupToggle}
                    />
                  </div>
                );
              }
              const accessory = item.data;
              const isSelected = selectedIds.has(accessory.id);
              const isDisabled = !isSelected && limitReached;
              const meta = accessoryMeta.get(accessory.id);
              return (
                <div
                  key={accessory.id}
                  style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: ROW_HEIGHT, transform: `translateY(${vItem.start}px)` }}
                >
                  <AccessoryRow
                    accessory={accessory}
                    isSelected={isSelected}
                    isDisabled={isDisabled}
                    icon={meta?.icon ?? CircleDot}
                    displayName={meta?.displayName ?? accessory.name}
                    homeName={homeNameMap.get(accessory.homeId || '')}
                    onToggle={onToggle}
                  />
                </div>
              );
            })}
          </div>
        )}
      </div>
      <div className="p-2 border-t text-xs text-muted-foreground text-center shrink-0">
        {filteredServiceGroups.length > 0 && `${filteredServiceGroups.length} groups · `}
        {dedupedAccessories.length} accessories
        {limit !== undefined
          ? ` · ${usedSlots ?? selectedIds.size} / ${limit} selected${limitReached ? ' · Maximum reached' : ''}`
          : (selectedIds.size > 0 || (selectedServiceGroupIds?.size ?? 0) > 0)
            ? ` · ${selectedIds.size + (selectedServiceGroupIds?.size ?? 0)} selected`
            : ''
        }
      </div>
    </div>
  );
}
