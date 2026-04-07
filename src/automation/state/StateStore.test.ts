// Tests for StateStore — reactive device state tracking

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { StateStore } from './StateStore';

describe('StateStore', () => {
  let store: StateStore;

  beforeEach(() => {
    store = new StateStore();
  });

  describe('getState / updateDeviceState', () => {
    it('returns undefined for unknown state', () => {
      expect(store.getState('acc-1', 'brightness')).toBeUndefined();
    });

    it('stores and retrieves state', () => {
      store.updateDeviceState('acc-1', 'brightness', 80);
      expect(store.getState('acc-1', 'brightness')).toBe(80);
    });

    it('updates existing state', () => {
      store.updateDeviceState('acc-1', 'brightness', 80);
      store.updateDeviceState('acc-1', 'brightness', 50);
      expect(store.getState('acc-1', 'brightness')).toBe(50);
    });

    it('tracks multiple accessories independently', () => {
      store.updateDeviceState('acc-1', 'brightness', 80);
      store.updateDeviceState('acc-2', 'brightness', 30);
      expect(store.getState('acc-1', 'brightness')).toBe(80);
      expect(store.getState('acc-2', 'brightness')).toBe(30);
    });

    it('tracks multiple characteristics per accessory', () => {
      store.updateDeviceState('acc-1', 'brightness', 80);
      store.updateDeviceState('acc-1', 'power_state', 1);
      expect(store.getState('acc-1', 'brightness')).toBe(80);
      expect(store.getState('acc-1', 'power_state')).toBe(1);
    });
  });

  describe('lastChanged / getSecondsSinceLastChange', () => {
    it('returns undefined for never-changed state', () => {
      expect(store.getLastChanged('acc-1', 'brightness')).toBeUndefined();
    });

    it('tracks lastChanged timestamp', () => {
      const before = Date.now();
      store.updateDeviceState('acc-1', 'brightness', 80);
      const ts = store.getLastChanged('acc-1', 'brightness');
      expect(ts).toBeGreaterThanOrEqual(before);
    });

    it('returns Infinity for never-changed', () => {
      expect(store.getSecondsSinceLastChange('acc-1', 'brightness')).toBe(Infinity);
    });
  });

  describe('listeners', () => {
    it('fires global listeners on state change', () => {
      const listener = vi.fn();
      store.onAnyStateChange(listener);

      store.updateDeviceState('acc-1', 'brightness', 80);

      expect(listener).toHaveBeenCalledTimes(1);
      expect(listener.mock.calls[0][0]).toMatchObject({
        accessoryId: 'acc-1',
        characteristicType: 'brightness',
        newValue: 80,
      });
    });

    it('fires specific listeners for matching key', () => {
      const listener = vi.fn();
      store.onStateChange('acc-1', 'brightness', listener);

      store.updateDeviceState('acc-1', 'brightness', 80);
      expect(listener).toHaveBeenCalledTimes(1);

      // Different characteristic — should not fire
      store.updateDeviceState('acc-1', 'power_state', 1);
      expect(listener).toHaveBeenCalledTimes(1);
    });

    it('unsubscribes correctly', () => {
      const listener = vi.fn();
      const unsub = store.onAnyStateChange(listener);

      store.updateDeviceState('acc-1', 'brightness', 80);
      expect(listener).toHaveBeenCalledTimes(1);

      unsub();
      store.updateDeviceState('acc-1', 'brightness', 50);
      expect(listener).toHaveBeenCalledTimes(1); // Still 1
    });

    it('includes old value in event', () => {
      const listener = vi.fn();
      store.onAnyStateChange(listener);

      store.updateDeviceState('acc-1', 'brightness', 80);
      store.updateDeviceState('acc-1', 'brightness', 50);

      expect(listener.mock.calls[1][0].oldValue).toBe(80);
      expect(listener.mock.calls[1][0].newValue).toBe(50);
    });
  });

  describe('helpers', () => {
    it('stores and retrieves helper state', () => {
      store.updateHelperState('vacation_mode', true);
      expect(store.getHelperState('vacation_mode')).toBe(true);
    });

    it('returns undefined for unknown helpers', () => {
      expect(store.getHelperState('nonexistent')).toBeUndefined();
    });
  });

  describe('clear', () => {
    it('clears all state', () => {
      store.updateDeviceState('acc-1', 'brightness', 80);
      store.updateHelperState('mode', 'home');
      store.clear();

      expect(store.getState('acc-1', 'brightness')).toBeUndefined();
      expect(store.getHelperState('mode')).toBeUndefined();
    });
  });
});
