// Tests for TriggerManager — service group triggers and state triggers

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TriggerManager, type ServiceGroupResolver } from './TriggerManager';
import { StateStore } from '../state/StateStore';
import type { StateTrigger, NumericStateTrigger, TriggerData } from '../types/automation';

describe('TriggerManager', () => {
  let stateStore: StateStore;
  let triggerManager: TriggerManager;

  beforeEach(() => {
    stateStore = new StateStore();
  });

  // ============================================================
  // Individual accessory triggers (existing behavior)
  // ============================================================

  describe('individual state triggers', () => {
    beforeEach(() => {
      triggerManager = new TriggerManager(stateStore);
      triggerManager.initialize();
    });

    it('fires callback when accessory state changes', () => {
      const callback = vi.fn();
      const trigger: StateTrigger = {
        type: 'state',
        id: 'trigger-1',
        accessoryId: 'acc-1',
        characteristicType: 'power_state',
      };

      triggerManager.registerTriggers('auto-1', [trigger], callback);
      stateStore.updateDeviceState('acc-1', 'power_state', 1);

      expect(callback).toHaveBeenCalledTimes(1);
      expect(callback.mock.calls[0][0]).toMatchObject({
        triggerId: 'trigger-1',
        triggerType: 'state',
        toValue: 1,
        accessoryId: 'acc-1',
      });
    });

    it('does not fire for unrelated accessory', () => {
      const callback = vi.fn();
      const trigger: StateTrigger = {
        type: 'state',
        id: 'trigger-1',
        accessoryId: 'acc-1',
        characteristicType: 'power_state',
      };

      triggerManager.registerTriggers('auto-1', [trigger], callback);
      stateStore.updateDeviceState('acc-OTHER', 'power_state', 1);

      expect(callback).not.toHaveBeenCalled();
    });

    it('respects to/from filters', () => {
      const callback = vi.fn();
      const trigger: StateTrigger = {
        type: 'state',
        id: 'trigger-1',
        accessoryId: 'acc-1',
        characteristicType: 'power_state',
        to: 1,
      };

      triggerManager.registerTriggers('auto-1', [trigger], callback);

      // Change to 0 — should NOT fire (filter is to=1)
      stateStore.updateDeviceState('acc-1', 'power_state', 0);
      expect(callback).not.toHaveBeenCalled();

      // Change to 1 — should fire
      stateStore.updateDeviceState('acc-1', 'power_state', 1);
      expect(callback).toHaveBeenCalledTimes(1);
    });

    it('unregisters triggers correctly', () => {
      const callback = vi.fn();
      const trigger: StateTrigger = {
        type: 'state',
        id: 'trigger-1',
        accessoryId: 'acc-1',
        characteristicType: 'power_state',
      };

      triggerManager.registerTriggers('auto-1', [trigger], callback);
      triggerManager.unregisterTriggers('auto-1');

      stateStore.updateDeviceState('acc-1', 'power_state', 1);
      expect(callback).not.toHaveBeenCalled();
    });
  });

  // ============================================================
  // Numeric state triggers
  // ============================================================

  describe('numeric state triggers', () => {
    beforeEach(() => {
      triggerManager = new TriggerManager(stateStore);
      triggerManager.initialize();
    });

    it('fires on threshold crossing', () => {
      const callback = vi.fn();
      const trigger: NumericStateTrigger = {
        type: 'numeric_state',
        id: 'trigger-1',
        accessoryId: 'acc-1',
        characteristicType: 'temperature',
        above: 25,
      };

      triggerManager.registerTriggers('auto-1', [trigger], callback);

      // Below threshold
      stateStore.updateDeviceState('acc-1', 'temperature', 20);
      expect(callback).not.toHaveBeenCalled();

      // Cross threshold
      stateStore.updateDeviceState('acc-1', 'temperature', 30);
      expect(callback).toHaveBeenCalledTimes(1);
    });
  });

  // ============================================================
  // Service group triggers (Phase 2)
  // ============================================================

  describe('service group triggers', () => {
    let resolver: ServiceGroupResolver;

    beforeEach(() => {
      // Group "all-lights" contains acc-1, acc-2, acc-3
      resolver = {
        getGroupsForAccessory: vi.fn((accId: string) => {
          const groups: Record<string, string[]> = {
            'acc-1': ['all-lights'],
            'acc-2': ['all-lights'],
            'acc-3': ['all-lights', 'bedroom-lights'],
          };
          return groups[accId] ?? [];
        }),
      };
      triggerManager = new TriggerManager(stateStore, resolver);
      triggerManager.initialize();
    });

    it('fires when any accessory in group changes', () => {
      const callback = vi.fn();
      const trigger: StateTrigger = {
        type: 'state',
        id: 'group-trigger-1',
        serviceGroupId: 'all-lights',
        characteristicType: 'power_state',
      };

      triggerManager.registerTriggers('auto-1', [trigger], callback);

      // acc-1 changes — is in "all-lights" group
      stateStore.updateDeviceState('acc-1', 'power_state', 1);
      expect(callback).toHaveBeenCalledTimes(1);

      const data: TriggerData = callback.mock.calls[0][0];
      expect(data.accessoryId).toBe('acc-1');
      expect(data.serviceGroupId).toBe('all-lights');
      expect(data.triggerType).toBe('state');
    });

    it('fires for each group member independently', () => {
      const callback = vi.fn();
      const trigger: StateTrigger = {
        type: 'state',
        id: 'group-trigger-1',
        serviceGroupId: 'all-lights',
        characteristicType: 'power_state',
      };

      triggerManager.registerTriggers('auto-1', [trigger], callback);

      stateStore.updateDeviceState('acc-1', 'power_state', 1);
      stateStore.updateDeviceState('acc-2', 'power_state', 1);
      stateStore.updateDeviceState('acc-3', 'power_state', 1);

      expect(callback).toHaveBeenCalledTimes(3);
      expect(callback.mock.calls[0][0].accessoryId).toBe('acc-1');
      expect(callback.mock.calls[1][0].accessoryId).toBe('acc-2');
      expect(callback.mock.calls[2][0].accessoryId).toBe('acc-3');
    });

    it('does not fire for accessories not in the group', () => {
      const callback = vi.fn();
      const trigger: StateTrigger = {
        type: 'state',
        id: 'group-trigger-1',
        serviceGroupId: 'all-lights',
        characteristicType: 'power_state',
      };

      triggerManager.registerTriggers('auto-1', [trigger], callback);

      // acc-99 is not in any group
      stateStore.updateDeviceState('acc-99', 'power_state', 1);
      expect(callback).not.toHaveBeenCalled();
    });

    it('does not fire for wrong characteristic type', () => {
      const callback = vi.fn();
      const trigger: StateTrigger = {
        type: 'state',
        id: 'group-trigger-1',
        serviceGroupId: 'all-lights',
        characteristicType: 'power_state',
      };

      triggerManager.registerTriggers('auto-1', [trigger], callback);

      // acc-1 changes brightness, not power_state
      stateStore.updateDeviceState('acc-1', 'brightness', 80);
      expect(callback).not.toHaveBeenCalled();
    });

    it('respects to/from filters on group triggers', () => {
      const callback = vi.fn();
      const trigger: StateTrigger = {
        type: 'state',
        id: 'group-trigger-1',
        serviceGroupId: 'all-lights',
        characteristicType: 'power_state',
        to: 0, // Only fire when turning OFF
      };

      triggerManager.registerTriggers('auto-1', [trigger], callback);

      // Turn ON — should NOT fire
      stateStore.updateDeviceState('acc-1', 'power_state', 1);
      expect(callback).not.toHaveBeenCalled();

      // Turn OFF — should fire
      stateStore.updateDeviceState('acc-1', 'power_state', 0);
      expect(callback).toHaveBeenCalledTimes(1);
    });

    it('handles numeric group triggers with thresholds', () => {
      const callback = vi.fn();
      const trigger: NumericStateTrigger = {
        type: 'numeric_state',
        id: 'group-trigger-2',
        serviceGroupId: 'all-lights',
        characteristicType: 'brightness',
        above: 80,
      };

      triggerManager.registerTriggers('auto-1', [trigger], callback);

      // Below threshold
      stateStore.updateDeviceState('acc-1', 'brightness', 50);
      expect(callback).not.toHaveBeenCalled();

      // Cross threshold
      stateStore.updateDeviceState('acc-1', 'brightness', 90);
      expect(callback).toHaveBeenCalledTimes(1);
      expect(callback.mock.calls[0][0].serviceGroupId).toBe('all-lights');
    });

    it('reflects dynamic group membership changes', () => {
      const callback = vi.fn();
      const trigger: StateTrigger = {
        type: 'state',
        id: 'group-trigger-1',
        serviceGroupId: 'all-lights',
        characteristicType: 'power_state',
      };

      triggerManager.registerTriggers('auto-1', [trigger], callback);

      // acc-99 is not in the group initially
      stateStore.updateDeviceState('acc-99', 'power_state', 1);
      expect(callback).not.toHaveBeenCalled();

      // Now the resolver says acc-99 is in the group (membership changed)
      (resolver.getGroupsForAccessory as any).mockReturnValue(['all-lights']);
      stateStore.updateDeviceState('acc-99', 'power_state', 0);
      expect(callback).toHaveBeenCalledTimes(1);
    });

    it('works without a resolver (graceful degradation)', () => {
      const noResolverManager = new TriggerManager(stateStore);
      noResolverManager.initialize();

      const callback = vi.fn();
      const trigger: StateTrigger = {
        type: 'state',
        id: 'group-trigger-1',
        serviceGroupId: 'all-lights',
        characteristicType: 'power_state',
      };

      noResolverManager.registerTriggers('auto-1', [trigger], callback);
      stateStore.updateDeviceState('acc-1', 'power_state', 1);

      // No resolver → group triggers never match
      expect(callback).not.toHaveBeenCalled();

      noResolverManager.teardown();
    });

    it('unregisters group triggers correctly', () => {
      const callback = vi.fn();
      const trigger: StateTrigger = {
        type: 'state',
        id: 'group-trigger-1',
        serviceGroupId: 'all-lights',
        characteristicType: 'power_state',
      };

      triggerManager.registerTriggers('auto-1', [trigger], callback);
      triggerManager.unregisterTriggers('auto-1');

      stateStore.updateDeviceState('acc-1', 'power_state', 1);
      expect(callback).not.toHaveBeenCalled();
    });

    it('coexists with individual accessory triggers', () => {
      const groupCallback = vi.fn();
      const deviceCallback = vi.fn();

      const groupTrigger: StateTrigger = {
        type: 'state',
        id: 'group-trigger',
        serviceGroupId: 'all-lights',
        characteristicType: 'power_state',
      };

      const deviceTrigger: StateTrigger = {
        type: 'state',
        id: 'device-trigger',
        accessoryId: 'acc-1',
        characteristicType: 'power_state',
      };

      triggerManager.registerTriggers('auto-group', [groupTrigger], groupCallback);
      triggerManager.registerTriggers('auto-device', [deviceTrigger], deviceCallback);

      // acc-1 change should fire BOTH triggers
      stateStore.updateDeviceState('acc-1', 'power_state', 1);
      expect(groupCallback).toHaveBeenCalledTimes(1);
      expect(deviceCallback).toHaveBeenCalledTimes(1);

      // acc-2 change should fire ONLY group trigger
      stateStore.updateDeviceState('acc-2', 'power_state', 1);
      expect(groupCallback).toHaveBeenCalledTimes(2);
      expect(deviceCallback).toHaveBeenCalledTimes(1); // Still 1
    });

    it('teardown clears service group triggers', () => {
      const callback = vi.fn();
      const trigger: StateTrigger = {
        type: 'state',
        id: 'group-trigger-1',
        serviceGroupId: 'all-lights',
        characteristicType: 'power_state',
      };

      triggerManager.registerTriggers('auto-1', [trigger], callback);
      triggerManager.teardown();

      // Re-init state store (teardown unsubscribed)
      stateStore.updateDeviceState('acc-1', 'power_state', 1);
      expect(callback).not.toHaveBeenCalled();
    });
  });

  // ============================================================
  // Disabled triggers
  // ============================================================

  describe('disabled triggers', () => {
    beforeEach(() => {
      triggerManager = new TriggerManager(stateStore);
      triggerManager.initialize();
    });

    it('skips disabled triggers', () => {
      const callback = vi.fn();
      const trigger: StateTrigger = {
        type: 'state',
        id: 'trigger-1',
        accessoryId: 'acc-1',
        characteristicType: 'power_state',
        enabled: false,
      };

      triggerManager.registerTriggers('auto-1', [trigger], callback);
      stateStore.updateDeviceState('acc-1', 'power_state', 1);

      expect(callback).not.toHaveBeenCalled();
    });
  });
});
