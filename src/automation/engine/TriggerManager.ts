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
  DeviceAvailabilityTrigger,
} from '../types/automation';
import { durationToMs, DEFAULT_UNAVAILABLE_FOR } from '../types/automation';
import type { StateChangeEvent } from '../types/execution';
import { getNextSunEvent } from '../state/SunCalculator';
import { valuesMatch } from '../state/valueMatch';
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

interface AvailabilityEntry {
  automationId: string;
  trigger: DeviceAvailabilityTrigger;
  callback: TriggerCallback;
  forTimer?: ReturnType<typeof setTimeout>;
}

/** Resolves which service groups an accessory belongs to (for group triggers) */
export interface ServiceGroupResolver {
  getGroupsForAccessory(accessoryId: string): string[];
  /**
   * Members of a group. Optional so existing resolvers/test doubles still
   * satisfy the interface; without it, group triggers fall back to
   * time-coalescing a burst instead of tracking the group's real state.
   */
  getMembers?(groupId: string): string[];
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

  // Group-trigger fire gating — see shouldFireGroupTrigger. Keyed by
  // "automationId:triggerId:groupId:characteristicType".
  private groupTriggerLastFire = new Map<string, { at: number; value: string }>();

  /**
   * Window for collapsing a group's per-member event burst into one run.
   * Production measured an 11-light group reporting over 1.3s, so 1.5s left no
   * margin. Only repeats of the SAME value are suppressed, so a longer window
   * can't swallow a real change.
   */
  /**
   * How long a group trigger ignores a repeat of the same value.
   *
   * Sized to how slowly a group actually reports, not to how fast a burst
   * arrives. A 12-light group toggled once produced five runs at 3s — the
   * relay's own write feeds every member at once and coalesces to one, then
   * HomeKit's observers report the real device changes over the following ~20s,
   * and each report landing more than a window after the last fired again.
   * Five runs meant five notifications, which is also how the per-automation
   * push rate limit was being exhausted.
   *
   * Widening this cannot swallow a real change: only a repeat of the *same*
   * value is suppressed, so an off-then-on inside the window still fires twice.
   * The worst it can cost is a genuine "group went off, then off again", which
   * is not a transition anyone automates on.
   */
  private static readonly GROUP_COALESCE_MS = 12_000;

  // Service group triggers indexed by "groupId:characteristicType"
  private serviceGroupStateTriggers = new Map<string, StateTriggerEntry[]>();
  private serviceGroupNumericTriggers = new Map<string, NumericTriggerEntry[]>();

  // Time-based triggers
  private timeSchedules = new Map<string, TimeSchedule[]>(); // automationId -> schedules
  private timePatternSchedules = new Map<string, TimePatternSchedule[]>();

  // Sun triggers
  private sunSchedules = new Map<string, SunSchedule[]>();
  // accessoryId -> availability triggers watching it
  private availabilityTriggers = new Map<string, AvailabilityEntry[]>();
  private reachabilityUnsubscribe?: () => void;

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
      case 'device_availability':
        this.registerAvailabilityTrigger(automationId, trigger, callback);
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

  /**
   * Set location for sun calculations.
   *
   * Reschedules any already-registered sun triggers — the location often
   * resolves after the engine has started, and a sun trigger scheduled against
   * the previous coordinates would otherwise keep its stale fire time.
   */
  setLocation(latitude: number, longitude: number): void {
    if (this.latitude === latitude && this.longitude === longitude) return;
    this.latitude = latitude;
    this.longitude = longitude;
    this.rescheduleSunTriggers();
  }

  private rescheduleSunTriggers(): void {
    for (const schedules of this.sunSchedules.values()) {
      for (const schedule of schedules) {
        if (schedule.timer) clearTimeout(schedule.timer);
        this.scheduleSunTrigger(schedule);
      }
    }
  }

  // ============================================================
  // Unregistration
  // ============================================================

