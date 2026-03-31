/**
 * Menu Bar Bridge - Exposes control functions for native Mac menu bar.
 *
 * The Mac app's MenuBarPlugin calls these functions via JavaScript injection
 * to control HomeKit devices. By routing through serverConnection.request(),
 * we ensure WebSocket events are properly broadcast to all connected clients.
 */

import { serverConnection } from '../server/connection';
import { apolloClient } from '../lib/apollo';
import { resolveWidgetType } from '../components/widgets/resolve-widget-type';
import type { ResolveWidgetTypeResult } from '../components/widgets/resolve-widget-type';
import { GET_SETTINGS, GET_COLLECTIONS, GET_STORED_ENTITY_LAYOUT, GET_ROOM_GROUPS } from '../lib/graphql/queries';
import type {
  GetSettingsResponse,
  GetCollectionsResponse,
  GetStoredEntityLayoutResponse,
  UserSettingsData,
  HomeLayoutData,
  RoomLayoutData,
  StoredEntity,
  RoomGroupData,
} from '../lib/graphql/types';

// Track which entities have been prefetched to avoid redundant requests
const prefetchedEntities = new Set<string>();

/**
 * Prefetch entity layouts for menu bar.
 * Fetches layouts from server and populates Apollo cache.
 */
async function prefetchEntityLayouts(homeIds: string[], roomIds: string[]): Promise<void> {
  const fetchPromises: Promise<unknown>[] = [];

  // Prefetch home layouts
  for (const homeId of homeIds) {
    const key = `home:${homeId}`;
    if (!prefetchedEntities.has(key)) {
      prefetchedEntities.add(key);
      fetchPromises.push(
        apolloClient.query<GetStoredEntityLayoutResponse>({
          query: GET_STORED_ENTITY_LAYOUT,
          variables: { entityType: 'home', entityId: homeId },
          fetchPolicy: 'network-only',
        }).catch(() => {
          // Remove from prefetched so we can retry later
          prefetchedEntities.delete(key);
        })
      );
    }
  }

  // Prefetch room layouts
  for (const roomId of roomIds) {
    const key = `room:${roomId}`;
    if (!prefetchedEntities.has(key)) {
      prefetchedEntities.add(key);
      fetchPromises.push(
        apolloClient.query<GetStoredEntityLayoutResponse>({
          query: GET_STORED_ENTITY_LAYOUT,
          variables: { entityType: 'room', entityId: roomId },
          fetchPolicy: 'network-only',
        }).catch(() => {
          // Remove from prefetched so we can retry later
          prefetchedEntities.delete(key);
        })
      );
    }
  }

  // Prefetch room groups for each home
  for (const homeId of homeIds) {
    const key = `roomGroups:${homeId}`;
    if (!prefetchedEntities.has(key)) {
      prefetchedEntities.add(key);
      fetchPromises.push(
        apolloClient.query<{ roomGroups: StoredEntity[] }>({
          query: GET_ROOM_GROUPS,
          variables: { homeId },
          fetchPolicy: 'network-only',
        }).catch(() => {
          prefetchedEntities.delete(key);
        })
      );
    }
  }

  // Also ensure settings are fetched
  if (!prefetchedEntities.has('settings')) {
    prefetchedEntities.add('settings');
    fetchPromises.push(
      apolloClient.query<GetSettingsResponse>({
        query: GET_SETTINGS,
        fetchPolicy: 'network-only',
      }).catch(() => {
        prefetchedEntities.delete('settings');
      })
    );
  }

  if (fetchPromises.length > 0) {
    console.log(`[MenuBarBridge] Prefetching ${fetchPromises.length} layouts for menu bar...`);
    await Promise.all(fetchPromises);
    console.log(`[MenuBarBridge] Prefetch complete`);
  }
}

/**
 * Settings structure exposed to native menu bar.
 * Contains visibility, ordering, and collections data.
 */
export interface MenuBarSettings {
  // Visibility
  hiddenHomes: string[];
  // Ordering
  homeOrder: string[];
  // Per-home layouts (visibility + ordering)
  homeLayouts: Record<string, {
    hiddenRooms: string[];
    roomOrder: string[];
  }>;
  // Per-room layouts (visibility + ordering)
  roomLayouts: Record<string, {
    hiddenAccessories: string[];
    hiddenGroups: string[];
    itemOrder: string[];
  }>;
  // Room groups per home
  roomGroups: Record<string, Array<{
    id: string;
    entityId: string;
    name: string;
    roomIds: string[];
  }>>;
  // Collections
  collections: Array<{
    id: string;
    name: string;
    items: Array<{
      homeId: string;
      accessoryId?: string;
      serviceGroupId?: string;
      groupId?: string;
    }>;
    groups: Array<{
      id: string;
      name: string;
    }>;
  }>;
  // Collection item ordering
  collectionItemOrder: Record<string, string[]>;
}

