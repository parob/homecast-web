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
 *   - get_hc_automations: List Homecast-engine automations
 *   - create_hc_automation / update_hc_automation / delete_hc_automation: Manage them
 *   - create_virtual_accessory / update_virtual_accessory / delete_virtual_accessory
 *
 * The two automation engines are different products — see local-hc-automations.ts
 * for the split and the tool descriptions for which to reach for.
 */

// uniqueKey MUST be the shared one: a private copy here sanitized punctuation
// differently ("rob's house" -> rob_s_house vs local-rest's rob's_house), so
// the slugs get_state emitted didn't resolve in run_scene/delete_scene.
import { handleGetState, handleSetState, uniqueKey } from './local-rest';
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
import {
  handleGetHcAutomations,
  handleCreateHcAutomation,
  handleUpdateHcAutomation,
  handleDeleteHcAutomation,
  handleCreateVirtualAccessory,
  handleUpdateVirtualAccessory,
  handleDeleteVirtualAccessory,
} from './local-hc-automations';
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
      'Settable properties listed in _settable array. Scene names in _scenes per home. ' +
      'VIRTUAL ACCESSORIES appear here alongside real devices: values the home owns rather than hardware, ' +
      'read and written exactly like a device. Recognise one by its characteristic — ' +
      'virtual_mode (a named choice like "Home"/"Away"), virtual_count (a number you add to), ' +
      'virtual_number (a setting), virtual_text (free text), virtual_datetime (a date and/or time), ' +
      'virtual_timer ("idle"/"active"/"paused"); a virtual switch carries plain on. ' +
      'They are the home\'s memory: HomeKit stores whether a light is on, never whether the house is in Away mode ' +
      'or whether you have already reported the leak. Read one before deciding rather than guessing, ' +
      'and set one after acting so the next thing to look knows what happened. ' +
      'A Homecast automation can read one in a condition and change one in an action — build those with ' +
      'create_hc_automation, and create the accessory itself with create_virtual_accessory. ' +
      'A HomeKit automation cannot use one at all — HomeKit cannot see them, so the slug will not resolve. ' +
      'Changing one does not itself fire an automation: it is a value to read, not an event to react to.',
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
    name: 'get_history',
    description:
      'Get recorded history for one accessory: how its characteristics changed over time. ' +
      'Use it to answer questions like "what was the temperature last night?", "when did the door open?", ' +
      '"how long was the heating on today?". Returns per-characteristic series — numeric ones as ' +
      '[isoTime, value] pairs with a min/avg/max summary, on/off and mode ones as [isoTime, state] ' +
      'transitions. History is OPT-IN and off by default: if nothing is recorded, the home owner has to ' +
      'turn it on in Settings → Homes → the home first — say so rather than retrying. Recording only captures ' +
      'changes, so a flat line costs nothing and gaps mean the value simply held.',
    inputSchema: {
      type: 'object',
      properties: {
        accessory: { type: 'string', description: 'Accessory name substring, slug, or id (required)' },
        home: { type: 'string', description: 'Home name substring — narrows the search when names repeat across homes' },
        characteristic: { type: 'string', description: 'One characteristic (e.g. current_temperature, on, motion). Omit for all recorded ones (up to 24, most informative first)' },
        hours: { type: 'number', description: 'How far back to look, in hours (default 24, max 8784)' },
        max_points: { type: 'number', description: 'Maximum points per series (default 200)' },
      },
      required: ['accessory'],
    },
    annotations: { readOnlyHint: true, openWorldHint: true, destructiveHint: false },
  },
  {
    name: 'query_history',
    description:
      'Bulk access to recorded history for pattern and behaviour analysis — YOU do the analysis, this hands ' +
      'you the data flexibly and fast. Query any subset of accessories and characteristics over any date range ' +
      'in one call. Control the level of detail with resolution: "hourly"/"daily" read precomputed summaries ' +
      '(a month of data is a few hundred rows per series — use these for long ranges and rhythm/trend analysis; ' +
      'each numeric bucket carries [time, min, avg, max], each on/off-or-mode bucket carries [time, transitions, ' +
      'msInEachState]), "raw" returns every recorded change (short ranges, exact event times), "auto" picks for ' +
      'you. Filter with accessories/characteristics (names, slugs, or characteristic types like ' +
      'current_temperature, power_state, motion). Large pulls paginate: a truncated series includes ' +
      'continue_from — repeat the call with start=continue_from. Recording is change-based, so gaps mean the ' +
      'value simply held. History is OPT-IN and off by default: if nothing matches, the home owner has to turn ' +
      'it on in Settings → Homes → the home first — say so rather than retrying. Use get_history instead for a quick ' +
      'single-accessory look.',
    inputSchema: {
      type: 'object',
      properties: {
        home: { type: 'string', description: 'Home name substring. Omit for the first home' },
        accessories: { type: 'array', items: { type: 'string' }, description: 'Accessory name/slug/id substrings. Omit for all recorded accessories' },
        characteristics: { type: 'array', items: { type: 'string' }, description: 'Characteristic types (e.g. current_temperature, power_state, motion). Omit for all' },
        start: { type: 'string', description: 'ISO 8601 start. Default: 24h before end' },
        end: { type: 'string', description: 'ISO 8601 end. Default: now' },
        resolution: { type: 'string', enum: ['auto', 'raw', 'hourly', 'daily'], description: 'Level of detail. Default auto' },
        max_points_per_series: { type: 'number', description: 'Per-series cap (default 500, max 2000). Response capped at 50k points total' },
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
      'blind (target), valve (active). Virtual accessories take the characteristic get_state ' +
      'reports for them: virtual_mode, virtual_count (sets the count), virtual_number, virtual_text, ' +
      'virtual_datetime, virtual_timer ("active" starts it, anything else cancels); a virtual ' +
      'switch uses on. Returns {updated, failed, changes, errors, message}.',
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
              virtual_mode: { type: 'string', description: 'Virtual accessory: the option to select' },
              virtual_count: { type: 'integer', description: 'Virtual accessory: sets the count' },
              virtual_number: { type: 'number', description: 'Virtual accessory: the value' },
              virtual_text: { type: 'string', description: 'Virtual accessory: the text' },
              virtual_datetime: { type: 'string', description: 'Virtual accessory: ISO date and/or time' },
              virtual_timer: { type: 'string', description: 'Virtual accessory: "active" starts, anything else cancels' },
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
      '(their automations are read-only from Homecast — note this restriction does NOT apply to Homecast ' +
      'automations, which are ours to write regardless). ' +
      'This lists HomeKit-native automations only; Homecast engine automations are separate — use get_hc_automations.',
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
      'Create a HOMEKIT automation: WHEN the trigger fires (and all conditions pass), the actions set device properties. ' +
      'Homecast has TWO automation engines — pick deliberately. HOMEKIT (this tool) runs on the Apple home hub, so it ' +
      'keeps working when the relay Mac is off and appears in the Apple Home app; in exchange it can only test ' +
      'EQUALITY, cannot store state, cannot see virtual accessories, and needs the relay\'s Apple ID to have edit ' +
      'access. HOMECAST (create_hc_automation) runs on the relay Mac and supports numeric thresholds (above/below), ' +
      'AND/OR/NOT conditions, delays, notifications and virtual accessories, with no edit permission needed. ' +
      'Use this tool when it must survive the Mac being off or must show up in Apple Home; otherwise prefer ' +
      'create_hc_automation. ' +
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
      'Virtual accessories CANNOT appear anywhere in a HomeKit automation — not as an event, a condition or an ' +
      'action — because HomeKit cannot see them, so their slug will not resolve. If the automation needs to remember ' +
      'state, use create_hc_automation with a virtual accessory instead; that is what they are for. ' +
      'CONDITIONS must ALL be true for actions to run and support equality only ' +
      '(e.g. only while alarm_state is "away"): {"type":"characteristic","accessory":"<slug>","characteristic":"<property>","value":<v>}. ' +
      'No greater/less-than or time-window conditions — if the user asked for a threshold ("above 65%", "below 5°C"), ' +
      'HomeKit cannot express it: use create_hc_automation with a "numeric" trigger rather than reporting it as ' +
      'impossible. ' +
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

  // --- Homecast engine automations ---
  // A second, more capable automation engine that is NOT HomeKit. Every
  // description below leads with the distinction, because choosing the wrong
  // engine is the single most likely mistake: HomeKit silently cannot express
  // thresholds or stored state, and an agent that only knows create_automation
  // will report the request as impossible when it isn't.
  {
    name: 'get_hc_automations',
    description:
      'List HOMECAST automations (the Homecast engine, NOT HomeKit — see create_hc_automation for which is which). ' +
      'Returns {home_key: [automation], _meta}. Each has id, name, enabled, mode, triggers, conditions, actions, ' +
      'last_triggered and trigger_count, in exactly the format create_hc_automation/update_hc_automation accept, ' +
      'so you can copy one, edit it and send it back. ' +
      'editable_via_mcp=false means the automation uses nodes this grammar has no words for (built in the app\'s ' +
      'visual editor — code nodes, HTTP requests, branching): it can still be renamed, enabled/disabled or deleted, ' +
      'but resending its triggers/actions would lose those nodes, and any part we could not read is marked ' +
      '_unsupported. ' +
      'For HomeKit-native automations use get_automations instead.',
    inputSchema: {
      type: 'object',
      properties: {
        filter_by_home: { type: 'string', description: 'Filter by home name substring' },
      },
    },
    annotations: { readOnlyHint: true, openWorldHint: true, destructiveHint: false },
  },
  {
    name: 'create_hc_automation',
    description:
      'Create a HOMECAST automation. Homecast has TWO separate automation engines and this is the more capable one — ' +
      'pick deliberately: ' +
      'HOMECAST (this tool) runs in the Homecast engine on the relay Mac. It supports numeric thresholds ' +
      '(above/below), AND/OR/NOT condition trees, delays, notifications and virtual accessories, and it does NOT ' +
      'need the relay\'s Apple ID to have edit access in Apple Home. It only runs while the relay Mac is awake and ' +
      'Homecast is running. ' +
      'HOMEKIT (create_automation) runs on the Apple home hub, so it keeps working when the Mac is off — but it can ' +
      'only test equality (never "above 65"), cannot store state, cannot see virtual accessories, and needs edit ' +
      'permission. ' +
      'DEFAULT TO THIS TOOL unless the automation must survive the Mac being off, or the user asked for it to appear ' +
      'in the Apple Home app. ' +
      'Call get_state first for home/accessory slug keys and property names — same vocabulary throughout. ' +
      'TRIGGERS (array, at least one; ANY firing runs the automation): ' +
      '{"type":"device","accessory":"<slug>","characteristic":"<prop>","to":<v>,"from":<v> (optional),' +
      '"for":<seconds or {minutes}> (optional, must hold that long)} — or "service_group":"<id>" for a group | ' +
      '{"type":"virtual","virtual":"<slug>","to":<v>} — fire on a stored value changing; omit "characteristic" ' +
      '(a virtual carries exactly one, decided by its type, and we fill it in), add above/below for a threshold | ' +
      '{"type":"numeric","accessory":"<slug>","characteristic":"relative_humidity","above":65,"below":<n>,"for":<...>} ' +
      '— THE THRESHOLD TRIGGER HomeKit cannot do; above/below at least one | ' +
      '{"type":"time","at":"07:30","weekdays":[1,2,3,4,5] (optional, 0=Sun)} | ' +
      '{"type":"sun","event":"sunrise"|"sunset","offset":<seconds or {minutes:-30}> (optional)} | ' +
      '{"type":"webhook","webhook_id":"<id>"}. ' +
      'CONDITIONS (optional array, ALL must pass; nest {"operator":"or"|"not","conditions":[...]} for other logic): ' +
      '{"type":"device","accessory":"<slug>","characteristic":"<prop>","value":<v>} | ' +
      '{"type":"numeric","accessory":"<slug>","characteristic":"<prop>","above":<n>,"below":<n>} | ' +
      '{"type":"virtual","virtual":"<slug>","equals":<v>} (or above/below) — read a stored value | ' +
      '{"type":"time","after":"09:00","before":"21:00","weekdays":[...]} | ' +
      '{"type":"sun","after":"sunset","before":"sunrise"} | ' +
      '{"type":"template","expression":"<expression>"}. ' +
      'ACTIONS (array, at least one, run in order): ' +
      '{"type":"device","accessory":"<slug>", plus any of on, brightness, hue, saturation, color_temp, active, ' +
      'heat_target, cool_target, hvac_mode, lock_target, alarm_target, speed, volume, mute, target} — same ' +
      'vocabulary as set_state; several properties in one action is fine | ' +
      '{"type":"virtual","virtual":"<slug>","operation":"set","value":<v>} — operations: set, turn_on, turn_off, ' +
      'toggle, increment, decrement, reset, start, pause, resume, cancel, finish | ' +
      '{"type":"scene","scene":"<name>"} | {"type":"delay","seconds":300} | ' +
      '{"type":"notify","message":"...","title":"..." (optional)}. ' +
      'To remember state between runs (e.g. "a dry cycle is already running"), create a virtual accessory with ' +
      'create_virtual_accessory, then read it in a condition and set it in an action. ' +
      'Names are free-form — the HomeKit trailing-punctuation rule does not apply here. ' +
      'Returns {home, automation, message}; automation.id identifies it for update/delete. ' +
      'The result is a normal automation in the app\'s visual editor, laid out automatically and fully editable.',
    inputSchema: {
      type: 'object',
      properties: {
        home: { type: 'string', description: 'Home slug key (e.g., "my_house_0bf8")' },
        name: { type: 'string', description: 'Automation name' },
        triggers: {
          type: 'array',
          description: 'Trigger definitions — any one firing runs the automation (see tool description)',
          items: { type: 'object' },
        },
        conditions: {
          type: 'array',
          description: 'Optional conditions that must ALL pass (nest a block for or/not)',
          items: { type: 'object' },
        },
        actions: {
          type: 'array',
          description: 'Actions to run in order (see tool description)',
          items: { type: 'object' },
        },
        enabled: { type: 'boolean', description: 'Defaults to true' },
        mode: {
          type: 'string',
          description: 'What happens if it re-triggers mid-run: single (default, ignore), restart, queued, parallel',
        },
        description: { type: 'string', description: 'Optional note shown in the editor' },
      },
      required: ['home', 'name', 'triggers', 'actions'],
    },
    annotations: { readOnlyHint: false, openWorldHint: true, destructiveHint: false },
  },
  {
    name: 'update_hc_automation',
    description:
      'Update a HOMECAST automation (NOT a HomeKit one — use update_automation for those). ' +
      'Provide home and id from get_hc_automations, plus any of name, triggers, conditions, actions, enabled, mode, ' +
      'description. Formats are exactly create_hc_automation\'s. ' +
      'enabled=true/false alone enables or disables it without resending the definition — the usual way to pause one. ' +
      'Supplying triggers or actions REPLACES that whole list, so send the complete set (get_hc_automations returns ' +
      'it in the right shape to edit and send back). The id is stable across updates, unlike HomeKit automations. ' +
      'Automations marked editable_via_mcp=false use editor-only nodes: changing their triggers/actions here would ' +
      'drop those nodes, so restrict yourself to name/enabled/description unless the user accepts the loss.',
    inputSchema: {
      type: 'object',
      properties: {
        home: { type: 'string', description: 'Home slug key' },
        id: { type: 'string', description: 'Automation id from get_hc_automations' },
        name: { type: 'string', description: 'New name' },
        triggers: { type: 'array', description: 'New triggers (replaces all)', items: { type: 'object' } },
        conditions: { type: 'array', description: 'New conditions (replaces all)', items: { type: 'object' } },
        actions: { type: 'array', description: 'New actions (replaces all)', items: { type: 'object' } },
        enabled: { type: 'boolean', description: 'Enable or disable' },
        mode: { type: 'string', description: 'single, restart, queued or parallel' },
        description: { type: 'string' },
      },
      required: ['home', 'id'],
    },
    annotations: { readOnlyHint: false, openWorldHint: true, destructiveHint: false },
  },
  {
    name: 'delete_hc_automation',
    description:
      'Permanently delete a HOMECAST automation (get id from get_hc_automations). This cannot be undone. ' +
      'To temporarily stop one, use update_hc_automation with enabled=false instead. ' +
      'For HomeKit-native automations use delete_automation.',
    inputSchema: {
      type: 'object',
      properties: {
        home: { type: 'string', description: 'Home slug key' },
        id: { type: 'string', description: 'Automation id from get_hc_automations' },
      },
      required: ['home', 'id'],
    },
    annotations: { readOnlyHint: false, openWorldHint: true, destructiveHint: true },
  },
  {
    name: 'create_virtual_accessory',
    description:
      'Create a virtual accessory — a value the home remembers, which HomeKit has nowhere to store. ' +
      'Use one whenever an automation needs memory: whether a cycle is already running, what mode the house is in, ' +
      'how many times something happened, or a setpoint to restore later. ' +
      'It appears in get_state alongside real devices, is writable with set_state, and can be read in a Homecast ' +
      'automation condition and written by a Homecast automation action. ' +
      'HomeKit CANNOT see it: it will not resolve in create_automation, so an automation that depends on one must be ' +
      'a Homecast automation (create_hc_automation). ' +
      'TYPES and their extra fields: ' +
      '"switch" — on/off, optional initial (boolean) | ' +
      '"mode" — a named choice; REQUIRES options (e.g. ["Idle","Running","Cancelled"]), optional initial (defaults ' +
      'to the first option) | ' +
      '"number" — a setting; REQUIRES min and max, optional step (default 1), unit, initial | ' +
      '"counter" — a tally; optional initial, step, min, max | ' +
      '"timer" — idle/active/paused; optional duration (seconds or {minutes}) | ' +
      '"text" — free text; optional initial | ' +
      '"date" — a date and time; optional initial (ISO 8601). ' +
      'Returns {home, virtual_accessory:{id, slug, name, type}, message} — use the slug to reference it.',
    inputSchema: {
      type: 'object',
      properties: {
        home: { type: 'string', description: 'Home slug key' },
        name: { type: 'string', description: 'Display name (e.g. "Bedroom 1 Dry Cycle")' },
        type: {
          type: 'string',
          description: 'switch, mode, number, counter, timer, text or date',
        },
        options: {
          type: 'array',
          description: 'Required for type "mode" — the named choices',
          items: { type: 'string' },
        },
        initial: { description: 'Starting value (type depends on the accessory type)' },
        min: { type: 'number', description: 'Required for type "number"' },
        max: { type: 'number', description: 'Required for type "number"' },
        step: { type: 'number', description: 'Increment for number/counter' },
        unit: { type: 'string', description: 'Display unit for number (e.g. "°C")' },
        duration: { description: 'Default duration for a timer (seconds or {hours, minutes, seconds})' },
        controllable: { type: 'boolean', description: 'Whether a person can change it from the dashboard (default true)' },
        icon: { type: 'string', description: 'Optional icon slug' },
      },
      required: ['home', 'name', 'type'],
    },
    annotations: { readOnlyHint: false, openWorldHint: true, destructiveHint: false },
  },
  {
    name: 'update_virtual_accessory',
    description:
      'Change a virtual accessory\'s DEFINITION — its name, or the settings that shape it (a mode\'s options, ' +
      'a number\'s min/max/step/unit, a counter\'s step, a timer\'s duration, the icon, whether it is ' +
      'controllable from the dashboard). Provide home and id (slug or id from get_state) plus only the fields ' +
      'you are changing. ' +
      'This does NOT change its current value — use set_state for that, exactly as you would for a real device. ' +
      'The type cannot be changed: a mode is not a counter, and the stored value would not survive. Delete and ' +
      'recreate instead. ' +
      'Changing a mode\'s options replaces the whole list; if the option it starts on is no longer in it, the ' +
      'start value moves to the first option so it cannot be left in a state nothing can select or match. ' +
      'Automations referencing the accessory keep working — they resolve it by id, not by name — but a rename ' +
      'changes its slug, so re-read get_state before referring to it again.',
    inputSchema: {
      type: 'object',
      properties: {
        home: { type: 'string', description: 'Home slug key' },
        id: { type: 'string', description: 'Virtual accessory slug or id' },
        name: { type: 'string', description: 'New display name' },
        options: {
          type: 'array',
          description: 'Replacement choices for a "mode" accessory',
          items: { type: 'string' },
        },
        initial: { description: 'New starting value (not the current value — use set_state for that)' },
        min: { type: 'number' },
        max: { type: 'number' },
        step: { type: 'number' },
        unit: { type: 'string' },
        duration: { description: 'New default duration for a timer (seconds or {hours, minutes, seconds})' },
        controllable: { type: 'boolean' },
        icon: { type: 'string' },
      },
      required: ['home', 'id'],
    },
    annotations: { readOnlyHint: false, openWorldHint: true, destructiveHint: false },
  },
  {
    name: 'delete_virtual_accessory',
    description:
      'Permanently delete a virtual accessory (slug or id from get_state). This cannot be undone, and any Homecast ' +
      'automation still referencing it will fail to resolve it — check get_hc_automations first.',
    inputSchema: {
      type: 'object',
      properties: {
        home: { type: 'string', description: 'Home slug key' },
        id: { type: 'string', description: 'Virtual accessory slug or id' },
      },
      required: ['home', 'id'],
    },
    annotations: { readOnlyHint: false, openWorldHint: true, destructiveHint: true },
  },
];


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

    case 'get_history': {
      const { handleGetHistory } = await import('./local-rest');
      return await handleGetHistory({
        home: args.home as string | undefined,
        accessory: args.accessory as string,
        characteristic: args.characteristic as string | undefined,
        hours: args.hours as number | undefined,
        max_points: args.max_points as number | undefined,
      });
    }

    case 'query_history': {
      const { handleQueryHistory } = await import('./local-rest');
      return await handleQueryHistory({
        home: args.home as string | undefined,
        accessories: args.accessories as string[] | undefined,
        characteristics: args.characteristics as string[] | undefined,
        start: args.start as string | undefined,
        end: args.end as string | undefined,
        resolution: args.resolution as 'auto' | 'raw' | 'hourly' | 'daily' | undefined,
        max_points_per_series: args.max_points_per_series as number | undefined,
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

    // --- Homecast engine automations ---

    case 'get_hc_automations': {
      return await handleGetHcAutomations(args.filter_by_home as string | undefined);
    }

    case 'create_hc_automation': {
      const { home, name: automationName, triggers, actions } = args as {
        home?: string; name?: string;
        triggers?: Array<Record<string, unknown>>; actions?: Array<Record<string, unknown>>;
      };
      if (!home || !automationName || !triggers || !actions) {
        throw new Error("'home', 'name', 'triggers' and 'actions' are required");
      }
      return await handleCreateHcAutomation({
        home,
        name: automationName,
        triggers,
        conditions: args.conditions as Array<Record<string, unknown>> | undefined,
        actions,
        enabled: args.enabled as boolean | undefined,
        mode: args.mode as string | undefined,
        description: args.description as string | undefined,
      });
    }

    case 'update_hc_automation': {
      const { home, id } = args as { home?: string; id?: string };
      if (!home || !id) {
        throw new Error("'home' and 'id' are required");
      }
      return await handleUpdateHcAutomation({
        home,
        id,
        name: args.name as string | undefined,
        triggers: args.triggers as Array<Record<string, unknown>> | undefined,
        conditions: args.conditions as Array<Record<string, unknown>> | undefined,
        actions: args.actions as Array<Record<string, unknown>> | undefined,
        enabled: args.enabled as boolean | undefined,
        mode: args.mode as string | undefined,
        description: args.description as string | undefined,
      });
    }

    case 'delete_hc_automation': {
      const { home, id } = args as { home?: string; id?: string };
      if (!home || !id) {
        throw new Error("'home' and 'id' are required");
      }
      return await handleDeleteHcAutomation({ home, id });
    }

    case 'create_virtual_accessory': {
      const { home, name: accessoryName, type } = args as {
        home?: string; name?: string; type?: string;
      };
      if (!home || !accessoryName || !type) {
        throw new Error("'home', 'name' and 'type' are required");
      }
      return await handleCreateVirtualAccessory({
        home,
        name: accessoryName,
        type,
        options: args.options as string[] | undefined,
        initial: args.initial,
        min: args.min as number | undefined,
        max: args.max as number | undefined,
        step: args.step as number | undefined,
        unit: args.unit as string | undefined,
        duration: args.duration,
        controllable: args.controllable as boolean | undefined,
        icon: args.icon as string | undefined,
      });
    }

    case 'update_virtual_accessory': {
      const { home, id } = args as { home?: string; id?: string };
      if (!home || !id) {
        throw new Error("'home' and 'id' are required");
      }
      return await handleUpdateVirtualAccessory({
        home,
        id,
        name: args.name as string | undefined,
        options: args.options as string[] | undefined,
        initial: args.initial,
        min: args.min as number | undefined,
        max: args.max as number | undefined,
        step: args.step as number | undefined,
        unit: args.unit as string | undefined,
        duration: args.duration,
        controllable: args.controllable as boolean | undefined,
        icon: args.icon as string | undefined,
      });
    }

    case 'delete_virtual_accessory': {
      const { home, id } = args as { home?: string; id?: string };
      if (!home || !id) {
        throw new Error("'home' and 'id' are required");
      }
      return await handleDeleteVirtualAccessory({ home, id });
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
