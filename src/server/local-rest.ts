/**
 * Community mode: REST API endpoints.
 * Same interface as the cloud REST API.
 */

import { executeHomeKitAction } from '../relay/local-handler';
import { communityRequest } from './connection';
import { verifyTokenFull } from './local-auth';

interface HTTPRequest {
  method: string;
  path: string;
  body?: string;
  authorization?: string;
}

export async function handleREST(req: HTTPRequest): Promise<unknown> {
  const { method, path } = req;
  // Parse query params from path
  const [cleanPath, queryString] = path.split('?');
  const params = new URLSearchParams(queryString || '');

  // Strip /rest prefix
  const route = cleanPath.replace(/^\/rest/, '');

  try {
    switch (true) {
      // GET /rest/homes
      case method === 'GET' && route === '/homes': {
        const result = await executeHomeKitAction('homes.list') as any;
        return result?.homes || [];
      }

      // GET /rest/state?home=X&room=X&type=X&name=X
      case method === 'GET' && (route === '/state' || route === ''): {
        return getState(params, req.authorization);
      }

      // GET /rest/accessories?home=X&room=X&type=X&name=X
      case method === 'GET' && route === '/accessories': {
        const payload: Record<string, unknown> = { includeValues: true, includeAll: true };
        if (params.get('home')) payload.homeId = params.get('home');
        if (params.get('room')) payload.roomId = params.get('room');
        const result = await executeHomeKitAction('accessories.list', payload) as any;
        let accessories = result?.accessories || [];
        // Filter by type/name if specified
        const typeFilter = params.get('type');
        const nameFilter = params.get('name');
        if (typeFilter) accessories = accessories.filter((a: any) => a.category?.toLowerCase() === typeFilter.toLowerCase());
        if (nameFilter) accessories = accessories.filter((a: any) => a.name?.toLowerCase().includes(nameFilter.toLowerCase()));
        return accessories;
      }

      // GET /rest/accessories/:id
      case method === 'GET' && route.startsWith('/accessories/'): {
        const accessoryId = route.replace('/accessories/', '');
        const result = await executeHomeKitAction('accessory.get', { accessoryId }) as any;
        return result?.accessory || null;
      }

      // POST /rest/state
      case method === 'POST' && route === '/state': {
        if (!req.body) return { error: 'Missing body' };
        const body = JSON.parse(req.body);

        // Community format: { state: { ... }, homeId: "..." }
        if ('state' in body) {
          const state = body.state;
          const homeId = body.homeId || body.home_id;
          await communityRequest('state.set', { state, homeId });
          return { success: true };
        }

        // Cloud format: { home_key: { room_key: { acc_key: { on: true } } } }
        // Resolve home slug keys to HomeKit UUIDs, pass room dict to setState
        const homesResult = await executeHomeKitAction('homes.list') as any;
        const homes = homesResult?.homes || [];
        const homeKeyToId: Record<string, string> = {};
        for (const home of homes) {
          homeKeyToId[uniqueKey(home.name, home.id)] = home.id;
        }

        let updated = 0;
        let failed = 0;
        const changes: string[] = [];
        const errors: string[] = [];

        for (const [homeKey, homeData] of Object.entries(body)) {
          if (homeKey.startsWith('_') || !homeData || typeof homeData !== 'object') continue;
          const homeId = homeKeyToId[homeKey];
          if (!homeId) { errors.push(`${homeKey}: home not found`); failed++; continue; }

          try {
            await communityRequest('state.set', { state: homeData, homeId });
            for (const [roomKey, roomData] of Object.entries(homeData as Record<string, any>)) {
              if (typeof roomData !== 'object' || roomData === null) continue;
              for (const [accKey, props] of Object.entries(roomData as Record<string, any>)) {
                if (typeof props !== 'object' || props === null) continue;
                updated++;
                const propList = Object.entries(props).filter(([k]) => k !== 'type' && k !== '_settable').map(([k, v]) => `${k}=${v}`).join(', ');
                changes.push(`${homeKey}/${roomKey}/${accKey}: ${propList}`);
              }
            }
          } catch (e: any) {
            errors.push(`${homeKey}: ${e.message}`);
            failed++;
          }
        }

        return { updated, failed, changes, errors, message: updated > 0 ? `Updated ${updated} accessor${updated === 1 ? 'y' : 'ies'}` : 'No updates' };
      }

      // GET /rest/history?accessory=X&home=X&characteristic=X&hours=24&max_points=200
      case method === 'GET' && route === '/history': {
        return handleGetHistory({
          home: params.get('home') || undefined,
          accessory: params.get('accessory') || '',
          characteristic: params.get('characteristic') || undefined,
          hours: params.get('hours') ? Number(params.get('hours')) : undefined,
          max_points: params.get('max_points') ? Number(params.get('max_points')) : undefined,
        });
      }

      // GET /rest/scenes?home=X
      case method === 'GET' && route === '/scenes': {
        const homeId = params.get('home');
        if (!homeId) return { error: 'home parameter required' };
        const result = await executeHomeKitAction('scenes.list', { homeId }) as any;
        return result?.scenes || [];
      }

      // POST /rest/scenes — create a scene {homeId, name, actions}
      case method === 'POST' && route === '/scenes': {
        if (!req.body) return { error: 'Missing body' };
        const body = JSON.parse(req.body);
        return await executeHomeKitAction('scene.create', body);
      }

      // PATCH /rest/scenes/:id — update a scene {name?, actions?}
      case method === 'PATCH' && route.startsWith('/scenes/'): {
        const sceneId = route.replace('/scenes/', '');
        if (!req.body) return { error: 'Missing body' };
        const body = JSON.parse(req.body);
        return await executeHomeKitAction('scene.update', { sceneId, ...body });
      }

      // DELETE /rest/scenes/:id
      case method === 'DELETE' && route.startsWith('/scenes/'): {
        const sceneId = route.replace('/scenes/', '');
        return await executeHomeKitAction('scene.delete', { sceneId });
      }

      // POST /rest/scenes/:id/execute
      case method === 'POST' && route.match(/^\/scenes\/[^/]+\/execute$/): {
        const sceneId = route.split('/')[2];
        await executeHomeKitAction('scene.execute', { sceneId });
        return { success: true };
      }

      // POST /rest/scene — execute scene by home key + name (cloud-compatible)
      case method === 'POST' && route === '/scene': {
        if (!req.body) return { error: 'Missing body' };
        const body = JSON.parse(req.body);
        const homeKey = body.home;
        const sceneName = body.name;
        if (!homeKey || !sceneName) {
          return { error: "Both 'home' and 'name' are required" };
        }

        // Resolve home slug key to UUID
        const homesResult = await executeHomeKitAction('homes.list') as any;
        const homes = homesResult?.homes || [];
        const homeKeyToId: Record<string, string> = {};
        for (const home of homes) {
          homeKeyToId[uniqueKey(home.name, home.id)] = home.id;
        }

        const homeId = homeKeyToId[homeKey];
        if (!homeId) {
          return { error: `Home not found: ${homeKey}` };
        }

        // Get scenes and find by name
        const scenesResult = await executeHomeKitAction('scenes.list', { homeId }) as any;
        const scenes = scenesResult?.scenes || [];
        const scene = scenes.find((s: any) => (s.name || '').toLowerCase() === sceneName.toLowerCase());
        if (!scene) {
          const available = scenes.map((s: any) => s.name);
          return { error: `Scene '${sceneName}' not found. Available: ${JSON.stringify(available)}` };
        }

        await executeHomeKitAction('scene.execute', { sceneId: scene.id });
        return { success: true };
      }

      // GET /rest/rooms?home=X
      case method === 'GET' && route === '/rooms': {
        const homeId = params.get('home');
        if (!homeId) return { error: 'home parameter required' };
        const result = await executeHomeKitAction('rooms.list', { homeId }) as any;
        return result?.rooms || [];
      }

      default:
        return { error: 'Not found', path: route };
    }
  } catch (e: any) {
    return { error: e.message || 'Internal error' };
  }
}

