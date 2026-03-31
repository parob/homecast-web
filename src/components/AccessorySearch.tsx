import { useState, useEffect, useMemo, useDeferredValue, useRef, useCallback } from 'react';
import { Search } from 'lucide-react';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { AccessoryWidget, ServiceGroupWidget } from '@/components/widgets';
import { ExpandedOverlay } from '@/components/shared/ExpandedOverlay';
import { BackgroundContext } from '@/contexts/BackgroundContext';
import type { HomeKitAccessory, HomeKitHome, HomeKitServiceGroup } from '@/lib/graphql/types';
import type { IconStyle } from '@/components/widgets/iconColors';
import { createFuse, fuseSearchScored } from '@/lib/fuzzySearch';

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

interface AccessorySearchProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  accessories: HomeKitAccessory[];
  homes: HomeKitHome[];
  serviceGroups: HomeKitServiceGroup[];
  onToggle: (accessoryId: string, characteristicType: string, currentValue: boolean) => void;
  onSlider: (accessoryId: string, characteristicType: string, value: number) => void;
  getEffectiveValue: (accessoryId: string, characteristicType: string, serverValue: any) => any;
  onGroupToggle: (groupId: string, checked: boolean, homeId?: string) => void;
  onGroupSlider: (groupId: string, characteristicType: string, value: number, homeId?: string) => void;
  onNavigate: (homeId: string, roomId?: string) => void;
  iconStyle?: IconStyle;
  disabled?: boolean;
  initialKey?: string;
  selectedHomeId?: string | null;
  selectedRoomName?: string | null;
  collectionItemIds?: Set<string> | null;
}

