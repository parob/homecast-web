// Homecast Automation Engine - Trigger Manager
// Registers and evaluates triggers, calling back when they fire

import type { StateStore } from '../state/StateStore';
import type {
  Trigger,
  TriggerData,
  StateTrigger,
  NumericStateTrigger,
  TimeTrigger,
  TimePatternTrigger,
  SunTrigger,
  TemplateTrigger,
  Duration,
} from '../types/automation';
import { durationToMs } from '../types/automation';
import type { StateChangeEvent } from '../types/execution';
import { getNextSunEvent } from '../state/SunCalculator';
import { ExpressionEngine } from '../expression/ExpressionEngine';
import type { ExpressionContext } from '../expression/ExpressionEngine';

export type TriggerCallback = (triggerData: TriggerData) => void;

interface TriggerRegistration {
  automationId: string;
  trigger: Trigger;
  callback: TriggerCallback;
}

interface StateTriggerEntry extends TriggerRegistration {
  trigger: StateTrigger;
  forTimer?: ReturnType<typeof setTimeout>;
}

interface NumericTriggerEntry extends TriggerRegistration {
  trigger: NumericStateTrigger;
  forTimer?: ReturnType<typeof setTimeout>;
  wasAbove?: boolean;
  wasBelow?: boolean;
}

interface TimeSchedule {
  automationId: string;
  trigger: TimeTrigger;
  callback: TriggerCallback;
  timer?: ReturnType<typeof setTimeout>;
}

interface TimePatternSchedule {
  automationId: string;
  trigger: TimePatternTrigger;
  callback: TriggerCallback;
  interval?: ReturnType<typeof setInterval>;
  initialTimer?: ReturnType<typeof setTimeout>;
}

interface SunSchedule {
  automationId: string;
  trigger: SunTrigger;
  callback: TriggerCallback;
  timer?: ReturnType<typeof setTimeout>;
}

interface TemplateTriggerEntry {
  automationId: string;
  trigger: TemplateTrigger;
  callback: TriggerCallback;
  previousValue: boolean;
  forTimer?: ReturnType<typeof setTimeout>;
}

/** Resolves which service groups an accessory belongs to (for group triggers) */
export interface ServiceGroupResolver {
  getGroupsForAccessory(accessoryId: string): string[];
}

/**
 * Manages trigger registration and evaluation.
 * Supports: state, numeric_state, time, time_pattern, sun, event, system, template triggers.
 * Supports service group triggers via dynamic reverse-index lookup.
 */
export class TriggerManager {
  // State triggers indexed by "accessoryId:characteristicType"
  private stateTriggers = new Map<string, StateTriggerEntry[]>();

  // Numeric state triggers indexed by "accessoryId:characteristicType"
  private numericTriggers = new Map<string, NumericTriggerEntry[]>();

  // Service group triggers indexed by "groupId:characteristicType"
  private serviceGroupStateTriggers = new Map<string, StateTriggerEntry[]>();
  private serviceGroupNumericTriggers = new Map<string, NumericTriggerEntry[]>();

  // Time-based triggers
  private timeSchedules = new Map<string, TimeSchedule[]>(); // automationId -> schedules
  private timePatternSchedules = new Map<string, TimePatternSchedule[]>();

  // Sun triggers
  private sunSchedules = new Map<string, SunSchedule[]>();

  // Template triggers (re-evaluate on any state change)
  private templateTriggers: TemplateTriggerEntry[] = [];
  private expressionEngine = new ExpressionEngine();

  // Location for sun calculations (user-configured)
  private latitude = 0;
  private longitude = 0;

  // Event triggers (for inter-automation events)
  private eventTriggers = new Map<string, TriggerRegistration[]>(); // eventType -> registrations

  // Global unsubscribe from StateStore
  private stateStoreUnsubscribe?: () => void;

  constructor(
    private stateStore: StateStore,
    private serviceGroupResolver?: ServiceGroupResolver,
  ) {}

  // ============================================================
  // Registration
  // ============================================================

