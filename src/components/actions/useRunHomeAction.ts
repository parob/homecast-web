import { useCallback } from 'react';
import { toast } from 'sonner';
import { serverConnection } from '@/server/connection';
import { trackWrite, accessoryKey, actionKey } from '@/lib/pending-writes';
import { markPendingUpdate } from '@/hooks/useHomeKitData';
import { runWithConcurrency } from '@/lib/concurrency';
import { describeError } from '@/lib/describe-error';
import type { BulkWriteResponse } from '@/native/homekit-bridge';
import type { HomeAction, HomeActionWrite } from './catalog';

/**
 * How many writes may be in flight at once, **on the fallback path only**.
 *
 * Relays that understand `characteristics.set` send the whole step as one
 * request and never reach this. It governs older relays, where an action is
 * still one request per accessory.
 *
 * Nothing downstream serializes, so on that path this cap is the only thing
 * deciding how long an action takes. The relay dispatches each request without
 * awaiting it (`local-server.ts`), and although HomeKitManager is `@MainActor`
 * its `writeValue` helper is deliberately `nonisolated` and awaited off-actor,
 * so concurrent writes genuinely overlap.
 *
 * It was 6, which made a 40-light home seven sequential waves. Worse than the
 * latency: a single wedged accessory pins its whole wave for
 * `writeTimeoutSeconds` (10s in HomeKitManager), so a couple of unresponsive
 * bulbs could push the action past the request timeout and fail outright.
 *
 * Still bounded rather than unlimited — a 200-accessory home opening 200
 * simultaneous requests is a burst nobody benefits from — but high enough that
 * a normal home completes in one wave and one dead device blocks nothing.
 *
 * A big home is exactly where this is not enough, and why the bulk path exists:
 * at 223 lights this is ten sequential waves, and pacing them also denies
 * HomeKit's own daemon the simultaneity it needs to coalesce writes that share
 * a bridge into one request.
 */
const MAX_CONCURRENT_WRITES = 24;

/**
 * Whether this relay understands `characteristics.set`.
 *
 * `null` means untried. Probed once and remembered, because an older relay
 * rejects every attempt and paying a doomed round trip before each fan-out
 * would make the slow case slower. Module state, so it resets on reload —
 * which is also when a relay may have been upgraded underneath us.
 */
let bulkWriteSupported: boolean | null = null;

/**
 * Test seam: say what we know about this relay, or `null` to forget.
 *
 * Takes a value rather than only clearing, so a test of the fallback does not
 * have to spend a doomed probe getting there — the probe is its own test.
 */
export function __setBulkWriteSupport(state: boolean | null): void {
  bulkWriteSupported = state;
}

/**
 * An older relay saying it has never heard of this action.
 *
 * Two spellings, because there are two ages of relay: web code that predates
 * the handler answers `UNKNOWN_ACTION`, and a Mac binary that predates the
 * native method answers `UNKNOWN_METHOD`. In cloud mode the second is the
 * common one — the relay loads today's web app from homecast.cloud but keeps
 * whatever Swift it shipped with.
 */
function isUnsupportedAction(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  if (code === 'UNKNOWN_ACTION' || code === 'UNKNOWN_METHOD') return true;
  const message = (error as { message?: unknown } | null)?.message;
  return typeof message === 'string' && /unknown (action|method)/i.test(message);
}

/**
 * Name the ones that could not answer, without turning a toast into a list.
 *
 * Three names is about what someone reads off a toast before it goes; past
 * that a count carries more than a wall of text nobody finishes.
 */
function describeUnreachable(writes: HomeActionWrite[]): string {
  const names = writes.map(w => w.name).filter((n): n is string => !!n);
  if (names.length === 0) return 'They may be switched off at the wall.';
  const shown = names.slice(0, 3).join(', ');
  const rest = names.length - Math.min(3, names.length);
  const list = rest > 0 ? `${shown} and ${rest} other${rest === 1 ? '' : 's'}` : shown;
  return `${list} — they may be switched off at the wall.`;
}

