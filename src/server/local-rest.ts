/**
 * Community mode: REST API endpoints.
 * Same interface as the cloud REST API.
 */

import { executeHomeKitAction } from '../relay/local-handler';
import { communityRequest } from './connection';

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
        return getState(params);
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
        // Accept both flat dict and { state: ... } format
        const state = body.state || body;
        const homeId = body.homeId || body.home_id;
        await communityRequest('state.set', { state, homeId });
        return { success: true };
      }

      // GET /rest/scenes?home=X
      case method === 'GET' && route === '/scenes': {
        const homeId = params.get('home');
        if (!homeId) return { error: 'home parameter required' };
        const result = await executeHomeKitAction('scenes.list', { homeId }) as any;
        return result?.scenes || [];
      }

      // POST /rest/scenes/:id/execute
      case method === 'POST' && route.match(/^\/scenes\/[^/]+\/execute$/): {
        const sceneId = route.split('/')[2];
        await executeHomeKitAction('scene.execute', { sceneId });
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
const CHAR_TO_SIMPLE: Record<string, string> = {
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

const UUID_TO_SIMPLE: Record<string, string> = {
  '000000b1-0000-1000-8000-0026bb765291': 'hvac_state',
  '000000b2-0000-1000-8000-0026bb765291': 'hvac_mode',
};

const SKIP_SERVICES = new Set(['accessory_information', 'battery', 'label']);
const SKIP_CHARS = new Set(['name', 'manufacturer', 'model', 'serial_number', 'firmware_revision', 'hardware_revision', 'identify']);

function sanitizeName(name: string): string {
  return name.trim().replace(/\s+/g, '_').toLowerCase();
}

function uniqueKey(name: string, uuid: string): string {
  const shortId = uuid ? uuid.slice(-4).toLowerCase() : '0000';
  return `${sanitizeName(name)}_${shortId}`;
}

function getSimpleName(charType: string): string | null {
  if (CHAR_TO_SIMPLE[charType]) return CHAR_TO_SIMPLE[charType];
  if (UUID_TO_SIMPLE[charType.toLowerCase()]) return UUID_TO_SIMPLE[charType.toLowerCase()];
  if (SKIP_CHARS.has(charType)) return null;
  if (charType.includes('-') && charType.length > 20) return null;
  return charType;
}

function formatValue(value: any, simpleName: string): any {
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

async function getState(params: URLSearchParams): Promise<Record<string, any>> {
  const homeFilter = params.get('home')?.toLowerCase() || null;
  const roomFilter = params.get('room')?.toLowerCase() || null;
  const typeFilter = params.get('type')?.toLowerCase() || null;
  const nameFilter = params.get('name')?.toLowerCase() || null;

  // Get all homes
  const homesResult = await executeHomeKitAction('homes.list') as any;
  const homes = homesResult?.homes || [];

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

    // Add scenes
    homeData.scenes = scenes.map((s: any) => s.name);

    // Merge into result under home key
    if (homes.length === 1) {
      // Single home — flatten (no home key wrapper)
      Object.assign(result, homeData);
    } else {
      result[homeKey] = homeData;
    }
  }

  result._meta = { fetched_at: new Date().toISOString() };
  return result;
}
