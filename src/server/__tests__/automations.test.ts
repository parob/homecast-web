/**
 * Automation MCP tool tests.
 *
 * Covers the slug/characteristic/value transforms between the MCP grammar
 * (slugs + simple property names) and the native bridge payloads
 * (UUIDs + characteristic names), plus the tool handlers.
 *
 * The Cloud Edition has a mirror suite (test_homes_automations.py) using the
 * same fixture data — keep the two in sync.
 */

import { vi, describe, it, expect, beforeEach } from 'vitest';

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

vi.mock('@/server/connection', () => ({
  communityRequest: vi.fn().mockResolvedValue(null),
}));

vi.mock('@/server/local-auth', () => ({
  verifyToken: vi.fn().mockResolvedValue(null),
  verifyTokenFull: vi.fn().mockResolvedValue(null),
  generateCustomToken: vi.fn().mockResolvedValue('mock-token'),
}));

vi.mock('@/server/local-db', () => ({
  getSetting: vi.fn().mockResolvedValue(null),
}));

import { HomeKit } from '@/native/homekit-bridge';
import { handleMCP, resetHomeContextCache } from '@/server/local-mcp';
import {
  convertSimpleValue,
  buildAccessoryIndex,
  resolveAccessory,
  buildTriggerPayload,
  buildActionsPayload,
  normalizeAutomation,
  handleGetAutomations,
  handleCreateAutomation,
  handleUpdateAutomation,
  handleDeleteAutomation,
} from '@/server/local-automations';

// ---------------------------------------------------------------------------
// Fixtures — mirror test_homes_automations.py
// ---------------------------------------------------------------------------

const HOME = { id: '11111111-1111-1111-1111-11111111ABCD', name: 'My House' };
const HOME_SLUG = 'my_house_abcd';

const ACCESSORIES = [
  {
    id: '22222222-2222-2222-2222-22222222C3D4',
    name: 'Porch Light',
    roomName: 'Porch',
    roomId: '33333333-3333-3333-3333-33333333A1B2',
  },
  {
    id: '44444444-4444-4444-4444-44444444DDEE',
    name: 'Hall Motion',
    roomName: 'Hall',
    roomId: '55555555-5555-5555-5555-55555555B2C3',
  },
  {
    id: '66666666-6666-6666-6666-66666666EEFF',
    name: 'Alarm',
    roomName: 'Hall',
    roomId: '55555555-5555-5555-5555-55555555B2C3',
  },
];

const LIGHT_SLUG = 'porch_light_c3d4';
const MOTION_SLUG = 'hall_motion_ddee';
const ALARM_SLUG = 'alarm_eeff';

function mockHome() {
  vi.mocked(HomeKit.listHomes).mockResolvedValue([HOME] as any);
  vi.mocked(HomeKit.listAccessories).mockResolvedValue(ACCESSORIES as any);
}

async function index() {
  mockHome();
  return buildAccessoryIndex(HOME.id);
}

beforeEach(() => {
  vi.clearAllMocks();
  resetHomeContextCache();
});

// ---------------------------------------------------------------------------
// Value conversion
// ---------------------------------------------------------------------------

describe('convertSimpleValue', () => {
  it('maps alarm_target strings to HomeKit values', () => {
    expect(convertSimpleValue('alarm_target', 'home')).toBe(0);
    expect(convertSimpleValue('alarm_target', 'away')).toBe(1);
    expect(convertSimpleValue('alarm_target', 'night')).toBe(2);
    expect(convertSimpleValue('alarm_target', 'off')).toBe(3);
  });

  it('rejects invalid alarm_target strings (including triggered)', () => {
    expect(() => convertSimpleValue('alarm_target', 'triggered')).toThrow(/Invalid alarm_target/);
    expect(() => convertSimpleValue('alarm_target', 'nope')).toThrow(/home\/away\/night\/off/);
  });

  it('maps hvac_mode strings', () => {
    expect(convertSimpleValue('hvac_mode', 'auto')).toBe(0);
    expect(convertSimpleValue('hvac_mode', 'heat')).toBe(1);
    expect(convertSimpleValue('hvac_mode', 'cool')).toBe(2);
    expect(() => convertSimpleValue('hvac_mode', 'freeze')).toThrow(/auto\/heat\/cool/);
  });

  it('converts lock_target booleans to 0/1', () => {
    expect(convertSimpleValue('lock_target', true)).toBe(1);
    expect(convertSimpleValue('lock_target', false)).toBe(0);
  });

  it('does NOT misparse *_target props as numbers (regression: cloud float("away") bug)', () => {
    // heat_target/cool_target/target pass numeric values through untouched
    expect(convertSimpleValue('heat_target', 21.5)).toBe(21.5);
    expect(convertSimpleValue('target', 40)).toBe(40);
    // and alarm_target string conversion happens before any numeric handling
    expect(convertSimpleValue('alarm_target', 'away')).toBe(1);
  });

  it('passes through plain values', () => {
    expect(convertSimpleValue('on', true)).toBe(true);
    expect(convertSimpleValue('brightness', 60)).toBe(60);
  });
});