/** Pairs a change back to the write that asked for it. */
function writeKey(accessoryId: string, characteristicType: string): string {
  return `${accessoryId}\u0000${characteristicType}`;
}

const delay = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

/**
 * The last write queued for each accessory, so two writes to one device stay in
 * the order they were asked for.
 *
 * Without this, reversing a run mid-flight is a race it can lose: the "on" is
 * already travelling, the "off" is sent while it travels, and whichever the
 * relay happens to finish last is the state the light is left in. Chaining per
 * accessory — and only per accessory, so different devices still go at once —
 * makes the later request the later request, and last-write-wins becomes true
 * rather than likely.
 */
const writeQueue = new Map<string, Promise<unknown>>();

/**
 * The chain key a bulk request uses.
 *
 * One key, not one per accessory: a batch is a single request, so there is
 * nothing finer to order it by, and two batches to the same relay must still
 * arrive in the order they were asked for.
 */
const BULK_QUEUE_KEY = '\u0000bulk';

/**
 * Forget every chain. Only for tests: the map is module state, so one test
 * leaving a write pending would make every later write to that accessory wait
 * behind it for ever.
 */
export function __resetWriteQueue(): void {
  writeQueue.clear();
}

function queueWrite<T>(accessoryId: string, send: () => Promise<T>): Promise<T> {
  const previous = writeQueue.get(accessoryId) ?? Promise.resolve();
  // Swallow the predecessor's failure: a device that refused one write must not
  // stop the next one being tried.
  const mine = previous.then(send, send);
  writeQueue.set(accessoryId, mine.then(() => undefined, () => undefined));
  return mine;
}

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
  /**
   * This run is taking over from one still in flight, so it writes to every
   * member rather than the ones that currently look wrong. See `onStepsEvery`.
   */
  supersedes?: boolean;
  /**
   * Abort the writes this run has not issued yet.
   *
   * Supplying one also makes the run report truthfully rather than optimistically
   * — see the note on the optimistic pass. Already-issued writes cannot be
   * recalled; this stops the queue, which on a big home is most of it.
   */
  signal?: AbortSignal;
}

interface RunHomeActionArgs {
  homeId: string | null;
  isViewOnly: boolean;
  updateCharacteristicInCache: (accessoryId: string, characteristicType: string, jsonValue: string) => void;
}