// --- GET /rest/state — simplified, AI-friendly state representation ---

// Characteristic type → simple name mapping (matches cloud server)
export const CHAR_TO_SIMPLE: Record<string, string> = {
  on: 'on', power_state: 'on', active: 'active', status_active: 'status_active',
  brightness: 'brightness', hue: 'hue', saturation: 'saturation', color_temperature: 'color_temp',
  current_temperature: 'current_temp', heating_threshold: 'heat_target',
  cooling_threshold: 'cool_target', target_temperature: 'target_temp',
  lock_current_state: 'locked', lock_target_state: 'lock_target',
  security_system_current_state: 'alarm_state', security_system_target_state: 'alarm_target',
  motion_detected: 'motion', contact_state: 'contact',
  battery_level: 'battery', status_low_battery: 'low_battery',
  volume: 'volume', mute: 'mute',
};

export const UUID_TO_SIMPLE: Record<string, string> = {
  '000000b1-0000-1000-8000-0026bb765291': 'hvac_state',
  '000000b2-0000-1000-8000-0026bb765291': 'hvac_mode',
};

const SKIP_SERVICES = new Set(['accessory_information', 'battery', 'label']);
const SKIP_CHARS = new Set(['name', 'manufacturer', 'model', 'serial_number', 'firmware_revision', 'hardware_revision', 'identify']);

