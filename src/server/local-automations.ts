/**
 * Community mode: HomeKit automation MCP tool handlers.
 * Mirrors the Cloud edition's HomesAPI automation tools (get_automations,
 * create_automation, update_automation, delete_automation).
 *
 * Addressing uses the same vocabulary as get_state/set_state: home and
 * accessory slug keys (uniqueKey) and simple property names (on, brightness,
 * alarm_target, ...). UUIDs and raw HomeKit characteristic types never
 * surface to the AI.
 */

import { executeHomeKitAction } from '../relay/local-handler';
import { uniqueKey, getSimpleName, formatValue } from './local-rest';
import { isInsufficientHomeKitPrivileges, HOMEKIT_EDIT_PERMISSION_MESSAGE } from '../lib/homekit-errors';

/**
 * Run an automation write against the native bridge, translating HomeKit's
 * "Insufficient privileges" (the relay Mac's Apple ID lacks edit access in
 * Apple Home) into actionable guidance. Wording mirrors the cloud server's
 * homekit_errors.py.
 */
async function executeAutomationWrite(action: string, payload: Record<string, unknown>): Promise<unknown> {
  try {
    return await executeHomeKitAction(action, payload);
  } catch (error) {
    if (isInsufficientHomeKitPrivileges(error)) {
      throw new Error(HOMEKIT_EDIT_PERMISSION_MESSAGE);
    }
    throw error;
  }
}

// Simple property name → characteristic name accepted by the native
// automation path (CharacteristicMapper.characteristicMap). Matches the
// cloud server's automation SIMPLE_TO_CHAR — keep in sync.
const SIMPLE_TO_CHAR: Record<string, string> = {
  on: 'power_state',
  active: 'active',
  status_active: 'status_active',
  brightness: 'brightness',
  hue: 'hue',
  saturation: 'saturation',
  color_temp: 'color_temperature',
  current_temp: 'current_temperature',
  heat_target: 'heating_threshold',
  cool_target: 'cooling_threshold',
  target_temp: 'target_temperature',
  locked: 'lock_current_state',
  lock_target: 'lock_target_state',
  alarm_state: 'security_system_current_state',
  alarm_target: 'security_system_target_state',
  motion: 'motion_detected',
  contact: 'contact_state',
  battery: 'battery_level',
  low_battery: 'status_low_battery',
  volume: 'volume',
  mute: 'mute',
  speed: 'rotation_speed',
  target: 'target_position',
  hvac_mode: 'target_heater_cooler_state',
  hvac_state: 'current_heater_cooler_state',
};

// Reverse map for read-side normalization (covers names CHAR_TO_SIMPLE
// doesn't, e.g. rotation_speed → speed). First entry wins on collisions.
const AUTOMATION_CHAR_TO_SIMPLE: Record<string, string> = {};
for (const [simple, char] of Object.entries(SIMPLE_TO_CHAR)) {
  if (!AUTOMATION_CHAR_TO_SIMPLE[char]) AUTOMATION_CHAR_TO_SIMPLE[char] = simple;
}
AUTOMATION_CHAR_TO_SIMPLE['on'] = 'on';

const ALARM_VALUES: Record<string, number> = { home: 0, away: 1, night: 2, off: 3, triggered: 4 };
const HVAC_MODE_VALUES: Record<string, number> = { auto: 0, heat: 1, cool: 2 };
const HVAC_STATE_VALUES: Record<string, number> = { inactive: 0, idle: 1, heating: 2, cooling: 3 };

const CREATABLE_EVENT_TYPES = ['characteristic', 'significantTime', 'calendar', 'duration'];

/** Best-effort valid variant of an invalid name, offered in the error. */
function suggestValidName(name: string): string {
  let suggestion = (name || '').trim();
  while (suggestion && !/[\p{L}\p{N}]$/u.test(suggestion)) {
    suggestion = suggestion.slice(0, -1).trimEnd();
  }
  for (const [opener, closer] of [['(', ')'], ['[', ']'], ['{', '}']] as const) {
    while (suggestion.split(opener).length > suggestion.split(closer).length) {
      const idx = suggestion.lastIndexOf(opener);
      suggestion = (suggestion.slice(0, idx) + suggestion.slice(idx + 1)).trim();
    }
  }
  return suggestion.split(/\s+/).join(' ');
}

