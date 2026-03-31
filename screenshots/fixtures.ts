/**
 * Demo fixture data for screenshot captures.
 * Curated set of accessories covering the main widget types.
 */

// ── IDs ──────────────────────────────────────────────────────────────────────

export const HOME_ID = '11111111-1111-1111-1111-111111111111';
export const SHARED_HOME_ID = '22222222-2222-2222-2222-222222222222';
export const USER_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

const ROOMS = {
  livingRoom: 'room-living-room',
  bedroom: 'room-bedroom',
  kitchen: 'room-kitchen',
  frontDoor: 'room-front-door',
  garden: 'room-garden',
  // Shared home
  sharedLiving: 'room-shared-living',
  sharedPatio: 'room-shared-patio',
  sharedBedroom: 'room-shared-bedroom',
  sharedKitchen: 'room-shared-kitchen',
} as const;

// ── Helpers ──────────────────────────────────────────────────────────────────

function char(
  type: string,
  value: string | number | boolean | null,
  opts: { readable?: boolean; writable?: boolean; min?: number; max?: number; step?: number; format?: string; unit?: string; validValues?: string[] } = {},
) {
  return {
    id: crypto.randomUUID(),
    characteristicType: type,
    value: value != null ? String(value) : null,
    isReadable: opts.readable ?? true,
    isWritable: opts.writable ?? true,
    minValue: opts.min,
    maxValue: opts.max,
    minStep: opts.step,
    format: opts.format,
    unit: opts.unit,
    validValues: opts.validValues,
    __typename: 'HomeKitCharacteristic',
  };
}

function service(name: string, type: string, chars: ReturnType<typeof char>[]) {
  return {
    id: crypto.randomUUID(),
    name,
    serviceType: type,
    characteristics: chars,
    __typename: 'HomeKitService',
  };
}

function accessory(
  id: string,
  name: string,
  category: string,
  roomId: string,
  roomName: string,
  services: ReturnType<typeof service>[],
  reachable = true,
) {
  return {
    id,
    name,
    category,
    isReachable: reachable,
    roomId,
    roomName,
    services,
    __typename: 'HomeKitAccessory',
  };
}

// ── My Home: Accessories ─────────────────────────────────────────────────────

