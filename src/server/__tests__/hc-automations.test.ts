/**
 * Homecast-engine automation MCP tool tests.
 *
 * The sibling suite `automations.test.ts` covers HomeKit's automation API.
 * This one covers the Homecast engine — the capabilities HomeKit does not have
 * (numeric thresholds, stored state via virtual accessories, condition trees)
 * and the compile step from the flat MCP grammar to `Automation` JSON.
 *
 * The Cloud Edition has a mirror suite (test_homes_hc_automations.py) using the
 * same fixture data — keep the two in sync.
 */

import { vi, describe, it, expect, beforeEach } from 'vitest';

const HOME_ID = '11111111-1111-1111-1111-111111111111';
const AIRCON_ID = '22222222-2222-2222-2222-222222222222';
const SENSOR_ID = '33333333-3333-3333-3333-333333333333';
const VIRTUAL_ID = '44444444-4444-4444-4444-444444444444';

const executeHomeKitAction = vi.fn(async (action: string, _payload?: unknown) => {
  if (action === 'homes.list') {
    return { homes: [{ id: HOME_ID, name: 'George Street' }] };
  }
  if (action === 'accessories.list') {
    return {
      accessories: [
        { id: AIRCON_ID, name: 'Bedroom 1 Air Conditioner', roomId: 'r1', roomName: 'Bedroom 1' },
        { id: SENSOR_ID, name: 'Bedroom 1 Underfloor Heating', roomId: 'r1', roomName: 'Bedroom 1' },
      ],
    };
  }
  if (action === 'scenes.list') {
    return { scenes: [{ id: 'scene-1', name: 'Good Night' }] };
  }
  return {};
});

// In-memory stand-in for IndexedDB.
const automationRows: { id: string; homeId: string; data: string }[] = [];
const virtualRows: { id: string; homeId: string; data: string }[] = [];

vi.mock('@/relay/local-handler', () => ({
  executeHomeKitAction: (action: string, payload?: unknown) => executeHomeKitAction(action, payload),
}));

// Same reason as automations.test.ts: connection.ts pulls in websocket.ts,
// which reaches through lib/config to `window`, and these run in node.
vi.mock('@/server/connection', () => ({
  communityRequest: vi.fn().mockResolvedValue(null),
  serverConnection: { emitBroadcast: vi.fn() },
}));

vi.mock('@/server/local-auth', () => ({
  verifyToken: vi.fn().mockResolvedValue(null),
  verifyTokenFull: vi.fn().mockResolvedValue(null),
  generateCustomToken: vi.fn().mockResolvedValue('mock-token'),
}));

vi.mock('@/server/local-db', () => ({
  getHcAutomations: vi.fn(async (homeId?: string) =>
    automationRows.filter((r) => !homeId || r.homeId === homeId)),
  saveHcAutomation: vi.fn(async (homeId: string, id: string | null, data: string) => {
    const row = { id: id ?? 'generated', homeId, data };
    const existing = automationRows.findIndex((r) => r.id === row.id);
    if (existing >= 0) automationRows[existing] = row;
    else automationRows.push(row);
    return row;
  }),
  deleteHcAutomation: vi.fn(async (id: string) => {
    const i = automationRows.findIndex((r) => r.id === id);
    if (i >= 0) automationRows.splice(i, 1);
    return true;
  }),
  getVirtualAccessories: vi.fn(async (homeId?: string) =>
    virtualRows.filter((r) => !homeId || r.homeId === homeId)),
  saveVirtualAccessory: vi.fn(async (homeId: string, id: string | null, data: string) => {
    const row = { id: id ?? 'generated', homeId, data };
    const existing = virtualRows.findIndex((r) => r.id === row.id);
    if (existing >= 0) virtualRows[existing] = row;
    else virtualRows.push(row);
    return row;
  }),
  deleteVirtualAccessory: vi.fn(async (id: string) => {
    const i = virtualRows.findIndex((r) => r.id === id);
    if (i >= 0) virtualRows.splice(i, 1);
    return true;
  }),
  getSetting: vi.fn().mockResolvedValue(null),
}));

vi.mock('@/server/community-automation', () => ({
  reloadCommunityAutomations: vi.fn().mockResolvedValue(undefined),
  reloadCommunityVirtualAccessories: vi.fn().mockResolvedValue(undefined),
}));