/**
 * Reject names HomeKit won't accept — BEFORE anything reaches the bridge.
 *
 * HomeKit requires trigger/action-set names to end with a letter or digit.
 * Worse than the rejection itself: the trigger is added before the
 * action-set name is validated, so letting HomeKit refuse leaves a
 * half-created, disabled automation behind. We don't rewrite the name
 * (the caller stays in control) — we fail fast with a suggestion.
 */
export function validateAutomationName(name: string): string {
  const stripped = (name || '').trim();
  if (stripped && /[\p{L}\p{N}]$/u.test(stripped)) {
    return stripped;
  }
  const suggestion = suggestValidName(stripped);
  const hint = suggestion ? ` Try "${suggestion}".` : '';
  throw new Error(
    `Invalid automation name "${name}": HomeKit requires names to end ` +
    `with a letter or number (no trailing punctuation like ")" or "!").${hint}`
  );
}

/**
 * Convert a friendly property value to the numeric value HomeKit expects.
 * Exact-name checks only — no substring matching.
 */
export function convertSimpleValue(prop: string, value: unknown): unknown {
  if (prop === 'alarm_target' || prop === 'alarm_state') {
    if (typeof value === 'string') {
      const mapped = ALARM_VALUES[value.toLowerCase()];
      if (mapped === undefined || (prop === 'alarm_target' && mapped > 3)) {
        throw new Error(`Invalid ${prop} value: "${value}" (use home/away/night/off)`);
      }
      return mapped;
    }
    return value;
  }
  if (prop === 'hvac_mode') {
    if (typeof value === 'string') {
      const mapped = HVAC_MODE_VALUES[value.toLowerCase()];
      if (mapped === undefined) {
        throw new Error(`Invalid hvac_mode value: "${value}" (use auto/heat/cool)`);
      }
      return mapped;
    }
    return value;
  }
  if (prop === 'hvac_state') {
    if (typeof value === 'string') {
      const mapped = HVAC_STATE_VALUES[value.toLowerCase()];
      if (mapped === undefined) {
        throw new Error(`Invalid hvac_state value: "${value}" (use inactive/idle/heating/cooling)`);
      }
      return mapped;
    }
    return value;
  }
  if (prop === 'lock_target' || prop === 'locked') {
    if (typeof value === 'boolean') return value ? 1 : 0;
    return value;
  }
  return value;
}

function simpleToChar(prop: string): string {
  return SIMPLE_TO_CHAR[prop] || prop;
}

function charToSimple(charType: string): string {
  if (AUTOMATION_CHAR_TO_SIMPLE[charType]) return AUTOMATION_CHAR_TO_SIMPLE[charType];
  return getSimpleName(charType) || charType;
}

// --- Home / accessory resolution ---

interface AccessoryIndex {
  slugToId: Record<string, string>;
  byId: Record<string, { slug: string; roomSlug: string }>;
}

export async function resolveHome(homeSlug: string): Promise<{ homeId: string; homeKey: string }> {
  const homesResult = await executeHomeKitAction('homes.list') as any;
  const homes = homesResult?.homes || [];
  const home = homes.find((h: any) => uniqueKey(h.name, h.id) === homeSlug);
  if (!home) {
    const available = homes.map((h: any) => uniqueKey(h.name, h.id));
    throw new Error(`Home not found: ${homeSlug}. Available: [${available.join(', ')}]`);
  }
  return { homeId: home.id, homeKey: homeSlug };
}

export async function buildAccessoryIndex(homeId: string): Promise<AccessoryIndex> {
  const accResult = await executeHomeKitAction('accessories.list', { homeId }) as any;
  const accessories = accResult?.accessories || [];
  const index: AccessoryIndex = { slugToId: {}, byId: {} };
  for (const acc of accessories) {
    const slug = uniqueKey(acc.name || 'Unknown', acc.id || '');
    const roomSlug = uniqueKey(acc.roomName || 'Unknown', acc.roomId || '');
    index.slugToId[slug] = acc.id;
    index.byId[acc.id] = { slug, roomSlug };
  }
  return index;
}