// ---------------------------------------------------------------------------
// Accessory resolution
// ---------------------------------------------------------------------------

describe('resolveAccessory', () => {
  it('resolves exact slugs, raw UUIDs, and unique name substrings', async () => {
    const idx = await index();
    expect(resolveAccessory(idx, LIGHT_SLUG)).toBe(ACCESSORIES[0].id);
    expect(resolveAccessory(idx, ACCESSORIES[0].id.toLowerCase())).toBe(ACCESSORIES[0].id);
    expect(resolveAccessory(idx, 'porch_light')).toBe(ACCESSORIES[0].id);
  });

  it('errors with available slugs for unknown accessories', async () => {
    const idx = await index();
    expect(() => resolveAccessory(idx, 'garage_door_0000')).toThrow(
      new RegExp(`Accessory not found: garage_door_0000. Available: \\[.*${LIGHT_SLUG}.*\\]`)
    );
  });

  it('errors on ambiguous references', async () => {
    const idx = await index();
    // 'l' matches porch_light_c3d4 and alarm_eeff and hall_motion_ddee
    expect(() => resolveAccessory(idx, 'l')).toThrow(/Ambiguous accessory/);
  });
});

// ---------------------------------------------------------------------------
// Write transforms
// ---------------------------------------------------------------------------

describe('buildActionsPayload', () => {
  it('expands settable props into characteristic writes', async () => {
    const idx = await index();
    const payload = buildActionsPayload(
      [{ accessory: LIGHT_SLUG, room: 'porch_a1b2', on: true, brightness: 60 }],
      idx
    );
    expect(payload).toEqual([
      { accessoryId: ACCESSORIES[0].id, characteristicType: 'power_state', targetValue: true },
      { accessoryId: ACCESSORIES[0].id, characteristicType: 'brightness', targetValue: 60 },
    ]);
  });

  it('converts friendly values (alarm_target away → security_system_target_state 1)', async () => {
    const idx = await index();
    const payload = buildActionsPayload([{ accessory: ALARM_SLUG, alarm_target: 'away' }], idx);
    expect(payload).toEqual([
      { accessoryId: ACCESSORIES[2].id, characteristicType: 'security_system_target_state', targetValue: 1 },
    ]);
  });

  it('maps automation-only props (speed/target/hvac_mode)', async () => {
    const idx = await index();
    const payload = buildActionsPayload(
      [{ accessory: LIGHT_SLUG, speed: 50, target: 80, hvac_mode: 'heat' }],
      idx
    );
    expect(payload).toEqual([
      { accessoryId: ACCESSORIES[0].id, characteristicType: 'rotation_speed', targetValue: 50 },
      { accessoryId: ACCESSORIES[0].id, characteristicType: 'target_position', targetValue: 80 },
      { accessoryId: ACCESSORIES[0].id, characteristicType: 'target_heater_cooler_state', targetValue: 1 },
    ]);
  });

  it('rejects actions without settable properties or accessory', async () => {
    const idx = await index();
    expect(() => buildActionsPayload([{ accessory: LIGHT_SLUG, room: 'porch_a1b2' }], idx)).toThrow(
      /No settable properties/
    );
    expect(() => buildActionsPayload([{ on: true }], idx)).toThrow(/requires an "accessory"/);
    expect(() => buildActionsPayload([], idx)).toThrow(/non-empty/);
  });
});

