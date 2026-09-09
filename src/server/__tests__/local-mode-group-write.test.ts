// @vitest-environment jsdom
/**
 * A group write in Local Mode has to reach the member tiles, not only the
 * group tile.
 *
 * homecast-web#95. `announceRelayGroupWrite` fans a group write out to its
 * members so every accessory tile hears about it, and it asks the automation
 * engine's resolver for the members. Local Mode never starts the engine —
 * deliberately; two engines fire every automation twice — so on a phone
 * serving its own HomeKit the loop iterated nothing and the guarantee quietly
 * did not hold. The controller now supplies the members itself, from a
 * resolver it owns, through the publisher it already registers.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const homekit = vi.hoisted(() => ({
  getStatus: vi.fn(async () => ({
    ready: true, authorized: true, restricted: false, determined: true, homeCount: 1,
  })),
  isAvailable: () => true,
  startObserving: vi.fn(async () => ({ success: true, observing: true })),
  stopObserving: vi.fn(async () => ({ success: true, observing: false })),
  resetObservationTimeout: vi.fn(async () => ({ success: true })),
  listHomes: vi.fn(async () => [{ id: 'HOME-1', name: 'Home' }]),
  listServiceGroups: vi.fn(async () => [
    { id: 'GROUP-1', name: 'Kitchen lights', accessoryIds: ['ACC-1', 'ACC-2'] },
  ]),
  setServiceGroupCharacteristic: vi.fn(async () => ({ success: true, affectedCount: 2 })),
}));

vi.mock('../../native/homekit-bridge', () => ({
  HomeKit: homekit,
  default: homekit,
  isRelayCapable: () => false,
  isLocalCapable: () => true,
  withCallReason: (_reason: string, fn: () => unknown) => fn(),
}));

// The engine is never running here — that is the whole point — so the helpers
// relay-write asks it answer as they do on a phone: nothing.
vi.mock('@/automation', () => ({
  notifyRelayWrite: vi.fn(),
  notifyRelayGroupWrite: vi.fn(),
  getServiceGroupMembers: () => [],
  getAutomationEngine: () => null,
}));

vi.mock('../home-serving', () => ({
  getHomeServing: () => null,
  getThisDevice: () => null,
  servedByThisDevice: () => false,
  setDeviceServing: () => {},
}));

const broadcasts = vi.hoisted(() => [] as Array<Record<string, unknown>>);

vi.mock('../connection', () => ({
  serverConnection: {
    getState: () => ({ connectionState: 'disconnected' }),
    emitBroadcast: (m: Record<string, unknown>) => { broadcasts.push(m); },
  },
  communityRequest: vi.fn(async () => ({})),
  clearCommunityCache: vi.fn(),
  setLocalModeRouter: vi.fn(),
}));

vi.mock('../local-identity', () => ({
  localIdentity: {
    loadLast: () => {},
    hasUser: () => false,
    counts: () => null,
    sync: vi.fn(async () => null),
    stableToLive: () => new Map(),
    // Live → stable, so the tiles can be told which ids came back.
    toStable: (id: string) => `hc:${id}`,
    toLivePayload: (p: Record<string, unknown>) => p,
    toStablePayload: (p: unknown) => p,
  },
}));

async function settle(): Promise<void> {
  for (let i = 0; i < 10; i++) await Promise.resolve();
}

describe('a group write while Local Mode is serving', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    localStorage.setItem('homecast-local-mode', 'on');
    broadcasts.length = 0;
  });

  afterEach(() => {
    vi.useRealTimers();
    localStorage.clear();
    vi.resetModules();
  });

  it('announces the group once and every member once', async () => {
    const { controller } = await import('../local-mode-controller');
    const { executeHomeKitAction } = await import('../../relay/local-handler');

    controller.start();
    await settle();
    await vi.advanceTimersByTimeAsync(1_100);   // first tick → engage
    await settle();
    expect(controller.isActive()).toBe(true);

    await executeHomeKitAction('serviceGroup.set', {
      groupId: 'GROUP-1', characteristicType: 'on', value: true, homeId: 'HOME-1',
    });

    const groups = broadcasts.filter((b) => b.type === 'service_group_update');
    const members = broadcasts.filter((b) => b.type === 'characteristic_update');
    expect(groups.map((b) => b.groupId)).toEqual(['hc:GROUP-1']);
    expect(members.map((b) => b.accessoryId)).toEqual(['hc:ACC-1', 'hc:ACC-2']);
    // `on` goes in; the handler announces under the one canonical name.
    expect(members.every((b) => b.characteristicType === 'power_state' && b.value === true)).toBe(true);
  });
});
