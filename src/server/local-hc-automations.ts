/**
 * Community mode: Homecast automation engine MCP tool handlers.
 *
 * The sibling module `local-automations.ts` drives HomeKit's OWN automation
 * API. This one drives the Homecast engine — our automations, stored in
 * IndexedDB and executed by `AutomationEngine`. They are different products
 * with different limits, and the tool descriptions in local-mcp.ts spell out
 * which to reach for; in short, HomeKit runs on the home hub without this Mac
 * but can only compare equality, while the engine needs the relay running and
 * can do thresholds, state and multi-step logic.
 *
 * ## Why a flat grammar rather than the graph
 *
 * The visual editor is a node canvas, but `Automation` itself is flat —
 * triggers[] / conditions / actions[] — and `uiState` (positions, edges) is
 * optional decoration. The engine executes the flat form, and
 * `automationToGraph.ts` lays out a canvas for automations that arrive with no
 * uiState, which is exactly what these tools produce. So an agent never has to
 * synthesize node ids or wire edges: it sends the shape the engine already
 * runs, and the automation opens and edits normally in the app afterwards.
 *
 * Addressing matches get_state/set_state and the HomeKit automation tools:
 * home/accessory slug keys and simple property names, never UUIDs or raw
 * HomeKit characteristic types.
 */

import { SIMPLE_TO_CHAR } from '@/lib/characteristic-aliases';
import { VIRTUAL_CHARACTERISTIC } from '@/automation/types/automation';
import { uniqueKey } from './local-rest';
import { executeHomeKitAction } from '../relay/local-handler';
import {
  resolveHome,
  buildAccessoryIndex,
  resolveAccessory,
  convertSimpleValue,
} from './local-automations';
import * as db from './local-db';
import type {
  Automation,
  AutomationMode,
  Action,
  Condition,
  ConditionBlock,
  Duration,
  Trigger,
  VirtualAccessoryDefinition,
  VirtualOperation,
} from '../automation/types/automation';

type AccessoryIndex = Awaited<ReturnType<typeof buildAccessoryIndex>>;

/**
 * Tell the running engine about a write. Imported at write time, not at module
 * load, for the same reason community-automation.ts defers its own targets: the
 * engine pulls in modules that reach through lib/config to `window`, which
 * doesn't exist when this module is loaded in a node test.
 */
async function reloadEngine(what: 'automations' | 'virtual'): Promise<void> {
  const m = await import('./community-automation');
  await (what === 'automations'
    ? m.reloadCommunityAutomations()
    : m.reloadCommunityVirtualAccessories());
}

/** Slug → id for the engine's own accessories, which HomeKit cannot see. */
interface VirtualIndex {
  slugToId: Record<string, string>;
  byId: Record<string, { slug: string; name: string; type: string }>;
}

const AUTOMATION_MODES: AutomationMode[] = ['single', 'restart', 'queued', 'parallel'];

/**
 * Friendly virtual-accessory type names ↔ the engine's internal ones.
 *
 * The engine inherited Home Assistant's `input_*` vocabulary. That is an
 * implementation detail an agent should never have to know, so the tools take
 * the same seven names the app's palette and docs use.
 */
const VIRTUAL_TYPE_TO_ENGINE: Record<string, VirtualAccessoryDefinition['type']> = {
  switch: 'input_boolean',
  mode: 'input_select',
  number: 'input_number',
  text: 'input_text',
  date: 'input_datetime',
  timer: 'timer',
  counter: 'counter',
};

/** Engine type → the friendly name the tools speak, for messages and errors. */
const ENGINE_TO_FRIENDLY: Record<string, string> = Object.fromEntries(
  Object.entries(VIRTUAL_TYPE_TO_ENGINE).map(([friendly, engine]) => [engine, friendly]),
);

const VIRTUAL_OPERATIONS: VirtualOperation[] = [
  'turn_on', 'turn_off', 'toggle', 'set', 'increment', 'decrement', 'reset',
  'start', 'pause', 'resume', 'cancel', 'finish',
];

function simpleToChar(prop: string): string {
  return SIMPLE_TO_CHAR[prop] || prop;
}

function charToSimple(charType: string): string {
  for (const [simple, char] of Object.entries(SIMPLE_TO_CHAR)) {
    if (char === charType) return simple;
  }
  return charType;
}

function newId(): string {
  return crypto.randomUUID();
}

/**
 * Accept a duration as a bare number of seconds or as {hours, minutes,
 * seconds} — an agent writing "for 10 minutes" should not have to guess which.
 */
function parseDuration(value: unknown, field: string): Duration {
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value < 0) throw new Error(`${field} must be a non-negative number of seconds`);
    return { seconds: value };
  }
  if (value && typeof value === 'object') {
    const d = value as Record<string, unknown>;
    const out: Duration = {};
    for (const unit of ['hours', 'minutes', 'seconds'] as const) {
      if (d[unit] !== undefined) {
        const n = Number(d[unit]);
        if (!Number.isFinite(n) || n < 0) throw new Error(`${field}.${unit} must be a non-negative number`);
        out[unit] = n;
      }
    }
    if (Object.keys(out).length === 0) throw new Error(`${field} needs at least one of hours, minutes, seconds`);
    return out;
  }
  throw new Error(`${field} must be a number of seconds or {hours, minutes, seconds}`);
}