describe('buildTriggerPayload', () => {
  it('passes timer triggers through', async () => {
    const idx = await index();
    const payload = buildTriggerPayload(
      { type: 'timer', hour: 7, minute: 30, recurrenceType: 'daily', timeZone: 'Europe/London' },
      idx
    );
    expect(payload).toEqual({
      type: 'timer', hour: 7, minute: 30, recurrenceType: 'daily', timeZone: 'Europe/London',
    });
  });

  it('transforms characteristic events to accessoryId/characteristicType/triggerValue', async () => {
    const idx = await index();
    const payload = buildTriggerPayload(
      {
        type: 'event',
        events: [{ type: 'characteristic', accessory: MOTION_SLUG, characteristic: 'motion', value: true }],
        conditions: [{ type: 'characteristic', accessory: ALARM_SLUG, characteristic: 'alarm_state', value: 'away' }],
        executeOnce: true,
      },
      idx
    );
    expect(payload).toEqual({
      type: 'event',
      events: [{
        type: 'characteristic',
        accessoryId: ACCESSORIES[1].id,
        characteristicType: 'motion_detected',
        triggerValue: true,
      }],
      conditions: [{
        type: 'characteristic',
        accessoryId: ACCESSORIES[2].id,
        characteristicType: 'security_system_current_state',
        value: 1,
      }],
      executeOnce: true,
    });
  });

  it('passes significantTime/calendar/duration events through', async () => {
    const idx = await index();
    const payload = buildTriggerPayload(
      {
        type: 'event',
        events: [{ type: 'significantTime', significantEvent: 'sunset', offsetMinutes: -15 }],
        recurrences: [{ weekday: 2 }, { weekday: 3 }],
      },
      idx
    );
    expect(payload.events).toEqual([
      { type: 'significantTime', significantEvent: 'sunset', offsetMinutes: -15 },
    ]);
    expect(payload.recurrences).toEqual([{ weekday: 2 }, { weekday: 3 }]);
  });

  it('rejects non-creatable event and condition types', async () => {
    const idx = await index();
    expect(() =>
      buildTriggerPayload({ type: 'event', events: [{ type: 'presence', presenceEvent: 'atHome' }] }, idx)
    ).toThrow(/Unsupported event type: presence/);
    expect(() =>
      buildTriggerPayload(
        {
          type: 'event',
          events: [{ type: 'significantTime', significantEvent: 'sunset' }],
          conditions: [{ type: 'time', beforeTime: '22:00' }],
        },
        idx
      )
    ).toThrow(/Unsupported condition type/);
    expect(() => buildTriggerPayload({ type: 'unknown' }, idx)).toThrow(/Unsupported trigger type/);
    expect(() => buildTriggerPayload({ type: 'event', events: [] }, idx)).toThrow(/non-empty "events"/);
  });
});

// ---------------------------------------------------------------------------
// Read transforms
// ---------------------------------------------------------------------------

const RAW_EVENT_AUTOMATION = {
  id: 'AUTO-1',
  name: 'Motion light',
  isEnabled: true,
  trigger: {
    type: 'event',
    events: [{
      type: 'characteristic',
      accessoryId: ACCESSORIES[1].id,
      accessoryName: 'Hall Motion',
      characteristicType: 'motion_detected',
      triggerValue: true,
    }],
    conditions: [{
      type: 'characteristic',
      accessoryId: ACCESSORIES[2].id,
      characteristicType: 'security_system_current_state',
      value: 1,
    }],
    executeOnce: false,
    activationState: 'enabled',
  },
  actions: [
    {
      accessoryId: ACCESSORIES[0].id,
      accessoryName: 'Porch Light',
      characteristicType: 'power_state',
      targetValue: true,
    },
    {
      accessoryId: ACCESSORIES[0].id,
      accessoryName: 'Porch Light',
      characteristicType: 'brightness',
      targetValue: 60,
    },
  ],
  lastFireDate: '2026-07-09T20:41:00Z',
};

