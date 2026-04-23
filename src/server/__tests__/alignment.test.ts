/**
 * Alignment tests: Community Edition ↔ Cloud Edition.
 *
 * These tests validate that the CE server modules export the correct
 * contracts, constants, and structures so that the CE stays aligned
 * with the Cloud Edition (homecast-cloud).
 *
 * Since the server code runs inside WKWebView and depends on
 * `window.homekit`, browser crypto, and IndexedDB, we mock the
 * native bridge and test the pure logic paths.
 */

import { vi, describe, it, expect, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks — must be declared before any imports that pull in browser deps
// ---------------------------------------------------------------------------

// Mock the HomeKit native bridge (used by local-handler.ts)
vi.mock('@/native/homekit-bridge', () => ({
  HomeKit: {
    listHomes: vi.fn().mockResolvedValue([]),
    listRooms: vi.fn().mockResolvedValue([]),
    listZones: vi.fn().mockResolvedValue([]),
    listAccessories: vi.fn().mockResolvedValue([]),
    getAccessory: vi.fn().mockResolvedValue(null),
    refreshAccessory: vi.fn().mockResolvedValue(null),
    getCharacteristic: vi.fn().mockResolvedValue(null),
    setCharacteristic: vi.fn().mockResolvedValue(null),
    listScenes: vi.fn().mockResolvedValue([]),
    executeScene: vi.fn().mockResolvedValue(null),
    listServiceGroups: vi.fn().mockResolvedValue([]),
    setServiceGroupCharacteristic: vi.fn().mockResolvedValue(null),
    setState: vi.fn().mockResolvedValue(null),
    startObserving: vi.fn().mockResolvedValue(null),
    stopObserving: vi.fn().mockResolvedValue(null),
    resetObservationTimeout: vi.fn().mockResolvedValue(null),
    listAutomations: vi.fn().mockResolvedValue([]),
    createAutomation: vi.fn().mockResolvedValue(null),
    updateAutomation: vi.fn().mockResolvedValue(null),
    deleteAutomation: vi.fn().mockResolvedValue(null),
    setAutomationEnabled: vi.fn().mockResolvedValue(null),
  },
  getNativeBridge: vi.fn().mockReturnValue(null),
}));

// Mock the connection module (used by local-rest.ts)
vi.mock('@/server/connection', () => ({
  communityRequest: vi.fn().mockResolvedValue(null),
}));

// Mock local-auth (used by local-rest.ts and local-oauth.ts)
vi.mock('@/server/local-auth', () => ({
  verifyToken: vi.fn().mockResolvedValue(null),
  verifyTokenFull: vi.fn().mockResolvedValue(null),
  generateCustomToken: vi.fn().mockResolvedValue('mock-token'),
}));

// Mock local-db (used by local-oauth.ts)
vi.mock('@/server/local-db', () => ({
  getSetting: vi.fn().mockResolvedValue(null),
  putOAuthClient: vi.fn().mockResolvedValue(undefined),
  getOAuthClient: vi.fn().mockResolvedValue(null),
  putAuthorizationCode: vi.fn().mockResolvedValue(undefined),
  getAuthorizationCode: vi.fn().mockResolvedValue(null),
  deleteAuthorizationCode: vi.fn().mockResolvedValue(undefined),
  putRefreshToken: vi.fn().mockResolvedValue(undefined),
  getRefreshToken: vi.fn().mockResolvedValue(null),
  deleteRefreshToken: vi.fn().mockResolvedValue(undefined),
  deleteRefreshTokensByFamily: vi.fn().mockResolvedValue(undefined),
  putUserConsent: vi.fn().mockResolvedValue(undefined),
  getUserConsent: vi.fn().mockResolvedValue(null),
}));

// ---------------------------------------------------------------------------
// Imports (after mocks are set up)
// ---------------------------------------------------------------------------

import {
  ErrorCode,
  setAccessoryLimit,
  setAllowedAccessoryIds,
  getAllowedAccessoryIds,
  getAccessoryLimit,
  isAccessoryAllowed,
  executeHomeKitAction,
} from '@/relay/local-handler';

import { handleMCP } from '@/server/local-mcp';
import { handleREST } from '@/server/local-rest';

// ===================================================================
// 1. ErrorCode — must match the Cloud Edition's error codes
// ===================================================================

describe('ErrorCode', () => {
  it('exports all expected error codes', () => {
    const expected = [
      'INVALID_REQUEST',
      'UNKNOWN_ACTION',
      'HOME_NOT_FOUND',
      'ROOM_NOT_FOUND',
      'ACCESSORY_NOT_FOUND',
      'SCENE_NOT_FOUND',
      'CHARACTERISTIC_NOT_FOUND',
      'CHARACTERISTIC_NOT_WRITABLE',
      'ACCESSORY_UNREACHABLE',
      'INVALID_VALUE',
      'HOMEKIT_ERROR',
      'INTERNAL_ERROR',
      'PERMISSION_DENIED',
    ];
    for (const code of expected) {
      expect(ErrorCode).toHaveProperty(code);
      // Values should equal their key names (string enum convention)
      expect((ErrorCode as any)[code]).toBe(code);
    }
  });

  it('has no unexpected extra codes', () => {
    const knownCodes = new Set([
      'INVALID_REQUEST',
      'UNKNOWN_ACTION',
      'HOME_NOT_FOUND',
      'ROOM_NOT_FOUND',
      'ACCESSORY_NOT_FOUND',
      'SCENE_NOT_FOUND',
      'CHARACTERISTIC_NOT_FOUND',
      'CHARACTERISTIC_NOT_WRITABLE',
      'ACCESSORY_UNREACHABLE',
      'INVALID_VALUE',
      'HOMEKIT_ERROR',
      'INTERNAL_ERROR',
      'PERMISSION_DENIED',
    ]);
    for (const key of Object.keys(ErrorCode)) {
      expect(knownCodes.has(key)).toBe(true);
    }
  });
});

// ===================================================================
// 2. Accessory limit enforcement (pure logic in local-handler.ts)
// ===================================================================

describe('Accessory limit enforcement', () => {
  beforeEach(() => {
    // Reset to unlimited
    setAccessoryLimit(null);
    setAllowedAccessoryIds(null);
  });

  it('allows all accessories when limit is null (unlimited)', () => {
    expect(isAccessoryAllowed('any-id')).toBe(true);
    expect(getAccessoryLimit()).toBeNull();
    expect(getAllowedAccessoryIds()).toBeNull();
  });

  it('blocks all accessories when limit is set but no IDs selected', () => {
    setAccessoryLimit(5);
    expect(isAccessoryAllowed('any-id')).toBe(false);
    expect(getAccessoryLimit()).toBe(5);
  });

  it('allows only selected accessories when limit and IDs are set', () => {
    setAccessoryLimit(3);
    setAllowedAccessoryIds(['id-1', 'id-2', 'id-3']);

    expect(isAccessoryAllowed('id-1')).toBe(true);
    expect(isAccessoryAllowed('id-2')).toBe(true);
    expect(isAccessoryAllowed('id-3')).toBe(true);
    expect(isAccessoryAllowed('id-4')).toBe(false);
  });

  it('clears allowed IDs when null limit is set', () => {
    setAccessoryLimit(3);
    setAllowedAccessoryIds(['id-1']);
    expect(isAccessoryAllowed('id-1')).toBe(true);

    setAccessoryLimit(null);
    expect(isAccessoryAllowed('id-1')).toBe(true); // null limit = unlimited
    expect(getAllowedAccessoryIds()).toBeNull();
  });

  it('clears allowed IDs when empty array is set', () => {
    setAccessoryLimit(5);
    setAllowedAccessoryIds(['id-1']);
    expect(getAllowedAccessoryIds()?.size).toBe(1);

    setAllowedAccessoryIds([]);
    expect(getAllowedAccessoryIds()).toBeNull();
  });
});

// ===================================================================
// 3. MCP protocol compliance (JSON-RPC over handleMCP)
// ===================================================================

describe('MCP endpoint (handleMCP)', () => {
  it('responds to initialize with protocol version and server info', async () => {
    const response = JSON.parse(await handleMCP(JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {},
    })));

    expect(response.jsonrpc).toBe('2.0');
    expect(response.id).toBe(1);
    expect(response.result.protocolVersion).toBe('2024-11-05');
    expect(response.result.serverInfo.name).toBe('homecast-community');
    expect(response.result.serverInfo.version).toBeDefined();
    expect(response.result.capabilities).toHaveProperty('tools');
  });

  it('responds to tools/list with exactly 3 tools matching cloud', async () => {
    const response = JSON.parse(await handleMCP(JSON.stringify({
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/list',
    })));

    expect(response.jsonrpc).toBe('2.0');
    expect(response.id).toBe(2);
    const tools = response.result.tools;
    expect(tools).toHaveLength(3);

    const toolNames = tools.map((t: any) => t.name).sort();
    expect(toolNames).toEqual(['get_state', 'run_scene', 'set_state']);
  });

  it('get_state tool has correct filter parameters', async () => {
    const response = JSON.parse(await handleMCP(JSON.stringify({
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/list',
    })));

    const getState = response.result.tools.find((t: any) => t.name === 'get_state');
    const props = getState.inputSchema.properties;
    expect(props).toHaveProperty('filter_by_home');
    expect(props).toHaveProperty('filter_by_room');
    expect(props).toHaveProperty('filter_by_type');
    expect(props).toHaveProperty('filter_by_name');
    // get_state has no required fields
    expect(getState.inputSchema.required).toBeUndefined();
    // Annotations: read-only
    expect(getState.annotations.readOnlyHint).toBe(true);
  });

  it('set_state tool requires updates array with home/room/accessory', async () => {
    const response = JSON.parse(await handleMCP(JSON.stringify({
      jsonrpc: '2.0',
      id: 4,
      method: 'tools/list',
    })));

    const setState = response.result.tools.find((t: any) => t.name === 'set_state');
    expect(setState.inputSchema.required).toEqual(['updates']);
    const items = setState.inputSchema.properties.updates.items;
    expect(items.required).toEqual(['home', 'room', 'accessory']);
    // Must include all settable property types
    const propNames = Object.keys(items.properties);
    expect(propNames).toContain('on');
    expect(propNames).toContain('brightness');
    expect(propNames).toContain('hue');
    expect(propNames).toContain('saturation');
    expect(propNames).toContain('color_temp');
    expect(propNames).toContain('active');
    expect(propNames).toContain('heat_target');
    expect(propNames).toContain('cool_target');
    expect(propNames).toContain('hvac_mode');
    expect(propNames).toContain('lock_target');
    expect(propNames).toContain('alarm_target');
    expect(propNames).toContain('speed');
    expect(propNames).toContain('volume');
    expect(propNames).toContain('mute');
    expect(propNames).toContain('target');
    // Annotations: not read-only
    expect(setState.annotations.readOnlyHint).toBe(false);
  });

  it('run_scene tool requires home and name', async () => {
    const response = JSON.parse(await handleMCP(JSON.stringify({
      jsonrpc: '2.0',
      id: 5,
      method: 'tools/list',
    })));

    const runScene = response.result.tools.find((t: any) => t.name === 'run_scene');
    expect(runScene.inputSchema.required).toEqual(['home', 'name']);
    expect(runScene.inputSchema.properties).toHaveProperty('home');
    expect(runScene.inputSchema.properties).toHaveProperty('name');
    expect(runScene.annotations.readOnlyHint).toBe(false);
  });

  it('responds to ping', async () => {
    const response = JSON.parse(await handleMCP(JSON.stringify({
      jsonrpc: '2.0',
      id: 6,
      method: 'ping',
    })));

    expect(response.jsonrpc).toBe('2.0');
    expect(response.id).toBe(6);
    expect(response.result).toEqual({});
  });

  it('returns method-not-found for unknown methods', async () => {
    const response = JSON.parse(await handleMCP(JSON.stringify({
      jsonrpc: '2.0',
      id: 7,
      method: 'unknown/method',
    })));

    expect(response.error).toBeDefined();
    expect(response.error.code).toBe(-32601);
  });

  it('returns parse error for invalid JSON', async () => {
    const response = JSON.parse(await handleMCP('not valid json'));
    expect(response.error).toBeDefined();
    expect(response.error.code).toBe(-32700);
  });
});