export function AccessorySearch({
  open,
  onOpenChange,
  accessories,
  homes,
  serviceGroups,
  onToggle,
  onSlider,
  getEffectiveValue,
  onGroupToggle,
  onGroupSlider,
  onNavigate,
  iconStyle,
  disabled,
  initialKey,
  selectedHomeId: selectedHomeIdProp,
  selectedRoomName,
  collectionItemIds,
}: AccessorySearchProps) {
  const [search, setSearch] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  // Seed with initial key when opening via auto-type, reset when closing
  useEffect(() => {
    if (open && initialKey) {
      setSearch(initialKey);
    } else if (!open) {
      setSearch('');
    }
  }, [open, initialKey]);

  // Click-to-expand (same pattern as Dashboard compact mode)
  const [expandedWidgetId, setExpandedWidgetId] = useState<string | null>(null);
  const collapseTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const handleWidgetClick = useCallback((widgetId: string) => {
    setExpandedWidgetId(prev => prev === widgetId ? null : widgetId);
  }, []);

  const handleWidgetMouseLeave = useCallback(() => {
    collapseTimeoutRef.current = setTimeout(() => {
      setExpandedWidgetId(null);
    }, 300);
  }, []);

  const cancelCollapseTimeout = useCallback(() => {
    if (collapseTimeoutRef.current) {
      clearTimeout(collapseTimeoutRef.current);
      collapseTimeoutRef.current = null;
    }
  }, []);

  const collapseExpandedWidget = useCallback(() => {
    cancelCollapseTimeout();
    setExpandedWidgetId(null);
  }, [cancelCollapseTimeout]);

  // Collapse when search changes
  useEffect(() => {
    setExpandedWidgetId(null);
  }, [search]);

  // Auto-focus the input when dialog opens
  useEffect(() => {
    if (open) {
      // Small delay to let the dialog animate in
      const timer = setTimeout(() => inputRef.current?.focus(), 50);
      return () => clearTimeout(timer);
    }
  }, [open]);


  // Home name lookup (case-insensitive keys to handle ID casing mismatches)
  const homeNameMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const home of homes) map.set(home.id.toUpperCase(), home.name);
    return map;
  }, [homes]);
  const getHomeName = (homeId: string | undefined) => homeNameMap.get((homeId || '').toUpperCase()) || '';
  const selectedHomeName = selectedHomeIdProp ? getHomeName(selectedHomeIdProp) : null;

  // Accessory lookup by ID (case-insensitive) — must be before filteredGroups which depends on it
  const accessoryMap = useMemo(() => {
    const map = new Map<string, HomeKitAccessory>();
    for (const acc of accessories) map.set(acc.id.toUpperCase(), acc);
    return map;
  }, [accessories]);

  // Get accessories for a service group
  const getGroupAccessories = (group: HomeKitServiceGroup) => {
    return group.accessoryIds.map(id => accessoryMap.get(id.toUpperCase())).filter((a): a is HomeKitAccessory => !!a);
  };

  // Get first accessory for a service group
  const getGroupFirstAccessory = (group: HomeKitServiceGroup) => {
    for (const id of group.accessoryIds) {
      const acc = accessoryMap.get(id.toUpperCase());
      if (acc) return acc;
    }
    return undefined;
  };

  // Get category for a service group (based on first accessory)
  const getGroupCategory = (group: HomeKitServiceGroup): string => {
    const firstAcc = getGroupFirstAccessory(group);
    if (!firstAcc) return 'Other';
    return getAccessoryCategory(firstAcc);
  };

  // Defer the search value so filtering/rendering doesn't block the input
  const deferredSearch = useDeferredValue(search);
  const hasSearch = deferredSearch.trim().length > 0;

  // Build searchable accessories with home name for fuzzy search
  const searchableAccessories = useMemo(() =>
    accessories.map(acc => ({
      ...acc,
      _searchText: `${acc.name} ${acc.roomName || ''} ${getHomeName(acc.homeId)}`,
    })),
    [accessories, homeNameMap]
  );

  const accessoryFuse = useMemo(
    () => createFuse(searchableAccessories, ['_searchText']),
    [searchableAccessories]
  );

  // Filter accessories (fuzzy, score-aware)
  const scoredAccessories = useMemo(() => {
    if (!hasSearch) return [];
    return fuseSearchScored(accessoryFuse, deferredSearch, 0.3);
  }, [accessoryFuse, deferredSearch, hasSearch]);

  const accessoryScoreMap = useMemo(() => {
    const map = new Map<string, number>();
    for (const { item, score } of scoredAccessories) map.set(item.id, score);
    return map;
  }, [scoredAccessories]);

  const filteredAccessories = useMemo(() => scoredAccessories.map(r => r.item), [scoredAccessories]);

  // Build searchable service groups with room/home name for fuzzy search
  const searchableGroups = useMemo(() =>
    serviceGroups.map(group => {
      const firstAcc = getGroupFirstAccessory(group);
      const homeName = firstAcc ? getHomeName(firstAcc.homeId) : '';
      const roomName = firstAcc?.roomName || '';
      return { ...group, _searchText: `${group.name} ${roomName} ${homeName}` };
    }),
    [serviceGroups, accessoryMap, homeNameMap]
  );

  const groupFuse = useMemo(
    () => createFuse(searchableGroups, ['_searchText']),
    [searchableGroups]
  );

  // Filter service groups (fuzzy, score-aware)
  const scoredGroups = useMemo(() => {
    if (!hasSearch) return [];
    return fuseSearchScored(groupFuse, deferredSearch, 0.3).filter(
      r => getGroupFirstAccessory(r.item) !== undefined
    );
  }, [groupFuse, deferredSearch, hasSearch]);

  const groupScoreMap = useMemo(() => {
    const map = new Map<string, number>();
    for (const { item, score } of scoredGroups) map.set(item.id, score);
    return map;
  }, [scoredGroups]);

  const filteredGroups = useMemo(() => scoredGroups.map(r => r.item), [scoredGroups]);

  // Exclude accessories that belong to matched groups (they're shown via the group widget)
  const matchedGroupAccessoryIds = useMemo(() => {
    const ids = new Set<string>();
    for (const group of filteredGroups) {
      for (const id of group.accessoryIds) ids.add(id);
    }
    return ids;
  }, [filteredGroups]);

  const dedupedAccessories = useMemo(() => {
    return filteredAccessories.filter(acc => !matchedGroupAccessoryIds.has(acc.id));
  }, [filteredAccessories, matchedGroupAccessoryIds]);

  // Group results: Home → Room → Category (using homeName directly to avoid ID mismatch)
  type CategoryBucket = { name: string; accessories: HomeKitAccessory[]; groups: HomeKitServiceGroup[] };
  type RoomBucket = { name: string; categories: CategoryBucket[] };
  type HomeBucket = { name: string; rooms: RoomBucket[] };

  const grouped = useMemo(() => {
    // Nest: homeName → roomName → category → items
    const tree: Record<string, Record<string, { accs: Record<string, HomeKitAccessory[]>; grps: Record<string, HomeKitServiceGroup[]> }>> = {};

    const ensureBucket = (homeName: string, roomName: string) => {
      (tree[homeName] ??= {})[roomName] ??= { accs: {}, grps: {} };
      return tree[homeName][roomName];
    };

    for (const acc of dedupedAccessories) {
      const bucket = ensureBucket(getHomeName(acc.homeId), acc.roomName || '');
      const cat = getAccessoryCategory(acc);
      (bucket.accs[cat] ??= []).push(acc);
    }

    for (const group of filteredGroups) {
      const firstAcc = getGroupFirstAccessory(group);
      const homeName = getHomeName(firstAcc?.homeId);
      const roomName = firstAcc?.roomName || '';
      const bucket = ensureBucket(homeName, roomName);
      const cat = getGroupCategory(group);
      (bucket.grps[cat] ??= []).push(group);
    }

    // Check if any matched item in a room bucket belongs to the collection
    const roomHasCollectionItem = (
      bucket: { accs: Record<string, HomeKitAccessory[]>; grps: Record<string, HomeKitServiceGroup[]> },
      ids: Set<string>
    ) => {
      for (const cat of Object.keys(bucket.accs)) {
        if (bucket.accs[cat].some(a => ids.has(a.id))) return true;
      }
      for (const cat of Object.keys(bucket.grps)) {
        if (bucket.grps[cat].some(g => ids.has(g.id))) return true;
      }
      return false;
    };

    // Best match score for a home bucket (lower = better match)
    const bestScoreForHome = (homeName: string): number => {
      let best = 1;
      for (const room of Object.values(tree[homeName])) {
        for (const accs of Object.values(room.accs)) {
          for (const a of accs) {
            const s = accessoryScoreMap.get(a.id);
            if (s !== undefined && s < best) best = s;
          }
        }
        for (const grps of Object.values(room.grps)) {
          for (const g of grps) {
            const s = groupScoreMap.get(g.id);
            if (s !== undefined && s < best) best = s;
          }
        }
      }
      return best;
    };

    // Flatten into ordered structure — prioritize selected context, then best match score
    const homeNames = Object.keys(tree).sort((a, b) => {
      if (selectedHomeName) {
        if (a === selectedHomeName && b !== selectedHomeName) return -1;
        if (b === selectedHomeName && a !== selectedHomeName) return 1;
      }
      if (collectionItemIds && collectionItemIds.size > 0) {
        const aHas = Object.values(tree[a]).some(rm => roomHasCollectionItem(rm, collectionItemIds));
        const bHas = Object.values(tree[b]).some(rm => roomHasCollectionItem(rm, collectionItemIds));
        if (aHas && !bHas) return -1;
        if (bHas && !aHas) return 1;
      }
      const aScore = bestScoreForHome(a);
      const bScore = bestScoreForHome(b);
      if (aScore !== bScore) return aScore - bScore;
      return a.localeCompare(b);
    });

    return homeNames.map(homeName => {
      const roomMap = tree[homeName];
      const roomNames = Object.keys(roomMap).sort((a, b) => {
        if (selectedRoomName && homeName === selectedHomeName) {
          if (a === selectedRoomName && b !== selectedRoomName) return -1;
          if (b === selectedRoomName && a !== selectedRoomName) return 1;
        }
        if (collectionItemIds && collectionItemIds.size > 0) {
          const aHas = roomHasCollectionItem(roomMap[a], collectionItemIds);
          const bHas = roomHasCollectionItem(roomMap[b], collectionItemIds);
          if (aHas && !bHas) return -1;
          if (bHas && !aHas) return 1;
        }
        return a.localeCompare(b);
      });
      return {
        name: homeName,
        rooms: roomNames.map(roomName => {
          const { accs, grps } = roomMap[roomName];
          const cats = CATEGORY_ORDER.filter(cat => accs[cat] || grps[cat]).map(cat => ({
            name: cat,
            accessories: (accs[cat] || []).sort((a, b) =>
              (accessoryScoreMap.get(a.id) ?? 1) - (accessoryScoreMap.get(b.id) ?? 1)
            ),
            groups: (grps[cat] || []).sort((a, b) =>
              (groupScoreMap.get(a.id) ?? 1) - (groupScoreMap.get(b.id) ?? 1)
            ),
          }));
          return { name: roomName, categories: cats };
        }),
      } as HomeBucket;
    });
  }, [dedupedAccessories, filteredGroups, homeNameMap, accessories, selectedHomeName, selectedRoomName, collectionItemIds, accessoryScoreMap, groupScoreMap]);

  const totalResults = dedupedAccessories.length + filteredGroups.length;

  const lightBg = useMemo(() => ({ hasBackground: false, isDarkBackground: false }), []);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="flex flex-col gap-0 p-0 overflow-hidden transition-all duration-200 !rounded-[30px]"
        style={{ maxWidth: totalResults > 0 ? '75vw' : '40rem' }}
        hideCloseButton
      >
        <DialogTitle className="sr-only">Search Accessories</DialogTitle>

        {/* Search input */}
        <div className={`flex items-center px-5 py-3 ${hasSearch ? 'border-b' : ''}`}>
          <Search className="h-4 w-4 mr-3 text-muted-foreground shrink-0" />
          <Input
            ref={inputRef}
            placeholder="Search accessories..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="border-0 px-0 py-1 h-auto shadow-none !ring-0 !ring-offset-0 !outline-none !text-lg"
          />
        </div>

        {/* Results - only rendered when there's a search query */}
        {hasSearch && (
          totalResults === 0 ? (
            <div className="px-4 pb-4 text-sm text-muted-foreground text-center">
              No results found
            </div>
          ) : (
            <BackgroundContext.Provider value={lightBg}>
              <div className="overflow-y-auto px-4 pb-4 max-h-[60vh]">
                <div className="space-y-5">
                  {grouped.map(home => (
                    <div key={home.name}>
                      <div className="space-y-4">
                        {home.rooms.map(room => (
                          <div key={room.name}>
                            {(home.name || room.name) && (
                              <div className="sticky top-0 z-10 py-1">
                                <span className="inline-flex items-baseline gap-1.5 px-3 py-1 rounded-full bg-muted">
                                  {home.name && <span className="text-sm font-semibold">{home.name}</span>}
                                  {room.name && <span className="text-xs font-medium text-muted-foreground">{room.name}</span>}
                                </span>
                              </div>
                            )}
                            <div className="space-y-3">
                              {room.categories.map(({ name: catName, accessories: catAccessories, groups: catGroups }) => (
                                <div key={catName}>
                                  {room.categories.length > 1 && (
                                    <div className="text-[11px] font-medium text-muted-foreground/60 mb-1.5 px-1">{catName}</div>
                                  )}
                                  <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
                                    {catGroups.map(group => {
                                      const groupAccessories = getGroupAccessories(group);
                                      return (
                                        <ServiceGroupWidget
                                          key={group.id}
                                          group={group}
                                          accessories={groupAccessories}
                                          compact
                                          onToggle={(checked) => onGroupToggle(group.id, checked, group.homeId)}
                                          onSlider={(charType, value) => onGroupSlider(group.id, charType, value, group.homeId)}
                                          onAccessoryToggle={onToggle}
                                          onAccessorySlider={onSlider}
                                          getEffectiveValue={getEffectiveValue}
                                          iconStyle={iconStyle}
                                          disabled={disabled}
                                        />
                                      );
                                    })}
                                    {catAccessories.map(acc => {
                                      const isExpanded = expandedWidgetId === acc.id;
                                      return (
                                        <div
                                          key={acc.id}
                                          className="relative cursor-pointer"
                                          onClick={() => handleWidgetClick(acc.id)}
                                          onMouseLeave={isExpanded ? handleWidgetMouseLeave : undefined}
                                        >
                                          <AccessoryWidget
                                            accessory={acc}
                                            onToggle={onToggle}
                                            onSlider={onSlider}
                                            getEffectiveValue={getEffectiveValue}
                                            compact
                                            iconStyle={iconStyle}
                                            disabled={disabled}
                                          />
                                          <ExpandedOverlay isExpanded={isExpanded} onClose={collapseExpandedWidget} onMouseEnter={cancelCollapseTimeout}>
                                            <AccessoryWidget
                                              accessory={acc}
                                              onToggle={onToggle}
                                              onSlider={onSlider}
                                              getEffectiveValue={getEffectiveValue}
                                              expanded
                                              iconStyle={iconStyle}
                                              disabled={disabled}
                                            />
                                          </ExpandedOverlay>
                                        </div>
                                      );
                                    })}
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </BackgroundContext.Provider>
          )
        )}
      </DialogContent>
    </Dialog>
  );
}
