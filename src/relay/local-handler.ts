/**
 * Local HomeKit request handler.
 * Executes HomeKit actions directly via the native bridge.
 * Used by:
 * - ServerWebSocket to handle incoming server requests (relay mode)
 * - Local requests in Mac app mode (bypassing WebSocket)
 */

import { HomeKit } from '../native/homekit-bridge';

// Accessory limit enforcement state
let allowedAccessoryIds: Set<string> | null = null;
let accessoryLimit: number | null = null;

/**
 * Set the accessory limit and allowed IDs for free account enforcement.
 * Called when config message is received from server or when user saves selection.
 */
export function setAccessoryLimit(limit: number | null): void {
  accessoryLimit = limit;
  if (limit === null) {
    allowedAccessoryIds = null;
  }
}

/**
 * Set the allowed accessory IDs from user settings.
 */
export function setAllowedAccessoryIds(ids: string[] | null): void {
  if (ids && ids.length > 0) {
    allowedAccessoryIds = new Set(ids);
  } else {
    allowedAccessoryIds = null;
  }
}

/**
 * Get the current allowed accessory IDs set.
 */
export function getAllowedAccessoryIds(): Set<string> | null {
  return allowedAccessoryIds;
}

/**
 * Get the current accessory limit.
 */
export function getAccessoryLimit(): number | null {
  return accessoryLimit;
}

export function isAccessoryAllowed(accessoryId: string): boolean {
  if (accessoryLimit === null) return true; // Unlimited (standard)
  if (!allowedAccessoryIds) return false; // No selection yet — block all until user picks
  return allowedAccessoryIds.has(accessoryId);
}

function filterAccessories(accessories: any[]): any[] {
  if (accessoryLimit === null) return accessories;

  if (allowedAccessoryIds && allowedAccessoryIds.size > 0) {
    return accessories.filter((a: any) => allowedAccessoryIds!.has(a.id));
  }

  // No selection saved — return nothing
  return [];
}

