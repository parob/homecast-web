import type { HomeKitAccessory, HomeKitCharacteristic } from '@/lib/graphql/types';
import type { IconStyle } from './iconColors';

export interface WidgetProps {
  accessory: HomeKitAccessory;
  onToggle: (accessoryId: string, characteristicType: string, currentValue: boolean) => void;
  onSlider: (accessoryId: string, characteristicType: string, value: number) => void;
  getEffectiveValue: (accessoryId: string, characteristicType: string, serverValue: any) => any;
  compact?: boolean;
  onExpandToggle?: () => void;
  /** Callback to show debug info for this accessory (admin only) */
  onDebug?: () => void;
  iconStyle?: IconStyle;
  /** When true, disables hover effects and interactivity (for drag mode) */
  editMode?: boolean;
  /** When true, controls are disabled and show as view-only (for shared view-only mode) */
  disabled?: boolean;
  /** When true, widget is expanded and should float above others with glow effect */
  expanded?: boolean;
  /** Current edit mode type for showing appropriate visibility icon */
  editModeType?: 'ui' | null;
  /** Whether device is hidden in UI */
  isHiddenUi?: boolean;
  /** Home name for tooltip display */
  homeName?: string;
  /** When true, disables tooltip (e.g., when any item is being dragged) */
  disableTooltip?: boolean;
  /** Callback to remove accessory from collection/group */
  onRemove?: () => void;
  /** Label for remove action (e.g., "Remove from Collection", "Remove from Group") */
  removeLabel?: string;
  /** Callback to hide accessory */
  onHide?: () => void;
  /** Label for hide action (e.g., "Hide from Room") */
  hideLabel?: string;
  /** Whether the accessory is currently hidden */
  isHidden?: boolean;
  /** Whether hidden items are currently being shown */
  showHiddenItems?: boolean;
  /** Callback to toggle showing hidden items */
  onToggleShowHidden?: () => void;
  /** Callback to share this accessory */
  onShare?: () => void;
  /** Location subtitle (e.g., "Home · Room") shown after main subtitle in collections */
  locationSubtitle?: string;
  /** When true, widget uses translucent blurred background (for when page has a background image) */
}

export interface CharacteristicData {
  type: string;
  value: any;
  isWritable: boolean;
  characteristic: HomeKitCharacteristic;
}

// Service type mapping - all HomeKit service types
export type ServiceType = 
  | 'accessory_information'
  | 'lightbulb'
  | 'switch'
  | 'outlet'
  | 'thermostat'
  | 'lock'
  | 'door'
  | 'window'
  | 'window_covering'
  | 'fan'
  | 'garage_door'
  | 'motion_sensor'
  | 'occupancy_sensor'
  | 'contact_sensor'
  | 'temperature_sensor'
  | 'humidity_sensor'
  | 'light_sensor'
  | 'smoke_sensor'
  | 'carbon_monoxide_sensor'
  | 'carbon_dioxide_sensor'
  | 'leak_sensor'
  | 'air_quality_sensor'
  | 'battery'
  | 'speaker'
  | 'security_system'
  | 'stateless_programmable_switch'
  | 'filter_maintenance'
  | 'air_purifier'
  | 'heater_cooler'
  | 'humidifier_dehumidifier'
  | 'label'
  | 'irrigation_system'
  | 'valve'
  | 'faucet'
  | 'camera'
  | 'microphone'
  | 'doorbell'
  | 'target_control'
  | 'data_stream'
  | 'siri'
  | 'smart_speaker'
  | 'climate_balanced'; // Virtual type for thermostat at-target state

// Helper to parse JSON-encoded characteristic values
export const parseCharacteristicValue = (value: any): any => {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
};

// Get characteristics from an accessory by type
export const getCharacteristic = (accessory: HomeKitAccessory, type: string): CharacteristicData | null => {
  for (const service of accessory.services || []) {
    for (const char of service.characteristics || []) {
      if (char.characteristicType === type) {
        return {
          type: char.characteristicType,
          value: parseCharacteristicValue(char.value),
          isWritable: char.isWritable ?? false,
          characteristic: char,
        };
      }
    }
  }
  return null;
};

// Get all characteristics matching types
export const getCharacteristics = (accessory: HomeKitAccessory, types: string[]): CharacteristicData[] => {
  const result: CharacteristicData[] = [];
  for (const service of accessory.services || []) {
    for (const char of service.characteristics || []) {
      if (types.includes(char.characteristicType)) {
        result.push({
          type: char.characteristicType,
          value: parseCharacteristicValue(char.value),
          isWritable: char.isWritable ?? false,
          characteristic: char,
        });
      }
    }
  }
  return result;
};

