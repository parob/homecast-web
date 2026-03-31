/**
 * Pure widget type resolution — single source of truth for
 * "given this accessory's category and service types, which widget should we show?"
 *
 * Used by:
 *  - AccessoryWidgetInner (index.tsx) for the web dashboard
 *  - Menu bar bridge (menu-bar-bridge.ts) exposed to Swift via window.menuBarControl
 */

import { getPrimaryServiceType, normalizeServiceType, type ServiceType } from './types';

export type WidgetType =
  | 'lightbulb' | 'switch' | 'outlet' | 'thermostat'
  | 'lock' | 'fan' | 'air_purifier' | 'humidifier'
  | 'window_covering' | 'garage_door' | 'door_window'
  | 'contact_sensor' | 'speaker' | 'security_system'
  | 'doorbell' | 'valve' | 'irrigation' | 'camera'
  | 'smoke_alarm' | 'motion_sensor' | 'multi_sensor'
  | 'sensor' | 'button' | 'remote' | 'info' | 'hidden';

// Sensor types that use the SensorWidget
const SENSOR_TYPES: ServiceType[] = [
  'motion_sensor',
  'occupancy_sensor',
  'temperature_sensor',
  'humidity_sensor',
  'light_sensor',
  'smoke_sensor',
  'carbon_monoxide_sensor',
  'carbon_dioxide_sensor',
  'leak_sensor',
  'air_quality_sensor',
];

// Categories that should be hidden (non-controllable devices)
const HIDDEN_CATEGORIES = ['bridge', 'range extender', 'rangeextender'];

// Map category names to service types
const CATEGORY_MAP: Record<string, ServiceType> = {
  'lightbulb': 'lightbulb',
  'light': 'lightbulb',
  'switch': 'switch',
  'outlet': 'outlet',
  'thermostat': 'thermostat',
  'heater': 'heater_cooler',
  'cooler': 'heater_cooler',
  'heater-cooler': 'heater_cooler',
  'heatercooler': 'heater_cooler',
  'lock': 'lock',
  'lock-mechanism': 'lock',
  'door': 'door',
  'window': 'window',
  'window covering': 'window_covering',
  'window-covering': 'window_covering',
  'windowcovering': 'window_covering',
  'fan': 'fan',
  'garage door opener': 'garage_door',
  'garage-door-opener': 'garage_door',
  'garagedooropener': 'garage_door',
  'garage door': 'garage_door',
  'speaker': 'speaker',
  'smart speaker': 'smart_speaker',
  'smartspeaker': 'smart_speaker',
  'security system': 'security_system',
  'security-system': 'security_system',
  'securitysystem': 'security_system',
  'sensor': 'motion_sensor',
  'motion sensor': 'motion_sensor',
  'temperature sensor': 'temperature_sensor',
  'humidity sensor': 'humidity_sensor',
  'air purifier': 'air_purifier',
  'airpurifier': 'air_purifier',
  'humidifier': 'humidifier_dehumidifier',
  'dehumidifier': 'humidifier_dehumidifier',
  'valve': 'valve',
  'faucet': 'faucet',
  'irrigation': 'irrigation_system',
  'doorbell': 'doorbell',
  'camera': 'camera',
  'ip camera': 'camera',
  'ipcamera': 'camera',
};

export interface ResolveWidgetTypeResult {
  widgetType: WidgetType;
  sensorType?: string;
  /** For door_window, indicates 'door' or 'window' */
  deviceType?: 'door' | 'window';
}

/**
 * Determine the widget type for an accessory based on its category and service types.
 *
 * This is the single source of truth used by both the web dashboard and the Mac menu bar.
 * It only needs category + serviceTypes (not full characteristics data) since widget TYPE
 * selection depends only on service types and category. Widget CONFIGURATION (e.g., whether
 * a light has RGB/brightness) is handled separately by each consumer.
 */