  /**
   * Register all triggers for an automation.
   */
  registerTriggers(automationId: string, triggers: Trigger[], callback: TriggerCallback): void {
    for (const trigger of triggers) {
      if (trigger.enabled === false) continue;
      this.registerSingleTrigger(automationId, trigger, callback);
    }
  }

  private registerSingleTrigger(
    automationId: string,
    trigger: Trigger,
    callback: TriggerCallback,
  ): void {
    switch (trigger.type) {
      case 'state':
        this.registerStateTrigger(automationId, trigger, callback);
        break;
      case 'numeric_state':
        this.registerNumericStateTrigger(automationId, trigger, callback);
        break;
      case 'time':
        this.registerTimeTrigger(automationId, trigger, callback);
        break;
      case 'time_pattern':
        this.registerTimePatternTrigger(automationId, trigger, callback);
        break;
      case 'event':
        this.registerEventTrigger(automationId, trigger, callback);
        break;
      case 'sun':
        this.registerSunTrigger(automationId, trigger, callback);
        break;
      case 'system':
        // System triggers fire via handleEvent('system.relay_connected') etc.
        this.registerEventTrigger(automationId, { ...trigger, type: 'event', eventType: `system.${trigger.event}` } as Trigger & { type: 'event'; eventType: string }, callback);
        break;
      case 'template':
        this.registerTemplateTrigger(automationId, trigger, callback);
        break;
      case 'webhook':
        // Webhook triggers are forwarded from server as events
        this.registerEventTrigger(automationId, { ...trigger, type: 'event', eventType: `webhook.${trigger.webhookId}` } as Trigger & { type: 'event'; eventType: string }, callback);
        break;
      default:
        console.warn(`[TriggerManager] Unsupported trigger type: ${(trigger as Trigger).type}`);
    }
  }

  private registerStateTrigger(
    automationId: string,
    trigger: StateTrigger,
    callback: TriggerCallback,
  ): void {
    // Service group trigger — register by groupId
    if (trigger.serviceGroupId && !trigger.accessoryId) {
      const key = `${trigger.serviceGroupId}:${trigger.characteristicType}`;
      let entries = this.serviceGroupStateTriggers.get(key);
      if (!entries) {
        entries = [];
        this.serviceGroupStateTriggers.set(key, entries);
      }
      entries.push({ automationId, trigger, callback });
      return;
    }

    const key = `${trigger.accessoryId ?? ''}:${trigger.characteristicType}`;
    let entries = this.stateTriggers.get(key);
    if (!entries) {
      entries = [];
      this.stateTriggers.set(key, entries);
    }
    entries.push({ automationId, trigger, callback });
  }

  private registerNumericStateTrigger(
    automationId: string,
    trigger: NumericStateTrigger,
    callback: TriggerCallback,
  ): void {
    // Service group trigger — register by groupId
    if (trigger.serviceGroupId && !trigger.accessoryId) {
      const key = `${trigger.serviceGroupId}:${trigger.characteristicType}`;
      let entries = this.serviceGroupNumericTriggers.get(key);
      if (!entries) {
        entries = [];
        this.serviceGroupNumericTriggers.set(key, entries);
      }
      entries.push({
        automationId,
        trigger,
        callback,
        wasAbove: undefined,
        wasBelow: undefined,
      });
      return;
    }

    const key = `${trigger.accessoryId ?? ''}:${trigger.characteristicType}`;
    let entries = this.numericTriggers.get(key);
    if (!entries) {
      entries = [];
      this.numericTriggers.set(key, entries);
    }

    // Initialize crossing state from current value
    const currentValue = trigger.accessoryId
      ? this.stateStore.getState(trigger.accessoryId, trigger.characteristicType)
      : undefined;
    const numVal = typeof currentValue === 'number' ? currentValue : undefined;
    entries.push({
      automationId,
      trigger,
      callback,
      wasAbove: numVal !== undefined && trigger.above !== undefined ? numVal > trigger.above : undefined,
      wasBelow: numVal !== undefined && trigger.below !== undefined ? numVal < trigger.below : undefined,
    });
  }

