// Homecast Automation Engine - Helper Manager
// Virtual entity management: input_boolean, input_number, input_select, timer, counter, etc.

import type { StateStore } from './StateStore';
import type { VirtualAccessoryDefinition, Duration, VirtualOperation } from '../types/automation';
import { durationToMs } from '../types/automation';

type EventEmitter = (eventType: string, eventData?: Record<string, unknown>) => void;
type StatePusher = (accessoryId: string, state: unknown) => void;

interface TimerState {
  state: 'idle' | 'active' | 'paused';
  duration: number; // total duration in ms
  remaining: number; // remaining ms
  startedAt?: number;
  /**
   * When the countdown last ran out, and only that: a cancelled timer never
   * finished. Idle is otherwise indistinguishable from never-started, so this
   * is the only thing that tells you a timer you weren't watching has been and
   * gone. Survives until the next start, which begins a fresh TimerState and so
   * clears it without having to remember to.
   */
  finishedAt?: number;
  timer?: ReturnType<typeof setTimeout>;
  interval?: ReturnType<typeof setInterval>;
}

/**
 * Manages virtual helper entities.
 * Stores values in the StateStore so triggers/conditions can read them.
 * Fires events on the engine's event bus (e.g., timer.finished).
 * Pushes state changes to the server via the sync callback.
 */
export class VirtualAccessoryManager {
  private helpers = new Map<string, VirtualAccessoryDefinition>();
  private timers = new Map<string, TimerState>();

  constructor(
    private stateStore: StateStore,
    private fireEvent: EventEmitter,
    private pushState: StatePusher,
  ) {}

  // ============================================================
  // Registration
  // ============================================================

  register(helper: VirtualAccessoryDefinition): void {
    this.helpers.set(helper.id, helper);

    // Set initial state
    switch (helper.type) {
      case 'input_boolean':
        this.stateStore.updateVirtualState(helper.id, helper.initialValue ?? false);
        break;
      case 'input_number':
        this.stateStore.updateVirtualState(helper.id, helper.initialValue ?? helper.min);
        break;
      case 'input_select':
        this.stateStore.updateVirtualState(helper.id, helper.initialValue ?? helper.options[0] ?? '');
        break;
      case 'input_text':
        this.stateStore.updateVirtualState(helper.id, helper.initialValue ?? '');
        break;
      case 'input_datetime':
        this.stateStore.updateVirtualState(helper.id, helper.initialValue ?? '');
        break;
      case 'timer':
        this.timers.set(helper.id, { state: 'idle', duration: 0, remaining: 0 });
        this.stateStore.updateVirtualState(helper.id, 'idle');
        break;
      case 'counter':
        this.stateStore.updateVirtualState(helper.id, helper.initial ?? 0);
        break;
      case 'schedule':
        this.stateStore.updateVirtualState(helper.id, this.isScheduleActive(helper) ? 'on' : 'off');
        break;
    }
  }

  loadAll(helpers: VirtualAccessoryDefinition[]): void {
    for (const h of helpers) this.register(h);
  }

