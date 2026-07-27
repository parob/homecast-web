// Homecast Automation Engine - Central State Store
// Tracks all device characteristic values and helper states in real-time

import type { HomeKitEvent } from '../../native/homekit-bridge';
import type { StateChangeEvent } from '../types/execution';

export type StateChangeListener = (event: StateChangeEvent) => void;

/** How long after our own write an incoming change still counts as ours. */
const WRITE_ATTRIBUTION_WINDOW_MS = 10_000;

/** Split an "accessoryId:characteristicType" key, tolerating ids with colons. */
function splitKey(key: string): [string, string] {
  const i = key.lastIndexOf(':');
  return [key.slice(0, i), key.slice(i + 1)];
}

/**
 * Central reactive state store for the automation engine.
 * Holds device characteristic values and helper states.
 * Subscribes to HomeKit events to stay in sync.
 */
export class StateStore {
  // accessoryId -> characteristicType -> value
  private deviceStates = new Map<string, Map<string, unknown>>();

  // accessoryId -> characteristicType -> lastChangedTimestamp
  private lastChanged = new Map<string, Map<string, number>>();

  // helperId -> value
  private helperStates = new Map<string, unknown>();
  // accessoryId -> last reported reachability
  private reachability = new Map<string, boolean>();
  private reachabilityListeners = new Set<(accessoryId: string, isReachable: boolean) => void>();
  // Writes we made, awaiting the resulting state change so we can attribute it
  private lastWrites = new Map<string, { value: unknown; at: number }>();
  // key -> was the last change human-made?
  private manualChanges = new Map<string, boolean>();
  private manualChangeAt = new Map<string, number>();

  // Listeners keyed by "accessoryId:characteristicType"
  private specificListeners = new Map<string, Set<StateChangeListener>>();

  // Listeners for any state change (used by template triggers)
  private globalListeners = new Set<StateChangeListener>();

  // ============================================================
  // Device state read/write
  // ============================================================

  getState(accessoryId: string, characteristicType: string): unknown {
    return this.deviceStates.get(accessoryId)?.get(characteristicType);
  }

  /**
   * Returns a plain-object copy of all known device states, keyed by
   * accessoryId → characteristicType → value. Used by the Code node sandbox
   * so it can resolve `input.states(...)` without reaching back into the
   * parent realm.
   */
  snapshot(): Record<string, Record<string, unknown>> {
    const out: Record<string, Record<string, unknown>> = {};
    for (const [accessoryId, charMap] of this.deviceStates) {
      const inner: Record<string, unknown> = {};
      for (const [type, value] of charMap) inner[type] = value;
      out[accessoryId] = inner;
    }
    return out;
  }

  getLastChanged(accessoryId: string, characteristicType: string): number | undefined {
    return this.lastChanged.get(accessoryId)?.get(characteristicType);
  }

  getSecondsSinceLastChange(accessoryId: string, characteristicType: string): number {
    const ts = this.getLastChanged(accessoryId, characteristicType);
    if (ts === undefined) return Infinity;
    return (Date.now() - ts) / 1000;
  }

  /**
   * Update device state from a HomeKit event.
   * Notifies all registered listeners.
   */
  updateDeviceState(
    accessoryId: string,
    characteristicType: string,
    newValue: unknown,
    timestamp?: number,
  ): void {
    const ts = timestamp ?? Date.now();

    // Get previous value
    let charMap = this.deviceStates.get(accessoryId);
    if (!charMap) {
      charMap = new Map();
      this.deviceStates.set(accessoryId, charMap);
    }
    const oldValue = charMap.get(characteristicType);

    // Update state
    charMap.set(characteristicType, newValue);

    // Update lastChanged timestamp
    let changedMap = this.lastChanged.get(accessoryId);
    if (!changedMap) {
      changedMap = new Map();
      this.lastChanged.set(accessoryId, changedMap);
    }
    changedMap.set(characteristicType, ts);

    // Notify listeners
    const event: StateChangeEvent = {
      accessoryId,
      characteristicType,
      newValue,
      oldValue,
      timestamp: ts,
    };

    this.classifyChange(accessoryId, characteristicType, newValue);

    // Specific listeners
    const key = `${accessoryId}:${characteristicType}`;
    const specific = this.specificListeners.get(key);
    if (specific) {
      for (const listener of specific) {
        try {
          listener(event);
        } catch (e) {
          console.error('[StateStore] Listener error:', e);
        }
      }
    }

    // Global listeners
    for (const listener of this.globalListeners) {
      try {
        listener(event);
      } catch (e) {
        console.error('[StateStore] Global listener error:', e);
      }
    }
  }

  // ============================================================
  // Manual-override detection
  // ============================================================

  /**
   * Record that *we* wrote a value, so the resulting state change can be told
   * apart from a human reaching for a switch.
   *
   * Apple Home has no concept of this — automations "don't care what you do
   * manually", which is why people resort to encoding override state in a
   * light's brightness value. The engine can do better because it knows what
   * it wrote: any change that doesn't match a recent write was somebody else.
   */
  recordWrite(accessoryId: string, characteristicType: string, value: unknown): void {
    this.lastWrites.set(`${accessoryId}:${characteristicType}`, { value, at: Date.now() });
  }