  private registerTimeTrigger(
    automationId: string,
    trigger: TimeTrigger,
    callback: TriggerCallback,
  ): void {
    const schedule: TimeSchedule = { automationId, trigger, callback };
    this.scheduleNextTimeExecution(schedule);

    let schedules = this.timeSchedules.get(automationId);
    if (!schedules) {
      schedules = [];
      this.timeSchedules.set(automationId, schedules);
    }
    schedules.push(schedule);
  }

  private registerTimePatternTrigger(
    automationId: string,
    trigger: TimePatternTrigger,
    callback: TriggerCallback,
  ): void {
    const schedule: TimePatternSchedule = { automationId, trigger, callback };
    this.startTimePattern(schedule);

    let schedules = this.timePatternSchedules.get(automationId);
    if (!schedules) {
      schedules = [];
      this.timePatternSchedules.set(automationId, schedules);
    }
    schedules.push(schedule);
  }

  private registerEventTrigger(
    automationId: string,
    trigger: Trigger & { type: 'event'; eventType: string },
    callback: TriggerCallback,
  ): void {
    const key = trigger.eventType;
    let entries = this.eventTriggers.get(key);
    if (!entries) {
      entries = [];
      this.eventTriggers.set(key, entries);
    }
    entries.push({ automationId, trigger, callback });
  }

  private registerSunTrigger(
    automationId: string,
    trigger: SunTrigger,
    callback: TriggerCallback,
  ): void {
    const schedule: SunSchedule = { automationId, trigger, callback };
    this.scheduleSunTrigger(schedule);

    let schedules = this.sunSchedules.get(automationId);
    if (!schedules) {
      schedules = [];
      this.sunSchedules.set(automationId, schedules);
    }
    schedules.push(schedule);
  }

  private scheduleSunTrigger(schedule: SunSchedule): void {
    const offsetMs = schedule.trigger.offset ? durationToMs(schedule.trigger.offset) : 0;
    // Handle negative offset (before event)
    const adjustedOffset = schedule.trigger.offset?.hours !== undefined && schedule.trigger.offset.hours < 0
      ? -durationToMs({ hours: -schedule.trigger.offset.hours, minutes: schedule.trigger.offset.minutes, seconds: schedule.trigger.offset.seconds })
      : offsetMs;

    const nextEvent = getNextSunEvent(
      schedule.trigger.event,
      this.latitude,
      this.longitude,
      adjustedOffset,
    );

    const ms = nextEvent.getTime() - Date.now();
    if (ms <= 0) return; // shouldn't happen, but guard

    schedule.timer = setTimeout(() => {
      schedule.callback({
        triggerId: schedule.trigger.id,
        triggerType: 'sun',
        eventType: schedule.trigger.event,
        timestamp: Date.now(),
      });
      // Reschedule for next day
      this.scheduleSunTrigger(schedule);
    }, ms);
  }

  private registerTemplateTrigger(
    automationId: string,
    trigger: TemplateTrigger,
    callback: TriggerCallback,
  ): void {
    // Evaluate initial value
    const ctx = this.buildExpressionContext();
    let initialValue = false;
    try {
      initialValue = this.expressionEngine.evaluateBoolean(trigger.expression, ctx);
    } catch { /* ignore parse errors on init */ }

    this.templateTriggers.push({
      automationId,
      trigger,
      callback,
      previousValue: initialValue,
    });
  }

  /** Set location for sun calculations */
  setLocation(latitude: number, longitude: number): void {
    this.latitude = latitude;
    this.longitude = longitude;
  }

  // ============================================================
  // Unregistration
  // ============================================================

