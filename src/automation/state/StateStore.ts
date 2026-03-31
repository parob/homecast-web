// Homecast Automation Engine - Central State Store
// Tracks all device characteristic values and helper states in real-time

import type { HomeKitEvent } from '../../native/homekit-bridge';
import type { StateChangeEvent } from '../types/execution';

export type StateChangeListener = (event: StateChangeEvent) => void;

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
    this.specificListeners.clear();
    this.globalListeners.clear();
  }
}