export function resolveAccessory(index: AccessoryIndex, ref: string): string {
  if (index.slugToId[ref]) return index.slugToId[ref];
  // Raw UUID (round-trip safety)
  const refLower = ref.toLowerCase();
  for (const id of Object.values(index.slugToId)) {
    if (id.toLowerCase() === refLower) return id;
  }
  // Unique name-substring match
  const matches = Object.keys(index.slugToId).filter((slug) => slug.includes(refLower));
  if (matches.length === 1) return index.slugToId[matches[0]];
  const available = Object.keys(index.slugToId);
  if (matches.length > 1) {
    throw new Error(`Ambiguous accessory: ${ref}. Matches: [${matches.join(', ')}]`);
  }
  throw new Error(`Accessory not found: ${ref}. Available: [${available.join(', ')}]`);
}

// --- Write transforms (MCP grammar → native bridge payload) ---

function buildEventPayload(event: Record<string, any>, index: AccessoryIndex): Record<string, any> {
  const type = event.type;
  if (type === 'characteristic') {
    const ref = event.accessory || event.accessoryId;
    if (!ref) throw new Error('characteristic event requires "accessory"');
    const prop = event.characteristic || event.characteristicType;
    if (!prop) throw new Error('characteristic event requires "characteristic"');
    const value = event.value !== undefined ? event.value : event.triggerValue;
    const payload: Record<string, any> = {
      type: 'characteristic',
      accessoryId: resolveAccessory(index, ref),
      characteristicType: simpleToChar(prop),
    };
    if (value !== undefined) payload.triggerValue = convertSimpleValue(prop, value);
    return payload;
  }
  if (type === 'significantTime') {
    if (!event.significantEvent) throw new Error('significantTime event requires "significantEvent" (sunrise/sunset)');
    const payload: Record<string, any> = { type: 'significantTime', significantEvent: event.significantEvent };
    if (event.offsetMinutes !== undefined) payload.offsetMinutes = event.offsetMinutes;
    return payload;
  }
  if (type === 'calendar') {
    if (!event.calendarComponents) throw new Error('calendar event requires "calendarComponents" ({hour, minute, ...})');
    return { type: 'calendar', calendarComponents: event.calendarComponents };
  }
  if (type === 'duration') {
    if (event.durationSeconds === undefined) throw new Error('duration event requires "durationSeconds"');
    return { type: 'duration', durationSeconds: event.durationSeconds };
  }
  throw new Error(`Unsupported event type: ${type}. Supported: [${CREATABLE_EVENT_TYPES.join(', ')}]`);
}

export function buildTriggerPayload(trigger: Record<string, any>, index: AccessoryIndex): Record<string, any> {
  if (!trigger || typeof trigger !== 'object') {
    throw new Error('trigger must be an object');
  }
  if (trigger.type === 'timer') {
    const payload: Record<string, any> = { type: 'timer' };
    for (const key of ['fireDate', 'hour', 'minute', 'recurrence', 'recurrenceType', 'timeZone']) {
      if (trigger[key] !== undefined) payload[key] = trigger[key];
    }
    return payload;
  }
  if (trigger.type === 'event') {
    const events = trigger.events;
    if (!Array.isArray(events) || events.length === 0) {
      throw new Error('event trigger requires a non-empty "events" array');
    }
    const payload: Record<string, any> = {
      type: 'event',
      events: events.map((e: any) => buildEventPayload(e, index)),
    };
    if (Array.isArray(trigger.endEvents) && trigger.endEvents.length > 0) {
      payload.endEvents = trigger.endEvents.map((e: any) => buildEventPayload(e, index));
    }
    if (Array.isArray(trigger.conditions) && trigger.conditions.length > 0) {
      payload.conditions = trigger.conditions.map((c: any) => {
        if (c.type !== 'characteristic') {
          throw new Error(`Unsupported condition type: ${c.type} (only characteristic equality conditions can be created)`);
        }
        const ref = c.accessory || c.accessoryId;
        const prop = c.characteristic || c.characteristicType;
        if (!ref || !prop || c.value === undefined) {
          throw new Error('characteristic condition requires "accessory", "characteristic" and "value"');
        }
        return {
          type: 'characteristic',
          accessoryId: resolveAccessory(index, ref),
          characteristicType: simpleToChar(prop),
          value: convertSimpleValue(prop, c.value),
        };
      });
    }
    if (Array.isArray(trigger.recurrences)) payload.recurrences = trigger.recurrences;
    if (trigger.executeOnce !== undefined) payload.executeOnce = trigger.executeOnce;
    return payload;
  }
  throw new Error(`Unsupported trigger type: ${trigger.type} (use "timer" or "event")`);
}