export const MY_HOME_ACCESSORIES = [
  // Living Room
  accessory('acc-lr-ceiling', 'Ceiling Light', 'Lightbulb', ROOMS.livingRoom, 'Living Room', [
    service('Ceiling Light', 'lightbulb', [
      char('power_state', true),
      char('brightness', 80, { min: 0, max: 100, step: 1 }),
      char('color_temperature', 320, { min: 140, max: 500, step: 1 }),
    ]),
    service('Accessory Information', 'accessory_information', [
      char('manufacturer', 'Philips', { writable: false }),
      char('model', 'Hue White Ambiance', { writable: false }),
      char('name', 'Ceiling Light', { writable: false }),
    ]),
  ]),
  accessory('acc-lr-lamp', 'Floor Lamp', 'Lightbulb', ROOMS.livingRoom, 'Living Room', [
    service('Floor Lamp', 'lightbulb', [
      char('power_state', true),
      char('brightness', 45, { min: 0, max: 100, step: 1 }),
      char('hue', 28, { min: 0, max: 360, step: 1 }),
      char('saturation', 75, { min: 0, max: 100, step: 1 }),
    ]),
    service('Accessory Information', 'accessory_information', [
      char('manufacturer', 'Nanoleaf', { writable: false }),
      char('model', 'Essentials Lightstrip', { writable: false }),
      char('name', 'Floor Lamp', { writable: false }),
    ]),
  ]),
  accessory('acc-lr-thermo', 'Living Room Thermostat', 'Thermostat', ROOMS.livingRoom, 'Living Room', [
    service('Living Room Thermostat', 'thermostat', [
      char('current_temperature', 20.5, { writable: false }),
      char('target_temperature', 21, { min: 10, max: 30, step: 0.5 }),
      char('heating_cooling_current', 1, { writable: false }),
      char('heating_cooling_target', 1, { min: 0, max: 3, validValues: ['0', '1', '2', '3'] }),
    ]),
    service('Accessory Information', 'accessory_information', [
      char('manufacturer', 'ecobee', { writable: false }),
      char('model', 'SmartThermostat', { writable: false }),
      char('name', 'Living Room Thermostat', { writable: false }),
    ]),
  ]),
  accessory('acc-lr-speaker', 'HomePod', 'Speaker', ROOMS.livingRoom, 'Living Room', [
    service('HomePod', 'speaker', [
      char('volume', 35, { min: 0, max: 100, step: 1 }),
      char('mute', false),
    ]),
  ]),

  // Bedroom
  accessory('acc-br-light', 'Bedside Lamp', 'Lightbulb', ROOMS.bedroom, 'Bedroom', [
    service('Bedside Lamp', 'lightbulb', [
      char('power_state', false),
      char('brightness', 20, { min: 0, max: 100, step: 1 }),
      char('color_temperature', 400, { min: 140, max: 500, step: 1 }),
    ]),
  ]),
  accessory('acc-br-blinds', 'Bedroom Blinds', 'Window Covering', ROOMS.bedroom, 'Bedroom', [
    service('Bedroom Blinds', 'window_covering', [
      char('current_position', 60, { writable: false, min: 0, max: 100 }),
      char('target_position', 60, { min: 0, max: 100, step: 1 }),
      char('position_state', 2, { writable: false }),
    ]),
  ]),
  accessory('acc-br-fan', 'Ceiling Fan', 'Fan', ROOMS.bedroom, 'Bedroom', [
    service('Ceiling Fan', 'fan', [
      char('power_state', true),
      char('rotation_speed', 50, { min: 0, max: 100, step: 25 }),
    ]),
  ]),

  // Kitchen
  accessory('acc-ki-light', 'Kitchen Light', 'Lightbulb', ROOMS.kitchen, 'Kitchen', [
    service('Kitchen Light', 'lightbulb', [
      char('power_state', true),
      char('brightness', 100, { min: 0, max: 100, step: 1 }),
    ]),
  ]),
  accessory('acc-ki-outlet', 'Coffee Maker', 'Outlet', ROOMS.kitchen, 'Kitchen', [
    service('Coffee Maker', 'outlet', [
      char('power_state', false),
      char('outlet_in_use', false, { writable: false }),
    ]),
  ]),
  accessory('acc-ki-temp', 'Kitchen Sensor', 'Other', ROOMS.kitchen, 'Kitchen', [
    service('Kitchen Sensor', 'temperature_sensor', [
      char('current_temperature', 22.3, { writable: false }),
    ]),
  ]),

  // Front Door
  accessory('acc-fd-lock', 'Front Door Lock', 'Door Lock', ROOMS.frontDoor, 'Front Door', [
    service('Front Door Lock', 'lock_mechanism', [
      char('lock_current_state', 1, { writable: false }),
      char('lock_target_state', 1, { min: 0, max: 1 }),
    ]),
    service('Accessory Information', 'accessory_information', [
      char('manufacturer', 'Yale', { writable: false }),
      char('model', 'Assure Lock 2', { writable: false }),
      char('name', 'Front Door Lock', { writable: false }),
    ]),
  ]),
  accessory('acc-fd-camera', 'Doorbell Camera', 'IP Camera', ROOMS.frontDoor, 'Front Door', [
    service('Doorbell Camera', 'doorbell', [
      char('programmable_switch_event', null, { writable: false }),
    ]),
  ]),
  accessory('acc-fd-motion', 'Motion Sensor', 'Other', ROOMS.frontDoor, 'Front Door', [
    service('Motion Sensor', 'motion_sensor', [
      char('motion_detected', false, { writable: false }),
    ]),
  ]),

  // Garden
  accessory('acc-gd-valve', 'Garden Irrigation', 'Other', ROOMS.garden, 'Garden', [
    service('Garden Irrigation', 'valve', [
      char('active', false),
      char('in_use', false, { writable: false }),
      char('valve_type', 1, { writable: false }),
    ]),
  ]),
  accessory('acc-gd-light', 'Garden Lights', 'Lightbulb', ROOMS.garden, 'Garden', [
    service('Garden Lights', 'lightbulb', [
      char('power_state', true),
      char('brightness', 70, { min: 0, max: 100, step: 1 }),
    ]),
  ]),
];

// ── Shared Home (Beach House): Accessories ───────────────────────────────────

