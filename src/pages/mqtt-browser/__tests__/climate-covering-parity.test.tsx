// @vitest-environment jsdom
//
// An air conditioner and a blind must read the same in the MQTT browser as
// they do on the dashboard.
//
// Both relay shapes below are a live relay's accessories.list (County Hall,
// 2026-09-29). The AC used to render as a fan — its payload has a `speed`, and
// its mode never reached MQTT at all — and the Eve blind said "Open" while
// fully closed, because nothing on MQTT said who made it. The MQTT side is what
// the bridges publish for the same accessory: its state topic and its /info.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { AccessoryWidget } from '@/components/widgets/AccessoryWidget';
import { resolveWidgetType } from '@/components/widgets/resolve-widget-type';
import { mqttToAccessory, mqttPublishFor, inferServiceType, type DeviceInfo } from '../widget-adapter';
import type { WidgetProps } from '@/components/widgets/types';
import type { HomeKitAccessory } from '@/lib/graphql/types';

vi.mock('@/lib/config', () => ({
  isCommunity: false,
  getCommunityMode: () => null,
  isRelayMode: () => false,
  isClientMode: () => false,
  isRelaySetupComplete: () => false,
  config: { isCommunity: false, apiBase: 'https://api.test', graphqlUrl: 'https://api.test/', wsUrl: 'wss://api.test/ws' },
}));

