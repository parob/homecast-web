/**
 * Community mode: MCP (Model Context Protocol) endpoint.
 * Exposes HomeKit capabilities as tools for AI assistants.
 * Uses JSON-RPC over HTTP (Streamable HTTP transport).
 */

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
    name: 'list_homes',
    description: 'List all HomeKit homes',
    inputSchema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'list_rooms',
    description: 'List rooms in a home',
    inputSchema: {
      type: 'object',
      properties: { home_id: { type: 'string', description: 'Home ID' } },
      required: ['home_id'],
    },
  },
  {
    name: 'list_accessories',
    description: 'List accessories, optionally filtered by home or room',
    inputSchema: {
      type: 'object',
      properties: {
        home_id: { type: 'string', description: 'Filter by home ID' },
        room_id: { type: 'string', description: 'Filter by room ID' },
      },
    },
  },
  {
    name: 'get_accessory',
    description: 'Get detailed info about a single accessory',
    inputSchema: {
      type: 'object',
      properties: { accessory_id: { type: 'string', description: 'Accessory ID' } },
      required: ['accessory_id'],
    },
  },
  {
    name: 'set_characteristic',
    description: 'Set a characteristic value on an accessory (e.g., turn on a light)',
    inputSchema: {
      type: 'object',
      properties: {
        accessory_id: { type: 'string', description: 'Accessory ID' },
        characteristic_type: { type: 'string', description: 'Characteristic type (e.g., power_state, brightness)' },
        value: { description: 'Value to set' },
      },
      required: ['accessory_id', 'characteristic_type', 'value'],
    },
  },
  {
    name: 'set_state',
    description: 'Set multiple accessories at once. State is a dict of accessory_id -> service_type -> characteristic_type -> value',
    inputSchema: {
      type: 'object',
      properties: {
        state: { type: 'object', description: 'Nested dict: {accessory_id: {service_type: {characteristic_type: value}}}' },
        home_id: { type: 'string', description: 'Home ID (optional)' },
      },
      required: ['state'],
    },
  },
  {
    name: 'list_scenes',
    description: 'List scenes in a home',
    inputSchema: {
      type: 'object',
      properties: { home_id: { type: 'string', description: 'Home ID' } },
      required: ['home_id'],
    },
  },
  {
    name: 'execute_scene',
    description: 'Execute a HomeKit scene',
    inputSchema: {
      type: 'object',
      properties: { scene_id: { type: 'string', description: 'Scene ID' } },
      required: ['scene_id'],
    },
  },
  {
    name: 'list_service_groups',
    description: 'List service groups in a home',
    inputSchema: {
      type: 'object',
      properties: { home_id: { type: 'string', description: 'Home ID' } },
      required: ['home_id'],
    },
  },
];

async function callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
  switch (name) {
    case 'list_homes': {
      const result = await executeHomeKitAction('homes.list') as any;
      return result?.homes || [];
    }
    case 'list_rooms': {
      const result = await executeHomeKitAction('rooms.list', { homeId: args.home_id }) as any;
      return result?.rooms || [];
    }
    case 'list_accessories': {
      const payload: Record<string, unknown> = { includeValues: true, includeAll: true };
      if (args.home_id) payload.homeId = args.home_id;
      if (args.room_id) payload.roomId = args.room_id;
      const result = await executeHomeKitAction('accessories.list', payload) as any;
      return result?.accessories || [];
    }
    case 'get_accessory': {
      const result = await executeHomeKitAction('accessory.get', { accessoryId: args.accessory_id }) as any;
      return result?.accessory || null;
    }
    case 'set_characteristic': {
      await executeHomeKitAction('characteristic.set', {
        accessoryId: args.accessory_id,
        characteristicType: args.characteristic_type,
        value: args.value,
      });
      return { success: true };
    }
    case 'set_state': {
      await executeHomeKitAction('state.set', { state: args.state, homeId: args.home_id });
      return { success: true };
    }
    case 'list_scenes': {
      const result = await executeHomeKitAction('scenes.list', { homeId: args.home_id }) as any;
      return result?.scenes || [];
    }
    case 'execute_scene': {
      await executeHomeKitAction('scene.execute', { sceneId: args.scene_id });
      return { success: true };
    }
    case 'list_service_groups': {
      const result = await executeHomeKitAction('serviceGroups.list', { homeId: args.home_id }) as any;
      return result?.serviceGroups || [];
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
        // Client acknowledges initialization — no response needed
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