export function resolveWidgetType(input: {
  category?: string;
  serviceTypes: string[];
}): ResolveWidgetTypeResult {
  const { category, serviceTypes } = input;

  // Build a minimal fake accessory shape for getPrimaryServiceType
  const fakeAccessory = {
    services: serviceTypes.map(st => ({
      serviceType: st,
      characteristics: [],
    })),
  } as Parameters<typeof getPrimaryServiceType>[0];

  // Check if this is a hidden device (bridge, range extender, or no controllable services)
  const isInfoDevice =
    (category && HIDDEN_CATEGORIES.includes(category.toLowerCase())) ||
    serviceTypes.filter(
      st => st !== 'accessory_information' && st !== 'protocol_information'
    ).length === 0;

  if (isInfoDevice) {
    return { widgetType: 'info' };
  }

  // Check category first for certain device types that have misleading primary services
  let serviceType: ServiceType | null = null;
  if (category) {
    const categoryLower = category.toLowerCase();
    const categoryServiceType = CATEGORY_MAP[categoryLower];
    if (categoryServiceType === 'camera' || categoryServiceType === 'window_covering') {
      serviceType = categoryServiceType;
    }
  }

  // Get service type from services if not determined by category
  if (!serviceType) {
    serviceType = getPrimaryServiceType(fakeAccessory);
  }

  // Fall back to category mapping if no service type found
  if (!serviceType && category) {
    const categoryLower = category.toLowerCase();
    serviceType = CATEGORY_MAP[categoryLower] || normalizeServiceType(categoryLower);
  }

  // Check for multi-sensor devices (have multiple different sensor services)
  const sensorServiceTypes = serviceTypes
    .map(s => normalizeServiceType(s))
    .filter((t): t is ServiceType => t !== null && SENSOR_TYPES.includes(t));
  const uniqueSensorTypes = [...new Set(sensorServiceTypes)];

  // Check for smoke/CO alarm devices
  const hasSmokeSensor = uniqueSensorTypes.includes('smoke_sensor');
  const hasCOSensor = uniqueSensorTypes.includes('carbon_monoxide_sensor');
  if (hasSmokeSensor || hasCOSensor) {
    return { widgetType: 'smoke_alarm' };
  }

  // Check for motion/occupancy sensor devices
  const hasMotionSensor = uniqueSensorTypes.includes('motion_sensor');
  const hasOccupancySensor = uniqueSensorTypes.includes('occupancy_sensor');
  if ((hasMotionSensor || hasOccupancySensor) &&
      (serviceType === 'motion_sensor' || serviceType === 'occupancy_sensor' || uniqueSensorTypes.length > 1)) {
    return { widgetType: 'motion_sensor' };
  }

  if (uniqueSensorTypes.length > 1) {
    return { widgetType: 'multi_sensor' };
  }

  // Check for button/remote devices (stateless_programmable_switch)
  const switchServiceCount = serviceTypes.filter(
    s => s === 'stateless_programmable_switch' ||
         s === '00000089-0000-1000-8000-0026BB765291'
  ).length;

  if (switchServiceCount > 0 && serviceType === 'stateless_programmable_switch') {
    if (switchServiceCount === 1) {
      return { widgetType: 'button' };
    } else {
      return { widgetType: 'remote' };
    }
  }

  // Check for sensor types (single sensor)
  if (serviceType && SENSOR_TYPES.includes(serviceType)) {
    return { widgetType: 'sensor', sensorType: serviceType };
  }

  // Map service type to widget type
  switch (serviceType) {
    case 'lightbulb':
      return { widgetType: 'lightbulb' };

    case 'switch':
      return { widgetType: 'switch' };

    case 'outlet':
      return { widgetType: 'outlet' };

    case 'thermostat':
    case 'heater_cooler':
      return { widgetType: 'thermostat' };

    case 'lock':
      return { widgetType: 'lock' };

    case 'fan':
      return { widgetType: 'fan' };

    case 'air_purifier':
      return { widgetType: 'air_purifier' };

    case 'humidifier_dehumidifier':
      return { widgetType: 'humidifier' };

    case 'window_covering':
      return { widgetType: 'window_covering' };

    case 'garage_door':
      return { widgetType: 'garage_door' };

    case 'door':
      return { widgetType: 'door_window', deviceType: 'door' };

    case 'window':
      return { widgetType: 'door_window', deviceType: 'window' };

    case 'contact_sensor':
      return { widgetType: 'contact_sensor' };

    case 'speaker':
    case 'smart_speaker':
    case 'microphone':
      return { widgetType: 'speaker' };

    case 'security_system':
      return { widgetType: 'security_system' };

    case 'doorbell':
      return { widgetType: 'doorbell' };

    case 'valve':
    case 'faucet':
      return { widgetType: 'valve' };

    case 'irrigation_system':
      return { widgetType: 'irrigation' };

    case 'camera':
      return { widgetType: 'camera' };

    // Default fallback to switch widget (simple on/off)
    default:
      return { widgetType: 'switch' };
  }
}
