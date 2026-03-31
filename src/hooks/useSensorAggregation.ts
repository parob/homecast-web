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

/**
 * Extract characteristic value from an accessory by type.
 * Returns undefined if not found or accessory is unreachable.
 */
function getCharacteristicValue(
  accessory: HomeKitAccessory,
  types: string[]
): unknown | undefined {
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
            return JSON.parse(char.value);
          } catch {
            return char.value;
          }
        }
        return char.value;
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
      // Temperature
      const temp = getCharacteristicValue(accessory, TEMPERATURE_TYPES);
      if (typeof temp === 'number' && !isNaN(temp)) {
        temperatureReadings.push({
          accessoryId: accessory.id,
          accessoryName: accessory.name,
          roomName: accessory.roomName,
          value: temp,
        });
      }

      // Humidity
      const humidity = getCharacteristicValue(accessory, HUMIDITY_TYPES);
      if (typeof humidity === 'number' && !isNaN(humidity)) {
        humidityReadings.push({
          accessoryId: accessory.id,
          accessoryName: accessory.name,
          roomName: accessory.roomName,
          value: humidity,
        });
      }

      // Motion/Occupancy
      const motion = getCharacteristicValue(accessory, MOTION_TYPES);
      if (typeof motion === 'boolean') {
        motionReadings.push({
          accessoryId: accessory.id,
          accessoryName: accessory.name,
          roomName: accessory.roomName,
          value: motion,
        });
      }

      // Locks
      const lockState = getCharacteristicValue(accessory, LOCK_TYPES);
      if (typeof lockState === 'number') {
        lockReadings.push({
          accessoryId: accessory.id,
          accessoryName: accessory.name,
          roomName: accessory.roomName,
          value: lockState,
        });
      }

      // Contact sensors
      const contactState = getCharacteristicValue(accessory, CONTACT_TYPES);
      if (typeof contactState === 'number') {
        contactReadings.push({
          accessoryId: accessory.id,
          accessoryName: accessory.name,
          roomName: accessory.roomName,
          value: contactState,
        });
      }

      // Low battery
      const lowBattery = getCharacteristicValue(accessory, BATTERY_TYPES);
      if (lowBattery === true || lowBattery === 1) {
        batteryReadings.push({
          accessoryId: accessory.id,
          accessoryName: accessory.name,
          roomName: accessory.roomName,
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
