/**
 * Community mode: MCP (Model Context Protocol) endpoint.
 * Exposes HomeKit capabilities as tools for AI assistants.
 * Uses JSON-RPC over HTTP (Streamable HTTP transport).
 *
 * Tools match the Cloud edition's HomesAPI (3-tool design):
 *   - get_state: Read state across all homes
 *   - set_state: Set accessory state with flat update list
 *   - run_scene: Execute a scene by home + name
 */

import { handleGetState, handleSetState } from './local-rest';
import { executeHomeKitAction } from '../relay/local-handler';

interface JsonRpcRequest {
  jsonrpc: '2.0';
  id?: string | number;
  method: string;
  params?: Record<string, unknown>;
}

interface JsonRpcResponse {
  jsonrpc: '2.0';
  id?: string | number | null;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

const SERVER_INFO = {
  name: 'homecast-community',
  version: '1.0.0',
};

const TOOLS = [
  {
    name: 'get_state',
    description:
      'Get state across all homes. Returns nested dict: {home_key: {room_key: {accessory_key: {type, on, brightness, ...}}}}. ' +
      'Settable properties listed in _settable array. Scene names in _scenes per home.',
    inputSchema: {
      type: 'object',
      properties: {
        filter_by_home: { type: 'string', description: 'Filter by home name substring' },
        filter_by_room: { type: 'string', description: 'Filter by room name substring' },
        filter_by_type: { type: 'string', description: 'Filter by device type (light, switch, climate, lock, alarm, fan, blind, etc.)' },
        filter_by_name: { type: 'string', description: 'Filter by accessory name substring' },
      },
    },
    annotations: { readOnlyHint: true, openWorldHint: true, destructiveHint: false },
  },
  {
    name: 'set_state',
    description:
      'Set accessory state using a flat list of updates. Each update has home/room/accessory path and settings. ' +
      'Settable properties by type: light (on, brightness, hue, saturation, color_temp), ' +
      'climate (active, heat_target, cool_target, hvac_mode), switch/outlet (on), ' +
      'lock (lock_target), alarm (alarm_target), fan (on, speed), speaker (volume, mute), ' +
      'blind (target), valve (active). Returns {updated, failed, changes, errors, message}.',
    inputSchema: {
      type: 'object',
      properties: {
        updates: {
          type: 'array',
          description: 'List of updates, each with home/room/accessory path and settings to change',
          items: {
            type: 'object',
            properties: {
              home: { type: 'string', description: 'Home slug key (e.g., "my_house_0bf8")' },
              room: { type: 'string', description: 'Room slug key (e.g., "living_a1b2")' },
              accessory: { type: 'string', description: 'Accessory slug key (e.g., "ceiling_light_c3d4")' },
              on: { type: 'boolean' },
              brightness: { type: 'integer', description: '0-100' },
              hue: { type: 'integer', description: '0-360' },
              saturation: { type: 'integer', description: '0-100' },
              color_temp: { type: 'integer', description: '140-500 mirek' },
              active: { type: 'boolean' },
              heat_target: { type: 'number' },
              cool_target: { type: 'number' },
              hvac_mode: { type: 'string', description: 'auto/heat/cool' },
              lock_target: { type: 'boolean' },
              alarm_target: { type: 'string', description: 'home/away/night/off' },
              speed: { type: 'integer', description: '0-100' },
              volume: { type: 'integer', description: '0-100' },
              mute: { type: 'boolean' },
              target: { type: 'integer', description: '0-100 (blinds)' },
            },
            required: ['home', 'room', 'accessory'],
          },
        },
      },
      required: ['updates'],
    },
    annotations: { readOnlyHint: false, openWorldHint: true, destructiveHint: false },
  },
  {
    name: 'run_scene',
    description: 'Execute a scene by name in a specific home. Use get_state to see available scenes in _scenes.',
    inputSchema: {
      type: 'object',
      properties: {
        home: { type: 'string', description: 'Home slug key (e.g., "my_house_0bf8")' },
        name: { type: 'string', description: 'Scene name (e.g., "Good Morning")' },
      },
      required: ['home', 'name'],
    },
    annotations: { readOnlyHint: false, openWorldHint: true, destructiveHint: false },
  },
];

// Import uniqueKey for home key resolution
function uniqueKey(name: string, uuid: string): string {
  const sanitized = name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
  return `${sanitized}_${uuid.slice(-4).toLowerCase()}`;
}

async function callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
  switch (name) {
    case 'get_state': {
      return await handleGetState({
        home: args.filter_by_home as string | undefined,
        room: args.filter_by_room as string | undefined,
        type: args.filter_by_type as string | undefined,
        name: args.filter_by_name as string | undefined,
      });
    }

    case 'set_state': {
      const updates = args.updates as Array<Record<string, unknown>>;
      if (!updates || !Array.isArray(updates)) {
        throw new Error('updates must be an array');
      }
      return await handleSetState(updates);
    }

    case 'run_scene': {
      const homeSlug = args.home as string;
      const sceneName = args.name as string;
      if (!homeSlug || !sceneName) {
        throw new Error("Both 'home' and 'name' are required");
      }

      // Resolve home slug key to HomeKit UUID
      const homesResult = await executeHomeKitAction('homes.list') as any;
      const homes = homesResult?.homes || [];
      const homeEntry = homes.find((h: any) => uniqueKey(h.name, h.id) === homeSlug);
      if (!homeEntry) {
        throw new Error(`Home not found: ${homeSlug}`);
      }

      // Find scene by name in that home
      const scenesResult = await executeHomeKitAction('scenes.list', { homeId: homeEntry.id }) as any;
      const scenes = scenesResult?.scenes || [];
      const scene = scenes.find((s: any) =>
        s.name?.toLowerCase() === sceneName.toLowerCase()
      );
      if (!scene) {
        throw new Error(`Scene not found: "${sceneName}" in ${homeSlug}`);
      }

      await executeHomeKitAction('scene.execute', { sceneId: scene.id });
      return { success: true, scene: scene.name, home: homeSlug };
    }

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

function handleJsonRpc(request: JsonRpcRequest): Promise<JsonRpcResponse> {
  return (async () => {
    switch (request.method) {
      case 'initialize':
        return {
          jsonrpc: '2.0' as const,
          id: request.id ?? null,
          result: {
            protocolVersion: '2024-11-05',
            serverInfo: SERVER_INFO,
            capabilities: { tools: {} },
          },
        };

      case 'notifications/initialized':
        return { jsonrpc: '2.0' as const, id: request.id ?? null, result: {} };

      case 'tools/list':
        return {
          jsonrpc: '2.0' as const,
          id: request.id ?? null,
          result: { tools: TOOLS },
        };

      case 'tools/call': {
        const toolName = (request.params as any)?.name as string;
        const toolArgs = (request.params as any)?.arguments || {};
        try {
          const result = await callTool(toolName, toolArgs);
          return {
            jsonrpc: '2.0' as const,
            id: request.id ?? null,
            result: {
              content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
            },
          };
        } catch (e: any) {
          return {
            jsonrpc: '2.0' as const,
            id: request.id ?? null,
            result: {
              content: [{ type: 'text', text: `Error: ${e.message}` }],
              isError: true,
            },
          };
        }
      }

      case 'ping':
        return { jsonrpc: '2.0' as const, id: request.id ?? null, result: {} };

      default:
        return {
          jsonrpc: '2.0' as const,
          id: request.id ?? null,
          error: { code: -32601, message: `Method not found: ${request.method}` },
        };
    }
  })();
}

export async function handleMCP(body: string): Promise<string> {
  try {
    const request = JSON.parse(body) as JsonRpcRequest;
    const response = await handleJsonRpc(request);
    return JSON.stringify(response);
  } catch (e: any) {
    return JSON.stringify({
      jsonrpc: '2.0',
      id: null,
      error: { code: -32700, message: 'Parse error: ' + e.message },
    });
  }
}