export async function executeHomeKitAction(
  action: string,
  payload: Record<string, unknown> = {}
): Promise<unknown> {
  switch (action) {
    case 'homes.list':
      return { homes: await HomeKit.listHomes() };

    case 'rooms.list': {
      const { homeId } = payload as { homeId: string };
      return { homeId, rooms: await HomeKit.listRooms(homeId) };
    }

    case 'zones.list': {
      const { homeId } = payload as { homeId: string };
      return { homeId, zones: await HomeKit.listZones(homeId) };
    }

    case 'serviceGroups.list': {
      const { homeId } = payload as { homeId: string };
      return { homeId, serviceGroups: await HomeKit.listServiceGroups(homeId) };
    }

    case 'serviceGroup.set': {
      const { groupId, characteristicType, value, homeId } = payload as {
        groupId: string;
        characteristicType: string;
        value: unknown;
        homeId?: string;
      };
      return await HomeKit.setServiceGroupCharacteristic(groupId, characteristicType, value, homeId);
    }

    case 'accessories.list': {
      const { homeId, roomId, includeValues, includeAll } = payload as {
        homeId?: string;
        roomId?: string;
        includeValues?: boolean;
        includeAll?: boolean;
      };
      const result = await HomeKit.listAccessories({ homeId, roomId, includeValues });
      return { accessories: includeAll ? result : filterAccessories(result) };
    }

    case 'accessory.get': {
      const { accessoryId } = payload as { accessoryId: string };
      if (!isAccessoryAllowed(accessoryId)) {
        throw Object.assign(new Error('Accessory not included in your plan'), { code: 'ACCESSORY_NOT_FOUND' });
      }
      return { accessory: await HomeKit.getAccessory(accessoryId) };
    }

    case 'accessory.refresh': {
      const { accessoryId } = payload as { accessoryId: string };
      if (!isAccessoryAllowed(accessoryId)) {
        throw Object.assign(new Error('Accessory not included in your plan'), { code: 'ACCESSORY_NOT_FOUND' });
      }
      return await HomeKit.refreshAccessory(accessoryId);
    }

    case 'characteristic.get': {
      const { accessoryId, characteristicType } = payload as {
        accessoryId: string;
        characteristicType: string;
      };
      if (!isAccessoryAllowed(accessoryId)) {
        throw Object.assign(new Error('Accessory not included in your plan'), { code: 'ACCESSORY_NOT_FOUND' });
      }
      return await HomeKit.getCharacteristic(accessoryId, characteristicType);
    }

    case 'characteristic.set': {
      const { accessoryId, characteristicType, value } = payload as {
        accessoryId: string;
        characteristicType: string;
        value: unknown;
      };
      if (!isAccessoryAllowed(accessoryId)) {
        throw Object.assign(new Error('Accessory not included in your plan'), { code: 'ACCESSORY_NOT_FOUND' });
      }
      return await HomeKit.setCharacteristic(accessoryId, characteristicType, value);
    }

    case 'scenes.list': {
      const { homeId } = payload as { homeId: string };
      return { homeId, scenes: await HomeKit.listScenes(homeId) };
    }

    case 'scene.execute': {
      const { sceneId } = payload as { sceneId: string };
      return await HomeKit.executeScene(sceneId);
    }

    case 'automations.list': {
      const { homeId } = payload as { homeId: string };
      return { automations: await HomeKit.listAutomations(homeId) };
    }

    case 'automation.get': {
      const { automationId } = payload as { automationId: string };
      // getAutomation not available via bridge, use listAutomations and filter
      const bridge = (await import('@/native/homekit-bridge')).getNativeBridge();
      if (!bridge) throw new Error('HomeKit bridge not available');
      return bridge.call('automation.get', { automationId });
    }

    case 'automation.create': {
      const { homeId, name, trigger, actions } = payload as { homeId: string; name: string; trigger: unknown; actions: unknown[] };
      return await HomeKit.createAutomation(homeId, name, trigger as Parameters<typeof HomeKit.createAutomation>[2], actions as Parameters<typeof HomeKit.createAutomation>[3]);
    }

    case 'automation.update': {
      const { automationId, ...rest } = payload as { automationId: string; [key: string]: unknown };
      return await HomeKit.updateAutomation(automationId, rest as Parameters<typeof HomeKit.updateAutomation>[1]);
    }

    case 'automation.delete': {
      const { automationId } = payload as { automationId: string };
      return await HomeKit.deleteAutomation(automationId);
    }

    case 'automation.enable': {
      const { automationId } = payload as { automationId: string };
      return await HomeKit.setAutomationEnabled(automationId, true);
    }

    case 'automation.disable': {
      const { automationId } = payload as { automationId: string };
      return await HomeKit.setAutomationEnabled(automationId, false);
    }

    case 'state.set': {
      const { state, homeId } = payload as {
        state: Record<string, Record<string, Record<string, unknown>>>;
        homeId?: string;
      };
      // Note: free-tier filtering is NOT applied here because state.set uses
      // slug keys (room/accessory), not HomeKit UUIDs. The Swift setState()
      // resolves slug keys internally. Limit enforcement happens at the
      // characteristic.set level for individual accessory control.
      console.log('[state.set] state:', JSON.stringify(state), 'homeId:', homeId);
      const result = await HomeKit.setState(state, homeId);
      console.log('[state.set] result:', JSON.stringify(result));
      return result;
    }

    case 'observe.start':
      return await HomeKit.startObserving();

    case 'observe.stop':
      return await HomeKit.stopObserving();

    case 'observe.reset':
      return await HomeKit.resetObservationTimeout();

    case 'ping':
      return { pong: true, timestamp: Date.now() };

    default:
      throw Object.assign(new Error(`Unknown action: ${action}`), { code: 'UNKNOWN_ACTION' });
  }
}