  /**
   * Was the last change to this characteristic made by a human rather than by
   * us? Undefined until the characteristic has actually changed.
   */
  wasManuallyChanged(accessoryId: string, characteristicType: string): boolean | undefined {
    return this.manualChanges.get(`${accessoryId}:${characteristicType}`);
  }

  /**
   * True if a human touched this accessory within `withinMs`. Intended as the
   * "don't fight the human" guard: hold off automating a device someone just
   * adjusted by hand.
   */
  hasRecentManualChange(accessoryId: string, withinMs: number, characteristicType?: string): boolean {
    const cutoff = Date.now() - withinMs;
    for (const [key, at] of this.manualChangeAt) {
      if (at < cutoff) continue;
      const [acc, char] = splitKey(key);
      if (acc !== accessoryId) continue;
      if (characteristicType && char !== characteristicType) continue;
      return true;
    }
    return false;
  }

  /**
   * Decide whether an incoming change matches a write we just made. A write is
   * only credited once, and only briefly — a device that echoes our value back
   * an hour later is not the same event.
   */
  private classifyChange(accessoryId: string, characteristicType: string, value: unknown): void {
    const key = `${accessoryId}:${characteristicType}`;
    const pending = this.lastWrites.get(key);
    const ours = pending !== undefined
      && Date.now() - pending.at <= WRITE_ATTRIBUTION_WINDOW_MS
      && String(pending.value) === String(value);

    if (ours) this.lastWrites.delete(key);
    this.manualChanges.set(key, !ours);
    if (!ours) this.manualChangeAt.set(key, Date.now());
  }

  // ============================================================
  // Reachability
  // ============================================================

  /** Last known reachability, or undefined if HomeKit hasn't reported yet. */
  isReachable(accessoryId: string): boolean | undefined {
    return this.reachability.get(accessoryId);
  }

  /**
   * Record an accessory's reachability and notify listeners on a real change.
   * Repeat reports of the same value are ignored so a flapping bridge doesn't
   * restart every pending availability trigger.
   */
  updateReachability(accessoryId: string, isReachable: boolean): void {
    if (this.reachability.get(accessoryId) === isReachable) return;
    this.reachability.set(accessoryId, isReachable);

    for (const listener of this.reachabilityListeners) {
      try {
        listener(accessoryId, isReachable);
      } catch (e) {
        console.error('[StateStore] Reachability listener error:', e);
      }
    }
  }

  /** Subscribe to reachability changes. Returns an unsubscribe function. */
  onReachabilityChange(listener: (accessoryId: string, isReachable: boolean) => void): () => void {
    this.reachabilityListeners.add(listener);
    return () => this.reachabilityListeners.delete(listener);
  }

  // ============================================================
  // Helper state read/write
  // ============================================================

  getHelperState(helperId: string): unknown {
    return this.helperStates.get(helperId);
  }

  updateHelperState(helperId: string, value: unknown): void {
    this.helperStates.set(helperId, value);
  }

  // ============================================================
  // Subscriptions
  // ============================================================

  /**
   * Subscribe to state changes for a specific accessory+characteristic.
   * Returns an unsubscribe function.
   */
  onStateChange(
    accessoryId: string,
    characteristicType: string,
    listener: StateChangeListener,
  ): () => void {
    const key = `${accessoryId}:${characteristicType}`;
    let set = this.specificListeners.get(key);
    if (!set) {
      set = new Set();
      this.specificListeners.set(key, set);
    }
    set.add(listener);
    return () => {
      set!.delete(listener);
      if (set!.size === 0) this.specificListeners.delete(key);
    };
  }

  /**
   * Subscribe to all state changes (for template triggers that need to
   * re-evaluate on any change).
   */
  onAnyStateChange(listener: StateChangeListener): () => void {
    this.globalListeners.add(listener);
    return () => {
      this.globalListeners.delete(listener);
    };
  }

  // ============================================================
  // HomeKit event integration
  // ============================================================

  /**
   * Process a HomeKit event from the native bridge.
   * Call this from the engine's event subscription.
   */
  handleHomeKitEvent(event: HomeKitEvent): void {
    if (event.type === 'characteristic.updated' && event.characteristicType != null) {
      this.updateDeviceState(
        event.accessoryId,
        event.characteristicType,
        event.value,
      );
      return;
    }

    // Previously dropped, so nothing could react to a device going offline.
    if (event.type === 'accessory.reachability' && typeof event.isReachable === 'boolean') {
      this.updateReachability(event.accessoryId, event.isReachable);
    }
  }

  // ============================================================
  // Bulk operations
  // ============================================================

  /**
   * Get all known states for an accessory.
   */
  getAccessoryStates(accessoryId: string): Map<string, unknown> | undefined {
    return this.deviceStates.get(accessoryId);
  }

  /**
   * Get a snapshot of all device states (for expression engine context).
   */
  getAllDeviceStates(): Map<string, Map<string, unknown>> {
    return this.deviceStates;
  }

  /**
   * Clear all state (on teardown).
   */
  clear(): void {
    this.deviceStates.clear();
    this.lastChanged.clear();
    this.helperStates.clear();
    this.reachability.clear();
    this.specificListeners.clear();
    this.globalListeners.clear();
    this.reachabilityListeners.clear();
    this.lastWrites.clear();
    this.manualChanges.clear();
    this.manualChangeAt.clear();
  }
}