// Complete UUID to service type mapping (official HomeKit types)
const SERVICE_TYPE_MAP: Record<string, ServiceType> = {
  // Core services
  '0000003E-0000-1000-8000-0026BB765291': 'accessory_information',
  '00000040-0000-1000-8000-0026BB765291': 'fan',
  '00000041-0000-1000-8000-0026BB765291': 'garage_door',
  '00000043-0000-1000-8000-0026BB765291': 'lightbulb',
  '00000044-0000-1000-8000-0026BB765291': 'lock', // lock_management
  '00000045-0000-1000-8000-0026BB765291': 'lock',
  '00000047-0000-1000-8000-0026BB765291': 'outlet',
  '00000049-0000-1000-8000-0026BB765291': 'switch',
  '0000004A-0000-1000-8000-0026BB765291': 'thermostat',
  
  // Security & Sensors
  '0000007E-0000-1000-8000-0026BB765291': 'security_system',
  '0000007F-0000-1000-8000-0026BB765291': 'carbon_monoxide_sensor',
  '00000080-0000-1000-8000-0026BB765291': 'contact_sensor',
  '00000081-0000-1000-8000-0026BB765291': 'door',
  '00000082-0000-1000-8000-0026BB765291': 'humidity_sensor',
  '00000083-0000-1000-8000-0026BB765291': 'leak_sensor',
  '00000084-0000-1000-8000-0026BB765291': 'light_sensor',
  '00000085-0000-1000-8000-0026BB765291': 'motion_sensor',
  '00000086-0000-1000-8000-0026BB765291': 'occupancy_sensor',
  '00000087-0000-1000-8000-0026BB765291': 'smoke_sensor',
  '00000089-0000-1000-8000-0026BB765291': 'stateless_programmable_switch',
  '0000008A-0000-1000-8000-0026BB765291': 'temperature_sensor',
  '0000008B-0000-1000-8000-0026BB765291': 'window',
  '0000008C-0000-1000-8000-0026BB765291': 'window_covering',
  '0000008D-0000-1000-8000-0026BB765291': 'air_quality_sensor',
  
  // Battery & Climate
  '00000096-0000-1000-8000-0026BB765291': 'battery',
  '00000097-0000-1000-8000-0026BB765291': 'carbon_dioxide_sensor',
  '000000B7-0000-1000-8000-0026BB765291': 'fan', // fan_v2
  '000000B9-0000-1000-8000-0026BB765291': 'window_covering', // slats
  '000000BA-0000-1000-8000-0026BB765291': 'filter_maintenance',
  '000000BB-0000-1000-8000-0026BB765291': 'air_purifier',
  '000000BC-0000-1000-8000-0026BB765291': 'heater_cooler',
  '000000BD-0000-1000-8000-0026BB765291': 'humidifier_dehumidifier',
  
  // Irrigation & Water
  '000000CC-0000-1000-8000-0026BB765291': 'label',
  '000000CF-0000-1000-8000-0026BB765291': 'irrigation_system',
  '000000D0-0000-1000-8000-0026BB765291': 'valve',
  '000000D7-0000-1000-8000-0026BB765291': 'faucet',
  
  // Camera & Audio
  '000000D8-0000-1000-8000-0026BB765291': 'camera',
  '00000110-0000-1000-8000-0026BB765291': 'camera',
  '00000111-0000-1000-8000-0026BB765291': 'microphone',
  '00000112-0000-1000-8000-0026BB765291': 'speaker',
  '00000121-0000-1000-8000-0026BB765291': 'doorbell',
  '00000127-0000-1000-8000-0026BB765291': 'target_control',
  '00000128-0000-1000-8000-0026BB765291': 'target_control',
  '00000129-0000-1000-8000-0026BB765291': 'speaker',
  '0000012A-0000-1000-8000-0026BB765291': 'data_stream',
  '00000133-0000-1000-8000-0026BB765291': 'siri',
  '0000022A-0000-1000-8000-0026BB765291': 'smart_speaker',
};

// All known service type names (must match ServiceType union)
const KNOWN_SERVICE_TYPES: ServiceType[] = [
  'accessory_information',
  'lightbulb', 'switch', 'outlet', 'thermostat', 'lock', 'door', 'window',
  'window_covering', 'fan', 'garage_door',
  'motion_sensor', 'occupancy_sensor', 'contact_sensor', 'temperature_sensor',
  'humidity_sensor', 'light_sensor', 'smoke_sensor', 'carbon_monoxide_sensor',
  'carbon_dioxide_sensor', 'leak_sensor', 'air_quality_sensor',
  'battery', 'speaker', 'security_system', 'stateless_programmable_switch',
  'filter_maintenance', 'air_purifier', 'heater_cooler', 'humidifier_dehumidifier',
  'label', 'irrigation_system', 'valve', 'faucet',
  'camera', 'microphone', 'doorbell', 'target_control', 'data_stream', 'siri', 'smart_speaker'
];

// Normalize service type (handles UUID or readable name)
export const normalizeServiceType = (serviceType: string): ServiceType | null => {
  // If it's already a readable name
  if (KNOWN_SERVICE_TYPES.includes(serviceType as ServiceType)) {
    return serviceType as ServiceType;
  }

  // Try UUID mapping (case-insensitive)
  return SERVICE_TYPE_MAP[serviceType.toUpperCase()] || null;
};

// Auxiliary service types that should be skipped when determining primary service
const AUXILIARY_SERVICE_TYPES = [
  'accessory_information',
  '0000003E-0000-1000-8000-0026BB765291', // accessory_information UUID
  'battery',
  '00000096-0000-1000-8000-0026BB765291', // battery UUID
  'protocol_information',
  'pairing',
];