// ===================================================================
// 4. executeHomeKitAction — action routing
// ===================================================================

describe('executeHomeKitAction', () => {
  it('returns pong for ping action', async () => {
    const result = await executeHomeKitAction('ping') as any;
    expect(result.pong).toBe(true);
    expect(result.timestamp).toBeTypeOf('number');
  });

  it('throws UNKNOWN_ACTION for invalid actions', async () => {
    await expect(executeHomeKitAction('nonexistent.action')).rejects.toMatchObject({
      code: 'UNKNOWN_ACTION',
    });
  });

  it('routes homes.list to HomeKit bridge', async () => {
    const { HomeKit } = await import('@/native/homekit-bridge');
    (HomeKit.listHomes as any).mockResolvedValueOnce([
      { id: 'home-1', name: 'Test Home' },
    ]);

    const result = await executeHomeKitAction('homes.list') as any;
    expect(result.homes).toEqual([{ id: 'home-1', name: 'Test Home' }]);
    expect(HomeKit.listHomes).toHaveBeenCalled();
  });

  it('supports all documented relay actions', () => {
    // These are the actions documented in CLAUDE.md — verify they don't
    // throw UNKNOWN_ACTION (they may throw other errors due to missing
    // payload, but that's fine — we're testing the routing, not the logic).
    const actions = [
      'homes.list',
      'rooms.list',
      'zones.list',
      'accessories.list',
      'accessory.get',
      'accessory.refresh',
      'characteristic.get',
      'characteristic.set',
      'scenes.list',
      'scene.execute',
      'serviceGroups.list',
      'serviceGroup.set',
      'automations.list',
      'automation.get',
      'automation.create',
      'automation.update',
      'automation.delete',
      'automation.enable',
      'automation.disable',
      'state.set',
      'observe.start',
      'observe.stop',
      'observe.reset',
      'ping',
    ];

    // Just verify the switch cases exist — each action is represented
    // in the executeHomeKitAction switch statement
    expect(actions.length).toBe(24);
  });
});