  /**
   * Replace the whole helper set — the `sync_all` semantic.
   *
   * What arrives is the complete set, so anything absent has been deleted and
   * must stop existing here too; otherwise a deleted helper keeps answering
   * `helper()` and keeps its triggers alive forever.
   *
   * Three cases, kept apart deliberately:
   *
   * - **Unchanged** helpers are left completely alone. Re-registering resets a
   *   helper to its initial value, so a blanket reload would send Home Mode
   *   back to `Home` every time an unrelated helper was edited, and would
   *   orphan any running timer's pending timeout while `register` installed a
   *   fresh idle record over the top of it.
   * - **Changed** helpers are torn down and rebuilt, keeping their current
   *   value: editing a counter's step must not reset the count. Timers are the
   *   exception — a countdown whose definition just changed cannot be resumed
   *   honestly, so it goes back to idle.
   * - **Deleted** helpers are removed, which also cancels their timers.
   */
  replaceAll(
    helpers: VirtualAccessoryDefinition[],
    persistedStates?: Record<string, unknown>,
  ): void {
    const next = new Map(helpers.map(h => [h.id, h]));

    for (const id of [...this.helpers.keys()]) {
      if (!next.has(id)) this.remove(id);
    }

    for (const helper of helpers) {
      const existing = this.helpers.get(helper.id);
      // Cheap structural check. Both sides come through the same serialization,
      // so key order is stable; a false "changed" only costs a rebuild.
      if (existing && JSON.stringify(existing) === JSON.stringify(helper)) continue;

      // What the value should be after this rebuild. A helper already running
      // here keeps what it holds — this engine is the thing that has been
      // changing it, so its value is newer than anything the sync carries.
      // One we are meeting for the first time takes the stored value instead
      // of the definition's initial one: a relay reload rebuilds the whole set
      // from scratch, and without this every value reset to its initial on
      // every reload, which is exactly what "it keeps forgetting" was.
      const carried = existing
        ? this.stateStore.getVirtualState(helper.id)
        : persistedStates?.[helper.id];
      if (existing) this.remove(helper.id);  // also clears any pending timeout
      this.register(helper);
      // Timers are never restored: a half-elapsed countdown cannot be trusted
      // across a rebuild, which is the same call restoreStates makes.
      if (carried !== undefined && helper.type !== 'timer') {
        this.stateStore.updateVirtualState(helper.id, carried);
      }
    }
  }

  remove(accessoryId: string): void {
    this.helpers.delete(accessoryId);
    this.cancelTimer(accessoryId);
    this.timers.delete(accessoryId);
  }

  // ============================================================
  // Input Boolean
  // ============================================================

  toggle(accessoryId: string): void {
    const current = this.stateStore.getVirtualState(accessoryId);
    const newVal = !current;
    this.stateStore.updateVirtualState(accessoryId, newVal);
    this.pushState(accessoryId, newVal);
  }

  turnOn(accessoryId: string): void {
    this.stateStore.updateVirtualState(accessoryId, true);
    this.pushState(accessoryId, true);
  }

  turnOff(accessoryId: string): void {
    this.stateStore.updateVirtualState(accessoryId, false);
    this.pushState(accessoryId, false);
  }

  // ============================================================
  // Input Number
  // ============================================================

  setNumber(accessoryId: string, value: number): void {
    const def = this.helpers.get(accessoryId);
    if (def?.type === 'input_number') {
      const clamped = Math.max(def.min, Math.min(def.max, value));
      this.stateStore.updateVirtualState(accessoryId, clamped);
      this.pushState(accessoryId, clamped);
    }
  }

  increment(accessoryId: string, step?: number): void {
    const def = this.helpers.get(accessoryId);
    const current = Number(this.stateStore.getVirtualState(accessoryId) ?? 0);
    const s = step ?? (def?.type === 'input_number' ? def.step : 1);
    this.setNumber(accessoryId, current + s);
  }

  decrement(accessoryId: string, step?: number): void {
    const def = this.helpers.get(accessoryId);
    const current = Number(this.stateStore.getVirtualState(accessoryId) ?? 0);
    const s = step ?? (def?.type === 'input_number' ? def.step : 1);
    this.setNumber(accessoryId, current - s);
  }

  // ============================================================
  // Input Select
  // ============================================================

  selectOption(accessoryId: string, option: string): void {
    this.stateStore.updateVirtualState(accessoryId, option);
    this.pushState(accessoryId, option);
  }

  // ============================================================
  // Input Text
  // ============================================================

  setText(accessoryId: string, text: string): void {
    this.stateStore.updateVirtualState(accessoryId, text);
    this.pushState(accessoryId, text);
  }

  // ============================================================
  // Counter
  // ============================================================

  incrementCounter(accessoryId: string): void {
    const def = this.helpers.get(accessoryId);
    const current = Number(this.stateStore.getVirtualState(accessoryId) ?? 0);
    const step = (def?.type === 'counter' ? def.step : undefined) ?? 1;
    const max = (def?.type === 'counter' ? def.max : undefined) ?? Infinity;
    const newVal = Math.min(current + step, max);
    this.stateStore.updateVirtualState(accessoryId, newVal);
    this.pushState(accessoryId, newVal);
  }

