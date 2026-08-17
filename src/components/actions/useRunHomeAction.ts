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
 * Nothing downstream serializes, so this cap is the only thing deciding how
 * long an action takes. The relay dispatches each request without awaiting it
 * (`local-server.ts`), and although HomeKitManager is `@MainActor` its
 * `writeValue` helper is deliberately `nonisolated` and awaited off-actor, so
 * concurrent writes genuinely overlap. Native fans out unbounded already —
 * `setServiceGroupCharacteristic` and `setState` both fire one TaskGroup over
 * every member.
 *
 * It was 6, which made a 40-light home seven sequential waves. Worse than the
 * latency: a single wedged accessory pins its whole wave for
 * `writeTimeoutSeconds` (10s in HomeKitManager), so a couple of unresponsive
 * bulbs could push the action past the request timeout and fail outright.
 *
 * Still bounded rather than unlimited — a 200-accessory home opening 200
 * simultaneous requests is a burst nobody benefits from — but high enough that
 * a normal home completes in one wave and one dead device blocks nothing.
 */
const MAX_CONCURRENT_WRITES = 24;

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

/** Per-call overrides, for running an action against a home you are not in. */
export interface RunHomeActionOverrides {
  homeId?: string | null;
  isViewOnly?: boolean;
  /**
   * Fires as each write settles, succeeded or failed, so the card can count up
   * while it works. Matters most exactly when the action is slow: a wedged
   * accessory holds its write for the native 10s timeout, and a bare spinner
   * gives no way to tell that apart from nothing happening.
   */
  onProgress?: (done: number, total: number) => void;
  /**
   * Which way to run a two-way action, when the caller has a control that lets
   * the user say. Omitted, the action runs its own `steps` — the single
   * next-press direction the catalog chose, which is all a play button or a
   * tab-bar pin can express.
   */
  direction?: boolean;
}

interface RunHomeActionArgs {
  homeId: string | null;
  isViewOnly: boolean;
  updateCharacteristicInCache: (accessoryId: string, characteristicType: string, jsonValue: string) => void;
}

/**
 * Run an Action: optimistically move every tile, then fan the writes out.
 *
 * Uses per-accessory `characteristic.set` rather than the bulk `state.set`,
 * which would be one round trip instead of N.
 *
 * Not for the reason first recorded here: `state.set`'s `changes[]` does carry
 * `accessoryId`, so failures *can* be mapped back. The actual blocker is
 * addressing. Native resolves its keys through `findAccessoryByKey`, which
 * matches sanitized room/accessory slugs and opens with
 * `guard let room = accessory.room else { continue }` — so an accessory with
 * no room (a virtual one, or anything in HomeKit's default room) cannot be
 * addressed at all and would be silently dropped from "all lights off". It
 * would also mean regenerating the relay's slugs client-side and keeping them
 * in step through renames.
 *
 * The fix worth making is a relay action addressed by accessory id that fans
 * out in one native TaskGroup; that needs a Mac app release, so until then the
 * concurrency cap above is what keeps this quick. The relay's write fan-out
 * (MQTT publish, automation triggers) fires identically either way.
 */
export function useRunHomeAction({ homeId, isViewOnly, updateCharacteristicInCache }: RunHomeActionArgs) {
  return useCallback(async (action: HomeAction, opts?: RunHomeActionOverrides) => {
    // A pinned action can target a home other than the one on screen, so both
    // the destination and the permission check have to be overridable.
    const effectiveHomeId = opts?.homeId !== undefined ? opts.homeId : homeId;
    const effectiveViewOnly = opts?.isViewOnly !== undefined ? opts.isViewOnly : isViewOnly;

    if (effectiveViewOnly) {
      toast.error('View-only access: you cannot control accessories in this home');
      return;
    }

    const steps = opts?.direction !== undefined && action.toggle
      ? (opts.direction ? action.toggle.onSteps : action.toggle.offSteps)
      : action.steps;

    const writes = steps.flatMap(step => step.writes);
    // Asking for an end it is already at is not an error — pressing "all on"
    // when they all are should quietly do nothing, not report a failure.
    if (writes.length === 0) return;

    // 1. Optimistic pass — entirely synchronous, before any network work, so
    //    the UI has repainted by the time the first request leaves.
    for (const write of writes) applyToCache(write, write.value, updateCharacteristicInCache);

    // 2. Fan out, one step at a time so a step's delay actually separates it
    //    from the next. Every action here has a single step today.
    const failed: HomeActionWrite[] = [];
    let firstError: unknown;
    let settled = 0;
    // Counts across every step, not per step, so the card shows one run of
    // progress rather than restarting at zero on a composite action.
    opts?.onProgress?.(0, writes.length);

    for (const step of steps) {
      if (step.writes.length > 0) {
        const results = await runWithConcurrency(step.writes, MAX_CONCURRENT_WRITES, async write => {
          try {
            return await serverConnection.request('characteristic.set', {
              accessoryId: write.accessoryId,
              characteristicType: write.characteristicType,
              value: write.value,
              homeId: effectiveHomeId,
            });
          } finally {
            // `finally`, so a failure still advances the count — the point is
            // "how many are resolved", not "how many worked". The toast at the
            // end is what reports failures.
            opts?.onProgress?.(++settled, writes.length);
          }
        });
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