export interface MenuBarControlAPI {
  setCharacteristic: (
    accessoryId: string,
    characteristicType: string,
    value: unknown
  ) => Promise<{ success: boolean; accessoryId: string; characteristicType: string; value: unknown }>;
  setServiceGroupCharacteristic: (
    groupId: string,
    characteristicType: string,
    value: unknown,
    homeId?: string
  ) => Promise<{ success: boolean; groupId: string; successCount: number }>;
  executeScene: (sceneId: string) => Promise<{ success: boolean; sceneId: string }>;
  getMenuBarSettings: (homeIds: string[], roomIds: string[]) => MenuBarSettings;
  prefetchMenuBarData: (homeIds: string[], roomIds: string[]) => Promise<void>;
  // Widget type resolution (called by Swift menu bar to match web app widget types)
  resolveWidgetTypes: (accessories: Array<{
    id: string;
    category?: string;
    serviceTypes: string[];
  }>) => Record<string, ResolveWidgetTypeResult>;
  // Relay connection status (for menu bar icon badge)
  getRelayConnectionStatus: () => {
    connectionState: 'disconnected' | 'connecting' | 'connected' | 'reconnecting';
    relayStatus: boolean | null;
  };
  // Notification handlers for direct HomeKit control
  notifyChange: (accessoryId: string, characteristicType: string, value: unknown) => void;
  notifyGroupChange: (groupId: string, homeId: string, characteristicType: string, value: unknown) => void;
  notifySceneExecuted: (sceneId: string) => void;
}

declare global {
  interface Window {
    menuBarControl?: MenuBarControlAPI;
  }
}

/**
 * Set up the menu bar control bridge.
 * Exposes window.menuBarControl for the native Mac menu bar to call.
 */
