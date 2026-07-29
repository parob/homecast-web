// The icons a Notify node can put on the notification it sends.
//
// Distinct from `icons.ts`, which glyphs the *canvas*. These are delivered: the
// slug travels with the notification and is turned into a picture three separate
// ways — a rasterised PNG served from the web origin (APNs and Android can only
// take a URL), and a natively rendered symbol on the relay Mac.
//
// The slug is a public contract: it is the PNG's filename, so
// `https://homecast.cloud/notification-icons/leak.png` is a URL already-shipped
// automations and already-delivered notifications point at. That is why slugs
// are semantic (`leak`, `alert`) rather than the lucide name of the day — the
// icon behind one can be swapped, or the whole library replaced, without
// breaking a URL. `lucide` is the current drawing of it, and is the filename the
// rasteriser reads from lucide-static.

import {
  Lightbulb, Power, Plug, Thermometer, Fan, Wind, Droplets, Droplet,
  Lock, LockOpen, Shield, DoorClosed, DoorOpen, Blinds, Warehouse,
  Activity, Camera, BellRing, Speaker, Flower2, Flame,
  TriangleAlert, CircleCheck, CircleX, Info, Bell, House, Clock,
  Zap, Sun, Moon, User, WifiOff, BatteryLow, Key, Siren,
  type LucideIcon,
} from 'lucide-react';

export type NotificationIconGroup = 'device' | 'status' | 'home';

export interface NotificationIconDef {
  /** Stable, URL-safe identity. Also the PNG filename. Never rename one. */
  slug: string;
  label: string;
  group: NotificationIconGroup;
  /** lucide icon name, kebab-case — the lucide-static SVG the rasteriser reads. */
  lucide: string;
  Icon: LucideIcon;
}

// Device and sensor icons are seeded from SERVICE_TYPE_ICONS in
// AccessoryPicker.tsx so a notification about a leak sensor carries the same
// glyph the accessory list shows for it, rather than a second vocabulary.
export const NOTIFICATION_ICONS: NotificationIconDef[] = [
  // Devices
  { slug: 'light', label: 'Light', group: 'device', lucide: 'lightbulb', Icon: Lightbulb },
  { slug: 'switch', label: 'Switch', group: 'device', lucide: 'power', Icon: Power },
  { slug: 'outlet', label: 'Outlet', group: 'device', lucide: 'plug', Icon: Plug },
  { slug: 'thermostat', label: 'Thermostat', group: 'device', lucide: 'thermometer', Icon: Thermometer },
  { slug: 'fan', label: 'Fan', group: 'device', lucide: 'fan', Icon: Fan },
  { slug: 'air', label: 'Air quality', group: 'device', lucide: 'wind', Icon: Wind },
  { slug: 'humidity', label: 'Humidity', group: 'device', lucide: 'droplets', Icon: Droplets },
  { slug: 'blinds', label: 'Blinds', group: 'device', lucide: 'blinds', Icon: Blinds },
  { slug: 'garage', label: 'Garage', group: 'device', lucide: 'warehouse', Icon: Warehouse },
  { slug: 'camera', label: 'Camera', group: 'device', lucide: 'camera', Icon: Camera },
  { slug: 'doorbell', label: 'Doorbell', group: 'device', lucide: 'bell-ring', Icon: BellRing },
  { slug: 'speaker', label: 'Speaker', group: 'device', lucide: 'speaker', Icon: Speaker },
  { slug: 'irrigation', label: 'Irrigation', group: 'device', lucide: 'flower-2', Icon: Flower2 },

  // Status — what the automation is telling you
  { slug: 'notification', label: 'Notification', group: 'status', lucide: 'bell', Icon: Bell },
  { slug: 'alert', label: 'Alert', group: 'status', lucide: 'triangle-alert', Icon: TriangleAlert },
  { slug: 'success', label: 'Success', group: 'status', lucide: 'circle-check', Icon: CircleCheck },
  { slug: 'error', label: 'Error', group: 'status', lucide: 'circle-x', Icon: CircleX },
  { slug: 'info', label: 'Info', group: 'status', lucide: 'info', Icon: Info },
  { slug: 'motion', label: 'Motion', group: 'status', lucide: 'activity', Icon: Activity },
  { slug: 'leak', label: 'Leak', group: 'status', lucide: 'droplet', Icon: Droplet },
  { slug: 'smoke', label: 'Smoke', group: 'status', lucide: 'flame', Icon: Flame },
  { slug: 'siren', label: 'Siren', group: 'status', lucide: 'siren', Icon: Siren },
  { slug: 'offline', label: 'Offline', group: 'status', lucide: 'wifi-off', Icon: WifiOff },
  { slug: 'battery', label: 'Battery', group: 'status', lucide: 'battery-low', Icon: BatteryLow },
  { slug: 'energy', label: 'Energy', group: 'status', lucide: 'zap', Icon: Zap },

  // Home and time
  { slug: 'home', label: 'Home', group: 'home', lucide: 'house', Icon: House },
  { slug: 'door', label: 'Door', group: 'home', lucide: 'door-closed', Icon: DoorClosed },
  { slug: 'door-open', label: 'Door open', group: 'home', lucide: 'door-open', Icon: DoorOpen },
  { slug: 'lock', label: 'Locked', group: 'home', lucide: 'lock', Icon: Lock },
  { slug: 'unlock', label: 'Unlocked', group: 'home', lucide: 'lock-open', Icon: LockOpen },
  { slug: 'security', label: 'Security', group: 'home', lucide: 'shield', Icon: Shield },
  { slug: 'key', label: 'Key', group: 'home', lucide: 'key', Icon: Key },
  { slug: 'person', label: 'Person', group: 'home', lucide: 'user', Icon: User },
  { slug: 'schedule', label: 'Schedule', group: 'home', lucide: 'clock', Icon: Clock },
  { slug: 'day', label: 'Daytime', group: 'home', lucide: 'sun', Icon: Sun },
  { slug: 'night', label: 'Night', group: 'home', lucide: 'moon', Icon: Moon },
];