import {
  handleCreateHcAutomation,
  handleUpdateHcAutomation,
  handleDeleteHcAutomation,
  handleGetHcAutomations,
  handleCreateVirtualAccessory,
  handleUpdateVirtualAccessory,
  handleDeleteVirtualAccessory,
} from '@/server/local-hc-automations';

/** The stored Automation JSON for the single automation we just created. */
function storedAutomation(): any {
  return JSON.parse(automationRows[automationRows.length - 1].data);
}

function seedVirtual(name: string, type: string, extra: Record<string, unknown> = {}): string {
  virtualRows.push({
    id: VIRTUAL_ID,
    homeId: HOME_ID,
    data: JSON.stringify({ id: VIRTUAL_ID, name, homeId: HOME_ID, type, ...extra }),
  });
  return VIRTUAL_ID;
}

beforeEach(() => {
  automationRows.length = 0;
  virtualRows.length = 0;
  executeHomeKitAction.mockClear();
});

describe('numeric thresholds — the capability HomeKit does not have', () => {
  it('compiles above into a numeric_state trigger', async () => {
    await handleCreateHcAutomation({
      home: 'george_street_1111',
      name: 'Bedroom 1 dry cycle',
      triggers: [{
        type: 'numeric',
        accessory: 'bedroom_1_underfloor_heating_3333',
        characteristic: 'relative_humidity',
        above: 65,
      }],
      actions: [{ type: 'device', accessory: 'bedroom_1_air_conditioner_2222', active: true }],
    });

    const trigger = storedAutomation().triggers[0];
    expect(trigger.type).toBe('numeric_state');
    expect(trigger.above).toBe(65);
    expect(trigger.accessoryId).toBe(SENSOR_ID);
    expect(trigger.characteristicType).toBe('relative_humidity');
  });

  it('rejects a numeric trigger with neither above nor below', async () => {
    await expect(handleCreateHcAutomation({
      home: 'george_street_1111',
      name: 'Bad',
      triggers: [{ type: 'numeric', accessory: 'bedroom_1_underfloor_heating_3333', characteristic: 'relative_humidity' }],
      actions: [{ type: 'device', accessory: 'bedroom_1_air_conditioner_2222', active: true }],
    })).rejects.toThrow(/above.*below/i);
  });

  it('accepts a "for" duration as bare seconds or as a unit object', async () => {
    await handleCreateHcAutomation({
      home: 'george_street_1111',
      name: 'Held humidity',
      triggers: [
        { type: 'numeric', accessory: 'bedroom_1_underfloor_heating_3333', characteristic: 'relative_humidity', above: 65, for: 600 },
        { type: 'numeric', accessory: 'bedroom_1_underfloor_heating_3333', characteristic: 'relative_humidity', below: 60, for: { minutes: 10 } },
      ],
      actions: [{ type: 'device', accessory: 'bedroom_1_air_conditioner_2222', active: true }],
    });

    const [held, released] = storedAutomation().triggers;
    expect(held.for).toEqual({ seconds: 600 });
    expect(released.for).toEqual({ minutes: 10 });
  });
});