// Re-exported so every existing importer (and the parity test) keeps working;
// the definition lives in lib/slug so the relay can use it without pulling this
// module's whole dependency graph in.
import { sanitizeName, uniqueKey } from '@/lib/slug';
export { sanitizeName, uniqueKey };

export function getSimpleName(charType: string): string | null {
  if (CHAR_TO_SIMPLE[charType]) return CHAR_TO_SIMPLE[charType];
  if (UUID_TO_SIMPLE[charType.toLowerCase()]) return UUID_TO_SIMPLE[charType.toLowerCase()];
  if (SKIP_CHARS.has(charType)) return null;
  if (charType.includes('-') && charType.length > 20) return null;
  return charType;
}

export function formatValue(value: any, simpleName: string): any {
  if (value == null) return null;
  if (simpleName === 'alarm_state') {
    const states: Record<number, string> = { 0: 'home', 1: 'away', 2: 'night', 3: 'off', 4: 'triggered' };
    return states[Number(value)] ?? `unknown_${value}`;
  }
  if (simpleName === 'alarm_target') {
    const states: Record<number, string> = { 0: 'home', 1: 'away', 2: 'night', 3: 'off' };
    return states[Number(value)] ?? `unknown_${value}`;
  }
  if (simpleName === 'hvac_state') {
    const states: Record<number, string> = { 0: 'inactive', 1: 'idle', 2: 'heating', 3: 'cooling' };
    return states[Number(value)] ?? `unknown_${value}`;
  }
  if (simpleName === 'hvac_mode') {
    const states: Record<number, string> = { 0: 'auto', 1: 'heat', 2: 'cool' };
    return states[Number(value)] ?? `unknown_${value}`;
  }
  if (simpleName === 'locked') return value === 1 || value === true;
  if (['on', 'active', 'motion', 'mute', 'low_battery'].includes(simpleName)) return Boolean(value);
  if (['brightness', 'battery', 'volume'].includes(simpleName)) return Math.round(Number(value));
  if (simpleName.includes('temp') || ['heat_target', 'cool_target'].includes(simpleName)) {
    return Math.round(Number(value) * 10) / 10;
  }
  return value;
}

function getDeviceType(accessory: any): string {
  const services = (accessory.services || []).map((s: any) => (s.serviceType || '').toLowerCase());
  const category = (accessory.category || '').toLowerCase();
  if (services.includes('lightbulb')) return 'light';
  if (services.includes('switch')) return 'switch';
  if (services.includes('outlet')) return 'outlet';
  if (services.includes('heater_cooler') || services.includes('thermostat')) return 'climate';
  if (services.includes('lock')) return 'lock';
  if (services.includes('security_system')) return 'alarm';
  if (services.includes('motion_sensor')) return 'motion';
  if (services.includes('contact_sensor')) return 'contact';
  if (services.includes('temperature_sensor')) return 'temperature';
  if (services.includes('fan') || services.includes('fanv2')) return 'fan';
  if (services.includes('window_covering')) return 'blind';
  if (services.includes('valve')) return 'valve';
  if (services.includes('speaker') || services.includes('microphone')) return 'speaker';
  if (services.includes('light_sensor')) return 'light_sensor';
  if (services.includes('doorbell')) return 'doorbell';
  if (services.includes('stateless_programmable_switch')) return 'button';
  if (category.includes('light')) return 'light';
  if (category.includes('thermostat')) return 'climate';
  if (category.includes('lock')) return 'lock';
  if (category.includes('outlet')) return 'outlet';
  if (category.includes('switch')) return 'switch';
  return 'other';
}

function simplifyAccessory(accessory: any): Record<string, any> {
  const result: Record<string, any> = { type: getDeviceType(accessory) };
  const settable: string[] = [];

  for (const service of accessory.services || []) {
    if (SKIP_SERVICES.has((service.serviceType || '').toLowerCase())) continue;
    for (const char of service.characteristics || []) {
      const simpleName = getSimpleName(char.characteristicType || '');
      if (!simpleName) continue;
      const formatted = formatValue(char.value, simpleName);
      if (formatted != null) {
        result[simpleName] = formatted;
        if (char.isWritable && !settable.includes(simpleName)) settable.push(simpleName);
      }
    }
  }

  if (settable.length > 0) result._settable = settable;
  return result;
}