export function setupMenuBarBridge(): void {
  window.menuBarControl = {
    /**
     * Set a characteristic value on an accessory.
     * Routes through serverConnection to ensure WebSocket event broadcast.
     */
    setCharacteristic: async (
      accessoryId: string,
      characteristicType: string,
      value: unknown
    ) => {
      console.log(`[MenuBarBridge] setCharacteristic: ${accessoryId}, ${characteristicType}, ${value}`);
      try {
        const result = await serverConnection.request<{
          success: boolean;
          accessoryId: string;
          characteristicType: string;
          value: unknown;
        }>('characteristic.set', { accessoryId, characteristicType, value });
        console.log(`[MenuBarBridge] setCharacteristic result:`, result);
        return result;
      } catch (error) {
        console.error(`[MenuBarBridge] setCharacteristic failed:`, error);
        throw error;
      }
    },

    /**
     * Set a characteristic value on all accessories in a service group.
     * Routes through serverConnection to ensure WebSocket event broadcast.
     */
    setServiceGroupCharacteristic: async (
      groupId: string,
      characteristicType: string,
      value: unknown,
      homeId?: string
    ) => {
      console.log(`[MenuBarBridge] setServiceGroupCharacteristic: ${groupId}, ${characteristicType}, ${value}`);
      try {
        const result = await serverConnection.request<{
          success: boolean;
          groupId: string;
          successCount: number;
        }>('serviceGroup.set', { groupId, characteristicType, value, ...(homeId && { homeId }) });
        console.log(`[MenuBarBridge] setServiceGroupCharacteristic result:`, result);
        return result;
      } catch (error) {
        console.error(`[MenuBarBridge] setServiceGroupCharacteristic failed:`, error);
        throw error;
      }
    },

    /**
     * Execute a HomeKit scene.
     * Routes through serverConnection to ensure WebSocket event broadcast.
     */
    executeScene: async (sceneId: string) => {
      console.log(`[MenuBarBridge] executeScene: ${sceneId}`);
      try {
        const result = await serverConnection.request<{
          success: boolean;
          sceneId: string;
        }>('scene.execute', { sceneId });
        console.log(`[MenuBarBridge] executeScene result:`, result);
        return result;
      } catch (error) {
        console.error(`[MenuBarBridge] executeScene failed:`, error);
        throw error;
      }
    },

    /**
     * Prefetch layout data for the native menu bar.
     * Call this before getMenuBarSettings to ensure data is in cache.
     */
    prefetchMenuBarData: async (homeIds: string[], roomIds: string[]) => {
      console.log(`[MenuBarBridge] prefetchMenuBarData called with ${homeIds.length} homes, ${roomIds.length} rooms`);
      await prefetchEntityLayouts(homeIds, roomIds);
    },

    /**
     * Get settings for the native menu bar.
     * Returns visibility settings, item ordering, and collections from Apollo cache.
     * Triggers async prefetch for any missing data (will be available on subsequent calls).
     * @param homeIds - Array of home IDs to fetch layouts for
     * @param roomIds - Array of room IDs to fetch layouts for
     */
    getMenuBarSettings: (homeIds: string[], roomIds: string[]): MenuBarSettings => {
      console.log(`[MenuBarBridge] getMenuBarSettings called with ${homeIds.length} homes, ${roomIds.length} rooms`);

      const result: MenuBarSettings = {
        hiddenHomes: [],
        homeOrder: [],
        homeLayouts: {},
        roomLayouts: {},
        roomGroups: {},
        collections: [],
        collectionItemOrder: {},
      };

      // Track which entities are missing from cache so we can prefetch them
      const missingHomeIds: string[] = [];
      const missingRoomIds: string[] = [];
      let settingsMissing = false;

      try {
        // Read user settings from cache
        const settingsData = apolloClient.readQuery<GetSettingsResponse>({
          query: GET_SETTINGS,
        });

        if (settingsData?.settings?.data) {
          const settings: UserSettingsData = JSON.parse(settingsData.settings.data);

          // Extract visibility and ordering from settings
          result.hiddenHomes = settings.visibility?.ui?.hiddenHomes ?? [];
          result.homeOrder = settings.homeOrder ?? [];
          result.collectionItemOrder = settings.collectionItemOrder ?? {};
        } else {
          settingsMissing = true;
        }

        // Read home layouts from cache
        for (const homeId of homeIds) {
          try {
            const homeLayoutData = apolloClient.readQuery<{
              storedEntityLayout: { layoutJson: string } | null;
            }>({
              query: GET_STORED_ENTITY_LAYOUT,
              variables: { entityType: 'home', entityId: homeId },
            });

            if (homeLayoutData?.storedEntityLayout?.layoutJson) {
              const layout: HomeLayoutData = JSON.parse(homeLayoutData.storedEntityLayout.layoutJson);
              result.homeLayouts[homeId] = {
                hiddenRooms: layout.visibility?.hiddenRooms ?? [],
                roomOrder: layout.roomOrder ?? [],
              };
            } else {
              missingHomeIds.push(homeId);
            }
          } catch {
            // Layout not in cache
            missingHomeIds.push(homeId);
          }
        }

        // Read room layouts from cache
        for (const roomId of roomIds) {
          try {
            const roomLayoutData = apolloClient.readQuery<{
              storedEntityLayout: { layoutJson: string } | null;
            }>({
              query: GET_STORED_ENTITY_LAYOUT,
              variables: { entityType: 'room', entityId: roomId },
            });

            if (roomLayoutData?.storedEntityLayout?.layoutJson) {
              const layout: RoomLayoutData = JSON.parse(roomLayoutData.storedEntityLayout.layoutJson);
              result.roomLayouts[roomId] = {
                hiddenAccessories: layout.visibility?.hiddenAccessories ?? [],
                hiddenGroups: layout.visibility?.hiddenGroups ?? [],
                itemOrder: layout.itemOrder ?? [],
              };
            } else {
              missingRoomIds.push(roomId);
            }
          } catch {
            // Layout not in cache
            missingRoomIds.push(roomId);
          }
        }

        // Read room groups from cache for each home
        for (const homeId of homeIds) {
          try {
            const roomGroupsData = apolloClient.readQuery<{ roomGroups: StoredEntity[] }>({
              query: GET_ROOM_GROUPS,
              variables: { homeId },
            });

            if (roomGroupsData?.roomGroups) {
              result.roomGroups[homeId] = roomGroupsData.roomGroups.map((entity) => {
                const data: RoomGroupData = entity.dataJson ? JSON.parse(entity.dataJson) : { name: 'Room Group', roomIds: [] };
                return {
                  id: entity.id,
                  entityId: entity.entityId,
                  name: data.name,
                  roomIds: data.roomIds,
                };
              });
            }
          } catch {
            // Room groups not in cache
          }
        }

        // Trigger async prefetch for any missing data
        // This ensures subsequent calls will have the data
        if (settingsMissing || missingHomeIds.length > 0 || missingRoomIds.length > 0) {
          console.log(`[MenuBarBridge] Cache miss - settings: ${settingsMissing}, homes: ${missingHomeIds.length}, rooms: ${missingRoomIds.length}`);
          // Reset prefetch tracking for missing items so they get fetched
          if (settingsMissing) prefetchedEntities.delete('settings');
          missingHomeIds.forEach(id => prefetchedEntities.delete(`home:${id}`));
          missingRoomIds.forEach(id => prefetchedEntities.delete(`room:${id}`));
          // Trigger async prefetch (fire and forget)
          prefetchEntityLayouts(homeIds, roomIds).catch(console.error);
        }

        // Read collections from cache
        try {
          const collectionsData = apolloClient.readQuery<GetCollectionsResponse>({
            query: GET_COLLECTIONS,
          });

          if (collectionsData?.collections) {
            result.collections = collectionsData.collections.map((collection) => {
              // Parse the payload JSON
              let items: MenuBarSettings['collections'][0]['items'] = [];
              let groups: MenuBarSettings['collections'][0]['groups'] = [];

              try {
                const payload = JSON.parse(collection.payload);
                // Handle both old array format and new object format
                if (Array.isArray(payload)) {
                  items = payload.map((item: { home_id: string; accessory_id?: string; service_group_id?: string }) => ({
                    homeId: item.home_id,
                    accessoryId: item.accessory_id,
                    serviceGroupId: item.service_group_id,
                  }));
                } else {
                  items = (payload.items || []).map((item: { home_id: string; accessory_id?: string; service_group_id?: string; group_id?: string }) => ({
                    homeId: item.home_id,
                    accessoryId: item.accessory_id,
                    serviceGroupId: item.service_group_id,
                    groupId: item.group_id,
                  }));
                  groups = (payload.groups || []).map((g: { id: string; name: string }) => ({
                    id: g.id,
                    name: g.name,
                  }));
                }
              } catch {
                // Invalid payload, use empty arrays
              }

              return {
                id: collection.id,
                name: collection.name,
                items,
                groups,
              };
            });
          }
        } catch {
          // Collections not in cache
        }

        console.log(`[MenuBarBridge] getMenuBarSettings result:`, {
          hiddenHomes: result.hiddenHomes.length,
          homeOrder: result.homeOrder.length,
          homeLayouts: Object.keys(result.homeLayouts).length,
          roomLayouts: Object.keys(result.roomLayouts).length,
          roomGroups: Object.keys(result.roomGroups).length,
          collections: result.collections.length,
        });

        return result;
      } catch (error) {
        console.error(`[MenuBarBridge] getMenuBarSettings failed:`, error);
        return result;
      }
    },

    /**
     * Resolve widget types for a batch of accessories.
     * Pure computation — synchronous, no async needed.
     * Returns { accessoryId → { widgetType, sensorType?, deviceType? } }.
     */
    resolveWidgetTypes: (accessories) => {
      const result: Record<string, ResolveWidgetTypeResult> = {};
      for (const acc of accessories) {
        result[acc.id] = resolveWidgetType({
          category: acc.category,
          serviceTypes: acc.serviceTypes,
        });
      }
      return result;
    },

    /**
     * Get current relay connection status (for menu bar icon badge).
     */
    getRelayConnectionStatus: () => {
      const state = serverConnection.getState();
      return {
        connectionState: state.connectionState,
        relayStatus: state.relayStatus,
      };
    },

    /**
     * Notify WebView of a characteristic change from direct HomeKit control.
     * Triggers a cache invalidation to refresh data.
     */
    notifyChange: (accessoryId: string, characteristicType: string, value: unknown) => {
      console.log(`[MenuBarBridge] notifyChange: ${accessoryId}, ${characteristicType}, ${value}`);
      // Trigger a cache refresh to pick up the change
      // The HomeKit relay will send the characteristic.updated event which updates the UI
    },

    /**
     * Notify WebView of a service group change from direct HomeKit control.
     * Triggers a cache invalidation to refresh data.
     */
    notifyGroupChange: (groupId: string, homeId: string, characteristicType: string, value: unknown) => {
      console.log(`[MenuBarBridge] notifyGroupChange: ${groupId}, ${homeId}, ${characteristicType}, ${value}`);
      // The HomeKit changes will be broadcast via the normal relay event flow
      // when HomeKit notifies us of the changes
    },

    /**
     * Notify WebView of a scene execution from direct HomeKit control.
     */
    notifySceneExecuted: (sceneId: string) => {
      console.log(`[MenuBarBridge] notifySceneExecuted: ${sceneId}`);
      // Scene execution will trigger characteristic updates via the relay
    },
  };

  // Push relay status changes to native Mac app for menu bar icon updates
  const win = window as Window & {
    webkit?: { messageHandlers?: { homecast?: { postMessage: (msg: unknown) => void } } };
    isHomecastMacApp?: boolean;
  };
  if (win.isHomecastMacApp && win.webkit?.messageHandlers?.homecast) {
    const handler = win.webkit.messageHandlers.homecast;
    serverConnection.subscribe((state) => {
      handler.postMessage({
        action: 'relayStatus',
        connectionState: state.connectionState,
        relayStatus: state.relayStatus,
      });
    });
  }

  console.log('[MenuBarBridge] Menu bar control bridge initialized');
}

export default setupMenuBarBridge;