describe('virtual accessories — the stored state HomeKit has nowhere to put', () => {
  it('creates a mode accessory with its options and defaults to the first', async () => {
    const result = await handleCreateVirtualAccessory({
      home: 'george_street_1111',
      name: 'Bedroom 1 Dry Cycle',
      type: 'mode',
      options: ['Idle', 'Running', 'Cancelled'],
    });

    const def = JSON.parse(virtualRows[0].data);
    expect(def.type).toBe('input_select');
    expect(def.options).toEqual(['Idle', 'Running', 'Cancelled']);
    expect(def.initialValue).toBe('Idle');
    expect(result.virtual_accessory.type).toBe('mode');
    expect(result.virtual_accessory.slug).toMatch(/^bedroom_1_dry_cycle_/);
  });

  it('refuses a mode accessory with no options rather than creating a useless one', async () => {
    await expect(handleCreateVirtualAccessory({
      home: 'george_street_1111', name: 'Broken', type: 'mode',
    })).rejects.toThrow(/requires "options"/);
  });

  it('requires min and max for a number', async () => {
    await expect(handleCreateVirtualAccessory({
      home: 'george_street_1111', name: 'Stashed target', type: 'number',
    })).rejects.toThrow(/requires "min" and "max"/);
  });

  it('rejects an unknown type by listing the seven that exist', async () => {
    await expect(handleCreateVirtualAccessory({
      home: 'george_street_1111', name: 'Nope', type: 'input_select',
    })).rejects.toThrow(/switch, mode, number, counter, timer, text, date|Supported/);
  });

  it('reads one in a condition through virtual(), which is what the engine understands', async () => {
    seedVirtual('Bedroom 1 Dry Cycle', 'input_select', { options: ['Idle', 'Running'] });

    await handleCreateHcAutomation({
      home: 'george_street_1111',
      name: 'Start dry cycle',
      triggers: [{ type: 'numeric', accessory: 'bedroom_1_underfloor_heating_3333', characteristic: 'relative_humidity', above: 65 }],
      conditions: [{ type: 'virtual', virtual: 'bedroom_1_dry_cycle_4444', equals: 'Idle' }],
      actions: [{ type: 'device', accessory: 'bedroom_1_air_conditioner_2222', active: true }],
    });

    const condition = storedAutomation().conditions.conditions[0];
    expect(condition.type).toBe('template');
    expect(condition.expression).toBe(`virtual('${VIRTUAL_ID}') == "Idle"`);
  });

  it('writes one in an action', async () => {
    seedVirtual('Bedroom 1 Dry Cycle', 'input_select', { options: ['Idle', 'Running'] });

    await handleCreateHcAutomation({
      home: 'george_street_1111',
      name: 'Start dry cycle',
      triggers: [{ type: 'numeric', accessory: 'bedroom_1_underfloor_heating_3333', characteristic: 'relative_humidity', above: 65 }],
      actions: [{ type: 'virtual', virtual: 'bedroom_1_dry_cycle_4444', operation: 'set', value: 'Running' }],
    });

    const action = storedAutomation().actions[0];
    expect(action).toMatchObject({ type: 'virtual', accessoryId: VIRTUAL_ID, operation: 'set', value: 'Running' });
  });

  it('names the alternative when the referenced accessory does not exist', async () => {
    await expect(handleCreateHcAutomation({
      home: 'george_street_1111',
      name: 'Start dry cycle',
      triggers: [{ type: 'time', at: '07:00' }],
      actions: [{ type: 'virtual', virtual: 'missing_0000', operation: 'set', value: 'x' }],
    })).rejects.toThrow(/create_virtual_accessory/);
  });

  it('renames one without touching its type or options', async () => {
    seedVirtual('Dry Cycle', 'input_select', { options: ['Idle', 'Running'], initialValue: 'Idle' });

    const result = await handleUpdateVirtualAccessory({
      home: 'george_street_1111', id: 'dry_cycle_4444', name: 'Bedroom 1 Dry Cycle',
    });

    const def = JSON.parse(virtualRows[0].data);
    expect(def.name).toBe('Bedroom 1 Dry Cycle');
    expect(def.type).toBe('input_select');
    expect(def.options).toEqual(['Idle', 'Running']);
    expect(result.virtual_accessory.type).toBe('mode');
  });

  it('moves the start value inside the list when options drop it', async () => {
    seedVirtual('Dry Cycle', 'input_select', { options: ['Idle', 'Running'], initialValue: 'Running' });

    await handleUpdateVirtualAccessory({
      home: 'george_street_1111', id: 'dry_cycle_4444', options: ['Off', 'On'],
    });

    const def = JSON.parse(virtualRows[0].data);
    expect(def.options).toEqual(['Off', 'On']);
    expect(def.initialValue).toBe('Off');
  });

  it('refuses options on an accessory that has none', async () => {
    seedVirtual('Tally', 'counter', {});

    await expect(handleUpdateVirtualAccessory({
      home: 'george_street_1111', id: 'tally_4444', options: ['a', 'b'],
    })).rejects.toThrow(/only applies to a "mode"/);
  });

  it('warns that automations may still reference a deleted accessory', async () => {
    seedVirtual('Bedroom 1 Dry Cycle', 'input_select', { options: ['Idle'] });
    const result = await handleDeleteVirtualAccessory({
      home: 'george_street_1111', id: 'bedroom_1_dry_cycle_4444',
    });
    expect(result.message).toMatch(/get_hc_automations/);
    expect(virtualRows).toHaveLength(0);
  });
});

