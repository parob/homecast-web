/**
 * What an AI connector sees and can ask for, on the Community edition.
 * Mirrors homecast-cloud's test_homes_room_filter.py, test_mcp_alignment.py
 * and test_mcp_room_context.py — every MCP tool exists twice, and a grammar
 * one edition accepts and the other rejects is a user-visible split.
 */

import { vi, describe, it, expect, beforeEach } from 'vitest';

vi.mock('../../lib/config', () => ({ isCommunity: true }));
vi.mock('../connection', () => ({ communityRequest: vi.fn(), serverConnection: { emitBroadcast: vi.fn() } }));
vi.mock('../local-auth', () => ({
  verifyToken: vi.fn().mockResolvedValue(null),
  verifyTokenFull: vi.fn().mockResolvedValue(null),
}));

function light(id: string, name: string, roomName: string, roomId: string) {
  return {
    id, name, roomName, roomId,
    services: [{
      serviceType: 'lightbulb',
      characteristics: [{ characteristicType: 'power_state', value: true, isWritable: true }],
    }],
  };
}

vi.mock('@/relay/local-handler', () => ({
  executeHomeKitAction: vi.fn(async (action: string) => {
    if (action === 'homes.list') return { homes: [{ id: 'HOME-0001', name: 'Clitheroe Road' }] };
    if (action === 'rooms.list') {
      return { rooms: [
        { id: 'ROOM-0BF8', name: 'Living Room' },
        { id: 'ROOM-92F6', name: 'Bathroom 1' },
        { id: 'ROOM-11AA', name: 'Bedroom 2' },
      ] };
    }
    if (action === 'accessories.list') {
      return { accessories: [
        light('ACC-1', 'Mirror Light', 'Bathroom 1', 'ROOM-92F6'),
        light('ACC-2', 'Ceiling', 'Living Room', 'ROOM-0BF8'),
        light('ACC-3', 'Lamp', 'Bedroom 2', 'ROOM-11AA'),
        light('ACC-4', 'Lamp', 'Bedroom 2', 'ROOM-11AA'),
      ] };
    }
    if (action === 'serviceGroups.list') {
      return { serviceGroups: [{ id: 'GRP-77CC', name: 'Bedroom Lamps', accessoryIds: ['ACC-3', 'ACC-4'] }] };
    }
    if (action === 'scenes.list') return { scenes: [] };
    return {};
  }),
  ErrorCode: {},
}));

import { handleGetState } from '../local-rest';
import { handleMCP, resetHomeContextCache } from '../local-mcp';

const HOME_KEY = 'clitheroe_road_0001';
const rooms = (result: Record<string, any>) =>
  Object.keys(result[HOME_KEY] ?? {}).filter(k => !k.startsWith('_'));

describe('filter_by_room answers to the room name, not only its slug', () => {
  for (const spoken of ['Bathroom 1', 'bathroom 1', 'bathroom_1', 'BATHROOM', 'bathroom_1_92f6']) {
    it(`"${spoken}"`, async () => {
      const result = await handleGetState({ room: spoken });
      expect(rooms(result)).toEqual(['bathroom_1_92f6']);
    });
  }

  it('a multi-word room name', async () => {
    expect(rooms(await handleGetState({ room: 'Living Room' }))).toEqual(['living_room_0bf8']);
  });

  it('applies to service groups too', async () => {
    const result = await handleGetState({ room: 'Bedroom 2' });
    expect(Object.keys(result[HOME_KEY].bedroom_2_11aa)).toContain('bedroom_lamps_77cc');
  });

  it('name filter accepts spaces for accessories and groups', async () => {
    expect(rooms(await handleGetState({ name: 'Mirror Light' }))).toEqual(['bathroom_1_92f6']);
    const grouped = await handleGetState({ name: 'Bedroom Lamps' });
    expect(Object.keys(grouped[HOME_KEY].bedroom_2_11aa)).toEqual(['bedroom_lamps_77cc']);
  });

  it('an unmatched room still says so', async () => {
    const result = await handleGetState({ room: 'Garage' });
    expect(rooms(result)).toEqual([]);
    expect(result._meta.message).toBe('No accessories match filters');
  });
});

describe('tools/list', () => {
  beforeEach(() => resetHomeContextCache());

  async function listTools() {
    const response = JSON.parse(await handleMCP(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' })));
    return response.result.tools as Array<{ name: string; description: string; annotations?: Record<string, boolean> }>;
  }

  it('annotates every tool, and only the reads are read-only (matches cloud TOOL_ANNOTATIONS)', async () => {
    const readOnly = new Set(['get_state', 'get_history', 'query_history', 'get_automations', 'get_hc_automations']);
    for (const tool of await listTools()) {
      expect(tool.annotations, tool.name).toBeDefined();
      expect(tool.annotations!.readOnlyHint, tool.name).toBe(readOnly.has(tool.name));
      expect(tool.annotations!.destructiveHint, tool.name).toBe(tool.name.startsWith('delete_'));
    }
  });

  it('lists room display names in the home context', async () => {
    const getState = (await listTools()).find(t => t.name === 'get_state')!;
    expect(getState.description).toContain(
      `This account's homes: ${HOME_KEY} (rooms: Bathroom 1, Bedroom 2, Living Room)`,
    );
  });
});