// The tile colour is baked into the rasterised PNG, so a colour is part of the
// URL — `/notification-icons/{color}/{slug}.png` — and therefore as much of a
// public contract as the slug. A fixed palette rather than free hex: it keeps
// every notification legible against a white glyph, lets colour carry meaning
// (red for alerts, amber for warnings) instead of becoming decoration, and needs
// no server-side image rendering.
//
// `from`/`to` are the gradient stops, matching the brand header's treatment.
export interface NotificationIconColor {
  slug: string;
  label: string;
  from: string;
  to: string;
}

export const NOTIFICATION_ICON_COLORS: NotificationIconColor[] = [
  { slug: 'blue', label: 'Blue', from: '#3B82F6', to: '#2563EB' },
  { slug: 'red', label: 'Red', from: '#EF4444', to: '#DC2626' },
  { slug: 'amber', label: 'Amber', from: '#F59E0B', to: '#D97706' },
  { slug: 'green', label: 'Green', from: '#22C55E', to: '#16A34A' },
  { slug: 'teal', label: 'Teal', from: '#14B8A6', to: '#0D9488' },
  { slug: 'purple', label: 'Purple', from: '#A855F7', to: '#9333EA' },
  { slug: 'pink', label: 'Pink', from: '#EC4899', to: '#DB2777' },
  { slug: 'slate', label: 'Slate', from: '#64748B', to: '#475569' },
];

/**
 * The colour a Notify node gets when it doesn't choose one.
 *
 * Also the colour served from the *root* path, `/notification-icons/{slug}.png`,
 * which is what every automation created before colours existed points at. That
 * path must keep working and keep looking the same.
 */
export const DEFAULT_NOTIFICATION_ICON_COLOR = 'blue';

const BY_COLOR: Record<string, NotificationIconColor> = Object.fromEntries(
  NOTIFICATION_ICON_COLORS.map((c) => [c.slug, c]),
);

export function getNotificationIconColor(slug: string | undefined): NotificationIconColor {
  return (slug && BY_COLOR[slug]) || BY_COLOR[DEFAULT_NOTIFICATION_ICON_COLOR];
}

export function isNotificationIconColor(value: string): boolean {
  return value in BY_COLOR;
}

const BY_SLUG: Record<string, NotificationIconDef> = Object.fromEntries(
  NOTIFICATION_ICONS.map((i) => [i.slug, i]),
);

/** The icon shown when a Notify node hasn't chosen one. */
export const DEFAULT_NOTIFICATION_ICON = 'notification';

export function getNotificationIcon(slug: string | undefined): NotificationIconDef | undefined {
  return slug ? BY_SLUG[slug] : undefined;
}

/**
 * A built-in slug, as opposed to a custom URL.
 *
 * Deliberately narrower than "is a key of BY_SLUG": the same shape is what the
 * server matches before interpolating a slug into an icon URL, so anything that
 * could escape the path has to fail here too.
 */
const SLUG_PATTERN = /^[a-z0-9-]{1,40}$/;

export function isNotificationIconSlug(value: string): boolean {
  return SLUG_PATTERN.test(value) && value in BY_SLUG;
}

/** Icons can also be an https URL — a camera snapshot from an upstream node, say. */
export function isNotificationIconUrl(value: string): boolean {
  return value.length <= 2048 && /^https:\/\/\S+$/i.test(value);
}

/**
 * Whether a value is usable as a Notify icon at all.
 *
 * Templates are exempt: `{{ nodes.snap.data.url }}` is only a URL once the
 * automation runs, so it cannot be judged here — the run-time resolution and the
 * server both re-check the resolved value.
 */
export function isValidNotificationIcon(value: string): boolean {
  if (!value) return true;
  if (value.includes('{{')) return true;
  return isNotificationIconSlug(value) || isNotificationIconUrl(value);
}