async function getState(params: URLSearchParams, authorization?: string): Promise<Record<string, any>> {
  const homeFilter = params.get('home')?.toLowerCase() || null;
  const roomFilter = params.get('room')?.toLowerCase() || null;
  const typeFilter = params.get('type')?.toLowerCase() || null;
  const nameFilter = params.get('name')?.toLowerCase() || null;

  // Extract home_permissions from OAuth token (if present)
  let allowedHomeIds: Set<string> | null = null;
  if (authorization) {
    const token = authorization.replace(/^Bearer\s+/i, '');
    if (token && !token.startsWith('hc_')) {
      const payload = await verifyTokenFull(token);
      if (payload?.home_permissions && typeof payload.home_permissions === 'object' && Object.keys(payload.home_permissions).length > 0) {
        allowedHomeIds = new Set(Object.keys(payload.home_permissions as Record<string, string>));
      }
    }
  }

  // Get all homes
  const homesResult = await executeHomeKitAction('homes.list') as any;
  let homes = homesResult?.homes || [];

  // Filter by OAuth home permissions
  if (allowedHomeIds) {
    homes = homes.filter((h: any) => allowedHomeIds!.has(h.id));
  }

  const result: Record<string, any> = {};

  for (const home of homes) {
    const homeKey = uniqueKey(home.name, home.id);
    if (homeFilter && !homeKey.includes(homeFilter)) continue;

    // Get accessories for this home
    const accResult = await executeHomeKitAction('accessories.list', { homeId: home.id, includeValues: true }) as any;
    const accessories = accResult?.accessories || [];

    // Get scenes
    const scenesResult = await executeHomeKitAction('scenes.list', { homeId: home.id }) as any;
    const scenes = scenesResult?.scenes || [];

    // Get service groups
    const groupsResult = await executeHomeKitAction('serviceGroups.list', { homeId: home.id }) as any;
    const groups = groupsResult?.serviceGroups || [];

    const homeData: Record<string, any> = {};
    const accessoryById: Record<string, any> = {};
    for (const acc of accessories) accessoryById[acc.id] = acc;

    for (const acc of accessories) {
      const roomName = acc.roomName || 'Unknown';
      const roomId = acc.roomId || '';
      const roomKey = uniqueKey(roomName, roomId);
      const accKey = uniqueKey(acc.name || 'Unknown', acc.id || '');
      const simplified = simplifyAccessory(acc);

      if (roomFilter && !roomKey.includes(roomFilter)) continue;
      if (typeFilter && simplified.type !== typeFilter) continue;
      if (nameFilter && !accKey.includes(nameFilter)) continue;

      if (!homeData[roomKey]) homeData[roomKey] = {};
      simplified.name = `${homeKey}.${roomKey}.${accKey}`;
      homeData[roomKey][accKey] = simplified;
    }

    // Add service groups
    for (const group of groups) {
      const groupKey = uniqueKey(group.name || 'Unknown', group.id || '');
      const memberIds: string[] = group.accessoryIds || [];
      if (memberIds.length === 0) continue;

      const firstMember = accessoryById[memberIds[0]];
      if (!firstMember) continue;

      const roomKey = uniqueKey(firstMember.roomName || 'Unknown', firstMember.roomId || '');
      if (roomFilter && !roomKey.includes(roomFilter)) continue;

      const groupState = simplifyAccessory(firstMember);
      groupState.group = true;
      if (typeFilter && groupState.type !== typeFilter) continue;
      if (nameFilter && !groupKey.includes(nameFilter)) continue;

      groupState.name = `${homeKey}.${roomKey}.${groupKey}`;

      const accessoriesDict: Record<string, any> = {};
      for (const accId of memberIds) {
        const member = accessoryById[accId];
        if (!member) continue;
        const memberKey = uniqueKey(member.name || 'Unknown', accId);
        const memberState = simplifyAccessory(member);
        memberState.name = `${homeKey}.${roomKey}.${groupKey}.${memberKey}`;
        accessoriesDict[memberKey] = memberState;
      }
      groupState.accessories = accessoriesDict;

      if (!homeData[roomKey]) homeData[roomKey] = {};
      homeData[roomKey][groupKey] = groupState;
    }

    // Add scenes (prefixed with _ so parsers skip it)
    homeData._scenes = scenes.map((s: any) => s.name);

    result[homeKey] = homeData;
  }

  // Include home key → UUID mapping so clients can subscribe with full UUIDs
  result._homes = Object.fromEntries(homes.map((h: any) => [uniqueKey(h.name, h.id), h.id]));

  // Build contextual message
  const homeKeys = Object.keys(result).filter(k => !k.startsWith('_'));
  let totalAccessories = 0;
  for (const hk of homeKeys) {
    for (const [rk, rv] of Object.entries(result[hk])) {
      if (!rk.startsWith('_') && typeof rv === 'object' && rv !== null) {
        totalAccessories += Object.keys(rv).length;
      }
    }
  }
  const hasFilters = !!(homeFilter || roomFilter || typeFilter || nameFilter);
  let message: string;
  if (homeKeys.length === 0 && homes.length === 0) {
    message = 'No homes available. Connect a device to get started.';
  } else if (totalAccessories === 0 && hasFilters) {
    message = 'No accessories match filters';
  } else if (totalAccessories === 0) {
    message = 'No accessories found';
  } else {
    const homeWord = homeKeys.length === 1 ? 'home' : 'homes';
    message = `Found ${totalAccessories} accessor${totalAccessories === 1 ? 'y' : 'ies'} across ${homeKeys.length} ${homeWord}`;
  }

  // Use seconds precision for fetched_at (matches cloud format)
  const now = new Date();
  const fetched_at = now.toISOString().replace(/\.\d{3}Z$/, '+00:00');
  result._meta = { fetched_at, message };
  return result;
}