  /**
   * Unregister all triggers for an automation.
   */
  unregisterTriggers(automationId: string): void {
    // State triggers
    for (const [key, entries] of this.stateTriggers) {
      const filtered = entries.filter((e) => {
        if (e.automationId === automationId) {
          if (e.forTimer) clearTimeout(e.forTimer);
          return false;
        }
        return true;
      });
      if (filtered.length === 0) this.stateTriggers.delete(key);
      else this.stateTriggers.set(key, filtered);
    }

    // Numeric triggers
    for (const [key, entries] of this.numericTriggers) {
      const filtered = entries.filter((e) => {
        if (e.automationId === automationId) {
          if (e.forTimer) clearTimeout(e.forTimer);
          return false;
        }
        return true;
      });
      if (filtered.length === 0) this.numericTriggers.delete(key);
      else this.numericTriggers.set(key, filtered);
    }

    // Time schedules
    const times = this.timeSchedules.get(automationId);
    if (times) {
      for (const s of times) {
        if (s.timer) clearTimeout(s.timer);
      }
      this.timeSchedules.delete(automationId);
    }

    // Time pattern schedules
    const patterns = this.timePatternSchedules.get(automationId);
    if (patterns) {
      for (const s of patterns) {
        if (s.interval) clearInterval(s.interval);
        if (s.initialTimer) clearTimeout(s.initialTimer);
      }
      this.timePatternSchedules.delete(automationId);
    }

    // Event triggers
    for (const [key, entries] of this.eventTriggers) {
      const filtered = entries.filter((e) => e.automationId !== automationId);
      if (filtered.length === 0) this.eventTriggers.delete(key);
      else this.eventTriggers.set(key, filtered);
    }

    // Sun schedules
    const suns = this.sunSchedules.get(automationId);
    if (suns) {
      for (const s of suns) {
        if (s.timer) clearTimeout(s.timer);
      }
      this.sunSchedules.delete(automationId);
    }

    // Service group state triggers
    for (const [key, entries] of this.serviceGroupStateTriggers) {
      const filtered = entries.filter((e) => {
        if (e.automationId === automationId) {
          if (e.forTimer) clearTimeout(e.forTimer);
          return false;
        }
        return true;
      });
      if (filtered.length === 0) this.serviceGroupStateTriggers.delete(key);
      else this.serviceGroupStateTriggers.set(key, filtered);
    }

    // Service group numeric triggers
    for (const [key, entries] of this.serviceGroupNumericTriggers) {
      const filtered = entries.filter((e) => {
        if (e.automationId === automationId) {
          if (e.forTimer) clearTimeout(e.forTimer);
          return false;
        }
        return true;
      });
      if (filtered.length === 0) this.serviceGroupNumericTriggers.delete(key);
      else this.serviceGroupNumericTriggers.set(key, filtered);
    }

    // Template triggers
    this.templateTriggers = this.templateTriggers.filter((e) => {
      if (e.automationId === automationId) {
        if (e.forTimer) clearTimeout(e.forTimer);
        return false;
      }
      return true;
    });
  }

  // ============================================================
  // State change handling
  // ============================================================

  /**
   * Initialize: subscribe to state store for all state changes.
   */
  initialize(): void {
    this.stateStoreUnsubscribe = this.stateStore.onAnyStateChange((event) => {
      this.handleStateChange(event);
    });
  }

  private handleStateChange(event: StateChangeEvent): void {
    const key = `${event.accessoryId}:${event.characteristicType}`;

    // Check state triggers
    const stateEntries = this.stateTriggers.get(key);
    if (stateEntries) {
      for (const entry of stateEntries) {
        this.evaluateStateTrigger(entry, event);
      }
    }

    // Check numeric state triggers
    const numericEntries = this.numericTriggers.get(key);
    if (numericEntries) {
      for (const entry of numericEntries) {
        this.evaluateNumericStateTrigger(entry, event);
      }
    }

    // Check service group triggers — look up which groups contain this accessory
    if (this.serviceGroupResolver &&
        (this.serviceGroupStateTriggers.size > 0 || this.serviceGroupNumericTriggers.size > 0)) {
      const groupIds = this.serviceGroupResolver.getGroupsForAccessory(event.accessoryId);
      for (const groupId of groupIds) {
        const groupKey = `${groupId}:${event.characteristicType}`;

        const groupStateEntries = this.serviceGroupStateTriggers.get(groupKey);
        if (groupStateEntries) {
          for (const entry of groupStateEntries) {
            this.evaluateStateTrigger(entry, event, groupId);
          }
        }

        const groupNumericEntries = this.serviceGroupNumericTriggers.get(groupKey);
        if (groupNumericEntries) {
          for (const entry of groupNumericEntries) {
            this.evaluateNumericStateTrigger(entry, event, groupId);
          }
        }
      }
    }

    // Check template triggers (re-evaluate on any state change)
    this.evaluateTemplateTriggers();
  }

