import {
  Activity, Blinds, Circle, DoorOpen, Droplets, Fan, Flame, Gauge, Lightbulb,
  Lock, Plug, Power, ShieldCheck, Speaker, Sparkles, SprayCan, Thermometer,
  Video, Wind,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

/**
 * A glyph per kind of accessory, keyed by resolveWidgetType's answer — the
 * same classification the dashboard's widgets use, so a lock is the same
 * padlock in both places.
 *
 * A column of similar names is hard to scan; the icon is what lets you find
 * the thermostat among six sensors without reading.
 */
const ICONS: Record<string, LucideIcon> = {
  lightbulb: Lightbulb,
  switch: Power,
  outlet: Plug,
  fan: Fan,
  thermostat: Thermometer,
  humidifier: Droplets,
  air_purifier: Wind,
  lock: Lock,
  garage_door: DoorOpen,
  door_window: DoorOpen,
  window_covering: Blinds,
  valve: Droplets,
  irrigation: SprayCan,
  camera: Video,
  doorbell: Video,
  speaker: Speaker,
  smoke_alarm: Flame,
  security_system: ShieldCheck,
  motion_sensor: Activity,
  contact_sensor: DoorOpen,
  multi_sensor: Gauge,
  sensor: Gauge,
  button: Circle,
  remote: Circle,
  virtual: Sparkles,
};

export function accessoryIcon(widgetType?: string): LucideIcon {
  if (!widgetType) return Gauge;
  return ICONS[widgetType] ?? Gauge;
}
