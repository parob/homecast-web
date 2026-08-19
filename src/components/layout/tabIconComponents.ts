/**
 * The lucide layer over `lib/tab-icons.ts`.
 *
 * Split for the same reason `actions/icons.ts` is split from `catalog.ts`: the
 * key list is a pure module the picker, the bar and the tests can all import,
 * and this is the thin mapping that pulls React components in.
 *
 * Every key in `TAB_ICON_KEYS` must appear here — a unit test asserts it, so a
 * key added to the vocabulary without a glyph fails the build rather than
 * rendering a hole in the picker.
 */

import {
  Archive, ArrowUpFromLine, Baby, Bath, Battery, Bed, Bell, Blinds, BookMarked,
  BookOpen, Briefcase, Camera, Car, Clapperboard, Clock, Calendar, Coffee,
  Compass, CookingPot, DoorOpen, Droplet, Dumbbell, Fan, Flag, Flame, Folder,
  Gamepad2, Gift, Grid3x3, Heart, House, Lamp, Layers, Leaf, Lightbulb, Lock,
  LockOpen, MapPin, Monitor, Moon, Music, PawPrint, Palette, Play, Plug, Power,
  Radio, Server, Settings, Shield, ShowerHead, Shirt, Sofa, Sparkles, Star, Sun,
  Sunrise, Sunset, ToggleLeft, Thermometer, Trees, Tv, User, Users,
  UtensilsCrossed, Waves, WashingMachine, Wifi, Wind, Zap,
  type LucideIcon,
} from 'lucide-react';
import { TAB_ICON_KEYS, type TabIconKey } from '@/lib/tab-icons';

const ICONS: Record<TabIconKey, LucideIcon> = {
  // Rooms
  'sofa': Sofa, 'bed': Bed, 'cooking-pot': CookingPot, 'utensils': UtensilsCrossed,
  'bath': Bath, 'shower': ShowerHead, 'desk': Monitor, 'books': BookOpen,
  'laundry': WashingMachine, 'wardrobe': Shirt, 'store': Archive, 'garage': Car,
  'garden': Trees, 'balcony': Sunrise, 'pool': Waves, 'plant': Leaf,
  'door': DoorOpen, 'stairs': ArrowUpFromLine, 'nursery': Baby, 'gym': Dumbbell,
  'cinema': Clapperboard, 'games': Gamepad2, 'bar': Coffee, 'studio': Palette,
  'pets': PawPrint, 'utility': Server,
  // Accessories
  'lightbulb': Lightbulb, 'lamp': Lamp, 'blinds': Blinds, 'lock': Lock,
  'unlock': LockOpen, 'fan': Fan, 'outlet': Plug, 'thermostat': Thermometer,
  'shield': Shield, 'power': Power, 'camera': Camera, 'doorbell': Bell,
  'speaker': Radio, 'tv': Tv, 'sensor': Wind, 'water': Droplet, 'flame': Flame,
  'battery': Battery, 'wifi': Wifi, 'switch': ToggleLeft,
  // General
  'home': House, 'star': Star, 'heart': Heart, 'bookmark': BookMarked,
  'flag': Flag, 'bell': Bell, 'clock': Clock, 'calendar': Calendar, 'sun': Sun,
  'moon': Moon, 'sunrise': Sunrise, 'sunset': Sunset, 'sparkles': Sparkles,
  'zap': Zap, 'play': Play, 'layers': Layers, 'folder': Folder, 'grid': Grid3x3,
  'compass': Compass, 'map-pin': MapPin, 'user': User, 'users': Users,
  'settings': Settings, 'coffee': Coffee, 'music': Music, 'car': Car,
  'briefcase': Briefcase, 'gift': Gift,
};

/** The glyph for a stored key, or undefined so the caller can derive one. */
export function tabIconComponent(key: string | undefined): LucideIcon | undefined {
  return key ? ICONS[key] : undefined;
}

/** Every key the vocabulary defines, paired with its glyph. For the picker. */
export function tabIconEntries(keys: TabIconKey[]): { key: TabIconKey; Icon: LucideIcon }[] {
  return keys.flatMap(key => {
    const Icon = ICONS[key];
    return Icon ? [{ key, Icon }] : [];
  });
}

/** Exported for the test that keeps this in step with the vocabulary. */
export const MAPPED_ICON_KEYS = Object.keys(ICONS);
export { TAB_ICON_KEYS };