  private evaluateTemplateTriggers(): void {
    const ctx = this.buildExpressionContext();

    for (const entry of this.templateTriggers) {
      try {
        const currentValue = this.expressionEngine.evaluateBoolean(entry.trigger.expression, ctx);

        // Fire on false -> true transition
        if (currentValue && !entry.previousValue) {
          const triggerData: TriggerData = {
            triggerId: entry.trigger.id,
            triggerType: 'template',
            timestamp: Date.now(),
          };

          if (entry.trigger.for) {
            if (entry.forTimer) clearTimeout(entry.forTimer);
            entry.forTimer = setTimeout(() => {
              // Re-check the expression is still true
              const recheckCtx = this.buildExpressionContext();
              try {
                if (this.expressionEngine.evaluateBoolean(entry.trigger.expression, recheckCtx)) {
                  entry.callback(triggerData);
                }
              } catch { /* ignore */ }
            }, durationToMs(entry.trigger.for));
          } else {
            entry.callback(triggerData);
          }
        } else if (!currentValue && entry.previousValue && entry.forTimer) {
          // State went back to false before "for" duration elapsed
          clearTimeout(entry.forTimer);
          entry.forTimer = undefined;
        }

        entry.previousValue = currentValue;
      } catch {
        // Expression evaluation errors are silently ignored
      }
    }
  }

  private buildExpressionContext(): ExpressionContext {
    return ExpressionEngine.buildContext(
      this.stateStore,
      { triggerId: '', triggerType: 'state', timestamp: Date.now() },
      {},
    );
  }

  private evaluateStateTrigger(entry: StateTriggerEntry, event: StateChangeEvent, serviceGroupId?: string): void {
    const { trigger } = entry;

    // Check from filter
    if (trigger.from !== undefined && !this.valueMatches(event.oldValue, trigger.from)) return;
    // Check to filter
    if (trigger.to !== undefined && !this.valueMatches(event.newValue, trigger.to)) return;

    const triggerData: TriggerData = {
      triggerId: trigger.id,
      triggerType: 'state',
      fromValue: event.oldValue,
      toValue: event.newValue,
      accessoryId: event.accessoryId,
      serviceGroupId: serviceGroupId ?? trigger.serviceGroupId,
      characteristicType: event.characteristicType,
      timestamp: event.timestamp,
    };

    // If "for" duration specified, start a timer
    if (trigger.for) {
      if (entry.forTimer) clearTimeout(entry.forTimer);
      entry.forTimer = setTimeout(() => {
        // Verify the state is still the same (use event's accessoryId for group triggers)
        const currentValue = this.stateStore.getState(
          event.accessoryId,
          trigger.characteristicType,
        );
        if (trigger.to !== undefined && !this.valueMatches(currentValue, trigger.to)) return;
        entry.callback(triggerData);
      }, durationToMs(trigger.for));
    } else {
      entry.callback(triggerData);
    }
  }

  private evaluateNumericStateTrigger(entry: NumericTriggerEntry, event: StateChangeEvent, serviceGroupId?: string): void {
    const { trigger } = entry;
    const newVal = typeof event.newValue === 'number' ? event.newValue : parseFloat(String(event.newValue));
    if (isNaN(newVal)) return;

    // Check if value crosses a threshold
    let shouldFire = false;

    if (trigger.above !== undefined) {
      const nowAbove = newVal > trigger.above;
      if (nowAbove && entry.wasAbove === false) shouldFire = true;
      entry.wasAbove = nowAbove;
    }

    if (trigger.below !== undefined) {
      const nowBelow = newVal < trigger.below;
      if (nowBelow && entry.wasBelow === false) shouldFire = true;
      entry.wasBelow = nowBelow;
    }

    if (!shouldFire) return;

    const triggerData: TriggerData = {
      triggerId: trigger.id,
      triggerType: 'numeric_state',
      fromValue: event.oldValue,
      toValue: event.newValue,
      accessoryId: event.accessoryId,
      serviceGroupId: serviceGroupId ?? trigger.serviceGroupId,
      characteristicType: event.characteristicType,
      timestamp: event.timestamp,
    };

    if (trigger.for) {
      if (entry.forTimer) clearTimeout(entry.forTimer);
      entry.forTimer = setTimeout(() => {
        const currentValue = this.stateStore.getState(event.accessoryId, trigger.characteristicType);
        const cv = typeof currentValue === 'number' ? currentValue : parseFloat(String(currentValue));
        if (isNaN(cv)) return;
        if (trigger.above !== undefined && cv <= trigger.above) return;
        if (trigger.below !== undefined && cv >= trigger.below) return;
        entry.callback(triggerData);
      }, durationToMs(trigger.for));
    } else {
      entry.callback(triggerData);
    }
  }