export const SHARED_HOME_ACCESSORIES = [
  accessory('acc-sh-light', 'Living Room Light', 'Lightbulb', ROOMS.sharedLiving, 'Living Room', [
    service('Living Room Light', 'lightbulb', [
      char('power_state', true),
      char('brightness', 60, { min: 0, max: 100, step: 1 }),
    ]),
  ]),
  accessory('acc-sh-ac', 'Air Conditioner', 'Thermostat', ROOMS.sharedLiving, 'Living Room', [
    service('Air Conditioner', 'thermostat', [
      char('current_temperature', 26.1, { writable: false }),
      char('target_temperature', 24, { min: 16, max: 30, step: 0.5 }),
      char('heating_cooling_current', 2, { writable: false }),
      char('heating_cooling_target', 2, { min: 0, max: 3, validValues: ['0', '1', '2', '3'] }),
    ]),
  ]),
  accessory('acc-sh-patio', 'Patio Lights', 'Lightbulb', ROOMS.sharedPatio, 'Patio', [
    service('Patio Lights', 'lightbulb', [
      char('power_state', false),
      char('brightness', 0, { min: 0, max: 100, step: 1 }),
    ]),
  ]),
  // Bedroom
  accessory('acc-sh-bed-light', 'Bedside Lamp', 'Lightbulb', ROOMS.sharedBedroom, 'Bedroom', [
    service('Bedside Lamp', 'lightbulb', [
      char('power_state', false),
      char('brightness', 20, { min: 0, max: 100, step: 1 }),
    ]),
  ]),
  accessory('acc-sh-bed-fan', 'Ceiling Fan', 'Fan', ROOMS.sharedBedroom, 'Bedroom', [
    service('Ceiling Fan', 'fan', [
      char('power_state', true),
      char('rotation_speed', 75, { min: 0, max: 100, step: 25 }),
    ]),
  ]),
  accessory('acc-sh-bed-blinds', 'Blinds', 'Window Covering', ROOMS.sharedBedroom, 'Bedroom', [
    service('Blinds', 'window_covering', [
      char('current_position', 40, { writable: false, min: 0, max: 100 }),
      char('target_position', 40, { min: 0, max: 100, step: 1 }),
      char('position_state', 2, { writable: false }),
    ]),
  ]),
  // Kitchen
  accessory('acc-sh-kit-light', 'Kitchen Light', 'Lightbulb', ROOMS.sharedKitchen, 'Kitchen', [
    service('Kitchen Light', 'lightbulb', [
      char('power_state', true),
      char('brightness', 100, { min: 0, max: 100, step: 1 }),
    ]),
  ]),
  accessory('acc-sh-kit-lock', 'Back Door', 'Door Lock', ROOMS.sharedKitchen, 'Kitchen', [
    service('Back Door', 'lock_mechanism', [
      char('lock_current_state', 1, { writable: false }),
      char('lock_target_state', 1, { min: 0, max: 1 }),
    ]),
  ]),
];

// ── Homes ────────────────────────────────────────────────────────────────────

export const HOMES = [
  { id: HOME_ID, name: 'My Home' },
  { id: SHARED_HOME_ID, name: 'Beach House' },
];

export const CACHED_HOMES = [
  { homeId: HOME_ID, name: 'My Home', role: 'owner', isConnected: true, memberCount: 2 },
  { homeId: SHARED_HOME_ID, name: 'Beach House', role: 'control', isConnected: true, memberCount: 3 },
];

// ── Rooms ────────────────────────────────────────────────────────────────────

export const MY_HOME_ROOMS = [
  { id: ROOMS.livingRoom, name: 'Living Room', homeId: HOME_ID },
  { id: ROOMS.bedroom, name: 'Bedroom', homeId: HOME_ID },
  { id: ROOMS.kitchen, name: 'Kitchen', homeId: HOME_ID },
  { id: ROOMS.frontDoor, name: 'Front Door', homeId: HOME_ID },
  { id: ROOMS.garden, name: 'Garden', homeId: HOME_ID },
];

export const SHARED_HOME_ROOMS = [
  { id: ROOMS.sharedLiving, name: 'Living Room', homeId: SHARED_HOME_ID },
  { id: ROOMS.sharedBedroom, name: 'Bedroom', homeId: SHARED_HOME_ID },
  { id: ROOMS.sharedKitchen, name: 'Kitchen', homeId: SHARED_HOME_ID },
  { id: ROOMS.sharedPatio, name: 'Patio', homeId: SHARED_HOME_ID },
];

// ── Scenes ───────────────────────────────────────────────────────────────────