/**
 * Coerce an initial value to what the accessory type actually stores.
 *
 * The cloud tool schema types `initial` as a string, so a switch can arrive as
 * "false" and a counter as "5" — and Boolean("false") is true while "5" is not a
 * number. Both would be stored wrong and silently: the accessory would look
 * created and behave incorrectly forever after. Mirrored in
 * homes_hc_automations.py::coerce_initial.
 */
function coerceInitial(value: unknown, engineType: string): unknown {
  if (value === undefined || value === null) return undefined;
  if (engineType === 'input_boolean') {
    if (typeof value === 'boolean') return value;
    const text = String(value).trim().toLowerCase();
    if (['true', 'on', 'yes', '1'].includes(text)) return true;
    if (['false', 'off', 'no', '0'].includes(text)) return false;
    throw new Error(`initial for a "switch" must be true or false (got "${value}")`);
  }
  if (engineType === 'input_number' || engineType === 'counter') {
    if (typeof value === 'number') return value;
    const n = Number(value);
    if (!Number.isFinite(n)) {
      const label = engineType === 'input_number' ? 'number' : 'counter';
      throw new Error(`initial for a "${label}" must be a number (got "${value}")`);
    }
    return n;
  }
  return String(value);
}

// --- Resolution ---

export async function buildVirtualIndex(homeId: string): Promise<VirtualIndex> {
  const rows = await db.getVirtualAccessories(homeId);
  const index: VirtualIndex = { slugToId: {}, byId: {} };
  for (const row of rows) {
    let def: VirtualAccessoryDefinition;
    try {
      def = JSON.parse(row.data) as VirtualAccessoryDefinition;
    } catch {
      continue;
    }
    const slug = uniqueKey(def.name || 'Unknown', def.id || '');
    index.slugToId[slug] = def.id;
    index.byId[def.id] = { slug, name: def.name, type: def.type };
  }
  return index;
}

export function resolveVirtual(index: VirtualIndex, ref: string): string {
  if (index.slugToId[ref]) return index.slugToId[ref];
  const refLower = ref.toLowerCase();
  for (const id of Object.values(index.slugToId)) {
    if (id.toLowerCase() === refLower) return id;
  }
  const matches = Object.keys(index.slugToId).filter((slug) => slug.includes(refLower));
  if (matches.length === 1) return index.slugToId[matches[0]];
  const available = Object.keys(index.slugToId);
  if (matches.length > 1) {
    throw new Error(`Ambiguous virtual accessory: ${ref}. Matches: [${matches.join(', ')}]`);
  }
  throw new Error(
    `Virtual accessory not found: ${ref}. Available: [${available.join(', ')}]. ` +
    'Create one with create_virtual_accessory.'
  );
}

async function resolveScene(homeId: string, ref: string): Promise<string> {
  const result = await executeHomeKitAction('scenes.list', { homeId }) as any;
  const scenes = result?.scenes || [];
  const refLower = ref.toLowerCase();
  const match = scenes.find((s: any) =>
    s.id === ref || String(s.id).toLowerCase() === refLower || String(s.name).toLowerCase() === refLower);
  if (match) return match.id;
  const available = scenes.map((s: any) => s.name);
  throw new Error(`Scene not found: ${ref}. Available: [${available.join(', ')}]`);
}

// --- Compile: flat MCP grammar → Automation ---

interface CompileContext {
  homeId: string;
  accessories: AccessoryIndex;
  virtuals: VirtualIndex;
}

