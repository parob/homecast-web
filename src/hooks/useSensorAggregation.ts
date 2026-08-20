/**
 * Hook for aggregating sensor data from HomeKit accessories.
 * Extracts temperature, humidity, motion, lock, contact, and battery readings
 * and provides aggregated summaries with individual breakdowns.
 */

import { useMemo } from 'react';
import type { HomeKitAccessory } from '../native/homekit-bridge';

// ============================================================================
// Types
// ============================================================================

export interface SensorReading {
  accessoryId: string;
  accessoryName: string;
  roomName?: string;
  value: number | boolean;
  /**
   * The characteristic this reading actually came from. A category can match
   * more than one type (motion is motion_detected OR occupancy_detected), so
   * the category alone cannot be turned back into a history query.
   */
  characteristicType: string;
  /** Which home the accessory belongs to — a collection can span several. */
  homeId?: string;
}

export interface NumericAggregation {
  avg: number;
  min: number;
  max: number;
  readings: SensorReading[];
}

export interface MotionAggregation {
  activeCount: number;
  totalCount: number;
  readings: SensorReading[];
}

export interface LockAggregation {
  lockedCount: number;
  unlockedCount: number;
  jammedCount: number;
  readings: SensorReading[];
}

export interface ContactAggregation {
  openCount: number;
  closedCount: number;
  readings: SensorReading[];
}

export interface BatteryAggregation {
  count: number;
  readings: SensorReading[];
}

export interface AggregatedSensorData {
  temperature: NumericAggregation | null;
  humidity: NumericAggregation | null;
  motion: MotionAggregation | null;
  locks: LockAggregation | null;
  contacts: ContactAggregation | null;
  lowBattery: BatteryAggregation | null;
  hasData: boolean;
}

// ============================================================================
// Characteristic type constants
// ============================================================================

const TEMPERATURE_TYPES = ['current_temperature'];
const HUMIDITY_TYPES = ['relative_humidity', 'current_relative_humidity'];
const MOTION_TYPES = ['motion_detected', 'occupancy_detected'];
const LOCK_TYPES = ['lock_current_state'];
const CONTACT_TYPES = ['contact_state', 'contact_sensor_state'];
const BATTERY_TYPES = ['status_low_battery'];

// Lock state values (HomeKit standard)
const LOCK_STATE = {
  UNSECURED: 0,
  SECURED: 1,
  JAMMED: 2,
  UNKNOWN: 3,
} as const;

// Contact state values (HomeKit standard)
const CONTACT_STATE = {
  DETECTED: 0, // Contact detected = closed
  NOT_DETECTED: 1, // No contact = open
} as const;

// ============================================================================
// Helper functions
// ============================================================================

/** A matched characteristic: its parsed value, and the type that matched. */
interface Matched {
  value: unknown;
  characteristicType: string;
}

/**
 * Find the first characteristic on an accessory whose type is in `types`.
 * Returns undefined if not found or accessory is unreachable.
 *
 * Reports the matched type alongside the value: the caller needs it to build
 * a history query, and several categories accept more than one type.
 */
function findCharacteristic(
  accessory: HomeKitAccessory,
  types: string[]
): Matched | undefined {
  // Skip unreachable accessories
  if (!accessory.isReachable) {
    return undefined;
  }

  for (const service of accessory.services) {
    for (const char of service.characteristics) {
      if (types.includes(char.characteristicType) && char.value !== undefined) {
        // Parse JSON-encoded value if it's a string
        if (typeof char.value === 'string') {
          try {
            return { value: JSON.parse(char.value), characteristicType: char.characteristicType };
          } catch {
            return { value: char.value, characteristicType: char.characteristicType };
          }
        }
        return { value: char.value, characteristicType: char.characteristicType };
      }
    }
  }
  return undefined;
}

/**
 * Aggregate numeric sensor readings (temperature, humidity).
 */
function aggregateNumeric(readings: SensorReading[]): NumericAggregation | null {
  if (readings.length === 0) return null;

  const values = readings.map((r) => r.value as number);
  const sum = values.reduce((a, b) => a + b, 0);

  return {
    avg: sum / values.length,
    min: Math.min(...values),
    max: Math.max(...values),
    readings,
  };
}

// ============================================================================
// Main hook
// ============================================================================