export const SCENES = [
  { id: 'scene-morning', name: 'Good Morning', homeId: HOME_ID },
  { id: 'scene-night', name: 'Good Night', homeId: HOME_ID },
  { id: 'scene-away', name: 'Away', homeId: HOME_ID },
];

// ── Service Groups ───────────────────────────────────────────────────────────

export const SERVICE_GROUPS = [
  {
    id: 'sg-all-lights',
    name: 'All Lights',
    homeId: HOME_ID,
    serviceIds: [],
    accessoryIds: ['acc-lr-ceiling', 'acc-lr-lamp', 'acc-br-light', 'acc-ki-light', 'acc-gd-light'],
  },
];

// ── Home Members ─────────────────────────────────────────────────────────────

export const HOME_MEMBERS = [
  { id: 'member-1', homeId: HOME_ID, userId: USER_ID, email: 'alex@example.com', name: 'Alex', role: 'owner', createdAt: '2025-06-01T00:00:00Z' },
  { id: 'member-2', homeId: HOME_ID, userId: 'user-2', email: 'jordan@example.com', name: 'Jordan', role: 'control', createdAt: '2025-07-15T00:00:00Z' },
  { id: 'member-3', homeId: HOME_ID, userId: null, email: 'sam@example.com', name: null, role: 'view', createdAt: '2025-08-01T00:00:00Z' },
];

// ── Collections ──────────────────────────────────────────────────────────────

export const COLLECTIONS = [
  {
    id: 'collection-1',
    entityType: 'collection',
    entityId: 'col-all-lights',
    parentId: null,
    dataJson: JSON.stringify({ name: 'All Lights', accessoryIds: ['acc-lr-ceiling', 'acc-lr-lamp', 'acc-br-light', 'acc-ki-light', 'acc-gd-light'] }),
    layoutJson: null,
    updatedAt: '2025-09-01T00:00:00Z',
  },
  {
    id: 'collection-2',
    entityType: 'collection',
    entityId: 'col-bedtime',
    parentId: null,
    dataJson: JSON.stringify({ name: 'Bedtime', accessoryIds: ['acc-br-light', 'acc-br-blinds', 'acc-fd-lock', 'acc-lr-thermo'] }),
    layoutJson: null,
    updatedAt: '2025-09-10T00:00:00Z',
  },
];

// ── User ─────────────────────────────────────────────────────────────────────

export const MOCK_USER = {
  id: USER_ID,
  email: 'alex@example.com',
  name: 'Alex',
  createdAt: '2025-06-01T00:00:00Z',
  lastLoginAt: '2026-02-16T08:00:00Z',
  isAdmin: false,
  accountType: 'standard',
};

export const MOCK_SETTINGS = {
  data: JSON.stringify({
    theme: 'dark',
    sidebarCollapsed: false,
    developerMode: true,
  }),
};

export const MOCK_ACCOUNT = {
  accountType: 'standard',
  accessoryLimit: null,
  smartDealsEnabled: true,
};

// ── Access Tokens ─────────────────────────────────────────────────────────────

export const MOCK_ACCESS_TOKENS = [
  {
    id: 'token-1',
    name: 'Home Assistant',
    tokenPrefix: 'hc_abc1',
    homePermissions: JSON.stringify({ [HOME_ID]: 'control' }),
    expiresAt: null,
    lastUsedAt: '2026-02-15T14:30:00Z',
    createdAt: '2025-11-01T00:00:00Z',
  },
  {
    id: 'token-2',
    name: 'Automation Script',
    tokenPrefix: 'hc_def2',
    homePermissions: JSON.stringify({ [HOME_ID]: 'view', [SHARED_HOME_ID]: 'view' }),
    expiresAt: '2026-05-01T00:00:00Z',
    lastUsedAt: '2026-02-10T09:00:00Z',
    createdAt: '2025-12-15T00:00:00Z',
  },
];

// ── Webhooks ──────────────────────────────────────────────────────────────────

