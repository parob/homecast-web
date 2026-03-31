import { useMemo, useCallback } from 'react';
import { useQuery, useMutation, useApolloClient } from '@apollo/client/react';
import { GET_STORED_ENTITY_LAYOUT } from '@/lib/graphql/queries';
import { UPDATE_STORED_ENTITY_LAYOUT } from '@/lib/graphql/mutations';
import type {
  GetStoredEntityLayoutResponse,
  UpdateStoredEntityLayoutResponse,
  BackgroundSettings,
} from '@/lib/graphql/types';

/**
 * Hook to get and update entity layout configuration.
 *
 * @param entityType - Type of entity ('home', 'room', 'collection', 'collection_group')
 * @param entityId - ID of the entity
 * @returns Layout data and setter function
 */
export function useEntityLayout<T extends object>(
  entityType: string,
  entityId: string | null | undefined
) {
  const client = useApolloClient();

  const { data, loading, refetch } = useQuery<GetStoredEntityLayoutResponse>(
    GET_STORED_ENTITY_LAYOUT,
    {
      variables: { entityType, entityId },
      skip: !entityId,
      fetchPolicy: 'cache-first', // Use cache to prevent repeated network calls
      nextFetchPolicy: 'cache-first',
    }
  );

  const [updateLayoutMutation] = useMutation<UpdateStoredEntityLayoutResponse>(
    UPDATE_STORED_ENTITY_LAYOUT
  );

  // Helper to update cache for a specific entity
  const updateCache = useCallback((targetEntityType: string, targetEntityId: string, newLayoutJson: string) => {
    // Read existing cache data to preserve fields like id, parentId, dataJson
    let existingData: any = null;
    try {
      existingData = client.readQuery({
        query: GET_STORED_ENTITY_LAYOUT,
        variables: { entityType: targetEntityType, entityId: targetEntityId },
      });
    } catch {
      // No existing data in cache
    }

    client.writeQuery({
      query: GET_STORED_ENTITY_LAYOUT,
      variables: { entityType: targetEntityType, entityId: targetEntityId },
      data: {
        storedEntityLayout: {
          __typename: 'StoredEntityLayout',
          id: existingData?.storedEntityLayout?.id || `temp-${targetEntityType}-${targetEntityId}`,
          entityType: targetEntityType,
          entityId: targetEntityId,
          parentId: existingData?.storedEntityLayout?.parentId || null,
          dataJson: existingData?.storedEntityLayout?.dataJson || null,
          layoutJson: newLayoutJson,
          updatedAt: new Date().toISOString(),
        }
      }
    });
  }, [client]);

  // Use the raw JSON string as dependency to ensure re-parsing when it changes
  const layoutJson = data?.storedEntityLayout?.layoutJson;

  const layout = useMemo((): T | null => {
    if (!layoutJson) return null;
    try {
      return JSON.parse(layoutJson) as T;
    } catch {
      return null;
    }
  }, [layoutJson]);

  const setLayout = useCallback(async (newLayout: T) => {
    if (!entityId) return;
    const newLayoutJson = JSON.stringify(newLayout);
    // Update cache first for instant UI update (optimistic)
    updateCache(entityType, entityId, newLayoutJson);
    // Then persist to server
    await updateLayoutMutation({
      variables: {
        entityType,
        entityId,
        layoutJson: newLayoutJson
      }
    });
  }, [entityType, entityId, updateLayoutMutation, updateCache]);

  const updateLayout = useCallback(async (updater: (prev: T | null) => T) => {
    if (!entityId) return;
    const newLayout = updater(layout);
    await setLayout(newLayout);
  }, [entityId, layout, setLayout]);

  // Save layout for a specific entity (useful when the ID might differ from the hook's entityId)
  const saveLayoutForEntity = useCallback(async (targetEntityId: string, newLayout: T) => {
    const newLayoutJson = JSON.stringify(newLayout);
    // Update cache first for instant UI update (optimistic)
    updateCache(entityType, targetEntityId, newLayoutJson);
    // Then persist to server
    await updateLayoutMutation({
      variables: {
        entityType,
        entityId: targetEntityId,
        layoutJson: newLayoutJson
      }
    });
  }, [entityType, updateLayoutMutation, updateCache]);

  return {
    layout,
    layoutJson, // Raw JSON string for dependency tracking
    loading,
    setLayout,
    updateLayout,
    saveLayoutForEntity,
    refetch,
  };
}

// Shared layout data type with background support
export interface HomeLayoutData {
  roomOrder?: string[];
  visibility?: { hiddenRooms?: string[] };
  background?: BackgroundSettings;
}

export interface RoomLayoutData {
  itemOrder?: string[];
  visibility?: { hiddenGroups?: string[]; hiddenAccessories?: string[] };
  expandedGroups?: string[];
  background?: BackgroundSettings;
}

export interface CollectionLayoutData {
  compactMode?: boolean;
  iconStyle?: string;
  background?: BackgroundSettings;
}

export interface CollectionGroupLayoutData {
  background?: BackgroundSettings;
  iconStyle?: string;
}

/**
 * Hook for home layout with typed interface.
 */
export function useHomeLayout(homeId: string | null | undefined) {
  return useEntityLayout<HomeLayoutData>('home', homeId);
}

/**
 * Hook for room layout with typed interface.
 */
export function useRoomLayout(roomId: string | null | undefined) {
  return useEntityLayout<RoomLayoutData>('room', roomId);
}

/**
 * Hook for collection layout with typed interface.
 */
export function useCollectionLayout(collectionId: string | null | undefined) {
  return useEntityLayout<CollectionLayoutData>('collection', collectionId);
}

/**
 * Hook for collection group layout with typed interface.
 */
export function useCollectionGroupLayout(groupId: string | null | undefined) {
  return useEntityLayout<CollectionGroupLayoutData>('collection_group', groupId);
}

export interface RoomGroupLayoutData {
  roomOrder?: string[];
  background?: BackgroundSettings;
}

/**
 * Hook for room group layout with typed interface.
 */
export function useRoomGroupLayout(groupId: string | null | undefined) {
  return useEntityLayout<RoomGroupLayoutData>('room_group', groupId);
}