function compileTrigger(raw: Record<string, any>, ctx: CompileContext): Trigger {
  let type = raw.type;
  const base = { id: newId() };

  // Conditions and actions both take `virtual` as a type of their own, so
  // agents reach for it on triggers too. It is not a shape of its own — it is a
  // device (or numeric, if a threshold came with it) trigger whose target is
  // engine-owned — but the request is unambiguous, so route it rather than
  // rejecting it.
  if (type === 'virtual') {
    const ref = raw.virtual || raw.accessory;
    if (!ref) throw new Error('virtual trigger requires "virtual"');
    raw = { ...raw, virtual: ref, accessory: undefined };
    type = raw.above !== undefined || raw.below !== undefined ? 'numeric' : 'device';
  }

  if (type === 'device' || type === 'numeric') {
    let prop = raw.characteristic || raw.characteristicType;
    const target: Record<string, unknown> = {};
    if (raw.service_group) {
      target.serviceGroupId = raw.service_group;
    } else {
      const ref = raw.accessory || raw.virtual;
      if (!ref) throw new Error(`${type} trigger requires "accessory", "virtual" or "service_group"`);
      if (raw.virtual) {
        // A virtual accessory carries exactly one characteristic, decided by
        // its type — a timer emits virtual_timer, a mode virtual_mode. Asking
        // the caller for it invited an answer like "value", which no accessory
        // ever emits: the trigger validated, stored, and could never fire.
        // Nobody finds that out until the thing it was guarding runs away.
        const id = resolveVirtual(ctx.virtuals, raw.virtual);
        const virtualType = ctx.virtuals.byId[id]?.type;
        const characteristic = virtualType ? VIRTUAL_CHARACTERISTIC[virtualType] : undefined;
        if (!characteristic) {
          throw new Error(`Unknown virtual accessory type for ${raw.virtual}: ${virtualType ?? 'missing'}`);
        }
        target.accessoryId = id;
        prop = characteristic;
      } else {
        target.accessoryId = resolveAccessory(ctx.accessories, ref);
      }
    }
    if (!prop) throw new Error(`${type} trigger requires "characteristic"`);

    if (type === 'numeric') {
      if (raw.above === undefined && raw.below === undefined) {
        throw new Error('numeric trigger requires "above" and/or "below"');
      }
      const trigger: Record<string, unknown> = {
        ...base, type: 'numeric_state', ...target, characteristicType: simpleToChar(prop),
      };
      if (raw.above !== undefined) trigger.above = Number(raw.above);
      if (raw.below !== undefined) trigger.below = Number(raw.below);
      if (raw.for !== undefined) trigger.for = parseDuration(raw.for, 'trigger.for');
      return trigger as unknown as Trigger;
    }

    const trigger: Record<string, unknown> = {
      ...base, type: 'state', ...target, characteristicType: simpleToChar(prop),
    };
    if (raw.to !== undefined) trigger.to = convertSimpleValue(prop, raw.to);
    if (raw.from !== undefined) trigger.from = convertSimpleValue(prop, raw.from);
    if (raw.for !== undefined) trigger.for = parseDuration(raw.for, 'trigger.for');
    return trigger as unknown as Trigger;
  }

  if (type === 'time') {
    if (!raw.at) throw new Error('time trigger requires "at" (HH:MM)');
    const trigger: Record<string, unknown> = { ...base, type: 'time', at: raw.at };
    if (raw.weekdays !== undefined) trigger.weekdays = raw.weekdays;
    return trigger as unknown as Trigger;
  }

  if (type === 'sun') {
    const event = raw.event;
    if (event !== 'sunrise' && event !== 'sunset') {
      throw new Error('sun trigger requires "event": "sunrise" or "sunset"');
    }
    const trigger: Record<string, unknown> = { ...base, type: 'sun', event };
    if (raw.offset !== undefined) trigger.offset = parseDuration(raw.offset, 'trigger.offset');
    return trigger as unknown as Trigger;
  }

  if (type === 'webhook') {
    const webhookId = raw.webhook_id || raw.webhookId;
    if (!webhookId) throw new Error('webhook trigger requires "webhook_id"');
    return { ...base, type: 'webhook', webhookId } as unknown as Trigger;
  }

  throw new Error(
    `Unsupported trigger type: ${type}. Supported: [device, numeric, virtual, time, sun, webhook]`
  );
}