/**
 * Run an Action: optimistically move every tile, then fan the writes out.
 *
 * Sends each step as one `characteristics.set`, falling back to a per-accessory
 * fan-out on relays that predate it.
 *
 * The bulk action is addressed by accessory id, which is what the older bulk
 * `state.set` could not be: native resolves its keys through
 * `findAccessoryByKey`, which matches sanitized room/accessory slugs and opens
 * with `guard let room = accessory.room else { continue }` — so an accessory
 * with no room (a virtual one, or anything in HomeKit's default room) cannot be
 * addressed at all and would be silently dropped from "all lights off".
 *
 * One request also matters beyond the round trips it saves. HomeKit's daemon
 * coalesces writes reaching the same accessory server together into a single
 * HAP request, and a bridge is one accessory server — so a batch dispatched at
 * once can become one write per bridge rather than one per bulb. Trickling the
 * same writes out of a worker pool gives it nothing to coalesce.
 *
 * The relay's write fan-out (MQTT publish, automation triggers) fires
 * identically either way.
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

    const toggle = action.toggle;
    const steps = opts?.direction !== undefined && toggle
      ? (opts.supersedes
          ? (opts.direction ? toggle.onStepsEvery : toggle.offStepsEvery)
          : (opts.direction ? toggle.onSteps : toggle.offSteps))
      : action.steps;

    const writes = steps.flatMap(step => step.writes);
    // Asking for an end it is already at is not an error — pressing "all on"
    // when they all are should quietly do nothing, not report a failure.
    if (writes.length === 0) return;

    // 1. Optimistic pass — entirely synchronous, before any network work, so
    //    the UI has repainted by the time the first request leaves.
    //
    //    An interruptible run skips it, and moves each accessory only once its
    //    own write lands. A control the user can still grab mid-flight must not
    //    claim work it has not done: reversing a run that had optimistically
    //    marked every light on would compute its write set from that claim and
    //    dutifully turn off lights that never came on. Truth costs the instant
    //    repaint, and buys a toggle that travels through the middle as the
    //    house actually changes — which is the whole point of the middle.
    const interruptible = opts?.signal !== undefined;
    if (!interruptible) {
      for (const write of writes) applyToCache(write, write.value, updateCharacteristicInCache);
    }

    // 2. Fan out, one step at a time so a step's delay actually separates it
    //    from the next. Every action here has a single step today.
    const failed: HomeActionWrite[] = [];
    let firstError: unknown;
    let settled = 0;
    // Counts across every step, not per step, so the card shows one run of
    // progress rather than restarting at zero on a composite action.
    opts?.onProgress?.(0, writes.length);

    /**
     * One step as a single relay request.
     *
     * Returns the writes that did not land, or `null` if this relay cannot do
     * bulk at all — which is the caller's signal to fan out instead. A request
     * that fails for any *other* reason is a real failure and reported as one:
     * falling back then would write the whole house a second time.
     */
    const runStepInOneRequest = async (stepWrites: HomeActionWrite[]): Promise<HomeActionWrite[] | null> => {
      let response: BulkWriteResponse | undefined;
      try {
        // Chained like any other write, but on one key for the whole batch.
        // Ordering still has to hold between runs: a reversal's batch must be
        // applied after the batch it is reversing, and an abort cannot recall
        // writes already travelling. Per-accessory chaining has nothing to
        // grip here, because the batch is one request.
        response = await queueWrite(BULK_QUEUE_KEY, async () => {
          if (opts?.signal?.aborted) return undefined;
          // Deduped: a step that writes two characteristics on one accessory is
          // still one request, and should be one ring.
          return await trackWrite(
            [actionKey(action.id), ...new Set(stepWrites.map(write => accessoryKey(write.accessoryId)))],
            serverConnection.request<BulkWriteResponse>('characteristics.set', {
              writes: stepWrites.map(write => ({
                accessoryId: write.accessoryId,
                characteristicType: write.characteristicType,
                value: write.value,
              })),
              homeId: effectiveHomeId,
            }),
          );
        });
      } catch (e) {
        if (isUnsupportedAction(e)) {
          bulkWriteSupported = false;
          return null;
        }
        firstError ??= e;
        settled += stepWrites.length;
        opts?.onProgress?.(settled, writes.length);
        return stepWrites;
      }

      // Aborted before it went out. Nothing was written, nothing failed, and
      // nothing was learned — a request that never left says nothing about
      // what the relay can do.
      if (!response) return [];
      bulkWriteSupported = true;

      // A relay that answered, but not in a shape that says which accessories
      // moved. We cannot know, so take its word for the whole step: assuming
      // everything landed shows a state we are not sure of, and assuming
      // nothing did reverts lights that are already off. Neither is good, but
      // only one of them writes the house a second time.
      if (!Array.isArray(response.changes)) {
        const wholeStepLanded = response.success !== false;
        if (wholeStepLanded && interruptible) {
          for (const write of stepWrites) applyToCache(write, write.value, updateCharacteristicInCache);
        }
        settled += stepWrites.length;
        opts?.onProgress?.(settled, writes.length);
        return wholeStepLanded ? [] : stepWrites;
      }

      const landed = new Set(
        response.changes
          .filter(change => change.success)
          .map(change => writeKey(change.accessoryId, change.characteristicType)),
      );
      const stepFailed: HomeActionWrite[] = [];
      for (const write of stepWrites) {
        if (landed.has(writeKey(write.accessoryId, write.characteristicType))) {
          if (interruptible) applyToCache(write, write.value, updateCharacteristicInCache);
        } else {
          stepFailed.push(write);
        }
      }
      if (stepFailed.length > 0) {
        firstError ??= new Error(
          response.changes.find(change => !change.success)?.error ?? 'The relay did not confirm the write',
        );
      }

      // One request, so one progress movement. There is nothing to count up
      // through: the batch is answered all at once or not at all.
      settled += stepWrites.length;
      opts?.onProgress?.(settled, writes.length);
      return stepFailed;
    };

    /** The pre-bulk path: one request per accessory, capped. */
    const runStepPerAccessory = async (stepWrites: HomeActionWrite[]): Promise<HomeActionWrite[]> => {
      const results = await runWithConcurrency(stepWrites, MAX_CONCURRENT_WRITES, async write => {
        try {
          return await queueWrite(write.accessoryId, async () => {
            // Checked here, inside the queue, rather than before joining it:
            // a write can sit behind another device's turn for a while, and
            // the whole point is to drop the ones that have not gone yet.
            if (opts?.signal?.aborted) return undefined;
            const result = await trackWrite(
              [actionKey(action.id), accessoryKey(write.accessoryId)],
              serverConnection.request('characteristic.set', {
                accessoryId: write.accessoryId,
                characteristicType: write.characteristicType,
                value: write.value,
                homeId: effectiveHomeId,
              }),
            );
            if (interruptible) applyToCache(write, write.value, updateCharacteristicInCache);
            return result;
          });
        } finally {
          // `finally`, so a failure still advances the count — the point is
          // "how many are resolved", not "how many worked". The toast at the
          // end is what reports failures.
          opts?.onProgress?.(++settled, writes.length);
        }
      });
      const stepFailed: HomeActionWrite[] = [];
      results.forEach((result, i) => {
        if (result.status === 'rejected') {
          stepFailed.push(stepWrites[i]);
          firstError ??= result.reason;
        }
      });
      return stepFailed;
    };

    for (const step of steps) {
      if (step.writes.length > 0) {
        const inOneRequest = bulkWriteSupported === false ? null : await runStepInOneRequest(step.writes);
        failed.push(...(inOneRequest ?? await runStepPerAccessory(step.writes)));
      }
      if (step.delayAfterMs) await delay(step.delayAfterMs);
    }

    // 3. Revert only what actually failed — the rest already moved and stayed.
    //    An interruptible run never moved anything it did not confirm, so it has
    //    nothing to put back.
    if (!interruptible) {
      for (const write of failed) applyToCache(write, write.previousValue, updateCharacteristicInCache);
    }

    // Called off on purpose: the replacement run is the report, and a toast
    // about the half we abandoned would be describing the user's own decision
    // back to them as a fault.
    if (opts?.signal?.aborted) return;

    // An accessory that cannot answer is not a fault to report. A Hue bulb
    // switched off at the wall is unreachable by design, it is already greyed
    // out as No Response on its tile, and an error toast about it is the app
    // shouting about something the grid is showing calmly.
    //
    // So the split is by cause, not by count: writes that failed at an
    // accessory nobody could have reached are stated, and only writes that
    // failed for some other reason are warned about.
    const unreachable = failed.filter(w => w.reachable === false);
    const broken = failed.filter(w => w.reachable !== false);

    if (broken.length > 0 && broken.length === writes.length) {
      toast.error(`${action.label} failed`, { description: describeError(firstError) });
    } else if (broken.length > 0) {
      toast.warning(`${writes.length - broken.length} of ${writes.length} changed`, {
        description: `${broken.length} accessor${broken.length === 1 ? 'y' : 'ies'} did not respond`,
      });
    } else if (unreachable.length > 0) {
      // Plain, not red, and never the relay's own words: "did not confirm the
      // write within 10s" is a sentence about our timeout, not about the light.
      toast(`${unreachable.length} not responding`, {
        description: describeUnreachable(unreachable),
      });
    }
  }, [homeId, isViewOnly, updateCharacteristicInCache]);
}