describe('compilation details', () => {
  it('splits a multi-property device action into one action per characteristic', async () => {
    await handleCreateHcAutomation({
      home: 'george_street_1111',
      name: 'Cool the bedroom',
      triggers: [{ type: 'time', at: '22:00' }],
      actions: [{
        type: 'device',
        accessory: 'bedroom_1_air_conditioner_2222',
        active: true,
        hvac_mode: 'cool',
        cool_target: 18,
      }],
    });

    const actions = storedAutomation().actions;
    expect(actions).toHaveLength(3);
    expect(actions.every((a: any) => a.type === 'set_characteristic' && a.accessoryId === AIRCON_ID)).toBe(true);
    // hvac_mode is a friendly name for a numeric HomeKit value — cool = 2.
    const hvac = actions.find((a: any) => a.characteristicType === 'target_heater_cooler_state');
    expect(hvac.value).toBe(2);
  });

  it('emits no uiState, so the editor lays the graph out itself', async () => {
    await handleCreateHcAutomation({
      home: 'george_street_1111',
      name: 'Simple',
      triggers: [{ type: 'time', at: '07:00' }],
      actions: [{ type: 'device', accessory: 'bedroom_1_air_conditioner_2222', active: false }],
    });
    expect(storedAutomation().uiState).toBeUndefined();
  });

  it('nests an or block inside the default and', async () => {
    await handleCreateHcAutomation({
      home: 'george_street_1111',
      name: 'Either sensor',
      triggers: [{ type: 'time', at: '07:00' }],
      conditions: [{
        operator: 'or',
        conditions: [
          { type: 'numeric', accessory: 'bedroom_1_underfloor_heating_3333', characteristic: 'relative_humidity', above: 70 },
          { type: 'device', accessory: 'bedroom_1_air_conditioner_2222', characteristic: 'active', value: true },
        ],
      }],
    actions: [{ type: 'device', accessory: 'bedroom_1_air_conditioner_2222', active: true }],
    });

    const root = storedAutomation().conditions;
    expect(root.operator).toBe('and');
    expect(root.conditions[0].operator).toBe('or');
    expect(root.conditions[0].conditions).toHaveLength(2);
  });

  it('resolves a scene action by name', async () => {
    await handleCreateHcAutomation({
      home: 'george_street_1111',
      name: 'Night',
      triggers: [{ type: 'sun', event: 'sunset' }],
      actions: [{ type: 'scene', scene: 'Good Night' }],
    });
    expect(storedAutomation().actions[0]).toMatchObject({ type: 'execute_scene', sceneId: 'scene-1' });
  });

  it('requires at least one trigger and one action', async () => {
    await expect(handleCreateHcAutomation({
      home: 'george_street_1111', name: 'Empty', triggers: [], actions: [],
    })).rejects.toThrow(/trigger is required/);
  });
});