/**
 * Aggregate sensor data from an array of HomeKit accessories.
 * Returns aggregated readings for temperature, humidity, motion, locks, contacts, and battery.
 */
export function useSensorAggregation(accessories: HomeKitAccessory[]): AggregatedSensorData {
  return useMemo(() => {
    const temperatureReadings: SensorReading[] = [];
    const humidityReadings: SensorReading[] = [];
    const motionReadings: SensorReading[] = [];
    const lockReadings: SensorReading[] = [];
    const contactReadings: SensorReading[] = [];
    const batteryReadings: SensorReading[] = [];

    for (const accessory of accessories) {
      // Everything a reading carries about where it came from, written once.
      const provenance = {
        accessoryId: accessory.id,
        accessoryName: accessory.name,
        roomName: accessory.roomName,
        homeId: accessory.homeId,
      };

      // Temperature
      const temp = findCharacteristic(accessory, TEMPERATURE_TYPES);
      if (typeof temp?.value === 'number' && !isNaN(temp.value)) {
        temperatureReadings.push({
          ...provenance,
          characteristicType: temp.characteristicType,
          value: temp.value,
        });
      }

      // Humidity
      const humidity = findCharacteristic(accessory, HUMIDITY_TYPES);
      if (typeof humidity?.value === 'number' && !isNaN(humidity.value)) {
        humidityReadings.push({
          ...provenance,
          characteristicType: humidity.characteristicType,
          value: humidity.value,
        });
      }

      // Motion/Occupancy
      const motion = findCharacteristic(accessory, MOTION_TYPES);
      if (typeof motion?.value === 'boolean') {
        motionReadings.push({
          ...provenance,
          characteristicType: motion.characteristicType,
          value: motion.value,
        });
      }

      // Locks
      const lockState = findCharacteristic(accessory, LOCK_TYPES);
      if (typeof lockState?.value === 'number') {
        lockReadings.push({
          ...provenance,
          characteristicType: lockState.characteristicType,
          value: lockState.value,
        });
      }

      // Contact sensors
      const contactState = findCharacteristic(accessory, CONTACT_TYPES);
      if (typeof contactState?.value === 'number') {
        contactReadings.push({
          ...provenance,
          characteristicType: contactState.characteristicType,
          value: contactState.value,
        });
      }

      // Low battery
      const lowBattery = findCharacteristic(accessory, BATTERY_TYPES);
      if (lowBattery?.value === true || lowBattery?.value === 1) {
        batteryReadings.push({
          ...provenance,
          characteristicType: lowBattery.characteristicType,
          value: true,
        });
      }
    }

    // Aggregate temperature
    const temperature = aggregateNumeric(temperatureReadings);

    // Aggregate humidity
    const humidity = aggregateNumeric(humidityReadings);

    // Aggregate motion
    const motion: MotionAggregation | null =
      motionReadings.length > 0
        ? {
            activeCount: motionReadings.filter((r) => r.value === true).length,
            totalCount: motionReadings.length,
            readings: motionReadings,
          }
        : null;

    // Aggregate locks
    const locks: LockAggregation | null =
      lockReadings.length > 0
        ? {
            lockedCount: lockReadings.filter((r) => r.value === LOCK_STATE.SECURED).length,
            unlockedCount: lockReadings.filter((r) => r.value === LOCK_STATE.UNSECURED).length,
            jammedCount: lockReadings.filter((r) => r.value === LOCK_STATE.JAMMED).length,
            readings: lockReadings,
          }
        : null;

    // Aggregate contacts
    const contacts: ContactAggregation | null =
      contactReadings.length > 0
        ? {
            openCount: contactReadings.filter((r) => r.value === CONTACT_STATE.NOT_DETECTED).length,
            closedCount: contactReadings.filter((r) => r.value === CONTACT_STATE.DETECTED).length,
            readings: contactReadings,
          }
        : null;

    // Aggregate low battery
    const lowBattery: BatteryAggregation | null =
      batteryReadings.length > 0
        ? {
            count: batteryReadings.length,
            readings: batteryReadings,
          }
        : null;

    const hasData = !!(temperature || humidity || motion || locks || contacts || lowBattery);

    return {
      temperature,
      humidity,
      motion,
      locks,
      contacts,
      lowBattery,
      hasData,
    };
  }, [accessories]);
}

export default useSensorAggregation;