function compileCondition(raw: Record<string, any>, ctx: CompileContext): Condition | ConditionBlock {
  // Nested block: {"operator": "or", "conditions": [...]}
  if (raw.operator) {
    const operator = String(raw.operator).toLowerCase();
    if (!['and', 'or', 'not'].includes(operator)) {
      throw new Error(`Unsupported condition operator: ${raw.operator}. Supported: [and, or, not]`);
    }
    const nested = Array.isArray(raw.conditions) ? raw.conditions : [];
    return {
      operator: operator as ConditionBlock['operator'],
      conditions: nested.map((c: Record<string, any>) => compileCondition(c, ctx)),
    };
  }

  const type = raw.type;
  const base = { id: newId() };

  if (type === 'device' || type === 'numeric') {
    const prop = raw.characteristic || raw.characteristicType;
    if (!prop) throw new Error(`${type} condition requires "characteristic"`);
    const ref = raw.accessory;
    if (!ref) throw new Error(`${type} condition requires "accessory"`);
    const accessoryId = resolveAccessory(ctx.accessories, ref);

    if (type === 'numeric') {
      if (raw.above === undefined && raw.below === undefined) {
        throw new Error('numeric condition requires "above" and/or "below"');
      }
      const cond: Record<string, unknown> = {
        ...base, type: 'numeric_state', accessoryId, characteristicType: simpleToChar(prop),
      };
      if (raw.above !== undefined) cond.above = Number(raw.above);
      if (raw.below !== undefined) cond.below = Number(raw.below);
      return cond as unknown as Condition;
    }

    if (raw.value === undefined) throw new Error('device condition requires "value"');
    return {
      ...base, type: 'state', accessoryId, characteristicType: simpleToChar(prop),
      value: convertSimpleValue(prop, raw.value),
    } as unknown as Condition;
  }

  // A virtual accessory is invisible to the state-based conditions, so it is
  // read through the expression layer — the same virtual('<id>') call the
  // visual editor emits.
  if (type === 'virtual') {
    const ref = raw.virtual || raw.accessory;
    if (!ref) throw new Error('virtual condition requires "virtual"');
    const id = resolveVirtual(ctx.virtuals, ref);
    if (raw.equals === undefined && raw.above === undefined && raw.below === undefined) {
      throw new Error('virtual condition requires "equals", "above" or "below"');
    }
    const parts: string[] = [];
    if (raw.equals !== undefined) parts.push(`virtual('${id}') == ${JSON.stringify(raw.equals)}`);
    if (raw.above !== undefined) parts.push(`virtual('${id}') > ${Number(raw.above)}`);
    if (raw.below !== undefined) parts.push(`virtual('${id}') < ${Number(raw.below)}`);
    return { ...base, type: 'template', expression: parts.join(' and ') } as unknown as Condition;
  }

  if (type === 'time') {
    const cond: Record<string, unknown> = { ...base, type: 'time' };
    if (raw.after !== undefined) cond.after = raw.after;
    if (raw.before !== undefined) cond.before = raw.before;
    if (raw.weekdays !== undefined) cond.weekdays = raw.weekdays;
    if (raw.after === undefined && raw.before === undefined && raw.weekdays === undefined) {
      throw new Error('time condition requires at least one of "after", "before", "weekdays"');
    }
    return cond as unknown as Condition;
  }

  if (type === 'sun') {
    const cond: Record<string, unknown> = { ...base, type: 'sun' };
    if (raw.after !== undefined) cond.after = raw.after;
    if (raw.before !== undefined) cond.before = raw.before;
    if (raw.after === undefined && raw.before === undefined) {
      throw new Error('sun condition requires "after" and/or "before" ("sunrise"/"sunset")');
    }
    return cond as unknown as Condition;
  }

  if (type === 'template') {
    if (!raw.expression) throw new Error('template condition requires "expression"');
    return { ...base, type: 'template', expression: raw.expression } as unknown as Condition;
  }

  throw new Error(
    `Unsupported condition type: ${type}. Supported: [device, numeric, virtual, time, sun, template]`
  );
}

/** Properties that are addressing, not values to write. */
const ACTION_RESERVED = new Set(['type', 'accessory', 'room', 'service_group', 'virtual',
  'operation', 'value', 'duration', 'step', 'scene', 'seconds', 'message', 'title', 'icon']);

async function compileAction(raw: Record<string, any>, ctx: CompileContext): Promise<Action[]> {
  const type = raw.type || (raw.accessory ? 'device' : undefined);
  const base = { id: newId() };

  if (type === 'device') {
    const props = Object.keys(raw).filter((k) => !ACTION_RESERVED.has(k));
    if (props.length === 0) {
      throw new Error('device action requires at least one property to set (e.g. on, brightness, cool_target)');
    }
    // One property per engine action: SetCharacteristicAction writes a single
    // characteristic, so {accessory, on, brightness} becomes two actions.
    if (raw.service_group) {
      return props.map((prop) => ({
        id: newId(), type: 'set_service_group', groupId: raw.service_group,
        characteristicType: simpleToChar(prop), value: convertSimpleValue(prop, raw[prop]),
        homeId: ctx.homeId,
      } as unknown as Action));
    }
    const accessoryId = resolveAccessory(ctx.accessories, raw.accessory);
    return props.map((prop) => ({
      id: newId(), type: 'set_characteristic', accessoryId,
      characteristicType: simpleToChar(prop), value: convertSimpleValue(prop, raw[prop]),
    } as unknown as Action));
  }

  if (type === 'virtual') {
    const ref = raw.virtual || raw.accessory;
    if (!ref) throw new Error('virtual action requires "virtual"');
    const operation = raw.operation || 'set';
    if (!VIRTUAL_OPERATIONS.includes(operation)) {
      throw new Error(`Unsupported virtual operation: ${operation}. Supported: [${VIRTUAL_OPERATIONS.join(', ')}]`);
    }
    if (operation === 'set' && raw.value === undefined) {
      throw new Error('virtual action with operation "set" requires "value"');
    }
    const action: Record<string, unknown> = {
      ...base, type: 'virtual', accessoryId: resolveVirtual(ctx.virtuals, ref), operation,
    };
    if (raw.value !== undefined) action.value = raw.value;
    if (raw.duration !== undefined) action.duration = parseDuration(raw.duration, 'action.duration');
    if (raw.step !== undefined) action.step = Number(raw.step);
    return [action as unknown as Action];
  }

  if (type === 'scene') {
    const ref = raw.scene;
    if (!ref) throw new Error('scene action requires "scene"');
    return [{
      ...base, type: 'execute_scene', sceneId: await resolveScene(ctx.homeId, ref), homeId: ctx.homeId,
    } as unknown as Action];
  }

  if (type === 'delay') {
    const source = raw.duration !== undefined ? raw.duration : raw.seconds;
    if (source === undefined) throw new Error('delay action requires "seconds" or "duration"');
    return [{ ...base, type: 'delay', duration: parseDuration(source, 'action.duration') } as unknown as Action];
  }

  if (type === 'notify') {
    if (!raw.message) throw new Error('notify action requires "message"');
    const action: Record<string, unknown> = { ...base, type: 'notify', message: raw.message };
    if (raw.title !== undefined) action.title = raw.title;
    if (raw.icon !== undefined) action.icon = raw.icon;
    return [action as unknown as Action];
  }

  throw new Error(
    `Unsupported action type: ${type}. Supported: [device, virtual, scene, delay, notify]`
  );
}