describe('normalizeAutomation', () => {
  it('emits slugs, simple names, and friendly values; groups actions per accessory', async () => {
    const idx = await index();
    const normalized = normalizeAutomation(RAW_EVENT_AUTOMATION, idx);
    expect(normalized).toEqual({
      id: 'AUTO-1',
      name: 'Motion light',
      enabled: true,
      editable: true,
      trigger: {
        type: 'event',
        events: [{ type: 'characteristic', accessory: MOTION_SLUG, characteristic: 'motion', value: true }],
        conditions: [{ type: 'characteristic', accessory: ALARM_SLUG, characteristic: 'alarm_state', value: 'away' }],
      },
      actions: [{ accessory: LIGHT_SLUG, room: 'porch_a1b2', on: true, brightness: 60 }],
      last_fired: '2026-07-09T20:41:00Z',
    });
  });

  it('round-trips: normalized output is valid create input', async () => {
    const idx = await index();
    const normalized = normalizeAutomation(RAW_EVENT_AUTOMATION, idx);
    // The normalized trigger/actions must be accepted by the write transforms
    const trigger = buildTriggerPayload(normalized.trigger, idx);
    const actions = buildActionsPayload(normalized.actions, idx);
    expect(trigger.events[0].accessoryId).toBe(ACCESSORIES[1].id);
    expect(trigger.conditions[0].value).toBe(1);
    expect(actions).toHaveLength(2);
  });

  it('marks presence/location/unknown triggers as not editable', async () => {
    const idx = await index();
    const presence = normalizeAutomation({
      id: 'AUTO-2', name: 'Arrive home', isEnabled: true,
      trigger: { type: 'event', events: [{ type: 'presence', presenceType: 'anyone', presenceEvent: 'atHome' }] },
      actions: [],
    }, idx);
    expect(presence.editable).toBe(false);

    const opaque = normalizeAutomation({
      id: 'AUTO-3', name: 'Shortcut thing', isEnabled: false,
      trigger: { type: 'unknown' },
      actions: [],
    }, idx);
    expect(opaque.editable).toBe(false);
    expect(opaque.enabled).toBe(false);
    expect(opaque.trigger).toEqual({ type: 'unknown' });
  });

  it('marks non-equality conditions as not editable', async () => {
    const idx = await index();
    const normalized = normalizeAutomation({
      id: 'AUTO-4', name: 'Temp guard', isEnabled: true,
      trigger: {
        type: 'event',
        events: [{ type: 'significantTime', significantEvent: 'sunset' }],
        conditions: [{
          type: 'characteristic',
          accessoryId: ACCESSORIES[1].id,
          characteristicType: 'current_temperature',
          value: 20,
          comparisonOperator: 'greaterThan',
        }],
      },
      actions: [],
    }, idx);
    expect(normalized.editable).toBe(false);
  });

  it('surfaces activation issues (e.g. disabledNoHomeHub)', async () => {
    const idx = await index();
    const normalized = normalizeAutomation({
      id: 'AUTO-5', name: 'Hub needed', isEnabled: true,
      trigger: {
        type: 'event',
        events: [{ type: 'significantTime', significantEvent: 'sunrise' }],
        activationState: 'disabledNoHomeHub',
      },
      actions: [],
    }, idx);
    expect(normalized.trigger.activation_issue).toBe('disabledNoHomeHub');
  });
});

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

describe('handleGetAutomations', () => {
  it('returns {home_key: [automation]} with _meta', async () => {
    mockHome();
    vi.mocked(HomeKit.listAutomations).mockResolvedValue([RAW_EVENT_AUTOMATION] as any);

    const result = await handleGetAutomations();
    expect(Object.keys(result)).toEqual([HOME_SLUG, '_meta']);
    expect(result[HOME_SLUG]).toHaveLength(1);
    expect(result[HOME_SLUG][0].id).toBe('AUTO-1');
    expect(result._meta.message).toBe('Found 1 automation across 1 home');
    expect(result._meta.fetched_at).toMatch(/\+00:00$/);
  });

  it('filters by home substring', async () => {
    mockHome();
    const result = await handleGetAutomations('beach');
    expect(Object.keys(result)).toEqual(['_meta']);
    expect(result._meta.message).toBe('No homes match filter: beach');
  });
});

describe('handleCreateAutomation', () => {
  it('resolves slugs and calls automation.create with native payloads', async () => {
    mockHome();
    vi.mocked(HomeKit.createAutomation).mockResolvedValue({
      ...RAW_EVENT_AUTOMATION, id: 'NEW-1', name: 'Sunset light',
    } as any);

    const result = await handleCreateAutomation({
      home: HOME_SLUG,
      name: 'Sunset light',
      trigger: { type: 'event', events: [{ type: 'significantTime', significantEvent: 'sunset' }] },
      actions: [{ accessory: LIGHT_SLUG, on: true }],
    });

    expect(HomeKit.createAutomation).toHaveBeenCalledWith(
      HOME.id,
      'Sunset light',
      { type: 'event', events: [{ type: 'significantTime', significantEvent: 'sunset' }] },
      [{ accessoryId: ACCESSORIES[0].id, characteristicType: 'power_state', targetValue: true }],
    );
    expect(result.home).toBe(HOME_SLUG);
    expect(result.automation.id).toBe('NEW-1');
    expect(result.message).toBe('Created automation "Sunset light"');
  });

  it('errors with available home slugs for unknown home', async () => {
    mockHome();
    await expect(handleCreateAutomation({
      home: 'wrong_home_0000',
      name: 'X',
      trigger: { type: 'timer', fireDate: '2026-07-11T07:00:00Z' },
      actions: [{ accessory: LIGHT_SLUG, on: true }],
    })).rejects.toThrow(`Home not found: wrong_home_0000. Available: [${HOME_SLUG}]`);
  });
});

