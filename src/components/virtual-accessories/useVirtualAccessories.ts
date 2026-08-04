import { useCallback, useEffect, useMemo, useState } from 'react';
import { useQuery, useMutation } from '@apollo/client/react';
import { toast } from 'sonner';
import { serverConnection } from '@/server/connection';
import { VIRTUAL_ACCESSORIES } from '@/lib/graphql/queries';
import { SAVE_VIRTUAL_ACCESSORY, DELETE_VIRTUAL_ACCESSORY } from '@/lib/graphql/mutations';
import { invalidateHomeKitCache } from '@/hooks/useHomeKitData';
import { isCreatableVirtualType } from '@/automation/virtual-accessories/catalogue';
import type { VirtualAccessoryDefinition, VirtualOperation } from '@/automation/types/automation';

/** How often to re-read live values while helper accessories are on screen. */
const STATE_POLL_MS = 10_000;

interface StoredHelperEntity {
  entityId: string;
  dataJson: string;
  updatedAt: string;
}

/**
 * Parse stored rows into definitions.
 *
 * A row whose type the engine can't run is dropped rather than rendered — it
 * would be a tile with a control that does nothing. That can only happen if the
 * helper was created by a newer build, so it's a forwards-compatibility guard.
 */
function parseHelpers(entities: StoredHelperEntity[]): VirtualAccessoryDefinition[] {
  const out: VirtualAccessoryDefinition[] = [];
  for (const e of entities) {
    try {
      const parsed = JSON.parse(e.dataJson) as VirtualAccessoryDefinition;
      if (!parsed?.type || !isCreatableVirtualType(parsed.type)) continue;
      out.push({ ...parsed, id: parsed.id || e.entityId });
    } catch {
      // A row we can't read is not a row we can safely show a control for.
    }
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Everything the dashboard needs to show and operate helper accessories.
 *
 * One hook rather than per-surface wiring: helper accessories now appear in the
 * room grid, in the home-level folder, and from four different create menus. If
 * each owned its own query and mutations they would hold different ideas of the
 * same helper's value, and a change made in one place would leave the others
 * showing the old one until something happened to refetch.
 */
export function useVirtualAccessories(homeId: string | null, options: { active?: boolean } = {}) {
  const active = options.active ?? true;
  const [states, setStates] = useState<Record<string, unknown>>({});
  /** Null while unknown; false once we know the engine isn't reachable. */
  const [engineLive, setEngineLive] = useState<boolean | null>(null);

  const { data, refetch } = useQuery<{ virtualAccessories: StoredHelperEntity[] }>(VIRTUAL_ACCESSORIES, {
    variables: { homeId },
    skip: !homeId,
    fetchPolicy: 'cache-first',
    errorPolicy: 'all',
  });

  const [saveMutation] = useMutation(SAVE_VIRTUAL_ACCESSORY);
  const [deleteMutation] = useMutation(DELETE_VIRTUAL_ACCESSORY);

  /**
   * Virtual accessories are published through `accessories.list`, so the tiles
   * on screen come from the HomeKit data cache — not from this query. Refetching
   * here alone updated the definitions and left the cache holding the old list:
   * a new accessory didn't appear, a deleted one didn't go away, and a moved one
   * stayed in its old room until the page was reloaded.
   *
   * Safe to do the moment a mutation resolves: the server acknowledges the
   * relay's `virtual_sync`/`virtual_unload` before returning, so by then the
   * relay is already answering `accessories.list` with the new set.
   */
  const refreshAccessories = useCallback(() => {
    invalidateHomeKitCache('accessories', { prefix: true });
  }, []);

  const helpers = useMemo(() => parseHelpers(data?.virtualAccessories ?? []), [data]);

  /** roomId → helpers. The home-level folder is keyed by the empty string. */
  const byRoom = useMemo(() => {
    const map = new Map<string, VirtualAccessoryDefinition[]>();
    for (const h of helpers) {
      const key = h.roomId ?? '';
      const list = map.get(key);
      if (list) list.push(h); else map.set(key, [h]);
    }
    return map;
  }, [helpers]);

  const refreshStates = useCallback(async () => {
    try {
      // homeId is required for ROUTING, not for filtering. Without it the
      // server falls back to resolving the relay from the caller's user id,
      // which finds nothing for a cloud-managed customer — the relay belongs to
      // the operator's service account, not to them. The request then fails and
      // the dashboard concludes the engine is unreachable, disabling every
      // control. Resolving by home is the only lookup that works for everyone.
      const res = await serverConnection.request<{ states: Record<string, unknown> }>(
        'automation.virtual_states', { homeId },
      );
      setStates(res?.states ?? {});
      setEngineLive(true);
    } catch {
      // Relay offline, or running a build without helper support. Values stay
      // unknown and controls disable themselves — better than showing a stale
      // value beside a control that would act on it.
      setEngineLive(false);
    }
  }, [homeId]);

  // Values change whenever an automation touches one, so they have to be
  // polled — but only while something is actually showing them.
  useEffect(() => {
    if (!active || !homeId || helpers.length === 0) return;
    void refreshStates();
    const t = setInterval(() => { void refreshStates(); }, STATE_POLL_MS);
    return () => clearInterval(t);
  }, [active, homeId, helpers.length, refreshStates]);

  const operate = useCallback(async (
    accessoryId: string,
    operation: VirtualOperation,
    opts: { value?: unknown } = {},
  ) => {
    try {
      const res = await serverConnection.request<{ accessoryId: string; state: unknown }>(
        'automation.virtual_operate', { homeId, accessoryId, operation, ...opts },
      );
      setStates(s => ({ ...s, [accessoryId]: res?.state }));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not change that virtual accessory');
      void refreshStates();
    }
  }, [homeId, refreshStates]);

  const save = useCallback(async (helper: VirtualAccessoryDefinition) => {
    if (!homeId) return;
    try {
      await saveMutation({
        variables: {
          homeId,
          accessoryId: helper.id || null,
          // id is stripped on create: the store mints it, and writing an empty
          // one into the blob would leave the definition disagreeing with its row.
          data: JSON.stringify(helper.id ? helper : { ...helper, id: undefined }),
        },
      });
      await refetch();
      refreshAccessories();
      void refreshStates();
      toast.success(helper.id ? 'Virtual accessory saved' : 'Virtual accessory created');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not save the virtual accessory');
      throw e;
    }
  }, [homeId, saveMutation, refetch, refreshStates, refreshAccessories]);

  const remove = useCallback(async (accessoryId: string) => {
    try {
      await deleteMutation({ variables: { accessoryId } });
      await refetch();
      refreshAccessories();
      toast.success('Virtual accessory deleted');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not delete the virtual accessory');
    }
  }, [deleteMutation, refetch, refreshAccessories]);

  /**
   * Move a helper accessory to a room, or to the home-level folder when
   * `roomId` is null. Separate from `save` because dragging a tile should not
   * announce itself with a toast the way an explicit save does.
   */
  const moveToRoom = useCallback(async (accessoryId: string, roomId: string | null) => {
    const helper = helpers.find(h => h.id === accessoryId);
    if (!helper || (helper.roomId ?? null) === roomId) return;
    try {
      await saveMutation({
        variables: {
          homeId,
          accessoryId,
          data: JSON.stringify({ ...helper, roomId: roomId ?? undefined }),
        },
      });
      await refetch();
      refreshAccessories();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not move that virtual accessory');
    }
  }, [helpers, homeId, saveMutation, refetch, refreshAccessories]);

  return {
    helpers,
    byRoom,
    states,
    live: engineLive === true,
    engineUnreachable: engineLive === false,
    refetch,
    refreshStates,
    operate,
    save,
    remove,
    moveToRoom,
  };
}