export function buildActionsPayload(
  actions: Array<Record<string, any>>,
  index: AccessoryIndex
): Array<{ accessoryId: string; characteristicType: string; targetValue: unknown }> {
  if (!Array.isArray(actions) || actions.length === 0) {
    throw new Error('actions must be a non-empty array');
  }
  const result: Array<{ accessoryId: string; characteristicType: string; targetValue: unknown }> = [];
  for (const action of actions) {
    const ref = action.accessory;
    if (!ref) throw new Error('Each action requires an "accessory" slug');
    const accessoryId = resolveAccessory(index, ref);
    let propCount = 0;
    for (const [key, value] of Object.entries(action)) {
      if (key === 'accessory' || key === 'room' || value === undefined || value === null) continue;
      propCount++;
      result.push({
        accessoryId,
        characteristicType: simpleToChar(key),
        targetValue: convertSimpleValue(key, value),
      });
    }
    if (propCount === 0) {
      throw new Error(`No settable properties in action for ${ref} (e.g. on, brightness, target)`);
    }
  }
  return result;
}

// --- Read transforms (native bridge → MCP grammar) ---

function normalizeEvent(event: Record<string, any>, index: AccessoryIndex): Record<string, any> {
  if (event.type === 'characteristic') {
    const prop = charToSimple(event.characteristicType || '');
    const normalized: Record<string, any> = {
      type: 'characteristic',
      accessory: index.byId[event.accessoryId]?.slug || event.accessoryId,
      characteristic: prop,
    };
    if (event.triggerValue !== undefined && event.triggerValue !== null) {
      normalized.value = formatValue(event.triggerValue, prop);
    }
    return normalized;
  }
  // Non-characteristic events (significantTime, calendar, duration, location,
  // presence, unknown) carry no accessory refs — pass through, dropping nulls.
  const passthrough: Record<string, any> = {};
  for (const [key, value] of Object.entries(event)) {
    if (value !== undefined && value !== null) passthrough[key] = value;
  }
  return passthrough;
}

function normalizeCondition(condition: Record<string, any>, index: AccessoryIndex): Record<string, any> {
  if (condition.type === 'characteristic') {
    const prop = charToSimple(condition.characteristicType || '');
    const normalized: Record<string, any> = {
      type: 'characteristic',
      accessory: index.byId[condition.accessoryId]?.slug || condition.accessoryId,
      characteristic: prop,
    };
    if (condition.value !== undefined && condition.value !== null) {
      normalized.value = formatValue(condition.value, prop);
    }
    if (condition.comparisonOperator && !isEqualityOperator(condition.comparisonOperator)) {
      normalized.operator = condition.comparisonOperator;
    }
    return normalized;
  }
  const passthrough: Record<string, any> = {};
  for (const [key, value] of Object.entries(condition)) {
    if (value !== undefined && value !== null) passthrough[key] = value;
  }
  return passthrough;
}

function isEqualityOperator(op: unknown): boolean {
  return !op || op === '==' || op === '=' || op === 'equalTo';
}

