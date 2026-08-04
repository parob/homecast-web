// Homecast Automation Engine - Helper Manager
// Virtual entity management: input_boolean, input_number, input_select, timer, counter, etc.

import type { StateStore } from './StateStore';
import type { VirtualAccessoryDefinition, Duration, VirtualOperation } from '../types/automation';
import { durationToMs } from '../types/automation';

type EventEmitter = (eventType: string, eventData?: Record<string, unknown>) => void;
type StatePusher = (helperId: string, state: unknown) => void;

interface TimerState {
  state: 'idle' | 'active' | 'paused';
  duration: number; // total duration in ms
  remaining: number; // remaining ms
  startedAt?: number;
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
  replaceAll(helpers: VirtualAccessoryDefinition[]): void {
    const next = new Map(helpers.map(h => [h.id, h]));

    for (const id of [...this.helpers.keys()]) {
      if (!next.has(id)) this.remove(id);
    }

    for (const helper of helpers) {
      const existing = this.helpers.get(helper.id);
      // Cheap structural check. Both sides come through the same serialization,
      // so key order is stable; a false "changed" only costs a rebuild.
      if (existing && JSON.stringify(existing) === JSON.stringify(helper)) continue;

      const carried = existing ? this.stateStore.getVirtualState(helper.id) : undefined;
      if (existing) this.remove(helper.id);  // also clears any pending timeout
      this.register(helper);
      if (carried !== undefined && helper.type !== 'timer') {
        this.stateStore.updateVirtualState(helper.id, carried);
      }
    }
  }

  remove(helperId: string): void {
    this.helpers.delete(helperId);
    this.cancelTimer(helperId);
    this.timers.delete(helperId);
  }

  // ============================================================
  // Input Boolean
  // ============================================================

  toggle(helperId: string): void {
    const current = this.stateStore.getVirtualState(helperId);
    const newVal = !current;
    this.stateStore.updateVirtualState(helperId, newVal);
    this.pushState(helperId, newVal);
  }

  turnOn(helperId: string): void {
    this.stateStore.updateVirtualState(helperId, true);
    this.pushState(helperId, true);
  }

  turnOff(helperId: string): void {
    this.stateStore.updateVirtualState(helperId, false);
    this.pushState(helperId, false);
  }

  // ============================================================
  // Input Number
  // ============================================================

  setNumber(helperId: string, value: number): void {
    const def = this.helpers.get(helperId);
    if (def?.type === 'input_number') {
      const clamped = Math.max(def.min, Math.min(def.max, value));
      this.stateStore.updateVirtualState(helperId, clamped);
      this.pushState(helperId, clamped);
    }
  }

  increment(helperId: string, step?: number): void {
    const def = this.helpers.get(helperId);
    const current = Number(this.stateStore.getVirtualState(helperId) ?? 0);
    const s = step ?? (def?.type === 'input_number' ? def.step : 1);
    this.setNumber(helperId, current + s);
  }

  decrement(helperId: string, step?: number): void {
    const def = this.helpers.get(helperId);
    const current = Number(this.stateStore.getVirtualState(helperId) ?? 0);
    const s = step ?? (def?.type === 'input_number' ? def.step : 1);
    this.setNumber(helperId, current - s);
  }

  // ============================================================
  // Input Select
  // ============================================================

  selectOption(helperId: string, option: string): void {
    this.stateStore.updateVirtualState(helperId, option);
    this.pushState(helperId, option);
  }

  // ============================================================
  // Input Text
  // ============================================================

  setText(helperId: string, text: string): void {
    this.stateStore.updateVirtualState(helperId, text);
    this.pushState(helperId, text);
  }

  // ============================================================
  // Counter
  // ============================================================

  incrementCounter(helperId: string): void {
    const def = this.helpers.get(helperId);
    const current = Number(this.stateStore.getVirtualState(helperId) ?? 0);
    const step = (def?.type === 'counter' ? def.step : undefined) ?? 1;
    const max = (def?.type === 'counter' ? def.max : undefined) ?? Infinity;
    const newVal = Math.min(current + step, max);
    this.stateStore.updateVirtualState(helperId, newVal);
    this.pushState(helperId, newVal);
  }

  decrementCounter(helperId: string): void {
    const def = this.helpers.get(helperId);
    const current = Number(this.stateStore.getVirtualState(helperId) ?? 0);
    const step = (def?.type === 'counter' ? def.step : undefined) ?? 1;
    const min = (def?.type === 'counter' ? def.min : undefined) ?? -Infinity;
    const newVal = Math.max(current - step, min);
    this.stateStore.updateVirtualState(helperId, newVal);
    this.pushState(helperId, newVal);
  }

  resetCounter(helperId: string): void {
    const def = this.helpers.get(helperId);
    const initial = (def?.type === 'counter' ? def.initial : undefined) ?? 0;
    this.stateStore.updateVirtualState(helperId, initial);
    this.pushState(helperId, initial);
  }

  // ============================================================
  // Type-dispatching entry points (used by the `helper` action)
  // ============================================================