  // ============================================================
  // Event handling (inter-automation)
  // ============================================================

  /**
   * Fire a custom event. Checks all registered event triggers.
   */
  handleEvent(eventType: string, eventData?: Record<string, unknown>): void {
    const entries = this.eventTriggers.get(eventType);
    if (!entries) return;

    for (const entry of entries) {
      const trigger = entry.trigger as Trigger & { type: 'event'; eventData?: Record<string, unknown> };

      // If trigger has eventData filter, check it matches
      if (trigger.eventData) {
        const matches = Object.entries(trigger.eventData).every(
          ([k, v]) => eventData?.[k] === v,
        );
        if (!matches) continue;
      }

      entry.callback({
        triggerId: trigger.id,
        triggerType: 'event',
        eventType,
        eventData,
        timestamp: Date.now(),
      });
    }
  }

  // ============================================================
  // Time scheduling
  // ============================================================

  private scheduleNextTimeExecution(schedule: TimeSchedule): void {
    const ms = this.msUntilNextTime(schedule.trigger.at, schedule.trigger.weekdays);
    if (ms === null) return;

    schedule.timer = setTimeout(() => {
      schedule.callback({
        triggerId: schedule.trigger.id,
        triggerType: 'time',
        timestamp: Date.now(),
      });
      // Reschedule for next occurrence
      this.scheduleNextTimeExecution(schedule);
    }, ms);
  }

  private msUntilNextTime(timeStr: string, weekdays?: number[]): number | null {
    const parts = timeStr.split(':');
    if (parts.length < 2) return null;

    const targetHour = parseInt(parts[0], 10);
    const targetMinute = parseInt(parts[1], 10);
    const targetSecond = parts.length > 2 ? parseInt(parts[2], 10) : 0;

    const now = new Date();
    const target = new Date(now);
    target.setHours(targetHour, targetMinute, targetSecond, 0);

    // If the time has already passed today, move to tomorrow
    if (target.getTime() <= now.getTime()) {
      target.setDate(target.getDate() + 1);
    }

    // If weekday filter, advance to the next matching day
    if (weekdays && weekdays.length > 0) {
      for (let i = 0; i < 7; i++) {
        if (weekdays.includes(target.getDay())) break;
        target.setDate(target.getDate() + 1);
      }
    }

    return target.getTime() - now.getTime();
  }

  private startTimePattern(schedule: TimePatternSchedule): void {
    const { trigger } = schedule;
    const intervalMs = this.computePatternIntervalMs(trigger);
    if (intervalMs === null) return;

    // Calculate ms until the next aligned tick
    const now = Date.now();
    const msUntilNext = intervalMs - (now % intervalMs);

    schedule.initialTimer = setTimeout(() => {
      // Fire immediately at the aligned time
      schedule.callback({
        triggerId: trigger.id,
        triggerType: 'time_pattern',
        timestamp: Date.now(),
      });
      // Then start the interval
      schedule.interval = setInterval(() => {
        schedule.callback({
          triggerId: trigger.id,
          triggerType: 'time_pattern',
          timestamp: Date.now(),
        });
      }, intervalMs);
    }, msUntilNext);
  }

