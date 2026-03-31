/** Human-readable characteristic type labels */
const CHAR_LABELS: Record<string, string> = {
  // Power
  on: 'Power State',
  active: 'Power State',
  power_state: 'Power State',
  // Lighting
  brightness: 'Brightness',
  hue: 'Hue',
  saturation: 'Saturation',
  color_temperature: 'Color Temperature',
  // Position / Blinds
  target_position: 'Target Position',
  current_position: 'Position',
  target_tilt_angle: 'Target Tilt',
  current_tilt_angle: 'Tilt',
  // Climate
  target_temperature: 'Target Temperature',
  current_temperature: 'Temperature',
  heating_threshold: 'Heating Threshold',
  cooling_threshold: 'Cooling Threshold',
  target_heating_cooling: 'HVAC Mode',
  target_heater_cooler_state: 'Target HVAC Mode',
  current_heater_cooler_state: 'Current HVAC Mode',
  current_humidity: 'Humidity',
  target_relative_humidity: 'Target Humidity',
  // Lock
  lock_target_state: 'Lock State',
  lock_current_state: 'Lock State',
  // Fan
  rotation_speed: 'Fan Speed',
  swing_mode: 'Swing Mode',
  // Audio
  volume: 'Volume',
  mute: 'Mute',
  // Sensors
  motion_detected: 'Motion Detected',
  occupancy_detected: 'Occupancy Detected',
  contact_sensor_state: 'Contact State',
  smoke_detected: 'Smoke Detected',
  carbon_monoxide_detected: 'CO Detected',
  carbon_dioxide_level: 'CO2 Level',
  air_quality: 'Air Quality',
  leak_detected: 'Leak Detected',
  obstruction_detected: 'Obstruction Detected',
  light_level: 'Light Level',
  current_ambient_light_level: 'Light Level',
  // Battery
  battery_level: 'Battery Level',
  status_low_battery: 'Low Battery',
  charging_state: 'Charging State',
  // Doors
  current_door_state: 'Door State',
  target_door_state: 'Target Door State',
  // Other
  configured_name: 'Name',
  name: 'Name',
  identify: 'Identify',
};

/** Get a human-readable label for a characteristic type */
export function charLabel(type: string): string {
  return CHAR_LABELS[type] || type.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
}

/** Format a characteristic value for display */
export function formatValue(val: unknown, charType?: string): string {
  if (val == null) return '';

  // Parse JSON-encoded strings
  let parsed = val;
  if (typeof val === 'string') {
    try { parsed = JSON.parse(val); } catch { return val; }
  }

  // Boolean-like characteristics
  if (typeof parsed === 'boolean') return parsed ? 'On' : 'Off';
  if (typeof parsed === 'number') {
    const boolTypes = ['on', 'active', 'power_state', 'mute', 'motion_detected', 'occupancy_detected',
      'smoke_detected', 'carbon_monoxide_detected', 'leak_detected', 'obstruction_detected', 'status_low_battery'];
    if (charType && boolTypes.includes(charType)) return parsed ? 'On' : 'Off';

    // Position
    if (charType === 'target_position' || charType === 'current_position') {
      return parsed === 0 ? 'Closed' : parsed === 100 ? 'Open' : `${parsed}%`;
    }
    // Percentage
    if (charType === 'brightness' || charType === 'rotation_speed' || charType === 'volume' ||
        charType === 'battery_level' || charType === 'current_humidity' || charType === 'target_relative_humidity') {
      return `${parsed}%`;
    }
    // Temperature
    if (charType?.includes('temperature') || charType?.includes('threshold')) {
      return `${parsed}°`;
    }
    // Lock
    if (charType === 'lock_target_state' || charType === 'lock_current_state') {
      return parsed === 1 ? 'Locked' : 'Unlocked';
    }

    return String(parsed);
  }

  return String(parsed);
}
