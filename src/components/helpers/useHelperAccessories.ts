import { useCallback, useEffect, useMemo, useState } from 'react';
import { useQuery, useMutation } from '@apollo/client/react';
import { toast } from 'sonner';
import { serverConnection } from '@/server/connection';
import { HC_HELPERS } from '@/lib/graphql/queries';
import { SAVE_HC_HELPER, DELETE_HC_HELPER } from '@/lib/graphql/mutations';
import { isCreatableHelperType } from '@/automation/helpers/catalogue';
import type { HelperDefinition, HelperOperation } from '@/automation/types/automation';

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
function parseHelpers(entities: StoredHelperEntity[]): HelperDefinition[] {
  const out: HelperDefinition[] = [];
  for (const e of entities) {
    try {
      const parsed = JSON.parse(e.dataJson) as HelperDefinition;
      if (!parsed?.type || !isCreatableHelperType(parsed.type)) continue;
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
export function useHelperAccessories(homeId: string | null, options: { active?: boolean } = {}) {
  const active = options.active ?? true;
  const [states, setStates] = useState<Record<string, unknown>>({});
  /** Null while unknown; false once we know the engine isn't reachable. */
  const [engineLive, setEngineLive] = useState<boolean | null>(null);

  const { data, refetch } = useQuery<{ hcHelpers: StoredHelperEntity[] }>(HC_HELPERS, {
    variables: { homeId },
    skip: !homeId,
    fetchPolicy: 'cache-first',
    errorPolicy: 'all',
  });

  const [saveMutation] = useMutation(SAVE_HC_HELPER);
  const [deleteMutation] = useMutation(DELETE_HC_HELPER);

  const helpers = useMemo(() => parseHelpers(data?.hcHelpers ?? []), [data]);

  /** roomId → helpers. The home-level folder is keyed by the empty string. */
  const byRoom = useMemo(() => {
    const map = new Map<string, HelperDefinition[]>();
    for (const h of helpers) {
      const key = h.roomId ?? '';
      const list = map.get(key);
      if (list) list.push(h); else map.set(key, [h]);
    }
    return map;
  }, [helpers]);

  const refreshStates = useCallback(async () => {
    try {
      const res = await serverConnection.request<{ states: Record<string, unknown> }>(
        'automation.helper_states', {},
      );
      setStates(res?.states ?? {});
      setEngineLive(true);
    } catch {
      // Relay offline, or running a build without helper support. Values stay
      // unknown and controls disable themselves — better than showing a stale
      // value beside a control that would act on it.
      setEngineLive(false);
    }
  }, []);

  // Values change whenever an automation touches one, so they have to be
  // polled — but only while something is actually showing them.
  useEffect(() => {
    if (!active || !homeId || helpers.length === 0) return;
    void refreshStates();
    const t = setInterval(() => { void refreshStates(); }, STATE_POLL_MS);
    return () => clearInterval(t);
  }, [active, homeId, helpers.length, refreshStates]);

  const operate = useCallback(async (
    helperId: string,
    operation: HelperOperation,
    opts: { value?: unknown } = {},
  ) => {
    try {
      const res = await serverConnection.request<{ helperId: string; state: unknown }>(
        'automation.helper_operate', { helperId, operation, ...opts },
      );
      setStates(s => ({ ...s, [helperId]: res?.state }));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not change that helper accessory');
      void refreshStates();
    }
  }, [refreshStates]);

  const save = useCallback(async (helper: HelperDefinition) => {
    if (!homeId) return;
    try {
      await saveMutation({
        variables: {
          homeId,
          helperId: helper.id || null,
          // id is stripped on create: the store mints it, and writing an empty
          // one into the blob would leave the definition disagreeing with its row.
          data: JSON.stringify(helper.id ? helper : { ...helper, id: undefined }),
        },
      });
      await refetch();
      void refreshStates();
      toast.success(helper.id ? 'Helper accessory saved' : 'Helper accessory created');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not save the helper accessory');
      throw e;
    }
  }, [homeId, saveMutation, refetch, refreshStates]);

  const remove = useCallback(async (helperId: string) => {
    try {
      await deleteMutation({ variables: { helperId } });
      await refetch();
      toast.success('Helper accessory deleted');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not delete the helper accessory');
    }
  }, [deleteMutation, refetch]);

  /**
   * Move a helper accessory to a room, or to the home-level folder when
   * `roomId` is null. Separate from `save` because dragging a tile should not
   * announce itself with a toast the way an explicit save does.
   */
  const moveToRoom = useCallback(async (helperId: string, roomId: string | null) => {
    const helper = helpers.find(h => h.id === helperId);
    if (!helper || (helper.roomId ?? null) === roomId) return;
    try {
      await saveMutation({
        variables: {
          homeId,
          helperId,
          data: JSON.stringify({ ...helper, roomId: roomId ?? undefined }),
        },
      });
      await refetch();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not move that helper accessory');
    }
  }, [helpers, homeId, saveMutation, refetch]);

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