export async function buildCompileContext(homeId: string): Promise<CompileContext> {
  return {
    homeId,
    accessories: await buildAccessoryIndex(homeId),
    virtuals: await buildVirtualIndex(homeId),
  };
}

export function compileConditionBlock(
  raw: Record<string, any>[], ctx: CompileContext,
): ConditionBlock {
  return { operator: 'and', conditions: raw.map((c) => compileCondition(c, ctx)) };
}

export async function compileActions(
  raw: Record<string, any>[], ctx: CompileContext,
): Promise<Action[]> {
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new Error('At least one action is required');
  }
  const actions: Action[] = [];
  for (const one of raw) {
    actions.push(...await compileAction(one, ctx));
  }
  return actions;
}

export function compileTriggers(raw: Record<string, any>[], ctx: CompileContext): Trigger[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new Error('At least one trigger is required');
  }
  return raw.map((t) => compileTrigger(t, ctx));
}

function validateMode(mode?: string): void {
  if (mode && !AUTOMATION_MODES.includes(mode as AutomationMode)) {
    throw new Error(`Unsupported mode: ${mode}. Supported: [${AUTOMATION_MODES.join(', ')}]`);
  }
}

export async function compileAutomation(args: {
  homeId: string;
  name: string;
  triggers: Record<string, any>[];
  conditions?: Record<string, any>[];
  actions: Record<string, any>[];
  enabled?: boolean;
  mode?: string;
  description?: string;
  existing?: Automation;
}): Promise<Automation> {
  const ctx = await buildCompileContext(args.homeId);
  validateMode(args.mode);

  const triggers = compileTriggers(args.triggers, ctx);
  const actions = await compileActions(args.actions, ctx);

  const now = new Date().toISOString();
  return {
    id: args.existing?.id ?? newId(),
    name: args.name,
    description: args.description ?? args.existing?.description,
    homeId: args.homeId,
    enabled: args.enabled ?? args.existing?.enabled ?? true,
    mode: (args.mode as AutomationMode) ?? args.existing?.mode ?? 'single',
    triggers,
    conditions: compileConditionBlock(args.conditions ?? [], ctx),
    actions,
    metadata: {
      createdAt: args.existing?.metadata?.createdAt ?? now,
      updatedAt: now,
      lastTriggeredAt: args.existing?.metadata?.lastTriggeredAt,
      triggerCount: args.existing?.metadata?.triggerCount ?? 0,
    },
    // No uiState: automationToGraph lays out MCP-authored automations, and
    // preserving a stale layout across an edit would strand renamed nodes.
    uiState: undefined,
  };
}

// --- Decompile: Automation → flat MCP grammar (for get_hc_automations) ---

/**
 * Best-effort reverse of the compiler. Anything built in the visual editor can
 * use nodes this grammar has no words for; rather than lie about it we return
 * what we can read and set `editable_via_mcp: false`, mirroring the `editable`
 * flag the HomeKit automation tools use for presence/location triggers.
 */