/**
 * Get state with simple filter object (used by MCP and REST).
 * No authorization — caller is responsible for auth checks.
 */
export async function handleGetState(filters: {
  home?: string;
  room?: string;
  type?: string;
  name?: string;
}): Promise<Record<string, any>> {
  const params = new URLSearchParams();
  if (filters.home) params.set('home', filters.home);
  if (filters.room) params.set('room', filters.room);
  if (filters.type) params.set('type', filters.type);
  if (filters.name) params.set('name', filters.name);
  return getState(params);
}

/**
 * Set state with flat update list (used by MCP and REST).
 * Matches the Cloud edition's HomesAPI.set_state interface.
 */
export async function handleSetState(updates: Array<Record<string, unknown>>): Promise<{
  updated: number;
  failed: number;
  changes: string[];
  errors: string[];
  message: string;
}> {
  // Build nested dict: { home_key: { room_key: { acc_key: { prop: val } } } }
  const homesResult = await executeHomeKitAction('homes.list') as any;
  const homes = homesResult?.homes || [];
  const homeKeyToId: Record<string, string> = {};
  for (const home of homes) {
    homeKeyToId[uniqueKey(home.name, home.id)] = home.id;
  }

  // Group updates by home
  const byHome: Record<string, Array<Record<string, unknown>>> = {};
  for (const update of updates) {
    const homeKey = update.home as string;
    if (!byHome[homeKey]) byHome[homeKey] = [];
    byHome[homeKey].push(update);
  }

  let updated = 0;
  let failed = 0;
  const changes: string[] = [];
  const errors: string[] = [];

  const settableProps = new Set([
    'on', 'brightness', 'hue', 'saturation', 'color_temp', 'active',
    'heat_target', 'cool_target', 'hvac_mode', 'lock_target', 'alarm_target',
    'speed', 'volume', 'mute', 'target',
  ]);

  for (const [homeKey, homeUpdates] of Object.entries(byHome)) {
    const homeId = homeKeyToId[homeKey];
    if (!homeId) {
      failed += homeUpdates.length;
      errors.push(`${homeKey}: home not found`);
      continue;
    }

    // Build nested state for this home
    const homeState: Record<string, Record<string, Record<string, unknown>>> = {};
    for (const update of homeUpdates) {
      const room = update.room as string;
      const acc = update.accessory as string;
      if (!homeState[room]) homeState[room] = {};
      const props: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(update)) {
        if (settableProps.has(k) && v !== undefined && v !== null) {
          props[k] = v;
        }
      }
      homeState[room][acc] = props;
    }

    try {
      await communityRequest('state.set', { state: homeState, homeId });
      for (const update of homeUpdates) {
        updated++;
        const props = Object.entries(update)
          .filter(([k]) => settableProps.has(k) && update[k] !== undefined && update[k] !== null)
          .map(([k, v]) => `${k}=${typeof v === 'boolean' ? (v ? 'true' : 'false') : v}`)
          .join(', ');
        changes.push(`${homeKey}/${update.room}/${update.accessory}: ${props}`);
      }
    } catch (e: any) {
      failed += homeUpdates.length;
      errors.push(`${homeKey}: ${e.message}`);
    }
  }

  let message: string;
  if (updated === 0 && failed === 0) message = 'No updates provided';
  else if (failed === 0) message = `Updated ${updated} accessor${updated === 1 ? 'y' : 'ies'}`;
  else if (updated === 0) message = `All ${failed} updates failed`;
  else message = `Updated ${updated} accessor${updated === 1 ? 'y' : 'ies'}, ${failed} failed`;

  return { updated, failed, changes, errors, message };
}

/**
 * History query for MCP and REST (`get_history` / GET /rest/history).
 * Matches the Cloud edition's HomesAPI.get_history interface and output
 * shape: compact [iso, value] pairs plus a per-series summary — sized for an
 * AI assistant answering "what was the temperature last night?", not for
 * charting (the GraphQL surface serves the charts).
 */