if (!window.matchMedia) {
  window.matchMedia = ((q: string) => ({
    matches: false, media: q, onchange: null,
    addEventListener: () => {}, removeEventListener: () => {},
    addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

// jsdom has none; ThermostatWidget measures itself with one.
if (!('ResizeObserver' in window)) {
  (window as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
    observe() {} unobserve() {} disconnect() {}
  };
}

type C = [type: string, value: unknown, writable: boolean, meta?: { valid?: number[]; min?: number; max?: number; step?: number }];

function relay(id: string, name: string, category: string, services: Record<string, C[]>): HomeKitAccessory {
  return {
    id, name, category, isReachable: true,
    services: Object.entries(services).map(([serviceType, chars]) => ({
      id: `${id}:${serviceType}`, name, serviceType,
      characteristics: chars.map(([characteristicType, value, isWritable, m]) => ({
        id: `${id}:${characteristicType}`, characteristicType, value, isReadable: true, isWritable,
        validValues: m?.valid, minValue: m?.min, maxValue: m?.max, stepValue: m?.step,
      })),
    })),
  };
}

const AC_RELAY = relay('ac-1', 'Bedroom 2 Air Conditioner', 'Other', {
  heater_cooler: [
    ['rotation_speed', 100, true, { min: 0, max: 100, step: 1 }],
    ['target_heater_cooler_state', 2, true, { valid: [0, 1, 2], min: 0, max: 2, step: 1 }],
    ['swing_mode', 0, true, { valid: [0, 1] }],
    ['current_temperature', 20, false],
    ['active', 1, true, { valid: [0, 1] }],
    ['current_heater_cooler_state', 3, false, { valid: [0, 1, 2, 3] }],
    ['heating_threshold', 17, true, { min: 16, max: 31, step: 1 }],
    ['cooling_threshold', 17, true, { min: 16, max: 31, step: 1 }],
  ],
  accessory_information: [['manufacturer', 'Powrmatic', false], ['model', 'Default-Model', false]],
});

const AC_TOPIC = 'homecast/county-hall-d08c/bedroom-2-493a/bedroom-2-air-conditioner-5d2b';
const AC_PAYLOAD = JSON.stringify({
  active: 1, cool_target: 17, current_temp: 20, heat_target: 17,
  hvac_mode: 2, hvac_state: 3, speed: 100, swing_mode: 0,
});
const hc = (m: object) => ({ service: 'heater_cooler', writable: true, ...m });
const AC_INFO: DeviceInfo = {
  category: 'Other', manufacturer: 'Powrmatic', model: 'Default-Model',
  keys: {
    speed: hc({ min: 0, max: 100, step: 1 }),
    hvac_mode: hc({ valid: [0, 1, 2], min: 0, max: 2, step: 1 }),
    swing_mode: hc({ valid: [0, 1] }),
    current_temp: hc({ writable: false }),
    active: hc({ valid: [0, 1] }),
    hvac_state: hc({ writable: false, valid: [0, 1, 2, 3] }),
    heat_target: hc({ min: 16, max: 31, step: 1 }),
    cool_target: hc({ min: 16, max: 31, step: 1 }),
  },
};

const BLIND_RELAY = relay('blind-1', 'Living Room Blinds', 'Window Covering', {
  eve_history: [['eve_history_status', null, false]],
  window_covering: [
    ['current_position', 0, false, { min: 0, max: 100, step: 1 }],
    ['position_state', 2, false],
    ['obstruction_detected', false, false],
    ['target_position', 0, true, { min: 0, max: 100, step: 1 }],
  ],
  accessory_information: [['manufacturer', 'Eve Systems', false], ['model', 'Eve MotionBlinds 20CAA9901', false]],
  battery: [['battery_level', 10, false, { min: 0, max: 100 }], ['status_low_battery', 1, false]],
});

const BLIND_TOPIC = 'homecast/county-hall-d08c/living-a751/living-room-blinds-4216';
const BLIND_PAYLOAD = JSON.stringify({
  battery: 10, low_battery: 1, obstruction: false, position: 0, position_state: 2, target: 0,
});
const wc = (m: object) => ({ service: 'window_covering', ...m });
const BLIND_INFO: DeviceInfo = {
  category: 'Window Covering', manufacturer: 'Eve Systems', model: 'Eve MotionBlinds 20CAA9901',
  keys: {
    position: wc({ writable: false, min: 0, max: 100, step: 1 }),
    position_state: wc({ writable: false }),
    obstruction: wc({ writable: false }),
    target: wc({ writable: true, min: 0, max: 100, step: 1 }),
    battery: { service: 'battery', writable: false, min: 0, max: 100 },
    low_battery: { service: 'battery', writable: false },
  },
};

function readoutOf(accessory: HomeKitAccessory, expanded = false): string {
  cleanup();
  render(<AccessoryWidget {...({
    accessory,
    expanded,
    getEffectiveValue: (_i: string, _c: string, v: unknown) => v,
    onSetValue: () => {},
    onSlider: () => {},
    onToggle: () => {},
  } as unknown as WidgetProps)} />);
  return document.body.textContent || '';
}

const widgetOf = (a: HomeKitAccessory) =>
  resolveWidgetType({ category: a.category, serviceTypes: a.services.map(s => s.serviceType) }).widgetType;

describe('air conditioner: MQTT browser vs dashboard', () => {
  afterEach(cleanup);
  const mqtt = () => mqttToAccessory(AC_TOPIC, AC_PAYLOAD, true, AC_INFO)!.accessory;

  it('draws the same widget the dashboard does, not a fan', () => {
    expect(widgetOf(AC_RELAY)).toBe('thermostat');
    expect(widgetOf(mqtt())).toBe('thermostat');
  });

  it('reads the same', () => {
    const fromRelay = readoutOf(AC_RELAY);
    expect(fromRelay).toContain('Cooling');
    expect(readoutOf(mqtt())).toBe(fromRelay);
    expect(readoutOf(mqtt(), true)).toBe(readoutOf(AC_RELAY, true));
  });

  it('is still an air conditioner before its /info arrives', () => {
    const bare = mqttToAccessory(AC_TOPIC, AC_PAYLOAD, true)!;
    expect(bare.type).toBe('heater_cooler');
    expect(widgetOf(bare.accessory)).toBe('thermostat');
    // An older bridge published no mode at all — still not a fan.
    expect(inferServiceType({ active: 1, cool_target: 17, current_temp: 20, heat_target: 17, speed: 100 })).toBe('heater_cooler');
  });

  it('publishes a mode change as the integer both bridges accept', () => {
    expect(mqttPublishFor(mqtt(), 'target_heater_cooler_state', 1)).toEqual({ key: 'hvac_mode', value: 1 });
    expect(mqttPublishFor(mqtt(), 'rotation_speed', 40)).toEqual({ key: 'speed', value: 40 });
    expect(mqttPublishFor(mqtt(), 'cooling_threshold', 21)).toEqual({ key: 'cool_target', value: 21 });
    // Read-only per the relay: no publish at all.
    expect(mqttPublishFor(mqtt(), 'current_heater_cooler_state', 2)).toBeNull();
  });
});

describe('Eve blind: MQTT browser vs dashboard', () => {
  afterEach(cleanup);
  const mqtt = () => mqttToAccessory(BLIND_TOPIC, BLIND_PAYLOAD, true, BLIND_INFO)!.accessory;

  it('says Closed, as the dashboard does', () => {
    const fromRelay = readoutOf(BLIND_RELAY);
    expect(fromRelay).toContain('Closed');
    expect(readoutOf(mqtt())).toBe(fromRelay);
  });

  it('shows the same controls when expanded', () => {
    expect(readoutOf(mqtt(), true)).toBe(readoutOf(BLIND_RELAY, true));
  });

  it('moves the blind through target, never position', () => {
    expect(mqttPublishFor(mqtt(), 'target_position', 60)).toEqual({ key: 'target', value: 60 });
    expect(mqttPublishFor(mqtt(), 'current_position', 60)).toBeNull();
  });

  it('keeps its controls before /info arrives', () => {
    const bare = mqttToAccessory(BLIND_TOPIC, JSON.stringify({ position: 0 }), true)!.accessory;
    expect(mqttPublishFor(bare, 'target_position', 60)).toEqual({ key: 'target', value: 60 });
  });
});