export const MOCK_WEBHOOKS = [
  {
    id: 'webhook-1',
    name: 'Home Assistant Sync',
    url: 'https://ha.example.com/api/webhook/hc-state',
    status: 'active',
    eventTypes: ['state.changed'],
    homeIds: [HOME_ID],
    roomIds: [],
    accessoryIds: [],
    collectionIds: [],
    maxRetries: 3,
    consecutiveFailures: 0,
    secret: 'whsec_mock_secret_1',
    lastTriggeredAt: '2026-02-16T07:45:00Z',
    createdAt: '2025-10-01T00:00:00Z',
  },
  {
    id: 'webhook-2',
    name: 'Slack Notifications',
    url: 'https://hooks.slack.com/triggers/T0/B0/xyz',
    status: 'active',
    eventTypes: ['state.changed'],
    homeIds: [],
    roomIds: [],
    accessoryIds: [],
    collectionIds: [],
    maxRetries: 5,
    consecutiveFailures: 2,
    secret: 'whsec_mock_secret_2',
    lastTriggeredAt: '2026-02-16T06:30:00Z',
    createdAt: '2025-12-01T00:00:00Z',
  },
];

export const MOCK_WEBHOOK_DELIVERIES = [
  {
    id: 'delivery-1',
    webhookId: 'webhook-1',
    eventType: 'state.changed',
    eventId: 'evt-001',
    status: 'success',
    attemptNumber: 1,
    maxAttempts: 3,
    responseStatusCode: 200,
    latencyMs: 145,
    createdAt: '2026-02-16T07:45:00Z',
  },
  {
    id: 'delivery-2',
    webhookId: 'webhook-1',
    eventType: 'state.changed',
    eventId: 'evt-002',
    status: 'success',
    attemptNumber: 1,
    maxAttempts: 3,
    responseStatusCode: 200,
    latencyMs: 203,
    createdAt: '2026-02-16T07:30:00Z',
  },
  {
    id: 'delivery-3',
    webhookId: 'webhook-1',
    eventType: 'state.changed',
    eventId: 'evt-003',
    status: 'failed',
    attemptNumber: 3,
    maxAttempts: 3,
    responseStatusCode: 502,
    latencyMs: 30012,
    createdAt: '2026-02-16T06:15:00Z',
  },
];

// ── Authorized Apps ───────────────────────────────────────────────────────────

export const MOCK_AUTHORIZED_APPS = [
  {
    clientId: 'claude-client-id',
    clientName: 'Claude',
    redirectDomain: 'claude.ai',
    logoUri: null,
    scope: 'homekit',
    homePermissions: JSON.stringify({ [HOME_ID]: 'control' }),
    createdAt: '2025-12-20T00:00:00Z',
  },
  {
    clientId: 'chatgpt-client-id',
    clientName: 'ChatGPT',
    redirectDomain: 'chatgpt.com',
    logoUri: null,
    scope: 'homekit',
    homePermissions: JSON.stringify({ [HOME_ID]: 'control', [SHARED_HOME_ID]: 'view' }),
    createdAt: '2026-01-15T00:00:00Z',
  },
];

// ── Entity Access (for ShareDialog) ───────────────────────────────────────────

export const MOCK_ENTITY_ACCESS = [
  {
    id: 'ea-public',
    entityType: 'home',
    entityId: HOME_ID,
    homeId: HOME_ID,
    ownerId: USER_ID,
    accessType: 'public',
    role: 'view',
    userId: null,
    passcodeHash: null,
    name: null,
    accessSchedule: null,
    createdAt: '2025-11-01T00:00:00Z',
  },
  {
    id: 'ea-passcode-1',
    entityType: 'home',
    entityId: HOME_ID,
    homeId: HOME_ID,
    ownerId: USER_ID,
    accessType: 'passcode',
    role: 'control',
    userId: null,
    passcodeHash: 'mock-hash',
    name: 'Guest Access',
    accessSchedule: null,
    createdAt: '2025-11-15T00:00:00Z',
  },
];

export const MOCK_SHARING_INFO = {
  shareUrl: 'https://homecast.cloud/s/abc123def',
  entityType: 'home',
  entityId: HOME_ID,
  entityName: 'My Home',
  accessCount: 2,
  memberCount: 3,
};

// ── Smart Deals ─────────────────────────────────────────────────────────────