  private computePatternIntervalMs(trigger: TimePatternTrigger): number | null {
    // Parse interval patterns like "/5" (every 5), "30" (at :30), "*" (every)
    if (trigger.seconds) {
      const sec = this.parsePatternValue(trigger.seconds);
      if (sec) return sec * 1000;
    }
    if (trigger.minutes) {
      const min = this.parsePatternValue(trigger.minutes);
      if (min) return min * 60 * 1000;
    }
    if (trigger.hours) {
      const hr = this.parsePatternValue(trigger.hours);
      if (hr) return hr * 3600 * 1000;
    }
    return null;
  }

  private parsePatternValue(pattern: string): number | null {
    if (pattern === '*') return 1;
    if (pattern.startsWith('/')) {
      const val = parseInt(pattern.slice(1), 10);
      return isNaN(val) ? null : val;
    }
    // Specific value — treat as "every N" for simplicity in Phase 1
    const val = parseInt(pattern, 10);
    return isNaN(val) ? null : val;
  }

  // ============================================================
  // Recalculation (after sleep/wake)
  // ============================================================

  /**
   * Recalculate all time-based triggers (call after sleep/wake or reconnect).
   */
  recalculateTimeTriggers(): void {
    for (const schedules of this.timeSchedules.values()) {
      for (const schedule of schedules) {
        if (schedule.timer) clearTimeout(schedule.timer);
        this.scheduleNextTimeExecution(schedule);
      }
    }

    for (const schedules of this.timePatternSchedules.values()) {
      for (const schedule of schedules) {
        if (schedule.interval) clearInterval(schedule.interval);
        if (schedule.initialTimer) clearTimeout(schedule.initialTimer);
        this.startTimePattern(schedule);
      }
    }
  }

  // ============================================================
  // Utilities
  // ============================================================

  private valueMatches(actual: unknown, expected: unknown): boolean {
    // Loose comparison: handle string/number coercion (HomeKit values are sometimes strings)
    if (actual === expected) return true;
    if (String(actual) === String(expected)) return true;
    return false;
  }

  // ============================================================
  // Teardown
  // ============================================================

  teardown(): void {
    if (this.stateStoreUnsubscribe) {
      this.stateStoreUnsubscribe();
      this.stateStoreUnsubscribe = undefined;
    }

    // Clear all state trigger timers
    for (const entries of this.stateTriggers.values()) {
      for (const e of entries) {
        if (e.forTimer) clearTimeout(e.forTimer);
      }
    }
    this.stateTriggers.clear();

    // Clear numeric trigger timers
    for (const entries of this.numericTriggers.values()) {
      for (const e of entries) {
        if (e.forTimer) clearTimeout(e.forTimer);
      }
    }
    this.numericTriggers.clear();

    // Clear service group trigger timers
    for (const entries of this.serviceGroupStateTriggers.values()) {
      for (const e of entries) {
        if (e.forTimer) clearTimeout(e.forTimer);
      }
    }
    this.serviceGroupStateTriggers.clear();

    for (const entries of this.serviceGroupNumericTriggers.values()) {
      for (const e of entries) {
        if (e.forTimer) clearTimeout(e.forTimer);
      }
    }
    this.serviceGroupNumericTriggers.clear();

    // Clear time schedules
    for (const schedules of this.timeSchedules.values()) {
      for (const s of schedules) {
        if (s.timer) clearTimeout(s.timer);
      }
    }
    this.timeSchedules.clear();

    // Clear time pattern schedules
    for (const schedules of this.timePatternSchedules.values()) {
      for (const s of schedules) {
        if (s.interval) clearInterval(s.interval);
        if (s.initialTimer) clearTimeout(s.initialTimer);
      }
    }
    this.timePatternSchedules.clear();

    // Clear event triggers
    this.eventTriggers.clear();

    // Clear sun schedules
    for (const schedules of this.sunSchedules.values()) {
      for (const s of schedules) {
        if (s.timer) clearTimeout(s.timer);
      }
    }
    this.sunSchedules.clear();

    // Clear template triggers
    for (const e of this.templateTriggers) {
      if (e.forTimer) clearTimeout(e.forTimer);
    }
    this.templateTriggers = [];
  }
}