// Service type priority - higher priority services should be used as primary
// even if other services appear first in the list
const SERVICE_TYPE_PRIORITY: Record<string, number> = {
  // High priority - these define the device's main purpose
  'security_system': 100,
  'thermostat': 95,
  'heater_cooler': 95,
  'lock': 90,
  'garage_door': 90,
  'doorbell': 85,
  'camera': 85,
  'irrigation_system': 80,
  'air_purifier': 75,
  'humidifier_dehumidifier': 75,
  // Medium priority - common device types
  'lightbulb': 50,
  'fan': 50,
  'window_covering': 50,
  'valve': 45,
  'faucet': 45,
  'outlet': 40,
  // Lower priority - generic types often used alongside specific types
  'switch': 20,
  'speaker': 30,
  'microphone': 25,
  // Sensors
  'motion_sensor': 35,
  'occupancy_sensor': 35,
  'contact_sensor': 35,
  'temperature_sensor': 30,
  'humidity_sensor': 30,
  'light_sensor': 30,
  'smoke_sensor': 40,
  'carbon_monoxide_sensor': 40,
  'carbon_dioxide_sensor': 35,
  'leak_sensor': 40,
  'air_quality_sensor': 35,
  // Buttons
  'stateless_programmable_switch': 60,
};

// Get primary service type from accessory
export const getPrimaryServiceType = (accessory: HomeKitAccessory): ServiceType | null => {
  let bestService: ServiceType | null = null;
  let bestPriority = -1;

  for (const service of accessory.services || []) {
    const serviceTypeLower = service.serviceType.toLowerCase();
    const serviceTypeUpper = service.serviceType.toUpperCase();
    // Skip auxiliary services that don't define the device's primary function
    if (AUXILIARY_SERVICE_TYPES.includes(serviceTypeLower) ||
        AUXILIARY_SERVICE_TYPES.includes(serviceTypeUpper) ||
        AUXILIARY_SERVICE_TYPES.includes(service.serviceType)) {
      continue;
    }
    const normalized = normalizeServiceType(service.serviceType);
    if (normalized && normalized !== 'battery') {
      const priority = SERVICE_TYPE_PRIORITY[normalized] ?? 10;
      if (priority > bestPriority) {
        bestPriority = priority;
        bestService = normalized;
      }
    }
  }
  return bestService;
};

// Get a specific service by type from an accessory
export const getServiceByType = (accessory: HomeKitAccessory, type: ServiceType | string) => {
  for (const service of accessory.services || []) {
    const normalized = normalizeServiceType(service.serviceType);
    if (normalized === type || service.serviceType === type) {
      return service;
    }
  }
  return null;
};

// Check if accessory has a specific service type
export const hasServiceType = (accessory: HomeKitAccessory, type: ServiceType | string): boolean => {
  return getServiceByType(accessory, type) !== null;
};

// Get all characteristics from an accessory for display
export const getAllCharacteristics = (accessory: HomeKitAccessory): CharacteristicData[] => {
  const result: CharacteristicData[] = [];
  const hiddenTypes = ['name', 'manufacturer', 'model', 'serial_number', 'firmware_revision', 'hardware_revision', 'identify'];
  
  for (const service of accessory.services || []) {
    if (service.serviceType === 'accessory_information' || 
        service.serviceType === '0000003E-0000-1000-8000-0026BB765291') continue;
    
    for (const char of service.characteristics || []) {
      if (!hiddenTypes.includes(char.characteristicType)) {
        result.push({
          type: char.characteristicType,
          value: parseCharacteristicValue(char.value),
          isWritable: char.isWritable ?? false,
          characteristic: char,
        });
      }
    }
  }
  return result;
};

// Format characteristic type for display
export const formatCharacteristicType = (type: string): string => {
  // Handle UUID types
  if (type.includes('-')) {
    return 'Unknown';
  }
  return type
    .replace(/_/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase());
};

// Format characteristic value for display
export const formatCharacteristicValue = (type: string, value: any): string => {
  if (value === null || value === undefined) return '—';
  
  // Boolean values
  if (typeof value === 'boolean') {
    return value ? 'Yes' : 'No';
  }
  
  // Specific type formatting
  switch (type) {
    case 'current_temperature':
    case 'target_temperature':
    case 'heating_threshold':
    case 'cooling_threshold':
      return `${Number(value).toFixed(1)}°C`;
    case 'relative_humidity':
    case 'brightness':
    case 'battery_level':
    case 'rotation_speed':
    case 'volume':
    case 'current_position':
    case 'target_position':
      return `${value}%`;
    case 'hue':
      return `${value}°`;
    case 'lock_current_state':
      const lockStates = ['Unlocked', 'Locked', 'Jammed', 'Unknown'];
      return lockStates[value] || 'Unknown';
    case 'heating_cooling_current':
      const hvacModes = ['Off', 'Heating', 'Cooling'];
      return hvacModes[value] || 'Unknown';
    default:
      return String(value);
  }
};
