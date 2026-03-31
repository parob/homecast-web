// Homecast Automation Engine - Helper Manager
// Virtual entity management: input_boolean, input_number, input_select, timer, counter, etc.

import type { StateStore } from './StateStore';
import type { HelperDefinition, Duration } from '../types/automation';
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
export class HelperManager {
  private helpers = new Map<string, HelperDefinition>();
  private timers = new Map<string, TimerState>();

  constructor(
    private stateStore: StateStore,
    private fireEvent: EventEmitter,
    private pushState: StatePusher,
  ) {}

  // ============================================================
  // Registration
  // ============================================================

  register(helper: HelperDefinition): void {
    this.helpers.set(helper.id, helper);

    // Set initial state
    switch (helper.type) {
      case 'input_boolean':
        this.stateStore.updateHelperState(helper.id, helper.initialValue ?? false);
        break;
      case 'input_number':
        this.stateStore.updateHelperState(helper.id, helper.initialValue ?? helper.min);
        break;
      case 'input_select':
        this.stateStore.updateHelperState(helper.id, helper.initialValue ?? helper.options[0] ?? '');
        break;
      case 'input_text':
        this.stateStore.updateHelperState(helper.id, helper.initialValue ?? '');
        break;
      case 'input_datetime':
        this.stateStore.updateHelperState(helper.id, helper.initialValue ?? '');
        break;
      case 'timer':
        this.timers.set(helper.id, { state: 'idle', duration: 0, remaining: 0 });
        this.stateStore.updateHelperState(helper.id, 'idle');
        break;
      case 'counter':
        this.stateStore.updateHelperState(helper.id, helper.initial ?? 0);
        break;
      case 'schedule':
        this.stateStore.updateHelperState(helper.id, this.isScheduleActive(helper) ? 'on' : 'off');
        break;
    }
  }

  loadAll(helpers: HelperDefinition[]): void {
    for (const h of helpers) this.register(h);
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
    const current = this.stateStore.getHelperState(helperId);
    const newVal = !current;
    this.stateStore.updateHelperState(helperId, newVal);
    this.pushState(helperId, newVal);
  }

  turnOn(helperId: string): void {
    this.stateStore.updateHelperState(helperId, true);
    this.pushState(helperId, true);
  }

  turnOff(helperId: string): void {
    this.stateStore.updateHelperState(helperId, false);
    this.pushState(helperId, false);
  }

  // ============================================================
  // Input Number
  // ============================================================

  setNumber(helperId: string, value: number): void {
    const def = this.helpers.get(helperId);
    if (def?.type === 'input_number') {
      const clamped = Math.max(def.min, Math.min(def.max, value));
      this.stateStore.updateHelperState(helperId, clamped);
      this.pushState(helperId, clamped);
    }
  }

  increment(helperId: string, step?: number): void {
    const def = this.helpers.get(helperId);
    const current = Number(this.stateStore.getHelperState(helperId) ?? 0);
    const s = step ?? (def?.type === 'input_number' ? def.step : 1);
    this.setNumber(helperId, current + s);
  }

  decrement(helperId: string, step?: number): void {
    const def = this.helpers.get(helperId);
    const current = Number(this.stateStore.getHelperState(helperId) ?? 0);
    const s = step ?? (def?.type === 'input_number' ? def.step : 1);
    this.setNumber(helperId, current - s);
  }

  // ============================================================
  // Input Select
  // ============================================================

  selectOption(helperId: string, option: string): void {
    this.stateStore.updateHelperState(helperId, option);
    this.pushState(helperId, option);
  }

  // ============================================================
  // Input Text
  // ============================================================

  setText(helperId: string, text: string): void {
    this.stateStore.updateHelperState(helperId, text);
    this.pushState(helperId, text);
  }

  // ============================================================
  // Counter
  // ============================================================

  incrementCounter(helperId: string): void {
    const def = this.helpers.get(helperId);
    const current = Number(this.stateStore.getHelperState(helperId) ?? 0);
    const step = (def?.type === 'counter' ? def.step : undefined) ?? 1;
    const max = (def?.type === 'counter' ? def.max : undefined) ?? Infinity;
    const newVal = Math.min(current + step, max);
    this.stateStore.updateHelperState(helperId, newVal);
    this.pushState(helperId, newVal);
  }

  decrementCounter(helperId: string): void {
    const def = this.helpers.get(helperId);
    const current = Number(this.stateStore.getHelperState(helperId) ?? 0);
    const step = (def?.type === 'counter' ? def.step : undefined) ?? 1;
    const min = (def?.type === 'counter' ? def.min : undefined) ?? -Infinity;
    const newVal = Math.max(current - step, min);
    this.stateStore.updateHelperState(helperId, newVal);
    this.pushState(helperId, newVal);
  }

  resetCounter(helperId: string): void {
    const def = this.helpers.get(helperId);
    const initial = (def?.type === 'counter' ? def.initial : undefined) ?? 0;
    this.stateStore.updateHelperState(helperId, initial);
    this.pushState(helperId, initial);
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
      this.stateStore.updateHelperState(helperId, 'idle');
      this.fireEvent('timer.finished', { helperId });
      this.pushState(helperId, 'idle');
    }, totalMs);

    this.timers.set(helperId, timerState);
    this.stateStore.updateHelperState(helperId, 'active');
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

    this.stateStore.updateHelperState(helperId, 'paused');
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
      this.stateStore.updateHelperState(helperId, 'idle');
      this.fireEvent('timer.finished', { helperId });
      this.pushState(helperId, 'idle');
    }, timerState.remaining);

    this.stateStore.updateHelperState(helperId, 'active');
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
      this.stateStore.updateHelperState(helperId, 'idle');
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

    this.stateStore.updateHelperState(helperId, 'idle');
    this.fireEvent('timer.finished', { helperId });
    this.pushState(helperId, 'idle');
  }

  // ============================================================
  // Schedule
  // ============================================================

  private isScheduleActive(helper: HelperDefinition & { type: 'schedule' }): boolean {
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
  // Query
  // ============================================================

  getHelper(id: string): HelperDefinition | undefined {
    return this.helpers.get(id);
  }

  getAllHelpers(): HelperDefinition[] {
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