export async function handleGetHistory(args: {
  home?: string;
  accessory: string;
  characteristic?: string;
  hours?: number;
  max_points?: number;
}): Promise<Record<string, any>> {
  const hours = Math.min(Math.max(Number(args.hours) || 24, 0.25), 24 * 366);
  const maxPoints = Math.min(Math.max(Number(args.max_points) || 200, 10), 1000);
  if (!args.accessory) {
    return { error: 'accessory is required (name substring, slug, or id)' };
  }

  const homesResult = await executeHomeKitAction('homes.list') as any;
  let homes: any[] = homesResult?.homes || [];
  if (args.home) {
    const homeFilter = args.home.toLowerCase();
    homes = homes.filter((h: any) =>
      uniqueKey(h.name, h.id).includes(homeFilter) || h.name?.toLowerCase().includes(homeFilter));
  }
  if (homes.length === 0) {
    return { error: args.home ? `No home matches "${args.home}"` : 'No homes found' };
  }

  // Find the accessory by slug, name substring, or raw id across the
  // candidate homes — same matching the state tools use.
  const wanted = args.accessory.toLowerCase();
  let matchedHome: any = null;
  let matchedAccessory: any = null;
  for (const home of homes) {
    const result = await executeHomeKitAction('accessories.list', { homeId: home.id, includeAll: true }) as any;
    for (const acc of result?.accessories || []) {
      if (
        acc.id?.toLowerCase() === wanted ||
        uniqueKey(acc.name || '', acc.id || '').includes(wanted) ||
        acc.name?.toLowerCase().includes(wanted)
      ) {
        matchedHome = home;
        matchedAccessory = acc;
        break;
      }
    }
    if (matchedAccessory) break;
  }
  if (!matchedAccessory) {
    return { error: `No accessory matches "${args.accessory}"${args.home ? ` in home "${args.home}"` : ''}` };
  }

  const [{ getRecordableCharacteristics }, { canonicalHistoryType, seriesKey }, { queryHistorySeries }, historyDb, { getProfile }] =
    await Promise.all([
      import('@/components/automations/characteristics'),
      import('@/history/keys'),
      import('@/history/query'),
      import('./local-db'),
      import('@/history/policy'),
    ]);

  let recordable = getRecordableCharacteristics(matchedAccessory);
  if (args.characteristic) {
    const canonical = canonicalHistoryType(args.characteristic);
    recordable = recordable.filter(c => c.type === canonical);
    if (recordable.length === 0) {
      return { error: `Characteristic "${args.characteristic}" is not recordable on ${matchedAccessory.name}` };
    }
  }
  recordable = recordable.slice(0, 6);

  const toTs = Date.now();
  const fromTs = toTs - hours * 3_600_000;
  const store = {
    getSamples: async (sid: string, from: number, to: number) =>
      (await historyDb.getHistorySamples(sid, from, to)).map(r => ({ ts: r.ts, v: r.v })),
    getLastSampleBefore: async (sid: string, ts: number) => {
      const row = await historyDb.getLastHistorySampleBefore(sid, ts);
      return row ? { ts: row.ts, v: row.v } : undefined;
    },
    getFirstSampleTs: async (sid: string) =>
      (await historyDb.getHistorySamples(sid, 0, Number.MAX_SAFE_INTEGER, 1))[0]?.ts ?? null,
    getRollups: (sid: string, tier: 'h' | 'd', from: number, to: number) =>
      historyDb.getHistoryRollups(sid, tier, from, to),
    getLastRollupBefore: (sid: string, tier: 'h' | 'd', bucket: number) =>
      historyDb.getLastHistoryRollupBefore(sid, tier, bucket),
  };

  const series = [];
  for (const char of recordable) {
    const profile = getProfile(char.type);
    if (!profile) continue;
    const sid = seriesKey(matchedHome.id, matchedAccessory.id, char.type);
    const data = await queryHistorySeries(store, sid, profile.kind, fromTs, toTs, maxPoints);
    const iso = (ms: number) => new Date(ms).toISOString();

    if (profile.kind === 'numeric') {
      const values = data.points.map(p => [iso(p.ts), Math.round(p.avg * 100) / 100]);
      let summary: Record<string, unknown> | null = null;
      if (data.points.length > 0) {
        summary = {
          min: Math.min(...data.points.map(p => p.min)),
          max: Math.max(...data.points.map(p => p.max)),
          avg: Math.round((data.points.reduce((a, p) => a + p.avg, 0) / data.points.length) * 100) / 100,
          latest: data.points[data.points.length - 1].last,
        };
      }
      series.push({
        characteristic: char.type, kind: profile.kind, unit: profile.unit ?? null,
        resolution: data.resolution, values, summary,
      });
    } else {
      const source = data.states.length > 0
        ? data.states.map(s => [iso(s.ts), s.value])
        : data.stateBuckets.map(b => [iso(b.ts), b.dominant]);
      series.push({
        characteristic: char.type, kind: profile.kind, unit: null,
        resolution: data.resolution,
        transitions: source,
        openingValue: data.prevValue,
      });
    }
  }

  const recorded = series.filter(s =>
    ('values' in s && (s as any).values.length > 0) ||
    ('transitions' in s && (s as any).transitions.length > 0));
  return {
    home: uniqueKey(matchedHome.name, matchedHome.id),
    accessory: { key: uniqueKey(matchedAccessory.name, matchedAccessory.id), name: matchedAccessory.name, id: matchedAccessory.id },
    from: new Date(fromTs).toISOString(),
    to: new Date(toTs).toISOString(),
    series,
    _meta: {
      message: recorded.length > 0
        ? `${recorded.length} of ${series.length} characteristics have recorded history in the last ${hours}h`
        : 'No recorded history in this range. History is opt-in: the home owner enables it in Settings → History.',
    },
  };
}