function describeAutomation(automation: Automation, ctx: {
  accessories: AccessoryIndex;
  virtuals: VirtualIndex;
}): Record<string, unknown> {
  let complete = true;
  const slugFor = (id: string): string => ctx.accessories.byId[id]?.slug
    ?? ctx.virtuals.byId[id]?.slug
    ?? id;

  const triggers = (automation.triggers ?? []).map((t: any) => {
    if (t.type === 'state' || t.type === 'numeric_state') {
      const out: Record<string, unknown> = {
        type: t.type === 'numeric_state' ? 'numeric' : 'device',
        characteristic: charToSimple(t.characteristicType),
      };
      if (t.serviceGroupId) out.service_group = t.serviceGroupId;
      else if (t.accessoryId && ctx.virtuals.byId[t.accessoryId]) out.virtual = slugFor(t.accessoryId);
      else if (t.accessoryId) out.accessory = slugFor(t.accessoryId);
      for (const k of ['to', 'from', 'above', 'below', 'for']) {
        if (t[k] !== undefined) out[k] = t[k];
      }
      return out;
    }
    if (t.type === 'time') {
      const out: Record<string, unknown> = { type: 'time', at: t.at };
      if (t.weekdays) out.weekdays = t.weekdays;
      return out;
    }
    if (t.type === 'sun') {
      const out: Record<string, unknown> = { type: 'sun', event: t.event };
      if (t.offset) out.offset = t.offset;
      return out;
    }
    if (t.type === 'webhook') return { type: 'webhook', webhook_id: t.webhookId };
    complete = false;
    return { type: t.type, _unsupported: true };
  });

  const describeCondition = (c: any): Record<string, unknown> => {
    if (c.operator) {
      return { operator: c.operator, conditions: (c.conditions ?? []).map(describeCondition) };
    }
    if (c.type === 'state' || c.type === 'numeric_state') {
      const out: Record<string, unknown> = {
        type: c.type === 'numeric_state' ? 'numeric' : 'device',
        accessory: slugFor(c.accessoryId),
        characteristic: charToSimple(c.characteristicType),
      };
      for (const k of ['value', 'above', 'below']) if (c[k] !== undefined) out[k] = c[k];
      return out;
    }
    if (c.type === 'time' || c.type === 'sun') {
      const out: Record<string, unknown> = { type: c.type };
      for (const k of ['after', 'before', 'weekdays']) if (c[k] !== undefined) out[k] = c[k];
      return out;
    }
    if (c.type === 'template') return { type: 'template', expression: c.expression };
    complete = false;
    return { type: c.type, _unsupported: true };
  };

  const actions = (automation.actions ?? []).map((a: any) => {
    if (a.type === 'set_characteristic') {
      return {
        type: 'device', accessory: slugFor(a.accessoryId),
        [charToSimple(a.characteristicType)]: a.value,
      };
    }
    if (a.type === 'set_service_group') {
      return {
        type: 'device', service_group: a.groupId,
        [charToSimple(a.characteristicType)]: a.value,
      };
    }
    if (a.type === 'virtual') {
      const out: Record<string, unknown> = {
        type: 'virtual', virtual: slugFor(a.accessoryId), operation: a.operation,
      };
      for (const k of ['value', 'duration', 'step']) if (a[k] !== undefined) out[k] = a[k];
      return out;
    }
    if (a.type === 'execute_scene') return { type: 'scene', scene: a.sceneId };
    if (a.type === 'delay') return { type: 'delay', duration: a.duration };
    if (a.type === 'notify') {
      const out: Record<string, unknown> = { type: 'notify', message: a.message };
      if (a.title !== undefined) out.title = a.title;
      return out;
    }
    complete = false;
    return { type: a.type, _unsupported: true };
  });

  const conditions = (automation.conditions?.conditions ?? []).map(describeCondition);

  return {
    id: automation.id,
    name: automation.name,
    description: automation.description,
    enabled: automation.enabled,
    mode: automation.mode,
    triggers,
    conditions,
    actions,
    last_triggered: automation.metadata?.lastTriggeredAt ?? null,
    trigger_count: automation.metadata?.triggerCount ?? 0,
    editable_via_mcp: complete,
  };
}

// --- Handlers ---

export async function handleGetHcAutomations(filterByHome?: string): Promise<Record<string, any>> {
  const homesResult = await executeHomeKitAction('homes.list') as any;
  const homes = homesResult?.homes || [];
  const filter = filterByHome?.toLowerCase();

  const out: Record<string, any> = {};
  let total = 0;
  for (const home of homes) {
    const key = uniqueKey(home.name, home.id);
    if (filter && !key.toLowerCase().includes(filter) && !String(home.name).toLowerCase().includes(filter)) {
      continue;
    }
    const rows = await db.getHcAutomations(home.id);
    const ctx = {
      accessories: await buildAccessoryIndex(home.id),
      virtuals: await buildVirtualIndex(home.id),
    };
    const automations: Record<string, unknown>[] = [];
    for (const row of rows) {
      try {
        automations.push(describeAutomation(JSON.parse(row.data) as Automation, ctx));
      } catch {
        // A corrupt row shouldn't hide the rest of the home's automations.
      }
    }
    out[key] = automations;
    total += automations.length;
  }

  out._meta = {
    message: `Found ${total} Homecast automation${total === 1 ? '' : 's'}`,
    engine: 'homecast',
    note: 'These run in the Homecast engine on the relay Mac. HomeKit-native automations are separate — use get_automations for those.',
  };
  return out;
}

export async function handleCreateHcAutomation(args: {
  home: string;
  name: string;
  triggers: Record<string, any>[];
  conditions?: Record<string, any>[];
  actions: Record<string, any>[];
  enabled?: boolean;
  mode?: string;
  description?: string;
}): Promise<Record<string, any>> {
  const { homeId, homeKey } = await resolveHome(args.home);
  if (!args.name || !args.name.trim()) throw new Error('Automation name is required');

  const automation = await compileAutomation({ ...args, homeId });
  await db.saveHcAutomation(homeId, automation.id, JSON.stringify(automation));
  await reloadEngine('automations');

  return {
    home: homeKey,
    automation: { id: automation.id, name: automation.name, enabled: automation.enabled },
    message: `Created Homecast automation "${automation.name}". It runs in the Homecast engine on the relay Mac and is editable in the app's automation editor.`,
  };
}

