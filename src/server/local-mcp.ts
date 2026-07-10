/**
 * Community mode: MCP (Model Context Protocol) endpoint.
 * Exposes HomeKit capabilities as tools for AI assistants.
 * Uses JSON-RPC over HTTP (Streamable HTTP transport).
 *
 * Tools match the Cloud edition's HomesAPI:
 *   - get_state: Read state across all homes
 *   - set_state: Set accessory state with flat update list
 *   - run_scene: Execute a scene by home + name
 *   - get_automations: List HomeKit automations
 *   - create_automation / update_automation / delete_automation: Manage HomeKit automations
 */

import { handleGetState, handleSetState } from './local-rest';
import {
  handleGetAutomations,
  handleCreateAutomation,
  handleUpdateAutomation,
  handleDeleteAutomation,
} from './local-automations';
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
  {
    name: 'get_automations',
    description:
      'List HomeKit automations for every home (or filter by home). Returns {home_key: [automation]}; ' +
      'each automation has id, name, enabled, editable, trigger, actions, last_fired. ' +
      'trigger and actions use the same format accepted by create_automation/update_automation, ' +
      'so they can be edited and sent back directly. Automations with editable=false ' +
      '(presence, location, or app-specific triggers) can only be renamed, enabled/disabled, or deleted.',
    inputSchema: {
      type: 'object',
      properties: {
        filter_by_home: { type: 'string', description: 'Filter by home name substring' },
      },
    },
    annotations: { readOnlyHint: true, openWorldHint: true, destructiveHint: false },
  },
  {
    name: 'create_automation',
    description:
      'Create a HomeKit automation. trigger is either a TIMER: {"type":"timer","fireDate":"ISO8601"} or ' +
      '{"type":"timer","hour":H,"minute":M,"recurrenceType":"once"|"daily"|"weekly","timeZone":"IANA id (optional)"} — ' +
      'or an EVENT trigger: {"type":"event","events":[...],"endEvents":[...] (optional),"conditions":[...] (optional),' +
      '"recurrences":[{"weekday":1-7},...] (optional, 1=Sunday),"executeOnce":bool (optional)}. ' +
      'Event objects: {"type":"characteristic","accessory":"<slug>","characteristic":"<property>","value":<v>} ' +
      '(fires when property becomes value, e.g. motion=true, on=true) | ' +
      '{"type":"significantTime","significantEvent":"sunrise"|"sunset","offsetMinutes":<±min, optional>} | ' +
      '{"type":"calendar","calendarComponents":{"hour":H,"minute":M,"weekday":1-7 (optional),"day","month" (optional)}} | ' +
      '{"type":"duration","durationSeconds":n}. ' +
      'Conditions (all must be true, equality only): {"type":"characteristic","accessory":"<slug>",' +
      '"characteristic":"<property>","value":<v>}. ' +
      'actions is a list of {"accessory":"<slug>","room":"<slug>" (optional), plus settable properties as in set_state: ' +
      'on, brightness, hue, saturation, color_temp, active, heat_target, cool_target, hvac_mode, lock_target, ' +
      'alarm_target, speed, volume, mute, target}. Get home/accessory slugs and properties from get_state.',
    inputSchema: {
      type: 'object',
      properties: {
        home: { type: 'string', description: 'Home slug key (e.g., "my_house_0bf8")' },
        name: { type: 'string', description: 'Automation name' },
        trigger: { type: 'object', description: 'Trigger definition (timer or event, see tool description)' },
        actions: {
          type: 'array',
          description: 'Accessory state changes to apply when triggered',
          items: {
            type: 'object',
            properties: {
              accessory: { type: 'string', description: 'Accessory slug key (e.g., "ceiling_light_c3d4")' },
              room: { type: 'string', description: 'Room slug key (optional, informational)' },
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
            required: ['accessory'],
          },
        },
      },
      required: ['home', 'name', 'trigger', 'actions'],
    },
    annotations: { readOnlyHint: false, openWorldHint: true, destructiveHint: false },
  },
  {
    name: 'update_automation',
    description:
      'Update a HomeKit automation. Provide home and id (from get_automations) plus any of: name, trigger, actions, enabled. ' +
      'Set enabled to enable/disable. NOTE: changing trigger (and on some automations, actions) recreates the automation ' +
      'in HomeKit — the result may have a NEW id; always use the returned id afterwards. ' +
      'trigger/actions use the same format as create_automation.',
    inputSchema: {
      type: 'object',
      properties: {
        home: { type: 'string', description: 'Home slug key (e.g., "my_house_0bf8")' },
        id: { type: 'string', description: 'Automation id from get_automations' },
        name: { type: 'string', description: 'New automation name' },
        trigger: { type: 'object', description: 'New trigger definition (same format as create_automation)' },
        actions: {
          type: 'array',
          description: 'New accessory state changes (replaces all existing actions)',
          items: { type: 'object' },
        },
        enabled: { type: 'boolean', description: 'Enable or disable the automation' },
      },
      required: ['home', 'id'],
    },
    annotations: { readOnlyHint: false, openWorldHint: true, destructiveHint: false },
  },
  {
    name: 'delete_automation',
    description: 'Permanently delete a HomeKit automation. Get id from get_automations. This cannot be undone.',
    inputSchema: {
      type: 'object',
      properties: {
        home: { type: 'string', description: 'Home slug key (e.g., "my_house_0bf8")' },
        id: { type: 'string', description: 'Automation id from get_automations' },
      },
      required: ['home', 'id'],
    },
    annotations: { readOnlyHint: false, openWorldHint: true, destructiveHint: true },
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

    case 'get_automations': {
      return await handleGetAutomations(args.filter_by_home as string | undefined);
    }

    case 'create_automation': {
      const { home, name: automationName, trigger, actions } = args as {
        home?: string; name?: string; trigger?: Record<string, unknown>; actions?: Array<Record<string, unknown>>;
      };
      if (!home || !automationName || !trigger || !actions) {
        throw new Error("'home', 'name', 'trigger' and 'actions' are required");
      }
      return await handleCreateAutomation({ home, name: automationName, trigger, actions });
    }

    case 'update_automation': {
      const { home, id } = args as { home?: string; id?: string };
      if (!home || !id) {
        throw new Error("'home' and 'id' are required");
      }
      return await handleUpdateAutomation({
        home,
        id,
        name: args.name as string | undefined,
        trigger: args.trigger as Record<string, unknown> | undefined,
        actions: args.actions as Array<Record<string, unknown>> | undefined,
        enabled: args.enabled as boolean | undefined,
      });
    }

    case 'delete_automation': {
      const { home, id } = args as { home?: string; id?: string };
      if (!home || !id) {
        throw new Error("'home' and 'id' are required");
      }
      return await handleDeleteAutomation({ home, id });
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