describe('round trip', () => {
  it('returns automations in the shape update accepts', async () => {
    await handleCreateHcAutomation({
      home: 'george_street_1111',
      name: 'Dry cycle',
      triggers: [{ type: 'numeric', accessory: 'bedroom_1_underfloor_heating_3333', characteristic: 'relative_humidity', above: 65 }],
      actions: [{ type: 'device', accessory: 'bedroom_1_air_conditioner_2222', active: true }],
    });

    const listed = await handleGetHcAutomations();
    const automation = listed['george_street_1111'][0];
    expect(automation.editable_via_mcp).toBe(true);
    expect(automation.triggers[0]).toMatchObject({
      type: 'numeric',
      accessory: 'bedroom_1_underfloor_heating_3333',
      characteristic: 'relative_humidity',
      above: 65,
    });
    expect(automation.actions[0]).toMatchObject({
      type: 'device',
      accessory: 'bedroom_1_air_conditioner_2222',
      active: true,
    });
    expect(listed._meta.engine).toBe('homecast');
  });

  it('flags an automation using editor-only nodes rather than pretending it round-trips', async () => {
    automationRows.push({
      id: 'editor-built',
      homeId: HOME_ID,
      data: JSON.stringify({
        id: 'editor-built', name: 'Built in the editor', homeId: HOME_ID, enabled: true, mode: 'single',
        triggers: [{ id: 't1', type: 'time', at: '07:00' }],
        conditions: { operator: 'and', conditions: [] },
        actions: [{ id: 'a1', type: 'code', code: 'return 1' }],
        metadata: { createdAt: '', updatedAt: '', triggerCount: 0 },
      }),
    });

    const listed = await handleGetHcAutomations();
    const automation = listed['george_street_1111'][0];
    expect(automation.editable_via_mcp).toBe(false);
    expect(automation.actions[0]._unsupported).toBe(true);
  });

  it('toggles enabled without needing the definition resent', async () => {
    await handleCreateHcAutomation({
      home: 'george_street_1111',
      name: 'Dry cycle',
      triggers: [{ type: 'time', at: '07:00' }],
      actions: [{ type: 'device', accessory: 'bedroom_1_air_conditioner_2222', active: true }],
    });
    const id = storedAutomation().id;

    await handleUpdateHcAutomation({ home: 'george_street_1111', id, enabled: false });

    const after = storedAutomation();
    expect(after.enabled).toBe(false);
    expect(after.triggers).toHaveLength(1);
    // Unlike HomeKit, editing does not recreate the automation under a new id.
    expect(after.id).toBe(id);
  });

  // Editing one part must not silently destroy the others. Compiling the whole
  // automation from the arguments made "change just the actions" arrive with no
  // triggers (an error) and dropped any conditions the caller didn't resend.
  describe('partial updates', () => {
    async function seedFullAutomation(): Promise<string> {
      seedVirtual('Bedroom 1 Dry Cycle', 'input_select', { options: ['Idle', 'Running'] });
      await handleCreateHcAutomation({
        home: 'george_street_1111',
        name: 'Dry cycle',
        triggers: [{ type: 'numeric', accessory: 'bedroom_1_underfloor_heating_3333', characteristic: 'relative_humidity', above: 65 }],
        conditions: [{ type: 'virtual', virtual: 'bedroom_1_dry_cycle_4444', equals: 'Idle' }],
        actions: [{ type: 'device', accessory: 'bedroom_1_air_conditioner_2222', active: true }],
      });
      return storedAutomation().id;
    }

    it('changes only the actions, keeping triggers and conditions', async () => {
      const id = await seedFullAutomation();

      await handleUpdateHcAutomation({
        home: 'george_street_1111',
        id,
        actions: [{ type: 'device', accessory: 'bedroom_1_air_conditioner_2222', active: true, cool_target: 20 }],
      });

      const after = storedAutomation();
      expect(after.actions).toHaveLength(2);
      expect(after.triggers[0]).toMatchObject({ type: 'numeric_state', above: 65 });
      expect(after.conditions.conditions).toHaveLength(1);
    });

    it('changes only the triggers, keeping actions and conditions', async () => {
      const id = await seedFullAutomation();

      await handleUpdateHcAutomation({
        home: 'george_street_1111',
        id,
        triggers: [{ type: 'numeric', accessory: 'bedroom_1_underfloor_heating_3333', characteristic: 'relative_humidity', above: 70 }],
      });

      const after = storedAutomation();
      expect(after.triggers[0].above).toBe(70);
      expect(after.actions).toHaveLength(1);
      expect(after.conditions.conditions).toHaveLength(1);
    });

    it('does not wipe conditions when they are simply not resent', async () => {
      const id = await seedFullAutomation();

      await handleUpdateHcAutomation({ home: 'george_street_1111', id, name: 'Dry cycle v2' });

      const after = storedAutomation();
      expect(after.name).toBe('Dry cycle v2');
      expect(after.conditions.conditions).toHaveLength(1);
    });

    it('clears conditions only when an empty list is sent explicitly', async () => {
      const id = await seedFullAutomation();

      await handleUpdateHcAutomation({ home: 'george_street_1111', id, conditions: [] });

      expect(storedAutomation().conditions.conditions).toHaveLength(0);
    });

    it('still refuses an explicitly empty trigger list', async () => {
      const id = await seedFullAutomation();

      await expect(handleUpdateHcAutomation({
        home: 'george_street_1111', id, triggers: [],
      })).rejects.toThrow(/trigger is required/);
    });
  });

  it('deletes by id and reports the name', async () => {
    await handleCreateHcAutomation({
      home: 'george_street_1111',
      name: 'Dry cycle',
      triggers: [{ type: 'time', at: '07:00' }],
      actions: [{ type: 'device', accessory: 'bedroom_1_air_conditioner_2222', active: true }],
    });
    const id = storedAutomation().id;

    const result = await handleDeleteHcAutomation({ home: 'george_street_1111', id });
    expect(result.message).toContain('Dry cycle');
    expect(automationRows).toHaveLength(0);
  });

  it('refuses an unknown id instead of silently creating one', async () => {
    await expect(handleDeleteHcAutomation({ home: 'george_street_1111', id: 'nope' }))
      .rejects.toThrow(/not found/);
  });
});