/**
 * Bulk history access for the `query_history` MCP tool — the AI-analysis
 * surface. Not an analysis endpoint: it hands the model the data flexibly
 * and cheaply and lets it do its own reasoning. Any subset of accessories
 * and characteristics, any date range, explicit resolution control (hourly/
 * daily read the rollup tables — a month costs hundreds of rows per series,
 * not hundreds of thousands of samples), many series per call, pagination
 * via continue_from when a series is truncated. Matches the Cloud edition's
 * HomesAPI.query_history output shape.
 */
export async function handleQueryHistory(args: {
  home?: string;
  accessories?: string[];
  characteristics?: string[];
  start?: string;
  end?: string;
  resolution?: 'auto' | 'raw' | 'hourly' | 'daily';
  max_points_per_series?: number;
}): Promise<Record<string, any>> {
  const perSeriesCap = Math.min(Math.max(Number(args.max_points_per_series) || 500, 10), 2000);
  const TOTAL_BUDGET = 50_000;
  const SERIES_CAP = 100;

  const endTs = args.end ? Date.parse(args.end) : Date.now();
  const startTs = args.start ? Date.parse(args.start) : endTs - 24 * 3_600_000;
  if (!Number.isFinite(startTs) || !Number.isFinite(endTs) || endTs <= startTs) {
    return { error: 'start/end must be ISO 8601 datetimes with start < end' };
  }
  const resolution = args.resolution ?? 'auto';

  const homesResult = await executeHomeKitAction('homes.list') as any;
  let homes: any[] = homesResult?.homes || [];
  if (args.home) {
    const homeFilter = args.home.toLowerCase();
    homes = homes.filter((h: any) =>
      uniqueKey(h.name, h.id).includes(homeFilter) || h.name?.toLowerCase().includes(homeFilter));
  }
  const home = homes[0];
  if (!home) {
    return { error: args.home ? `No home matches "${args.home}"` : 'No homes found' };
  }

  const [{ canonicalHistoryType, seriesKey }, { queryHistorySeries }, historyDb] = await Promise.all([
    import('@/history/keys'),
    import('@/history/query'),
    import('./local-db'),
  ]);

  const accessoriesResult = await executeHomeKitAction('accessories.list', { homeId: home.id, includeAll: true }) as any;
  const accessoryInfo = new Map<string, { name: string; room: string | null; key: string }>();
  for (const acc of accessoriesResult?.accessories || []) {
    accessoryInfo.set((acc.id || '').toUpperCase(), {
      name: acc.name || acc.id,
      room: acc.roomName ?? null,
      key: uniqueKey(acc.name || '', acc.id || ''),
    });
  }

  // Filter recorded series by the requested accessory/characteristic subsets.
  const accessoryFilters = (args.accessories ?? []).map(a => a.toLowerCase()).filter(Boolean);
  const charFilters = (args.characteristics ?? []).map(c => canonicalHistoryType(c));
  let rows = await historyDb.getHistorySeries(home.id);
  if (accessoryFilters.length > 0) {
    rows = rows.filter(row => {
      const info = accessoryInfo.get(row.accessoryId.toUpperCase());
      return accessoryFilters.some(f =>
        row.accessoryId.toLowerCase() === f ||
        (info && (info.key.includes(f) || info.name.toLowerCase().includes(f))));
    });
  }
  if (charFilters.length > 0) {
    rows = rows.filter(row => charFilters.includes(row.characteristicType));
  }

  const seriesMatched = rows.length;
  rows = rows.slice(0, SERIES_CAP);

  const iso = (ms: number) => new Date(ms).toISOString();
  const store = {
    getSamples: async (sid: string, from: number, to: number) =>
      (await historyDb.getHistorySamples(sid, from, to)).map(r => ({ ts: r.ts, v: r.v })),
    getLastSampleBefore: async (sid: string, ts: number) => {
      const row = await historyDb.getLastHistorySampleBefore(sid, ts);
      return row ? { ts: row.ts, v: row.v } : undefined;
    },
    getFirstSampleTs: async (sid: string) =>
      (await historyDb.getHistorySamples(sid, 0, Number.MAX_SAFE_INTEGER, 1))[0]?.ts ?? null,
    getRollups: (sid: string, tier: 'h' | 'd', from: number, to: number) =>
      historyDb.getHistoryRollups(sid, tier, from, to),
    getLastRollupBefore: (sid: string, tier: 'h' | 'd', bucket: number) =>
      historyDb.getLastHistoryRollupBefore(sid, tier, bucket),
  };

  const series: Array<Record<string, any>> = [];
  const truncated: string[] = [];
  let pointsReturned = 0;

  for (const row of rows) {
    if (pointsReturned >= TOTAL_BUDGET) {
      truncated.push(`response budget of ${TOTAL_BUDGET} points reached — ${rows.length - series.length} series omitted; narrow the range or filters`);
      break;
    }
    const info = accessoryInfo.get(row.accessoryId.toUpperCase());
    const label = {
      accessory: info?.key ?? row.accessoryId.toLowerCase(),
      accessoryName: info?.name ?? null,
      room: info?.room ?? null,
      characteristic: row.characteristicType,
      kind: row.kind,
      unit: row.unit ?? null,
    };
    const sid = seriesKey(home.id, row.accessoryId, row.characteristicType);
    const budget = Math.min(perSeriesCap, TOTAL_BUDGET - pointsReturned);

    if (resolution === 'raw') {
      const samples = await historyDb.getHistorySamples(sid, startTs, endTs, budget + 1);
      const page = samples.slice(0, budget);
      const entry: Record<string, any> = { ...label, resolution: 'raw' };
      if (row.kind === 'numeric') {
        entry.values = page.map(s => [iso(s.ts), s.v]);
      } else {
        entry.transitions = page.map(s => [iso(s.ts), s.v]);
      }
      if (samples.length > budget) {
        entry.continue_from = iso(page[page.length - 1].ts + 1);
        truncated.push(`${label.accessory}/${row.characteristicType}: raw truncated at ${budget} points — resume with start=continue_from`);
      }
      pointsReturned += page.length;
      series.push(entry);
    } else if (resolution === 'hourly' || resolution === 'daily') {
      const tier = resolution === 'hourly' ? 'h' : 'd';
      const rollups = await historyDb.getHistoryRollups(sid, tier, startTs, endTs);
      const page = rollups.slice(0, budget);
      const entry: Record<string, any> = { ...label, resolution };
      if (row.kind === 'numeric') {
        entry.values = page.map(r => [iso(r.bucket), r.vMin, r.vAvg, r.vMax]);
        entry.values_format = '[time, min, avg, max]';
      } else {
        entry.buckets = page.map(r => [iso(r.bucket), r.transitions ?? 0, r.stateMs ?? {}]);
        entry.buckets_format = '[time, transitions, msInEachState]';
      }
      if (rollups.length > budget) {
        entry.continue_from = iso(page[page.length - 1].bucket + 1);
        truncated.push(`${label.accessory}/${row.characteristicType}: ${resolution} truncated at ${budget} buckets — resume with start=continue_from`);
      }
      pointsReturned += page.length;
      series.push(entry);
    } else {
      // auto: the tier planner picks raw/hourly/daily to fit the budget.
      const data = await queryHistorySeries(store, sid, row.kind, startTs, endTs, budget);
      const entry: Record<string, any> = { ...label, resolution: data.resolution };
      if (row.kind === 'numeric') {
        entry.values = data.resolution === 'raw'
          ? data.points.map(p => [iso(p.ts), p.avg])
          : data.points.map(p => [iso(p.ts), p.min, p.avg, p.max]);
        if (data.resolution !== 'raw') entry.values_format = '[time, min, avg, max]';
        pointsReturned += data.points.length;
      } else if (data.states.length > 0) {
        entry.transitions = data.states.map(s => [iso(s.ts), s.value]);
        if (data.prevValue !== null) entry.opening_value = data.prevValue;
        pointsReturned += data.states.length;
      } else {
        entry.buckets = data.stateBuckets.map(b => [iso(b.ts), b.transitions, b.stateMs]);
        entry.buckets_format = '[time, transitions, msInEachState]';
        pointsReturned += data.stateBuckets.length;
      }
      series.push(entry);
    }
  }

  return {
    home: uniqueKey(home.name, home.id),
    from: iso(startTs),
    to: iso(endTs),
    series,
    _meta: {
      series_returned: series.length,
      series_matched: seriesMatched,
      points_returned: pointsReturned,
      ...(truncated.length > 0 ? { truncated } : {}),
      message: seriesMatched > 0
        ? `${series.length} of ${seriesMatched} matched series over ${((endTs - startTs) / 86_400_000).toFixed(1)} days`
        : 'No recorded series match. History is opt-in: the home owner enables it in Settings → History.',
    },
  };
}