export async function handleUpdateHcAutomation(args: {
  home: string;
  id: string;
  name?: string;
  triggers?: Record<string, any>[];
  conditions?: Record<string, any>[];
  actions?: Record<string, any>[];
  enabled?: boolean;
  mode?: string;
  description?: string;
}): Promise<Record<string, any>> {
  const { homeId, homeKey } = await resolveHome(args.home);
  const rows = await db.getHcAutomations(homeId);
  const row = rows.find((r) => r.id === args.id);
  if (!row) {
    throw new Error(`Homecast automation not found: ${args.id}. Use get_hc_automations to list them.`);
  }
  const existing = JSON.parse(row.data) as Automation;
  validateMode(args.mode);

  // Every part is optional and merged independently against what is already
  // stored. Compiling the whole automation from the arguments instead would
  // mean "change just the actions" arrived with no triggers — which reads as an
  // automation with none, and used to fail outright — and an omitted
  // `conditions` would silently delete the conditions the automation had.
  // Only what the caller actually sent is recompiled.
  const needsContext = Boolean(args.triggers || args.conditions || args.actions);
  const ctx = needsContext ? await buildCompileContext(homeId) : null;

  const automation: Automation = {
    ...existing,
    name: args.name ?? existing.name,
    description: args.description ?? existing.description,
    enabled: args.enabled ?? existing.enabled,
    mode: (args.mode as AutomationMode) ?? existing.mode,
    triggers: args.triggers ? compileTriggers(args.triggers, ctx!) : existing.triggers,
    conditions: args.conditions
      ? compileConditionBlock(args.conditions, ctx!)
      : existing.conditions,
    actions: args.actions ? await compileActions(args.actions, ctx!) : existing.actions,
    metadata: { ...existing.metadata, updatedAt: new Date().toISOString() },
  };

  await db.saveHcAutomation(homeId, automation.id, JSON.stringify(automation));
  await reloadEngine('automations');

  return {
    home: homeKey,
    automation: { id: automation.id, name: automation.name, enabled: automation.enabled },
    message: `Updated Homecast automation "${automation.name}".`,
  };
}

export async function handleDeleteHcAutomation(args: {
  home: string;
  id: string;
}): Promise<Record<string, any>> {
  const { homeId, homeKey } = await resolveHome(args.home);
  const rows = await db.getHcAutomations(homeId);
  const row = rows.find((r) => r.id === args.id);
  if (!row) {
    throw new Error(`Homecast automation not found: ${args.id}. Use get_hc_automations to list them.`);
  }
  const name = (() => {
    try { return (JSON.parse(row.data) as Automation).name; } catch { return args.id; }
  })();

  await db.deleteHcAutomation(args.id);
  await reloadEngine('automations');

  return { home: homeKey, deleted: args.id, message: `Deleted Homecast automation "${name}".` };
}

export async function handleCreateVirtualAccessory(args: {
  home: string;
  name: string;
  type: string;
  options?: string[];
  initial?: unknown;
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  duration?: unknown;
  controllable?: boolean;
  icon?: string;
}): Promise<Record<string, any>> {
  const { homeId, homeKey } = await resolveHome(args.home);
  if (!args.name || !args.name.trim()) throw new Error('Virtual accessory name is required');

  const engineType = VIRTUAL_TYPE_TO_ENGINE[args.type];
  if (!engineType) {
    throw new Error(
      `Unsupported virtual accessory type: ${args.type}. ` +
      `Supported: [${Object.keys(VIRTUAL_TYPE_TO_ENGINE).join(', ')}]`
    );
  }

  const def: Record<string, unknown> = {
    id: newId(),
    name: args.name.trim(),
    homeId,
    type: engineType,
  };
  if (args.icon !== undefined) def.icon = args.icon;
  if (args.controllable !== undefined) def.controllable = args.controllable;

  if (engineType === 'input_select') {
    if (!Array.isArray(args.options) || args.options.length === 0) {
      throw new Error('A "mode" virtual accessory requires "options" (e.g. ["Idle", "Running"])');
    }
    def.options = args.options;
    if (args.initial !== undefined && !args.options.includes(String(args.initial))) {
      // Starting outside the option list leaves a mode no control can reach —
      // a condition comparing against it can never pass.
      throw new Error(
        `initial "${args.initial}" is not one of the options [${args.options.join(', ')}]`
      );
    }
    def.initialValue = args.initial ?? args.options[0];
  } else if (engineType === 'input_number') {
    if (args.min === undefined || args.max === undefined) {
      throw new Error('A "number" virtual accessory requires "min" and "max"');
    }
    def.min = Number(args.min);
    def.max = Number(args.max);
    def.step = args.step === undefined ? 1 : Number(args.step);
    if (args.unit !== undefined) def.unit = args.unit;
    if (args.initial !== undefined) def.initialValue = coerceInitial(args.initial, engineType);
  } else if (engineType === 'counter') {
    if (args.initial !== undefined) def.initial = coerceInitial(args.initial, engineType);
    if (args.step !== undefined) def.step = Number(args.step);
    if (args.min !== undefined) def.min = Number(args.min);
    if (args.max !== undefined) def.max = Number(args.max);
  } else if (engineType === 'timer') {
    if (args.duration !== undefined) def.duration = parseDuration(args.duration, 'duration');
  } else if (engineType === 'input_boolean') {
    if (args.initial !== undefined) def.initialValue = coerceInitial(args.initial, engineType);
  } else if (engineType === 'input_text') {
    if (args.initial !== undefined) def.initialValue = String(args.initial);
  } else if (engineType === 'input_datetime') {
    // Both halves unless the caller narrows it — a bare date and a bare time
    // are both useful, and guessing wrong makes the control unusable.
    def.hasDate = true;
    def.hasTime = true;
    if (args.initial !== undefined) def.initialValue = String(args.initial);
  }

  await db.saveVirtualAccessory(homeId, def.id as string, JSON.stringify(def));
  await reloadEngine('virtual');

  return {
    home: homeKey,
    virtual_accessory: {
      id: def.id,
      slug: uniqueKey(def.name as string, def.id as string),
      name: def.name,
      type: args.type,
    },
    message:
      `Created virtual accessory "${def.name}". Reference it in Homecast automations by this slug ` +
      '(create_hc_automation) and read its value with get_state. HomeKit cannot see it, so it will ' +
      'not work in a HomeKit automation.',
  };
}