  /**
   * Unregister all triggers for an automation.
   */
  unregisterTriggers(automationId: string): void {
    // Group fire-gate state is keyed by automationId — drop it so a re-saved
    // automation starts unarmed rather than inheriting the old edge.
    const prefix = `${automationId}:`;
    for (const key of this.groupTriggerLastFire.keys()) {
      if (key.startsWith(prefix)) this.groupTriggerLastFire.delete(key);
    }

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

    // Availability triggers
    for (const [accessoryId, entries] of this.availabilityTriggers) {
      const kept = entries.filter((e) => {
        if (e.automationId === automationId) {
          if (e.forTimer) clearTimeout(e.forTimer);
          return false;
        }
        return true;
      });
      if (kept.length === 0) this.availabilityTriggers.delete(accessoryId);
      else this.availabilityTriggers.set(accessoryId, kept);
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
   * Register a device availability trigger.
   *
   * Always debounced: HMAccessory.isReachable is known to go stale and flap, so
   * firing on the raw edge would produce false "your freezer is offline" alarms.
   */
  private registerAvailabilityTrigger(
    automationId: string,
    trigger: DeviceAvailabilityTrigger,
    callback: TriggerCallback,
  ): void {
    const entry: AvailabilityEntry = { automationId, trigger, callback };
    let entries = this.availabilityTriggers.get(trigger.accessoryId);
    if (!entries) {
      entries = [];
      this.availabilityTriggers.set(trigger.accessoryId, entries);
    }
    entries.push(entry);
  }

  private handleReachabilityChange(accessoryId: string, isReachable: boolean): void {
    const entries = this.availabilityTriggers.get(accessoryId);
    if (!entries) return;

    for (const entry of entries) {
      if (entry.trigger.enabled === false) continue;
      const wanted = entry.trigger.to === 'available';

      if (entry.forTimer) {
        clearTimeout(entry.forTimer);
        entry.forTimer = undefined;
      }
      if (isReachable !== wanted) continue;

      const delay = durationToMs(entry.trigger.for ?? DEFAULT_UNAVAILABLE_FOR);
      const fire = () => {
        entry.forTimer = undefined;
        entry.callback({
          triggerId: entry.trigger.id,
          triggerType: 'device_availability',
          accessoryId,
          toValue: entry.trigger.to,
          timestamp: Date.now(),
        });
      };

      if (delay > 0) entry.forTimer = setTimeout(fire, delay);
      else fire();
    }
  }

  /**
   * Initialize: subscribe to state store for all state changes.
   */
  initialize(): void {
    this.stateStoreUnsubscribe = this.stateStore.onAnyStateChange((event) => {
      this.handleStateChange(event);
    });
    this.reachabilityUnsubscribe = this.stateStore.onReachabilityChange((accessoryId, isReachable) => {
      this.handleReachabilityChange(accessoryId, isReachable);
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
            const gateKey = `${entry.automationId}:${entry.trigger.id}:${groupId}:${event.characteristicType}`;
            if (!this.shouldFireGroupTrigger(gateKey, groupId, event.characteristicType, entry.trigger.to, event)) {
              continue;
            }
            this.evaluateStateTrigger(entry, event, groupId);
          }
        }

        const groupNumericEntries = this.serviceGroupNumericTriggers.get(groupKey);
        if (groupNumericEntries) {
          for (const entry of groupNumericEntries) {
            // Numeric group triggers have no single target value to aggregate
            // over (above/below across N members is ambiguous), so these always
            // take the time-coalescing path.
            const gateKey = `${entry.automationId}:${entry.trigger.id}:${groupId}:${event.characteristicType}`;
            if (!this.shouldFireGroupTrigger(gateKey, groupId, event.characteristicType, undefined, event)) {
              continue;
            }
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

  /**
   * Should a *group* trigger run for this member's event?
   *
   * HomeKit reports a group change as one event per member, so "when Kitchen
   * Lights turn on" used to run the automation once per bulb — an 11-light
   * group produced 10 runs (and 10 notifications) in 1.3s for a single logical
   * change. This collapses that burst to one run per group transition.
   *
   * Only group-registered triggers pass through here. A trigger bound to an
   * individual accessory is dispatched from `stateTriggers` and is untouched,
   * so an automation on one bulb inside the group still fires for that bulb.
   *
   * Where membership is known we track whether the GROUP satisfies the
   * trigger's target value and fire only on the false -> true edge, so trailing
   * members are absorbed and a later off -> on cycle re-arms it. Without
   * membership, or without a target value to test against, we coalesce by time
   * instead — a burst is one run, and genuinely separate changes still fire.
   */
  private shouldFireGroupTrigger(
    gateKey: string,
    _groupId: string,
    _characteristicType: string,
    _to: unknown,
    event: StateChangeEvent,
  ): boolean {
    // Coalesce only a repeat of the SAME value within a short window. A burst
    // is every member reporting the same new value, so that alone is what we
    // suppress — gating on time regardless of value would swallow a genuine
    // off-then-on (or a numeric threshold crossing) inside the window.
    //
    // This deliberately holds no latched per-group state. An earlier version
    // tracked whether the GROUP satisfied the trigger and fired on the
    // false->true edge, which is more precise but fails closed: any way that
    // flag gets stuck true — a member whose state the store never learns, a
    // periodic refresh landing mid-sequence — and the automation goes silent
    // forever, with nothing to show why. Silence is the worst failure mode
    // for an automation, so this errs toward firing: the window can only ever
    // delay a duplicate, never cancel a real change.
    const now = Date.now();
    const value = JSON.stringify(event.newValue ?? null);
    const last = this.groupTriggerLastFire.get(gateKey);
    if (last && last.value === value && now - last.at < TriggerManager.GROUP_COALESCE_MS) {
      return false;
    }
    this.groupTriggerLastFire.set(gateKey, { at: now, value });
    return true;
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

    // Sun triggers drift for the same reasons (sleep/wake, clock changes) and
    // their fire times move daily, so they need recomputing too.
    this.rescheduleSunTriggers();
  }

  // ============================================================
  // Utilities
  // ============================================================

  private valueMatches(actual: unknown, expected: unknown): boolean {
    return valuesMatch(actual, expected);
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

    // Clear availability triggers
    for (const entries of this.availabilityTriggers.values()) {
      for (const e of entries) {
        if (e.forTimer) clearTimeout(e.forTimer);
      }
    }
    this.availabilityTriggers.clear();
    this.reachabilityUnsubscribe?.();
    this.reachabilityUnsubscribe = undefined;

    // Clear template triggers
    for (const e of this.templateTriggers) {
      if (e.forTimer) clearTimeout(e.forTimer);
    }
    this.templateTriggers = [];
  }
}