function isEditable(trigger: Record<string, any>): boolean {
  const type = trigger?.type;
  if (type === 'timer') return true;
  if (type !== 'event') return false;
  const events = [...(trigger.events || []), ...(trigger.endEvents || [])];
  if (events.some((e: any) => !CREATABLE_EVENT_TYPES.includes(e.type))) return false;
  const conditions = trigger.conditions || [];
  if (conditions.some((c: any) => c.type !== 'characteristic' || !isEqualityOperator(c.comparisonOperator))) {
    return false;
  }
  return true;
}

export function normalizeAutomation(raw: Record<string, any>, index: AccessoryIndex): Record<string, any> {
  const trigger = raw.trigger || {};
  const normalized: Record<string, any> = {
    id: raw.id,
    name: raw.name,
    enabled: Boolean(raw.isEnabled),
    editable: isEditable(trigger),
  };

  // Trigger
  if (trigger.type === 'timer') {
    const t: Record<string, any> = { type: 'timer' };
    for (const key of ['fireDate', 'recurrence', 'timeZone']) {
      if (trigger[key] !== undefined && trigger[key] !== null) t[key] = trigger[key];
    }
    normalized.trigger = t;
  } else if (trigger.type === 'event') {
    const t: Record<string, any> = {
      type: 'event',
      events: (trigger.events || []).map((e: any) => normalizeEvent(e, index)),
    };
    if (Array.isArray(trigger.endEvents) && trigger.endEvents.length > 0) {
      t.endEvents = trigger.endEvents.map((e: any) => normalizeEvent(e, index));
    }
    if (Array.isArray(trigger.conditions) && trigger.conditions.length > 0) {
      t.conditions = trigger.conditions.map((c: any) => normalizeCondition(c, index));
    }
    if (Array.isArray(trigger.recurrences) && trigger.recurrences.length > 0) {
      t.recurrences = trigger.recurrences;
    }
    if (trigger.executeOnce) t.executeOnce = true;
    normalized.trigger = t;
  } else {
    normalized.trigger = { type: trigger.type || 'unknown' };
  }
  if (trigger.activationState && trigger.activationState !== 'enabled' && trigger.activationState !== 'disabled') {
    normalized.trigger.activation_issue = trigger.activationState;
  }

  // Actions: group characteristic writes per accessory into set_state-style objects
  const grouped: Record<string, Record<string, any>> = {};
  const groupOrder: string[] = [];
  for (const action of raw.actions || []) {
    const info = index.byId[action.accessoryId];
    const slug = info?.slug || action.accessoryId;
    if (!grouped[slug]) {
      grouped[slug] = { accessory: slug };
      if (info?.roomSlug) grouped[slug].room = info.roomSlug;
      groupOrder.push(slug);
    }
    const prop = charToSimple(action.characteristicType || '');
    grouped[slug][prop] = formatValue(action.targetValue, prop);
  }
  normalized.actions = groupOrder.map((slug) => grouped[slug]);

  if (raw.lastFireDate) normalized.last_fired = raw.lastFireDate;
  return normalized;
}

// --- MCP tool handlers ---

function fetchedAt(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, '+00:00');
}

export async function handleGetAutomations(filterByHome?: string): Promise<Record<string, any>> {
  const homesResult = await executeHomeKitAction('homes.list') as any;
  const homes = homesResult?.homes || [];
  const homeFilter = filterByHome?.toLowerCase() || null;

  const result: Record<string, any> = {};
  let total = 0;
  const viewOnlyHomes: string[] = [];
  for (const home of homes) {
    const homeKey = uniqueKey(home.name, home.id);
    if (homeFilter && !homeKey.includes(homeFilter)) continue;

    const [automationsResult, index] = await Promise.all([
      executeHomeKitAction('automations.list', { homeId: home.id }) as Promise<any>,
      buildAccessoryIndex(home.id),
    ]);
    const automations = automationsResult?.automations || [];
    result[homeKey] = automations.map((a: any) => normalizeAutomation(a, index));
    total += automations.length;
    if (home.isAdmin === false) viewOnlyHomes.push(homeKey);
  }

  const homeKeys = Object.keys(result);
  let message: string;
  if (homeKeys.length === 0) {
    message = homeFilter ? `No homes match filter: ${homeFilter}` : 'No homes available';
  } else if (total === 0) {
    message = 'No automations found';
  } else {
    const homeWord = homeKeys.length === 1 ? 'home' : 'homes';
    message = `Found ${total} automation${total === 1 ? '' : 's'} across ${homeKeys.length} ${homeWord}`;
  }
  if (viewOnlyHomes.length > 0) {
    message +=
      ` The relay has view-only access to ${viewOnlyHomes.join(', ')}; ` +
      'HomeKit automations there are read-only from Homecast.';
  }
  result._meta = { fetched_at: fetchedAt(), message };
  if (viewOnlyHomes.length > 0) {
    result._meta.view_only_homes = viewOnlyHomes;
  }
  return result;
}