  decrementCounter(accessoryId: string): void {
    const def = this.helpers.get(accessoryId);
    const current = Number(this.stateStore.getVirtualState(accessoryId) ?? 0);
    const step = (def?.type === 'counter' ? def.step : undefined) ?? 1;
    const min = (def?.type === 'counter' ? def.min : undefined) ?? -Infinity;
    const newVal = Math.max(current - step, min);
    this.stateStore.updateVirtualState(accessoryId, newVal);
    this.pushState(accessoryId, newVal);
  }

  resetCounter(accessoryId: string): void {
    const def = this.helpers.get(accessoryId);
    const initial = (def?.type === 'counter' ? def.initial : undefined) ?? 0;
    this.stateStore.updateVirtualState(accessoryId, initial);
    this.pushState(accessoryId, initial);
  }

  // ============================================================
  // Type-dispatching entry points (used by the `helper` action)
  // ============================================================

  /** Set a helper's value, routing to the right setter for its type. */
  setVirtualValue(accessoryId: string, value: unknown): void {
    const def = this.helpers.get(accessoryId);
    switch (def?.type) {
      case 'input_number':
        this.setNumber(accessoryId, Number(value));
        break;
      case 'input_select':
        this.selectOption(accessoryId, String(value));
        break;
      case 'input_text':
      case 'input_datetime':
        this.setText(accessoryId, String(value));
        break;
      case 'input_boolean':
        if (value) this.turnOn(accessoryId); else this.turnOff(accessoryId);
        break;
      case 'counter': {
        const n = Number(value);
        this.stateStore.updateVirtualState(accessoryId, n);
        this.pushState(accessoryId, n);
        break;
      }
      default:
        throw new Error(`Cannot set a value on helper ${accessoryId}`);
    }
  }

  /** Increment a counter or input_number. */
  incrementVirtual(accessoryId: string, step?: number): void {
    const def = this.helpers.get(accessoryId);
    if (def?.type === 'counter') this.incrementCounter(accessoryId);
    else this.increment(accessoryId, step);
  }

  /** Decrement a counter or input_number. */
  decrementVirtual(accessoryId: string, step?: number): void {
    const def = this.helpers.get(accessoryId);
    if (def?.type === 'counter') this.decrementCounter(accessoryId);
    else this.decrement(accessoryId, step);
  }

  /**
   * Reapply persisted values after a restart, so counters and modes survive a
   * relay restart rather than resetting to their initial value.
   */
  restoreStates(states: Record<string, unknown>): void {
    for (const [accessoryId, value] of Object.entries(states)) {
      if (!this.helpers.has(accessoryId)) continue;
      // Timers are not resumed — a half-elapsed countdown can't be trusted
      // across a restart, and `restoreOnRestart` is not implemented.
      if (this.helpers.get(accessoryId)?.type === 'timer') continue;
      this.stateStore.updateVirtualState(accessoryId, value);
    }
  }

  // ============================================================
  // Timer
  // ============================================================

  startTimer(accessoryId: string, duration?: Duration): void {
    this.cancelTimer(accessoryId);

    const def = this.helpers.get(accessoryId);
    const dur = duration ?? (def?.type === 'timer' ? def.duration : undefined);
    if (!dur) return;

    const totalMs = durationToMs(dur);
    const timerState: TimerState = {
      state: 'active',
      duration: totalMs,
      remaining: totalMs,
      startedAt: Date.now(),
    };

    timerState.timer = setTimeout(() => {
      timerState.state = 'idle';
      timerState.remaining = 0;
      timerState.finishedAt = Date.now();
      this.stateStore.updateVirtualState(accessoryId, 'idle');
      this.fireEvent('timer.finished', { accessoryId });
      this.pushState(accessoryId, 'idle');
    }, totalMs);

    this.timers.set(accessoryId, timerState);
    this.stateStore.updateVirtualState(accessoryId, 'active');
    this.fireEvent('timer.started', { accessoryId, duration: totalMs });
    this.pushState(accessoryId, 'active');
  }

