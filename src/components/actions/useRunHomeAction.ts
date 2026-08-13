import { useCallback } from 'react';
import { toast } from 'sonner';
import { serverConnection } from '@/server/connection';
import { markPendingUpdate } from '@/hooks/useHomeKitData';
import { runWithConcurrency } from '@/lib/concurrency';
import { describeError } from '@/lib/describe-error';
import type { HomeAction, HomeActionWrite } from './catalog';

/**
 * How many writes may be in flight at once.
 *
 * Firing forty at once buries every other message on the socket behind them
 * and pushes the relay into rate-limiting its own HomeKit writes, which turns
 * a slow action into a failing one.
 */
const MAX_CONCURRENT_WRITES = 6;

const delay = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

/**
 * Move one characteristic in the cache, under every name a widget might read it by.
 *
 * Widgets look up whichever name the bridge reported — FanWidget tries `on`,
 * then `power_state`, then `active` — while the wire carries the canonical
 * name. Writing both keeps the tile in step no matter which its widget reads.
 */
function applyToCache(
  write: HomeActionWrite,
  value: unknown,
  updateCharacteristicInCache: RunHomeActionArgs['updateCharacteristicInCache'],
) {
  const names = write.reportedCharacteristicType === write.characteristicType
    ? [write.characteristicType]
    : [write.characteristicType, write.reportedCharacteristicType];
  for (const name of names) {
    markPendingUpdate(write.accessoryId, name, value);
    updateCharacteristicInCache(write.accessoryId, name, JSON.stringify(value));
  }
}

interface RunHomeActionArgs {
  homeId: string | null;
  isViewOnly: boolean;
  updateCharacteristicInCache: (accessoryId: string, characteristicType: string, jsonValue: string) => void;
}

/**
 * Run an Action: optimistically move every tile, then fan the writes out.
 *
 * Uses per-accessory `characteristic.set` rather than the bulk `state.set`.
 * `state.set` is slug-addressed and reports failures by slug, so a partial
 * failure could not be mapped back to an accessory — which would forfeit
 * per-accessory revert and force an all-or-nothing rollback. The relay's write
 * fan-out (MQTT publish, automation triggers) fires identically for both.
 */
export function useRunHomeAction({ homeId, isViewOnly, updateCharacteristicInCache }: RunHomeActionArgs) {
  return useCallback(async (action: HomeAction) => {
    if (isViewOnly) {
      toast.error('View-only access: you cannot control devices in this home');
      return;
    }

    const writes = action.steps.flatMap(step => step.writes);
    if (writes.length === 0) return;

    // 1. Optimistic pass — entirely synchronous, before any network work, so
    //    the UI has repainted by the time the first request leaves.
    for (const write of writes) applyToCache(write, write.value, updateCharacteristicInCache);

    // 2. Fan out, one step at a time so a step's delay actually separates it
    //    from the next. Every action here has a single step today.
    const failed: HomeActionWrite[] = [];
    let firstError: unknown;

    for (const step of action.steps) {
      if (step.writes.length > 0) {
        const results = await runWithConcurrency(step.writes, MAX_CONCURRENT_WRITES, write =>
          serverConnection.request('characteristic.set', {
            accessoryId: write.accessoryId,
            characteristicType: write.characteristicType,
            value: write.value,
            homeId,
          }),
        );
        results.forEach((result, i) => {
          if (result.status === 'rejected') {
            failed.push(step.writes[i]);
            firstError ??= result.reason;
          }
        });
      }
      if (step.delayAfterMs) await delay(step.delayAfterMs);
    }

    // 3. Revert only what actually failed — the rest already moved and stayed.
    for (const write of failed) applyToCache(write, write.previousValue, updateCharacteristicInCache);

    if (failed.length === writes.length) {
      toast.error(`${action.label} failed`, { description: describeError(firstError) });
    } else if (failed.length > 0) {
      toast.warning(`${writes.length - failed.length} of ${writes.length} changed`, {
        description: `${failed.length} accessor${failed.length === 1 ? 'y' : 'ies'} did not respond`,
      });
    }
  }, [homeId, isViewOnly, updateCharacteristicInCache]);
}