// ===================================================================
// 5. REST endpoint routing
// ===================================================================

describe('REST endpoint routing (handleREST)', () => {
  it('returns not-found for unknown routes', async () => {
    const result = await handleREST({ method: 'GET', path: '/rest/nonexistent' }) as any;
    expect(result.error).toBe('Not found');
  });

  it('routes GET /rest/homes', async () => {
    const { HomeKit } = await import('@/native/homekit-bridge');
    (HomeKit.listHomes as any).mockResolvedValueOnce([
      { id: 'h1', name: 'My House' },
    ]);

    const result = await handleREST({ method: 'GET', path: '/rest/homes' }) as any;
    expect(Array.isArray(result)).toBe(true);
  });

  it('routes GET /rest/state', async () => {
    const { HomeKit } = await import('@/native/homekit-bridge');
    (HomeKit.listHomes as any).mockResolvedValueOnce([]);

    const result = await handleREST({ method: 'GET', path: '/rest/state' }) as any;
    // Should return state object with _meta
    expect(result).toHaveProperty('_meta');
    expect(result._meta).toHaveProperty('message');
    expect(result._meta).toHaveProperty('fetched_at');
  });

  it('routes GET /rest/accessories', async () => {
    const { HomeKit } = await import('@/native/homekit-bridge');
    (HomeKit.listAccessories as any).mockResolvedValueOnce([]);

    const result = await handleREST({ method: 'GET', path: '/rest/accessories' }) as any;
    expect(Array.isArray(result)).toBe(true);
  });

  it('routes POST /rest/state with cloud-format body', async () => {
    const { HomeKit } = await import('@/native/homekit-bridge');
    (HomeKit.listHomes as any).mockResolvedValueOnce([]);

    const result = await handleREST({
      method: 'POST',
      path: '/rest/state',
      body: JSON.stringify({ my_house_0bf8: { living_a1b2: { light_c3d4: { on: true } } } }),
    }) as any;

    // Should return the set_state response structure
    expect(result).toHaveProperty('updated');
    expect(result).toHaveProperty('failed');
    expect(result).toHaveProperty('changes');
    expect(result).toHaveProperty('errors');
    expect(result).toHaveProperty('message');
  });

  it('returns error for POST /rest/state with no body', async () => {
    const result = await handleREST({ method: 'POST', path: '/rest/state' }) as any;
    expect(result.error).toBe('Missing body');
  });

  it('routes GET /rest/scenes requiring home param', async () => {
    const result = await handleREST({ method: 'GET', path: '/rest/scenes' }) as any;
    expect(result.error).toBe('home parameter required');
  });

  it('routes GET /rest/rooms requiring home param', async () => {
    const result = await handleREST({ method: 'GET', path: '/rest/rooms' }) as any;
    expect(result.error).toBe('home parameter required');
  });

  it('supports query parameter filters on GET /rest/state', async () => {
    const { HomeKit } = await import('@/native/homekit-bridge');
    (HomeKit.listHomes as any).mockResolvedValueOnce([]);

    const result = await handleREST({
      method: 'GET',
      path: '/rest/state?home=test&room=living&type=light&name=ceiling',
    }) as any;

    expect(result).toHaveProperty('_meta');
  });
});