  pauseTimer(accessoryId: string): void {
    const timerState = this.timers.get(accessoryId);
    if (!timerState || timerState.state !== 'active') return;

    if (timerState.timer) clearTimeout(timerState.timer);
    timerState.timer = undefined;

    const elapsed = Date.now() - (timerState.startedAt ?? Date.now());
    timerState.remaining = Math.max(0, timerState.remaining - elapsed);
    timerState.state = 'paused';

    this.stateStore.updateVirtualState(accessoryId, 'paused');
    this.fireEvent('timer.paused', { accessoryId, remaining: timerState.remaining });
    this.pushState(accessoryId, 'paused');
  }

  resumeTimer(accessoryId: string): void {
    const timerState = this.timers.get(accessoryId);
    if (!timerState || timerState.state !== 'paused' || timerState.remaining <= 0) return;

    timerState.state = 'active';
    timerState.startedAt = Date.now();

    timerState.timer = setTimeout(() => {
      timerState.state = 'idle';
      timerState.remaining = 0;
      timerState.finishedAt = Date.now();
      this.stateStore.updateVirtualState(accessoryId, 'idle');
      this.fireEvent('timer.finished', { accessoryId });
      this.pushState(accessoryId, 'idle');
    }, timerState.remaining);

    this.stateStore.updateVirtualState(accessoryId, 'active');
    this.fireEvent('timer.resumed', { accessoryId });
    this.pushState(accessoryId, 'active');
  }

  cancelTimer(accessoryId: string): void {
    const timerState = this.timers.get(accessoryId);
    if (!timerState) return;

    if (timerState.timer) clearTimeout(timerState.timer);
    timerState.timer = undefined;

    if (timerState.state !== 'idle') {
      timerState.state = 'idle';
      timerState.remaining = 0;
      this.stateStore.updateVirtualState(accessoryId, 'idle');
      this.fireEvent('timer.cancelled', { accessoryId });
      this.pushState(accessoryId, 'idle');
    }
  }

  finishTimer(accessoryId: string): void {
    const timerState = this.timers.get(accessoryId);
    if (!timerState || timerState.state === 'idle') return;

    if (timerState.timer) clearTimeout(timerState.timer);
    timerState.timer = undefined;
    timerState.state = 'idle';
    timerState.remaining = 0;
    // Cut short, but finished all the same — it fires timer.finished, so it
    // has to leave the same trace behind. cancelTimer deliberately does not.
    timerState.finishedAt = Date.now();

    this.stateStore.updateVirtualState(accessoryId, 'idle');
    this.fireEvent('timer.finished', { accessoryId });
    this.pushState(accessoryId, 'idle');
  }

  // ============================================================
  // Schedule
  // ============================================================

  private isScheduleActive(helper: VirtualAccessoryDefinition & { type: 'schedule' }): boolean {
    const now = new Date();
    const day = now.getDay();
    const minuteOfDay = now.getHours() * 60 + now.getMinutes();

    return helper.blocks.some((block) => {
      if (block.day !== day) return false;
      const fromParts = block.from.split(':');
      const toParts = block.to.split(':');
      const fromMin = parseInt(fromParts[0], 10) * 60 + parseInt(fromParts[1], 10);
      const toMin = parseInt(toParts[0], 10) * 60 + parseInt(toParts[1], 10);
      return minuteOfDay >= fromMin && minuteOfDay < toMin;
    });
  }

  // ============================================================
  // Operations
  // ============================================================

