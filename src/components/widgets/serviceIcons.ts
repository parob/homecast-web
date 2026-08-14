/**
 * Which glyph stands for an accessory, by its primary service type.
 *
 * Lifted out of `AccessoryPicker` once the tab bar needed it too: a pinned lamp
 * should wear the same icon as its tile, and importing the picker — a
 * virtualized list with its own search index — just to draw one icon would pull
 * all of that into the bar's bundle. `automation-editor/notificationIcons.ts`
 * already notes it was seeded from this map; this is the shared home both of
 * them should have had.
 */

import {
  Activity, AlertTriangle, Bell, Blinds, CircleDot, DoorClosed, Droplet, Droplets,
  Disc, Fan, Flower2, Lightbulb, Lock, Plug, Power, Shield, Speaker, Sun,
  Thermometer, Video, Warehouse, Wind,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { getPrimaryServiceType } from './types';

export const SERVICE_TYPE_ICONS: Record<string, LucideIcon> = {
  lightbulb: Lightbulb,
  switch: Power,
  outlet: Plug,
  thermostat: Thermometer,
  heater_cooler: Thermometer,
  fan: Fan,
  air_purifier: Wind,
  humidifier_dehumidifier: Droplets,
  lock: Lock,
  security_system: Shield,
  door: DoorClosed,
  window: DoorClosed,
  window_covering: Blinds,
  garage_door: Warehouse,
  contact_sensor: DoorClosed,
  motion_sensor: Activity,
  occupancy_sensor: Activity,
  temperature_sensor: Thermometer,
  humidity_sensor: Droplets,
  light_sensor: Sun,
  smoke_sensor: AlertTriangle,
  carbon_monoxide_sensor: Wind,
  carbon_dioxide_sensor: Wind,
  leak_sensor: Droplet,
  air_quality_sensor: Wind,
  speaker: Speaker,
  smart_speaker: Speaker,
  microphone: Speaker,
  camera: Video,
  doorbell: Bell,
  valve: Droplets,
  faucet: Droplets,
  irrigation_system: Flower2,
  stateless_programmable_switch: Disc,
};

/** Falls back to a neutral dot, so an unknown service still gets a glyph. */
export function getAccessoryIcon(
  accessory: { services?: Array<{ serviceType: string }> } | null | undefined,
): LucideIcon {
  if (!accessory) return CircleDot;
  const serviceType = getPrimaryServiceType(accessory as never);
  if (serviceType && SERVICE_TYPE_ICONS[serviceType]) {
    return SERVICE_TYPE_ICONS[serviceType];
  }
  return CircleDot;
}