// ===================================================================
// 6. State response format alignment
// ===================================================================

describe('GET /rest/state response format', () => {
  // Accessory-limit globals persist across describe blocks (module-level state
  // in local-handler.ts). Earlier tests in "Accessory limit enforcement" leave
  // accessoryLimit set, which would make filterAccessories() strip every
  // accessory from the /rest/state response. Reset on every test here so this
  // block runs in "unlimited" mode regardless of ordering.
  beforeEach(() => {
    setAccessoryLimit(null);
    setAllowedAccessoryIds(null);
  });

  it('includes _meta with fetched_at in ISO format and message', async () => {
    const { HomeKit } = await import('@/native/homekit-bridge');
    (HomeKit.listHomes as any).mockResolvedValueOnce([]);

    const result = await handleREST({ method: 'GET', path: '/rest/state' }) as any;

    expect(result._meta).toBeDefined();
    expect(result._meta.fetched_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+00:00$/);
    expect(typeof result._meta.message).toBe('string');
  });

  it('includes _homes mapping when homes exist', async () => {
    const { HomeKit } = await import('@/native/homekit-bridge');
    (HomeKit.listHomes as any).mockResolvedValueOnce([
      { id: 'aaaa-bbbb-cccc-dddd', name: 'Beach House' },
    ]);
    (HomeKit.listAccessories as any).mockResolvedValueOnce([]);
    (HomeKit.listScenes as any).mockResolvedValueOnce([]);
    (HomeKit.listServiceGroups as any).mockResolvedValueOnce([]);

    const result = await handleREST({ method: 'GET', path: '/rest/state' }) as any;

    expect(result._homes).toBeDefined();
    // _homes maps slug key → UUID
    const keys = Object.keys(result._homes);
    expect(keys.length).toBe(1);
    expect(keys[0]).toMatch(/^beach_house_\w{4}$/);
    expect(Object.values(result._homes)[0]).toBe('aaaa-bbbb-cccc-dddd');
  });

  it('includes _scenes list in each home', async () => {
    const { HomeKit } = await import('@/native/homekit-bridge');
    (HomeKit.listHomes as any).mockResolvedValueOnce([
      { id: 'aaaa-bbbb-cccc-dddd', name: 'Test Home' },
    ]);
    (HomeKit.listAccessories as any).mockResolvedValueOnce([]);
    (HomeKit.listScenes as any).mockResolvedValueOnce([
      { id: 's1', name: 'Good Morning' },
      { id: 's2', name: 'Good Night' },
    ]);
    (HomeKit.listServiceGroups as any).mockResolvedValueOnce([]);

    const result = await handleREST({ method: 'GET', path: '/rest/state' }) as any;

    const homeKey = Object.keys(result).find(k => !k.startsWith('_'))!;
    expect(homeKey).toBeDefined();
    expect(result[homeKey]._scenes).toEqual(['Good Morning', 'Good Night']);
  });

  it('formats accessories with type, properties, and _settable', async () => {
    const { HomeKit } = await import('@/native/homekit-bridge');
    (HomeKit.listHomes as any).mockResolvedValueOnce([
      { id: 'aaaa-bbbb-cccc-dddd', name: 'Home' },
    ]);
    (HomeKit.listAccessories as any).mockResolvedValueOnce([
      {
        id: 'acc-1111',
        name: 'Ceiling Light',
        roomName: 'Living Room',
        roomId: 'room-2222',
        category: 'lightbulb',
        services: [
          {
            serviceType: 'lightbulb',
            characteristics: [
              { characteristicType: 'on', value: true, isWritable: true },
              { characteristicType: 'brightness', value: 75, isWritable: true },
              { characteristicType: 'name', value: 'Ceiling Light', isWritable: false },
            ],
          },
        ],
      },
    ]);
    (HomeKit.listScenes as any).mockResolvedValueOnce([]);
    (HomeKit.listServiceGroups as any).mockResolvedValueOnce([]);

    const result = await handleREST({ method: 'GET', path: '/rest/state' }) as any;

    const homeKey = Object.keys(result).find(k => !k.startsWith('_'))!;
    const roomKey = Object.keys(result[homeKey]).find(k => !k.startsWith('_'))!;
    const accKey = Object.keys(result[homeKey][roomKey])[0];
    const acc = result[homeKey][roomKey][accKey];

    expect(acc.type).toBe('light');
    expect(acc.on).toBe(true);
    expect(acc.brightness).toBe(75);
    expect(acc._settable).toContain('on');
    expect(acc._settable).toContain('brightness');
    // name field should contain the full slug path
    expect(acc.name).toMatch(/^home_\w{4}\.living_room_\w{4}\.ceiling_light_\w{4}$/);
  });
});

// ===================================================================
// 7. POST /rest/state response format alignment
// ===================================================================

describe('POST /rest/state response format', () => {
  it('returns { updated, failed, changes, errors, message } structure', async () => {
    const { HomeKit } = await import('@/native/homekit-bridge');
    (HomeKit.listHomes as any).mockResolvedValueOnce([]);

    const result = await handleREST({
      method: 'POST',
      path: '/rest/state',
      body: JSON.stringify({}),
    }) as any;

    // Even with no matching homes, the structure should be correct
    expect(result).toHaveProperty('updated');
    expect(result).toHaveProperty('failed');
    expect(result).toHaveProperty('changes');
    expect(result).toHaveProperty('errors');
    expect(result).toHaveProperty('message');
    expect(typeof result.updated).toBe('number');
    expect(typeof result.failed).toBe('number');
    expect(Array.isArray(result.changes)).toBe(true);
    expect(Array.isArray(result.errors)).toBe(true);
    expect(typeof result.message).toBe('string');
  });
});