export async function handleCreateAutomation(args: {
  home: string;
  name: string;
  trigger: Record<string, any>;
  actions: Array<Record<string, any>>;
}): Promise<Record<string, any>> {
  const { homeId, homeKey } = await resolveHome(args.home);
  if (!args.name) throw new Error("'name' is required");
  const name = validateAutomationName(args.name);
  const index = await buildAccessoryIndex(homeId);

  const trigger = buildTriggerPayload(args.trigger, index);
  const actions = buildActionsPayload(args.actions, index);

  const result = await executeAutomationWrite('automation.create', {
    homeId,
    name,
    trigger,
    actions,
  }) as any;

  const automation = normalizeAutomation(result?.automation || result || {}, index);
  return { home: homeKey, automation, message: `Created automation "${name}"` };
}

export async function handleUpdateAutomation(args: {
  home: string;
  id: string;
  name?: string;
  trigger?: Record<string, any>;
  actions?: Array<Record<string, any>>;
  enabled?: boolean;
}): Promise<Record<string, any>> {
  const { homeId, homeKey } = await resolveHome(args.home);
  if (!args.id) throw new Error("'id' is required");
  const index = await buildAccessoryIndex(homeId);

  const changesTriggerOrActions = args.trigger !== undefined || args.actions !== undefined;
  if (changesTriggerOrActions) {
    // Guard: opaque/read-only automations only allow name/enabled changes
    const automationsResult = await executeHomeKitAction('automations.list', { homeId }) as any;
    const existing = (automationsResult?.automations || []).find((a: any) => a.id === args.id);
    if (!existing) {
      throw new Error(`Automation not found: ${args.id} in ${homeKey}`);
    }
    if (!isEditable(existing.trigger || {})) {
      throw new Error(
        'This automation has an app-specific, presence, or location trigger that Homecast cannot modify. ' +
        'Only name and enabled can be changed; delete and recreate it to alter its behavior.'
      );
    }
  }

  const payload: Record<string, any> = { automationId: args.id };
  if (args.name !== undefined) payload.name = validateAutomationName(args.name);
  if (args.enabled !== undefined) payload.enabled = args.enabled;
  if (args.trigger !== undefined) payload.trigger = buildTriggerPayload(args.trigger, index);
  if (args.actions !== undefined) payload.actions = buildActionsPayload(args.actions, index);
  if (Object.keys(payload).length === 1) {
    throw new Error('Provide at least one of: name, trigger, actions, enabled');
  }

  const result = await executeAutomationWrite('automation.update', payload) as any;
  const automation = normalizeAutomation(result?.automation || result || {}, index);

  let message = `Updated automation "${automation.name || args.id}"`;
  if (automation.id && automation.id !== args.id) {
    message += `. Automation was recreated with a new id: ${automation.id}`;
  }
  return { home: homeKey, automation, message };
}

export async function handleDeleteAutomation(args: {
  home: string;
  id: string;
}): Promise<Record<string, any>> {
  const { homeKey } = await resolveHome(args.home);
  if (!args.id) throw new Error("'id' is required");
  await executeAutomationWrite('automation.delete', { automationId: args.id });
  return { success: true, id: args.id, home: homeKey, message: 'Automation deleted' };
}
