/**
 * Community mode: MCP (Model Context Protocol) endpoint.
 * Exposes HomeKit capabilities as tools for AI assistants.
 * Uses JSON-RPC over HTTP (Streamable HTTP transport).
 *
 * Tools match the Cloud edition's HomesAPI:
 *   - get_state: Read state across all homes
 *   - set_state: Set accessory state with flat update list
 *   - run_scene: Execute a scene by home + name
 *   - create_scene / update_scene / delete_scene: Manage scenes
 *   - get_automations: List HomeKit automations
 *   - create_automation / update_automation / delete_automation: Manage HomeKit automations
 */

import { handleGetState, handleSetState } from './local-rest';
import {
  handleGetAutomations,
  handleCreateAutomation,
  handleUpdateAutomation,
  handleDeleteAutomation,
  resolveHome,
  buildAccessoryIndex,
  buildActionsPayload,
  validateAutomationName,
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
    name: 'create_scene',
    description:
      'Create a scene: a named snapshot of device states that can be run on demand (run_scene). ' +
      'actions is a list of {"accessory":"<slug>","room":"<slug>" (optional), plus settable properties as in set_state: ' +
      'on, brightness, hue, saturation, color_temp, active, heat_target, cool_target, hvac_mode, lock_target, ' +
      'alarm_target, speed, volume, mute, target}. ' +
      'Scene names must end with a letter or number (HomeKit rejects trailing punctuation). ' +
      'Get home/accessory slugs and properties from get_state. ' +
      'Requires a relay app version with scene management support; older relays return an unsupported-method error.',
    inputSchema: {
      type: 'object',
      properties: {
        home: { type: 'string', description: 'Home slug key (e.g., "my_house_0bf8")' },
        name: { type: 'string', description: 'Scene name' },
        actions: {
          type: 'array',
          description: 'Accessory state changes the scene applies when run',
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
      required: ['home', 'name', 'actions'],
    },
    annotations: { readOnlyHint: false, openWorldHint: true, destructiveHint: false },
  },
  {
    name: 'update_scene',
    description:
      'Update a scene identified by name: rename it (new_name) and/or REPLACE all of its actions ' +
      '(same format as create_scene). Built-in scenes and scenes that belong to an automation cannot be modified. ' +
      'Requires a relay app version with scene management support.',
    inputSchema: {
      type: 'object',
      properties: {
        home: { type: 'string', description: 'Home slug key (e.g., "my_house_0bf8")' },
        name: { type: 'string', description: 'Current scene name (e.g., "Movie Night")' },
        new_name: { type: 'string', description: 'New scene name' },
        actions: {
          type: 'array',
          description: 'New accessory state changes (replaces all existing actions; same format as create_scene)',
          items: { type: 'object' },
        },
      },
      required: ['home', 'name'],
    },
    annotations: { readOnlyHint: false, openWorldHint: true, destructiveHint: false },
  },
  {
    name: 'delete_scene',
    description:
      'Permanently delete a scene by name in a specific home. This cannot be undone. ' +
      'Built-in scenes and scenes that belong to an automation cannot be deleted this way ' +
      '(delete the automation instead — the error will say which one). ' +
      'Use get_state to see available scenes in _scenes. ' +
      'Requires a relay app version with scene deletion support; older relays return an unsupported-method error.',
    inputSchema: {
      type: 'object',
      properties: {
        home: { type: 'string', description: 'Home slug key (e.g., "my_house_0bf8")' },
        name: { type: 'string', description: 'Scene name (e.g., "Movie Night")' },
      },
      required: ['home', 'name'],
    },
    annotations: { readOnlyHint: false, openWorldHint: true, destructiveHint: true },
  },
  {
    name: 'get_automations',
    description:
      'List HomeKit automations in every home (or filter by home). Returns {home_key: [automation], _meta}. ' +
      'Each automation has id, name, enabled, editable, trigger, actions, and last_fired. ' +
      'trigger and actions are returned in exactly the format create_automation/update_automation accept, ' +
      'so you can copy one, edit it, and send it back. ' +
      'editable=false means the trigger was created outside Homecast (presence, location, or app-specific) ' +
      'and cannot be recreated: the automation can still be renamed, enabled/disabled (update_automation) or deleted, ' +
      'but its trigger/actions cannot be changed. ' +
      'trigger.activation_issue (e.g. "disabledNoHomeHub") means HomeKit has deactivated it — usually a home hub is required. ' +
      "Homes where the relay's Apple ID is view-only in Apple Home are listed in _meta.view_only_homes " +
      '(their automations are read-only from Homecast).',
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
      'Create a HomeKit automation: WHEN the trigger fires (and all conditions pass), the actions set device properties. ' +
      'Call get_state first to learn home/accessory slug keys and property names — automations use the same vocabulary. ' +
      'TRIGGER is exactly one of two forms. ' +
      '(1) TIMER — fires at a time: {"type":"timer","hour":7,"minute":30,"recurrenceType":"daily"|"weekly"|"once",' +
      '"timeZone":"Europe/London" (optional, defaults to home timezone)} or {"type":"timer","fireDate":"<ISO8601>"} for one-off. ' +
      '(2) EVENT: {"type":"event","events":[<event>,...],"conditions":[<condition>,...] (optional),' +
      '"endEvents":[<event>,...] (optional, deactivates it),"recurrences":[{"weekday":1},...] ' +
      '(optional, limits which days it may fire; weekday 1=Sunday...7=Saturday),"executeOnce":true|false (optional)}. ' +
      'The ONLY creatable event types: ' +
      '{"type":"characteristic","accessory":"<slug>","characteristic":"<property>","value":<v>} — fires when a device ' +
      'property becomes that value (e.g. characteristic "motion" value true; "contact" value 1; "on" value true) | ' +
      '{"type":"significantTime","significantEvent":"sunrise"|"sunset","offsetMinutes":-30 (optional, negative=before)} | ' +
      '{"type":"calendar","calendarComponents":{"hour":22,"minute":0,"weekday":6 (optional),"day","month" (optional)}} — time-of-day | ' +
      '{"type":"duration","durationSeconds":3600} — repeating interval. ' +
      'Presence and location (arrive/leave home) triggers CANNOT be created — Apple restricts them to the Home app; ' +
      'tell the user to create those in Apple Home. ' +
      'CONDITIONS must ALL be true for actions to run and support equality only ' +
      '(e.g. only while alarm_state is "away"): {"type":"characteristic","accessory":"<slug>","characteristic":"<property>","value":<v>}. ' +
      'No greater/less-than or time-window conditions. ' +
      'ACTIONS is a list of device property changes using the set_state vocabulary: {"accessory":"<slug>","room":"<slug>" (optional), ' +
      'plus any of on, brightness, hue, saturation, color_temp, active, heat_target, cool_target, hvac_mode ("auto"/"heat"/"cool"), ' +
      'lock_target, alarm_target ("home"/"away"/"night"/"off"), speed, volume, mute, target}. ' +
      'Actions can only set device properties — running a scene from an automation is not supported ' +
      '(set the same properties the scene would). ' +
      'NAME rule: automation names must end with a letter or number — HomeKit rejects trailing punctuation ' +
      '(e.g. "Lights (evening)" fails; use "Lights evening" or "Evening lights"). ' +
      'Returns {home, automation, message}; automation.id identifies it for update_automation/delete_automation. ' +
      'Requires the Homecast relay\'s Apple ID to have edit access in Apple Home ' +
      '("Add & Edit Accessories" / "Allow Editing"); if it doesn\'t, the error will say so. ' +
      'If a timer\'s hour/minute has already passed today, older relays may reject with ' +
      '"Fire date is in the past" — retry with fireDate set to tomorrow.',
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
      'enabled=true/false enables or disables it (the usual way to turn automations on/off). ' +
      'trigger and actions use exactly the create_automation format; supplying actions REPLACES all existing actions. ' +
      'Names must end with a letter or number (HomeKit rejects trailing punctuation). ' +
      'IMPORTANT: changing trigger deletes and recreates the automation inside HomeKit, so the result may have a NEW id — ' +
      'always use the id from the response afterwards. ' +
      'Automations with editable=false (presence/location/app-specific triggers) accept only name and enabled changes. ' +
      'Requires the Homecast relay\'s Apple ID to have edit access in Apple Home ' +
      '("Add & Edit Accessories" / "Allow Editing"); if it doesn\'t, the error will say so.',
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
    description:
      'Permanently delete a HomeKit automation (get id from get_automations). This cannot be undone — ' +
      'the automation is removed from HomeKit and Apple Home immediately. ' +
      'To temporarily stop an automation, use update_automation with enabled=false instead.',
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

// --- Personalized tool descriptions ---
// tools/list appends the account's actual home keys and room names to the
// get_state/get_automations descriptions so the model knows valid filter
// values without a discovery call. Cached briefly — homes/rooms rarely change.

const HOME_CONTEXT_TTL_MS = 60_000;
const HOME_CONTEXT_MAX_HOMES = 10;
const HOME_CONTEXT_MAX_ROOMS = 15;
const PERSONALIZED_TOOLS = new Set(['get_state', 'get_automations']);

let homeContextCache: { expires: number; block: string } | null = null;

export function resetHomeContextCache(): void {
  homeContextCache = null;
}

async function getHomeContextBlock(): Promise<string> {
  if (homeContextCache && homeContextCache.expires > Date.now()) {
    return homeContextCache.block;
  }
  let block = '';
  try {
    const homesResult = await executeHomeKitAction('homes.list') as any;
    const allHomes = homesResult?.homes || [];
    const homes = allHomes.slice(0, HOME_CONTEXT_MAX_HOMES);
    if (homes.length > 0) {
      const parts: string[] = [];
      for (const home of homes) {
        const slug = uniqueKey(home.name, home.id);
        let rooms: string[] = [];
        try {
          const roomsResult = await executeHomeKitAction('rooms.list', { homeId: home.id }) as any;
          rooms = (roomsResult?.rooms || [])
            .map((r: any) => (r.name || '').toLowerCase())
            .filter(Boolean);
        } catch {
          // Rooms unavailable — list the home without them
        }
        const shown = rooms.slice(0, HOME_CONTEXT_MAX_ROOMS);
        const more = rooms.length - shown.length;
        const annotations: string[] = [];
        if (shown.length > 0) {
          annotations.push(`rooms: ${shown.join(', ')}${more > 0 ? `, +${more} more` : ''}`);
        }
        // Relay's Apple ID is view-only in Apple Home (undefined = unknown/older relay)
        if (home.isAdmin === false) {
          annotations.push('HomeKit automations read-only');
        }
        parts.push(annotations.length > 0 ? `${slug} (${annotations.join('; ')})` : slug);
      }
      const extraHomes = allHomes.length - homes.length;
      block =
        `\n\nThis account's homes: ${parts.join('; ')}` +
        (extraHomes > 0 ? `; +${extraHomes} more homes` : '') +
        `. Use the exact home key for home/filter_by_home parameters; room names work as filter_by_room values.`;
    }
  } catch {
    block = '';
  }
  homeContextCache = { expires: Date.now() + HOME_CONTEXT_TTL_MS, block };
  return block;
}

async function listToolsPersonalized(): Promise<typeof TOOLS> {
  const block = await getHomeContextBlock();
  if (!block) return TOOLS;
  return TOOLS.map((tool) =>
    PERSONALIZED_TOOLS.has(tool.name) ? { ...tool, description: tool.description + block } : tool
  );
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

    case 'create_scene': {
      const homeSlug = args.home as string;
      const sceneName = args.name as string;
      const actions = args.actions as Array<Record<string, unknown>>;
      if (!homeSlug || !sceneName || !actions) {
        throw new Error("'home', 'name' and 'actions' are required");
      }

      const { homeId } = await resolveHome(homeSlug);
      const name = validateAutomationName(sceneName);
      const index = await buildAccessoryIndex(homeId);
      const actionsPayload = buildActionsPayload(actions, index);

      await executeHomeKitAction('scene.create', { homeId, name, actions: actionsPayload });
      return { success: true, scene: name, home: homeSlug, message: 'Scene created' };
    }

    case 'update_scene': {
      const homeSlug = args.home as string;
      const sceneName = args.name as string;
      if (!homeSlug || !sceneName) {
        throw new Error("Both 'home' and 'name' are required");
      }

      const { homeId } = await resolveHome(homeSlug);
      const scenesResult = await executeHomeKitAction('scenes.list', { homeId }) as any;
      const scenes = scenesResult?.scenes || [];
      const scene = scenes.find((s: any) =>
        s.name?.toLowerCase() === sceneName.toLowerCase()
      );
      if (!scene) {
        const available = scenes.map((s: any) => s.name);
        throw new Error(`Scene not found: "${sceneName}" in ${homeSlug}. Available: [${available.join(', ')}]`);
      }
      if (scene.automationName) {
        throw new Error(
          `Scene "${scene.name}" is used by automation "${scene.automationName}" — ` +
          'it cannot be modified; delete or edit the automation instead (update_automation).'
        );
      }

      const payload: Record<string, unknown> = { sceneId: scene.id };
      if (args.new_name !== undefined) {
        payload.name = validateAutomationName(args.new_name as string);
      }
      if (args.actions !== undefined) {
        const index = await buildAccessoryIndex(homeId);
        payload.actions = buildActionsPayload(args.actions as Array<Record<string, unknown>>, index);
      }
      if (Object.keys(payload).length === 1) {
        throw new Error('Provide at least one of: new_name, actions');
      }

      await executeHomeKitAction('scene.update', payload);
      return { success: true, scene: (payload.name as string) || scene.name, home: homeSlug, message: 'Scene updated' };
    }

    case 'delete_scene': {
      const homeSlug = args.home as string;
      const sceneName = args.name as string;
      if (!homeSlug || !sceneName) {
        throw new Error("Both 'home' and 'name' are required");
      }

      const homesResult = await executeHomeKitAction('homes.list') as any;
      const homes = homesResult?.homes || [];
      const homeEntry = homes.find((h: any) => uniqueKey(h.name, h.id) === homeSlug);
      if (!homeEntry) {
        throw new Error(`Home not found: ${homeSlug}`);
      }

      const scenesResult = await executeHomeKitAction('scenes.list', { homeId: homeEntry.id }) as any;
      const scenes = scenesResult?.scenes || [];
      const scene = scenes.find((s: any) =>
        s.name?.toLowerCase() === sceneName.toLowerCase()
      );
      if (!scene) {
        const available = scenes.map((s: any) => s.name);
        throw new Error(`Scene not found: "${sceneName}" in ${homeSlug}. Available: [${available.join(', ')}]`);
      }
      if (scene.automationName) {
        throw new Error(
          `Scene "${scene.name}" is used by automation "${scene.automationName}" — ` +
          'delete the automation instead (delete_automation).'
        );
      }

      await executeHomeKitAction('scene.delete', { sceneId: scene.id });
      return { success: true, scene: scene.name, home: homeSlug, message: 'Scene deleted' };
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
          result: { tools: await listToolsPersonalized() },
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