export async function handleUpdateVirtualAccessory(args: {
  home: string;
  id: string;
  name?: string;
  options?: string[];
  initial?: unknown;
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  duration?: unknown;
  controllable?: boolean;
  icon?: string;
}): Promise<Record<string, any>> {
  const { homeId, homeKey } = await resolveHome(args.home);
  const index = await buildVirtualIndex(homeId);
  const id = resolveVirtual(index, args.id);

  const rows = await db.getVirtualAccessories(homeId);
  const row = rows.find((r) => r.id === id);
  if (!row) throw new Error(`Virtual accessory not found: ${args.id}`);
  const def = JSON.parse(row.data) as Record<string, any>;
  const engineType = def.type as string;

  if (args.name !== undefined) {
    if (!args.name.trim()) throw new Error('Virtual accessory name cannot be empty');
    def.name = args.name.trim();
  }
  if (args.icon !== undefined) def.icon = args.icon;
  if (args.controllable !== undefined) def.controllable = args.controllable;
  if (args.unit !== undefined) def.unit = args.unit;
  if (args.step !== undefined) def.step = Number(args.step);
  if (args.min !== undefined) def.min = Number(args.min);
  if (args.max !== undefined) def.max = Number(args.max);
  if (args.duration !== undefined) def.duration = parseDuration(args.duration, 'duration');

  if (args.options !== undefined) {
    if (engineType !== 'input_select') {
      throw new Error(`"options" only applies to a "mode" virtual accessory (this one is ${ENGINE_TO_FRIENDLY[engineType] ?? engineType})`);
    }
    if (!Array.isArray(args.options) || args.options.length === 0) {
      throw new Error('"options" must be a non-empty list');
    }
    def.options = args.options;
    // Dropping the option it currently starts on would leave a value no
    // control can select and no condition can match.
    if (def.initialValue !== undefined && !args.options.includes(String(def.initialValue))) {
      def.initialValue = args.options[0];
    }
  }

  if (args.initial !== undefined) {
    if (engineType === 'input_select') {
      const options: string[] = def.options ?? [];
      if (!options.includes(String(args.initial))) {
        throw new Error(
          `initial "${args.initial}" is not one of the options [${options.join(', ')}]`
        );
      }
      def.initialValue = args.initial;
    } else if (engineType === 'counter') {
      def.initial = coerceInitial(args.initial, engineType);
    } else {
      def.initialValue = coerceInitial(args.initial, engineType);
    }
  }

  await db.saveVirtualAccessory(homeId, id, JSON.stringify(def));
  await reloadEngine('virtual');

  return {
    home: homeKey,
    virtual_accessory: {
      id,
      slug: uniqueKey(def.name, id),
      name: def.name,
      type: ENGINE_TO_FRIENDLY[engineType] ?? engineType,
    },
    message:
      `Updated virtual accessory "${def.name}". Its current value is unchanged — ` +
      'use set_state to change that.',
  };
}

export async function handleDeleteVirtualAccessory(args: {
  home: string;
  id: string;
}): Promise<Record<string, any>> {
  const { homeId, homeKey } = await resolveHome(args.home);
  const index = await buildVirtualIndex(homeId);
  const id = resolveVirtual(index, args.id);
  const name = index.byId[id]?.name ?? id;

  await db.deleteVirtualAccessory(id);
  await reloadEngine('virtual');

  return {
    home: homeKey,
    deleted: id,
    message:
      `Deleted virtual accessory "${name}". Any automation still referencing it will fail to ` +
      'resolve it — check get_hc_automations.',
  };
}
