import { useEffect, useRef } from 'react';
import { useMutation } from '@apollo/client/react';
import { SYNC_ENTITIES } from '@/lib/graphql/mutations';
import type { HomeKitHome, HomeKitRoom, SyncEntitiesResponse } from '@/lib/graphql/types';

// Track synced entities across the session (module-level to persist across re-renders)
const syncedHomes = new Set<string>();
const syncedRooms = new Set<string>();

/**
 * Hook to sync home and room data from device to backend on dashboard load.
 * This ensures the backend has the latest entity data for layout storage.
 * Only syncs new/unseen entities to avoid unnecessary network requests.
 */
export function useEntitySync(
  homes: HomeKitHome[] | null | undefined,
  rooms: HomeKitRoom[] | null | undefined,
  homeId?: string | null
) {
  const [syncEntities] = useMutation<SyncEntitiesResponse>(SYNC_ENTITIES);
  const isSyncing = useRef(false);

  useEffect(() => {
    // Don't sync if no data yet or already syncing
    if (!homes || homes.length === 0 || isSyncing.current) return;

    // Find homes that haven't been synced yet
    const newHomes = homes.filter(h => !syncedHomes.has(h.id));

    // Find rooms that haven't been synced yet (only if we have rooms and a homeId)
    const newRooms = rooms && homeId
      ? rooms.filter(r => !syncedRooms.has(`${homeId}:${r.id}`))
      : [];

    // Nothing to sync
    if (newHomes.length === 0 && newRooms.length === 0) return;

    // Mark as syncing
    isSyncing.current = true;

    // Build entity list for sync (only new entities)
    const entities = [
      // Sync new homes
      ...newHomes.map(home => ({
        entityType: 'home',
        entityId: home.id,
        dataJson: JSON.stringify({ name: home.name })
      })),
      // Sync new rooms (with parent homeId)
      ...newRooms.map(room => ({
        entityType: 'room',
        entityId: room.id,
        parentId: homeId,
        dataJson: JSON.stringify({ name: room.name, homeId })
      }))
    ];

    // Perform sync
    syncEntities({ variables: { entities } })
      .then(() => {
        // Mark entities as synced
        newHomes.forEach(h => syncedHomes.add(h.id));
        newRooms.forEach(r => syncedRooms.add(`${homeId}:${r.id}`));
      })
      .catch(err => {
        console.error('Failed to sync entities:', err);
      })
      .finally(() => {
        isSyncing.current = false;
      });
  }, [homes, rooms, homeId, syncEntities]);
}