  /**
   * Apply a named operation to a helper.
   *
   * The one place that maps an operation name onto a method. An automation
   * action and a person pressing a control in the Helpers list are the same
   * operation arriving by different routes, and when each route owned its own
   * switch they could drift — a new operation added for one would silently do
   * nothing via the other.
   */
  apply(
    accessoryId: string,
    operation: VirtualOperation,
    opts: { value?: unknown; step?: number; duration?: Duration } = {},
  ): void {
    switch (operation) {
      case 'turn_on': this.turnOn(accessoryId); break;
      case 'turn_off': this.turnOff(accessoryId); break;
      case 'toggle': this.toggle(accessoryId); break;
      case 'set': this.setVirtualValue(accessoryId, opts.value); break;
      case 'increment': this.incrementVirtual(accessoryId, opts.step); break;
      case 'decrement': this.decrementVirtual(accessoryId, opts.step); break;
      case 'reset': this.resetCounter(accessoryId); break;
      case 'start': this.startTimer(accessoryId, opts.duration); break;
      case 'pause': this.pauseTimer(accessoryId); break;
      case 'resume': this.resumeTimer(accessoryId); break;
      case 'cancel': this.cancelTimer(accessoryId); break;
      case 'finish': this.finishTimer(accessoryId); break;
      default: {
        // Exhaustiveness guard: a new VirtualOperation that nobody wired up
        // should fail loudly here rather than be accepted and ignored.
        const unhandled: never = operation;
        throw new Error(`Unknown helper operation: ${String(unhandled)}`);
      }
    }
  }

  // ============================================================
  // Query
  // ============================================================

  getVirtualAccessory(id: string): VirtualAccessoryDefinition | undefined {
    const direct = this.helpers.get(id);
    if (direct) return direct;
    // Ids reach us from clients that got them from the cloud, which does not
    // preserve UUID case. An exact-case miss here reads as "no such
    // accessory", which surfaces as a control that silently does nothing.
    const wanted = id.toLowerCase();
    for (const [key, helper] of this.helpers) {
      if (key.toLowerCase() === wanted) return helper;
    }
    return undefined;
  }

  /** Current value of every registered helper, keyed by id. */
  getAllStates(): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const id of this.helpers.keys()) {
      out[id] = this.stateStore.getVirtualState(id);
    }
    return out;
  }

  getAllVirtualAccessories(): VirtualAccessoryDefinition[] {
    return Array.from(this.helpers.values());
  }

  /**
   * How much of a countdown is left, in ms, or undefined if it isn't a timer.
   *
   * Published alongside the accessory so a tile can show the countdown. Without
   * it the only thing a client knows is `active`, and a five-minute timer that
   * shows no time reads as one that never started.
   */
  /**
   * What a client needs to render a countdown, or undefined if it isn't a timer.
   *
   * `endsAt` is an absolute instant, not a remaining span. A span is only true
   * at the moment it is measured, and the accessory list is fetched minutes
   * apart — so a tile showing one was always displaying a stale number, and
   * showed 0:00 whenever the last reading had been taken while idle. An instant
   * stays true however long it sits in a cache.
   */
  getTimerInfo(accessoryId: string): {
    state: 'idle' | 'active' | 'paused';
    durationMs: number;
    startedAt?: number;
    endsAt?: number;
    remainingMs?: number;
    finishedAt?: number;
  } | undefined {
    const def = this.getVirtualAccessory(accessoryId);
    if (def?.type !== 'timer') return undefined;
    const t = this.timers.get(def.id);
    // The configured duration, not the running TimerState's — an idle one
    // carries 0, which is true and useless to something about to start it.
    const durationMs = durationToMs(def.duration);
    if (!t || t.state === 'idle') return { state: 'idle', durationMs, finishedAt: t?.finishedAt };
    if (t.state === 'paused') return { state: 'paused', durationMs, remainingMs: t.remaining };
    return {
      state: 'active',
      durationMs,
      // The two facts a client needs to compute the remaining time itself, at
      // whatever moment it happens to render. Anything we compute here is only
      // true when we compute it.
      startedAt: t.startedAt,
      endsAt: (t.startedAt ?? Date.now()) + t.duration,
      remainingMs: Math.max(0, t.duration - (Date.now() - (t.startedAt ?? Date.now()))),
    };
  }

  // ============================================================
  // Teardown
  // ============================================================

  teardown(): void {
    for (const [id] of this.timers) {
      this.cancelTimer(id);
    }
    this.timers.clear();
    this.helpers.clear();
  }
}