describe('handleUpdateAutomation', () => {
  it('passes enabled-only updates straight through (no editable guard)', async () => {
    mockHome();
    vi.mocked(HomeKit.updateAutomation).mockResolvedValue({ ...RAW_EVENT_AUTOMATION, isEnabled: false } as any);

    const result = await handleUpdateAutomation({ home: HOME_SLUG, id: 'AUTO-1', enabled: false });

    expect(HomeKit.updateAutomation).toHaveBeenCalledWith('AUTO-1', { enabled: false });
    expect(HomeKit.listAutomations).not.toHaveBeenCalled();
    expect(result.automation.enabled).toBe(false);
  });

  it('rejects trigger changes on non-editable automations', async () => {
    mockHome();
    vi.mocked(HomeKit.listAutomations).mockResolvedValue([{
      id: 'AUTO-2', name: 'Arrive home', isEnabled: true,
      trigger: { type: 'event', events: [{ type: 'presence', presenceEvent: 'atHome' }] },
      actions: [],
    }] as any);

    await expect(handleUpdateAutomation({
      home: HOME_SLUG, id: 'AUTO-2',
      trigger: { type: 'timer', fireDate: '2026-07-11T07:00:00Z' },
    })).rejects.toThrow(/Only name and enabled can be changed/);
    expect(HomeKit.updateAutomation).not.toHaveBeenCalled();
  });

  it('notes when a trigger change produced a new id', async () => {
    mockHome();
    vi.mocked(HomeKit.listAutomations).mockResolvedValue([RAW_EVENT_AUTOMATION] as any);
    vi.mocked(HomeKit.updateAutomation).mockResolvedValue({ ...RAW_EVENT_AUTOMATION, id: 'AUTO-99' } as any);

    const result = await handleUpdateAutomation({
      home: HOME_SLUG, id: 'AUTO-1',
      trigger: { type: 'timer', fireDate: '2026-07-11T07:00:00Z' },
    });
    expect(result.automation.id).toBe('AUTO-99');
    expect(result.message).toContain('recreated with a new id: AUTO-99');
  });

  it('requires at least one change', async () => {
    mockHome();
    await expect(handleUpdateAutomation({ home: HOME_SLUG, id: 'AUTO-1' }))
      .rejects.toThrow(/at least one of/);
  });
});

describe('personalized tool descriptions (tools/list)', () => {
  it('appends the home/room context block to get_state and get_automations only', async () => {
    mockHome();
    vi.mocked(HomeKit.listRooms).mockResolvedValue([
      { id: 'R1', name: 'Porch' },
      { id: 'R2', name: 'Hall' },
    ] as any);

    const response = JSON.parse(await handleMCP(JSON.stringify({
      jsonrpc: '2.0', id: 1, method: 'tools/list',
    })));

    const byName: Record<string, any> = {};
    for (const tool of response.result.tools) byName[tool.name] = tool;

    for (const name of ['get_state', 'get_automations']) {
      expect(byName[name].description).toContain(`This account's homes: ${HOME_SLUG} (rooms: porch, hall)`);
    }
    for (const name of ['set_state', 'run_scene', 'create_automation', 'update_automation', 'delete_automation']) {
      expect(byName[name].description).not.toContain("This account's homes");
    }
  });

  it('omits the block when no homes exist and caches the lookup', async () => {
    vi.mocked(HomeKit.listHomes).mockResolvedValue([] as any);

    const call = () => handleMCP(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }));
    const first = JSON.parse(await call());
    expect(first.result.tools.find((t: any) => t.name === 'get_state').description)
      .not.toContain("This account's homes");

    await call();
    expect(HomeKit.listHomes).toHaveBeenCalledTimes(1);
  });
});

describe('handleDeleteAutomation', () => {
  it('deletes by id and reports success', async () => {
    mockHome();
    vi.mocked(HomeKit.deleteAutomation).mockResolvedValue({ success: true, automationId: 'AUTO-1' } as any);

    const result = await handleDeleteAutomation({ home: HOME_SLUG, id: 'AUTO-1' });
    expect(HomeKit.deleteAutomation).toHaveBeenCalledWith('AUTO-1');
    expect(result).toEqual({ success: true, id: 'AUTO-1', home: HOME_SLUG, message: 'Automation deleted' });
  });
});