  /** Set a helper's value, routing to the right setter for its type. */
  setVirtualValue(helperId: string, value: unknown): void {
    const def = this.helpers.get(helperId);
    switch (def?.type) {
      case 'input_number':
        this.setNumber(helperId, Number(value));
        break;
      case 'input_select':
        this.selectOption(helperId, String(value));
        break;
      case 'input_text':
      case 'input_datetime':
        this.setText(helperId, String(value));
        break;
      case 'input_boolean':
        if (value) this.turnOn(helperId); else this.turnOff(helperId);
        break;
      case 'counter': {
        const n = Number(value);
        this.stateStore.updateVirtualState(helperId, n);
        this.pushState(helperId, n);
        break;
      }
      default:
        throw new Error(`Cannot set a value on helper ${helperId}`);
    }
  }

  /** Increment a counter or input_number. */
  incrementVirtual(helperId: string, step?: number): void {
    const def = this.helpers.get(helperId);
    if (def?.type === 'counter') this.incrementCounter(helperId);
    else this.increment(helperId, step);
  }

  /** Decrement a counter or input_number. */
  decrementVirtual(helperId: string, step?: number): void {
    const def = this.helpers.get(helperId);
    if (def?.type === 'counter') this.decrementCounter(helperId);
    else this.decrement(helperId, step);
  }

  /**
   * Reapply persisted values after a restart, so counters and modes survive a
   * relay restart rather than resetting to their initial value.
   */
  restoreStates(states: Record<string, unknown>): void {
    for (const [helperId, value] of Object.entries(states)) {
      if (!this.helpers.has(helperId)) continue;
      // Timers are not resumed — a half-elapsed countdown can't be trusted
      // across a restart, and `restoreOnRestart` is not implemented.
      if (this.helpers.get(helperId)?.type === 'timer') continue;
      this.stateStore.updateVirtualState(helperId, value);
    }
  }

  // ============================================================
  // Timer
  // ============================================================

  startTimer(helperId: string, duration?: Duration): void {
    this.cancelTimer(helperId);

    const def = this.helpers.get(helperId);
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
      this.stateStore.updateVirtualState(helperId, 'idle');
      this.fireEvent('timer.finished', { helperId });
      this.pushState(helperId, 'idle');
    }, totalMs);

    this.timers.set(helperId, timerState);
    this.stateStore.updateVirtualState(helperId, 'active');
    this.fireEvent('timer.started', { helperId, duration: totalMs });
    this.pushState(helperId, 'active');
  }

  pauseTimer(helperId: string): void {
    const timerState = this.timers.get(helperId);
    if (!timerState || timerState.state !== 'active') return;

    if (timerState.timer) clearTimeout(timerState.timer);
    timerState.timer = undefined;

    const elapsed = Date.now() - (timerState.startedAt ?? Date.now());
    timerState.remaining = Math.max(0, timerState.remaining - elapsed);
    timerState.state = 'paused';

    this.stateStore.updateVirtualState(helperId, 'paused');
    this.fireEvent('timer.paused', { helperId, remaining: timerState.remaining });
    this.pushState(helperId, 'paused');
  }

  resumeTimer(helperId: string): void {
    const timerState = this.timers.get(helperId);
    if (!timerState || timerState.state !== 'paused' || timerState.remaining <= 0) return;

    timerState.state = 'active';
    timerState.startedAt = Date.now();

    timerState.timer = setTimeout(() => {
      timerState.state = 'idle';
      timerState.remaining = 0;
      this.stateStore.updateVirtualState(helperId, 'idle');
      this.fireEvent('timer.finished', { helperId });
      this.pushState(helperId, 'idle');
    }, timerState.remaining);

    this.stateStore.updateVirtualState(helperId, 'active');
    this.fireEvent('timer.resumed', { helperId });
    this.pushState(helperId, 'active');
  }

  cancelTimer(helperId: string): void {
    const timerState = this.timers.get(helperId);
    if (!timerState) return;

    if (timerState.timer) clearTimeout(timerState.timer);
    timerState.timer = undefined;

    if (timerState.state !== 'idle') {
      timerState.state = 'idle';
      timerState.remaining = 0;
      this.stateStore.updateVirtualState(helperId, 'idle');
      this.fireEvent('timer.cancelled', { helperId });
      this.pushState(helperId, 'idle');
    }
  }

  finishTimer(helperId: string): void {
    const timerState = this.timers.get(helperId);
    if (!timerState || timerState.state === 'idle') return;

    if (timerState.timer) clearTimeout(timerState.timer);
    timerState.timer = undefined;
    timerState.state = 'idle';
    timerState.remaining = 0;

    this.stateStore.updateVirtualState(helperId, 'idle');
    this.fireEvent('timer.finished', { helperId });
    this.pushState(helperId, 'idle');
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
    helperId: string,
    operation: VirtualOperation,
    opts: { value?: unknown; step?: number; duration?: Duration } = {},
  ): void {
    switch (operation) {
      case 'turn_on': this.turnOn(helperId); break;
      case 'turn_off': this.turnOff(helperId); break;
      case 'toggle': this.toggle(helperId); break;
      case 'set': this.setVirtualValue(helperId, opts.value); break;
      case 'increment': this.incrementVirtual(helperId, opts.step); break;
      case 'decrement': this.decrementVirtual(helperId, opts.step); break;
      case 'reset': this.resetCounter(helperId); break;
      case 'start': this.startTimer(helperId, opts.duration); break;
      case 'pause': this.pauseTimer(helperId); break;
      case 'resume': this.resumeTimer(helperId); break;
      case 'cancel': this.cancelTimer(helperId); break;
      case 'finish': this.finishTimer(helperId); break;
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
    return this.helpers.get(id);
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