export const MOCK_DEALS = [
  {
    id: 'deal-1',
    deviceId: 'device-1',
    deviceName: 'Philips Hue White Ambiance A19',
    deviceManufacturer: 'Philips',
    productName: 'Philips Hue White Ambiance A19 LED Smart Bulb (4-Pack)',
    dealPrice: '34.99',
    regularPrice: '49.99',
    discountPercentage: 30,
    dealTitle: null,
    dealTier: 'hot',
    currency: 'USD',
    dealUrl: 'https://amazon.com/dp/B0EXAMPLE1',
    imageUrl: null,
    expiresAt: null,
    quantity: 4,
    listingType: 'multi_pack',
    unitPrice: '8.75',
    allTimeLow: '32.99',
    isNearAtl: true,
  },
  {
    id: 'deal-2',
    deviceId: 'device-2',
    deviceName: 'Yale Assure Lock 2',
    deviceManufacturer: 'Yale',
    productName: 'Yale Assure Lock 2 with Apple Home Key',
    dealPrice: '199.99',
    regularPrice: '279.99',
    discountPercentage: 29,
    dealTitle: null,
    dealTier: 'great',
    currency: 'USD',
    dealUrl: 'https://amazon.com/dp/B0EXAMPLE2',
    imageUrl: null,
    expiresAt: null,
    quantity: 1,
    listingType: 'single',
    unitPrice: null,
    allTimeLow: '189.99',
    isNearAtl: true,
  },
];

export const MOCK_DEAL_PRICE_HISTORY: Record<string, { date: string; price: number }[]> = {
  'deal-1': [
    { date: 'Jan 1', price: 49.99 }, { date: 'Jan 8', price: 49.99 },
    { date: 'Jan 15', price: 44.99 }, { date: 'Jan 22', price: 44.99 },
    { date: 'Jan 29', price: 42.99 }, { date: 'Feb 5', price: 39.99 },
    { date: 'Feb 12', price: 34.99 },
  ],
  'deal-2': [
    { date: 'Jan 1', price: 279.99 }, { date: 'Jan 8', price: 269.99 },
    { date: 'Jan 15', price: 259.99 }, { date: 'Jan 22', price: 249.99 },
    { date: 'Jan 29', price: 219.99 }, { date: 'Feb 5', price: 199.99 },
    { date: 'Feb 12', price: 199.99 },
  ],
};

// ── HomeKit Native Automations ────────────────────────────────────────────────

export const MOCK_HOMEKIT_AUTOMATIONS = [
  {
    id: 'hk-auto-1',
    name: 'Good Morning',
    isEnabled: true,
    trigger: { type: 'time', fireDate: '2026-01-01T07:00:00Z', recurrence: 'daily', timeZone: 'Europe/London', events: [] },
    actions: [
      { accessoryId: 'acc-lr-ceiling', accessoryName: 'Ceiling Light', characteristicType: 'power_state', targetValue: '1' },
      { accessoryId: 'acc-br-blinds', accessoryName: 'Bedroom Blinds', characteristicType: 'target_position', targetValue: '100' },
    ],
  },
  {
    id: 'hk-auto-2',
    name: 'Good Night',
    isEnabled: true,
    trigger: { type: 'time', fireDate: '2026-01-01T23:00:00Z', recurrence: 'daily', timeZone: 'Europe/London', events: [] },
    actions: [
      { accessoryId: 'acc-fd-lock', accessoryName: 'Front Door Lock', characteristicType: 'lock_target_state', targetValue: '1' },
    ],
  },
];

// ── Homecast Automations ──────────────────────────────────────────────────────

export const HC_AUTOMATION_ID = 'hc-auto-1111-1111-1111-111111111111';

export const MOCK_HC_AUTOMATIONS = [
  {
    id: 'se-hc-auto-1',
    entityType: 'hc_automation',
    entityId: HC_AUTOMATION_ID,
    parentId: HOME_ID,
    dataJson: JSON.stringify({
      id: HC_AUTOMATION_ID,
      name: 'Motion Light - Living Room',
      homeId: HOME_ID,
      enabled: true,
      mode: 'single',
      triggers: [
        {
          type: 'state',
          id: 'trigger-1',
          accessoryId: 'acc-motion',
          characteristicType: 'motion_detected',
          to: true,
        },
      ],
      conditions: { operator: 'and', conditions: [] },
      actions: [
        {
          type: 'set_characteristic',
          id: 'action-1',
          accessoryId: 'acc-ceiling-light',
          characteristicType: 'on',
          value: true,
        },
        {
          type: 'delay',
          id: 'action-2',
          duration: { minutes: 5 },
        },
        {
          type: 'set_characteristic',
          id: 'action-3',
          accessoryId: 'acc-ceiling-light',
          characteristicType: 'on',
          value: false,
        },
      ],
      metadata: {
        createdAt: '2026-03-25T10:00:00Z',
        updatedAt: '2026-03-25T10:00:00Z',
        triggerCount: 42,
      },
    }),
    updatedAt: '2026-03-25T10:00:00Z',
  },
];
