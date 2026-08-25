import { ServiceType } from './types';

// Complete widget color scheme for different device types
// These are Tailwind CSS color classes, except `tint` — see the note on it below.
export type IconColor = {
  // Icon colors (existing)
  bg: string;      // Icon background when on
  bgOff: string;   // Icon background when off
  text: string;    // Icon color when on
  textOff: string; // Icon color when off
  // Card background colors (new)
  cardBg: string;      // Card background when on
  cardBgHover: string; // Card background on hover when on
  cardBorder: string;  // Card border/ring when on
  // Control accent colors (new)
  accent: string;       // Primary accent color for buttons/switches
  accentHover: string;  // Accent hover state
  accentMuted: string;  // Muted accent for secondary elements
  accentMutedHover: string; // Muted accent hover state
  // Slider colors
  sliderTrack: string;  // Slider track fill color
  sliderThumb: string;  // Slider thumb color
  // Switch colors
  switchBg: string;     // Switch background when checked
  // The tile's fill.
  //
  // A hex, not a Tailwind class, because the fill is now painted at a strength
  // proportional to how far on the accessory is — and `tailwind.config.ts` has
  // no `safelist`, so a generated `bg-yellow-200/${pct}` would be purged. The
  // maths lives in `lib/widget-tint.ts`; this is just the colour it starts from.
  tint: string;
  /** Overrides the shared TINT_ALPHA for the rare entry that painted at another alpha. */
  tintAlpha?: number;
};

// Color palette for device types
export const ICON_COLORS: Record<string, IconColor> = {
  // Lights - warm yellow/amber
  lightbulb: {
    bg: 'bg-yellow-400',
    bgOff: 'bg-yellow-100 dark:bg-yellow-950',
    text: 'text-yellow-900',
    textOff: 'text-yellow-600 dark:text-yellow-400',
    cardBg: 'bg-yellow-100/80 dark:bg-yellow-950/50',
    cardBgHover: 'hover:bg-yellow-200/80 dark:hover:bg-yellow-900/50',
    cardBorder: 'ring-yellow-300 dark:ring-yellow-700',
    accent: 'bg-yellow-500 hover:bg-yellow-600',
    accentHover: 'hover:bg-yellow-600',
    accentMuted: 'bg-yellow-200 dark:bg-yellow-900',
    accentMutedHover: 'hover:bg-yellow-300 dark:hover:bg-yellow-800',
    sliderTrack: 'bg-yellow-500',
    sliderThumb: 'bg-yellow-600',
    switchBg: 'bg-yellow-500',
    tint: '#fef08a', // yellow-200
  },

  // Switches & Outlets - blue
  switch: {
    bg: 'bg-blue-500',
    bgOff: 'bg-blue-100 dark:bg-blue-950',
    text: 'text-white',
    textOff: 'text-blue-600 dark:text-blue-400',
    cardBg: 'bg-blue-100/80 dark:bg-blue-950/50',
    cardBgHover: 'hover:bg-blue-200/80 dark:hover:bg-blue-900/50',
    cardBorder: 'ring-blue-300 dark:ring-blue-700',
    accent: 'bg-blue-500 hover:bg-blue-600',
    accentHover: 'hover:bg-blue-600',
    accentMuted: 'bg-blue-200 dark:bg-blue-900',
    accentMutedHover: 'hover:bg-blue-300 dark:hover:bg-blue-800',
    sliderTrack: 'bg-blue-500',
    sliderThumb: 'bg-blue-600',
    switchBg: 'bg-blue-500',
    tint: '#bfdbfe', // blue-200
  },
  outlet: {
    bg: 'bg-blue-500',
    bgOff: 'bg-blue-100 dark:bg-blue-950',
    text: 'text-white',
    textOff: 'text-blue-600 dark:text-blue-400',
    cardBg: 'bg-blue-100/80 dark:bg-blue-950/50',
    cardBgHover: 'hover:bg-blue-200/80 dark:hover:bg-blue-900/50',
    cardBorder: 'ring-blue-300 dark:ring-blue-700',
    accent: 'bg-blue-500 hover:bg-blue-600',
    accentHover: 'hover:bg-blue-600',
    accentMuted: 'bg-blue-200 dark:bg-blue-900',
    accentMutedHover: 'hover:bg-blue-300 dark:hover:bg-blue-800',
    sliderTrack: 'bg-blue-500',
    sliderThumb: 'bg-blue-600',
    switchBg: 'bg-blue-500',
    tint: '#bfdbfe', // blue-200
  },

  // Climate - orange for heat
  thermostat: {
    bg: 'bg-orange-500',
    bgOff: 'bg-orange-100 dark:bg-orange-950',
    text: 'text-white',
    textOff: 'text-orange-600 dark:text-orange-400',
    cardBg: 'bg-orange-100/80 dark:bg-orange-950/50',
    cardBgHover: 'hover:bg-orange-200/80 dark:hover:bg-orange-900/50',
    cardBorder: 'ring-orange-300 dark:ring-orange-700',
    accent: 'bg-orange-500 hover:bg-orange-600',
    accentHover: 'hover:bg-orange-600',
    accentMuted: 'bg-orange-200 dark:bg-orange-900',
    accentMutedHover: 'hover:bg-orange-300 dark:hover:bg-orange-800',
    sliderTrack: 'bg-orange-500',
    sliderThumb: 'bg-orange-600',
    switchBg: 'bg-orange-500',
    tint: '#fed7aa', // orange-200
  },
  // Heater/Cooler - sky blue for cooling
  heater_cooler: {
    bg: 'bg-sky-500',
    bgOff: 'bg-sky-100 dark:bg-sky-950',
    text: 'text-white',
    textOff: 'text-sky-600 dark:text-sky-400',
    cardBg: 'bg-sky-100/80 dark:bg-sky-950/50',
    cardBgHover: 'hover:bg-sky-200/80 dark:hover:bg-sky-900/50',
    cardBorder: 'ring-sky-300 dark:ring-sky-700',
    accent: 'bg-sky-500 hover:bg-sky-600',
    accentHover: 'hover:bg-sky-600',
    accentMuted: 'bg-sky-200 dark:bg-sky-900',
    accentMutedHover: 'hover:bg-sky-300 dark:hover:bg-sky-800',
    sliderTrack: 'bg-sky-500',
    sliderThumb: 'bg-sky-600',
    switchBg: 'bg-sky-500',
    tint: '#bae6fd', // sky-200
  },
  // Climate balanced - emerald green
  climate_balanced: {
    bg: 'bg-emerald-500',
    bgOff: 'bg-emerald-100 dark:bg-emerald-950',
    text: 'text-white',
    textOff: 'text-emerald-600 dark:text-emerald-400',
    cardBg: 'bg-emerald-100/80 dark:bg-emerald-950/50',
    cardBgHover: 'hover:bg-emerald-200/80 dark:hover:bg-emerald-900/50',
    cardBorder: 'ring-emerald-300 dark:ring-emerald-700',
    accent: 'bg-emerald-500 hover:bg-emerald-600',
    accentHover: 'hover:bg-emerald-600',
    accentMuted: 'bg-emerald-200 dark:bg-emerald-900',
    accentMutedHover: 'hover:bg-emerald-300 dark:hover:bg-emerald-800',
    sliderTrack: 'bg-emerald-500',
    sliderThumb: 'bg-emerald-600',
    switchBg: 'bg-emerald-500',
    tint: '#a7f3d0', // emerald-200
  },

  // Fans - cyan/teal
  fan: {
    bg: 'bg-cyan-500',
    bgOff: 'bg-cyan-100 dark:bg-cyan-950',
    text: 'text-white',
    textOff: 'text-cyan-600 dark:text-cyan-400',
    cardBg: 'bg-cyan-100/80 dark:bg-cyan-950/50',
    cardBgHover: 'hover:bg-cyan-200/80 dark:hover:bg-cyan-900/50',
    cardBorder: 'ring-cyan-300 dark:ring-cyan-700',
    accent: 'bg-cyan-500 hover:bg-cyan-600',
    accentHover: 'hover:bg-cyan-600',
    accentMuted: 'bg-cyan-200 dark:bg-cyan-900',
    accentMutedHover: 'hover:bg-cyan-300 dark:hover:bg-cyan-800',
    sliderTrack: 'bg-cyan-500',
    sliderThumb: 'bg-cyan-600',
    switchBg: 'bg-cyan-500',
    tint: '#a5f3fc', // cyan-200
  },
  air_purifier: {
    bg: 'bg-cyan-500',
    bgOff: 'bg-cyan-100 dark:bg-cyan-950',
    text: 'text-white',
    textOff: 'text-cyan-600 dark:text-cyan-400',
    cardBg: 'bg-cyan-100/80 dark:bg-cyan-950/50',
    cardBgHover: 'hover:bg-cyan-200/80 dark:hover:bg-cyan-900/50',
    cardBorder: 'ring-cyan-300 dark:ring-cyan-700',
    accent: 'bg-cyan-500 hover:bg-cyan-600',
    accentHover: 'hover:bg-cyan-600',
    accentMuted: 'bg-cyan-200 dark:bg-cyan-900',
    accentMutedHover: 'hover:bg-cyan-300 dark:hover:bg-cyan-800',
    sliderTrack: 'bg-cyan-500',
    sliderThumb: 'bg-cyan-600',
    switchBg: 'bg-cyan-500',
    tint: '#a5f3fc', // cyan-200
  },

  // Humidity - sky blue
  humidifier_dehumidifier: {
    bg: 'bg-sky-500',
    bgOff: 'bg-sky-100 dark:bg-sky-950',
    text: 'text-white',
    textOff: 'text-sky-600 dark:text-sky-400',
    cardBg: 'bg-sky-100/80 dark:bg-sky-950/50',
    cardBgHover: 'hover:bg-sky-200/80 dark:hover:bg-sky-900/50',
    cardBorder: 'ring-sky-300 dark:ring-sky-700',
    accent: 'bg-sky-500 hover:bg-sky-600',
    accentHover: 'hover:bg-sky-600',
    accentMuted: 'bg-sky-200 dark:bg-sky-900',
    accentMutedHover: 'hover:bg-sky-300 dark:hover:bg-sky-800',
    sliderTrack: 'bg-sky-500',
    sliderThumb: 'bg-sky-600',
    switchBg: 'bg-sky-500',
    tint: '#bae6fd', // sky-200
  },

  // Locks - slight dark tint for secure feeling
  lock: {
    bg: 'bg-zinc-800 dark:bg-zinc-200',
    bgOff: 'bg-zinc-200 dark:bg-zinc-800',
    text: 'text-white dark:text-zinc-900',
    textOff: 'text-zinc-600 dark:text-zinc-400',
    cardBg: 'bg-zinc-300/80 dark:bg-zinc-800/80',
    cardBgHover: 'hover:bg-zinc-400/80 dark:hover:bg-zinc-700/80',
    cardBorder: 'ring-zinc-300 dark:ring-zinc-700',
    accent: 'bg-zinc-800 hover:bg-zinc-900 dark:bg-zinc-200 dark:hover:bg-zinc-100',
    accentHover: 'hover:bg-zinc-900 dark:hover:bg-zinc-100',
    accentMuted: 'bg-zinc-200 dark:bg-zinc-800',
    accentMutedHover: 'hover:bg-zinc-300 dark:hover:bg-zinc-700',
    sliderTrack: 'bg-zinc-800 dark:bg-zinc-200',
    sliderThumb: 'bg-zinc-900 dark:bg-zinc-100',
    switchBg: 'bg-zinc-800 dark:bg-zinc-200',
    tint: '#e4e4e7', // zinc-200
  },

  // Security - red
  security_system: {
    bg: 'bg-red-500',
    bgOff: 'bg-red-200 dark:bg-red-900',
    text: 'text-white',
    textOff: 'text-red-700 dark:text-red-300',
    cardBg: 'bg-red-100/80 dark:bg-red-950/50',
    cardBgHover: 'hover:bg-red-200/80 dark:hover:bg-red-900/50',
    cardBorder: 'ring-red-300 dark:ring-red-700',
    accent: 'bg-red-500 hover:bg-red-600',
    accentHover: 'hover:bg-red-600',
    accentMuted: 'bg-red-200 dark:bg-red-900',
    accentMutedHover: 'hover:bg-red-300 dark:hover:bg-red-800',
    sliderTrack: 'bg-red-500',
    sliderThumb: 'bg-red-600',
    switchBg: 'bg-red-500',
    tint: '#fecaca', // red-200
  },

  // Doors & Windows - indigo
  door: {
    bg: 'bg-indigo-500',
    bgOff: 'bg-indigo-100 dark:bg-indigo-950',
    text: 'text-white',
    textOff: 'text-indigo-600 dark:text-indigo-400',
    cardBg: 'bg-indigo-100/80 dark:bg-indigo-950/50',
    cardBgHover: 'hover:bg-indigo-200/80 dark:hover:bg-indigo-900/50',
    cardBorder: 'ring-indigo-300 dark:ring-indigo-700',
    accent: 'bg-indigo-500 hover:bg-indigo-600',
    accentHover: 'hover:bg-indigo-600',
    accentMuted: 'bg-indigo-200 dark:bg-indigo-900',
    accentMutedHover: 'hover:bg-indigo-300 dark:hover:bg-indigo-800',
    sliderTrack: 'bg-indigo-500',
    sliderThumb: 'bg-indigo-600',
    switchBg: 'bg-indigo-500',
    tint: '#c7d2fe', // indigo-200
  },
  window: {
    bg: 'bg-indigo-500',
    bgOff: 'bg-indigo-100 dark:bg-indigo-950',
    text: 'text-white',
    textOff: 'text-indigo-600 dark:text-indigo-400',
    cardBg: 'bg-indigo-100/80 dark:bg-indigo-950/50',
    cardBgHover: 'hover:bg-indigo-200/80 dark:hover:bg-indigo-900/50',
    cardBorder: 'ring-indigo-300 dark:ring-indigo-700',
    accent: 'bg-indigo-500 hover:bg-indigo-600',
    accentHover: 'hover:bg-indigo-600',
    accentMuted: 'bg-indigo-200 dark:bg-indigo-900',
    accentMutedHover: 'hover:bg-indigo-300 dark:hover:bg-indigo-800',
    sliderTrack: 'bg-indigo-500',
    sliderThumb: 'bg-indigo-600',
    switchBg: 'bg-indigo-500',
    tint: '#c7d2fe', // indigo-200
  },
  garage_door: {
    bg: 'bg-indigo-500',
    bgOff: 'bg-indigo-100 dark:bg-indigo-950',
    text: 'text-white',
    textOff: 'text-indigo-600 dark:text-indigo-400',
    cardBg: 'bg-indigo-100/80 dark:bg-indigo-950/50',
    cardBgHover: 'hover:bg-indigo-200/80 dark:hover:bg-indigo-900/50',
    cardBorder: 'ring-indigo-300 dark:ring-indigo-700',
    accent: 'bg-indigo-500 hover:bg-indigo-600',
    accentHover: 'hover:bg-indigo-600',
    accentMuted: 'bg-indigo-200 dark:bg-indigo-900',
    accentMutedHover: 'hover:bg-indigo-300 dark:hover:bg-indigo-800',
    sliderTrack: 'bg-indigo-500',
    sliderThumb: 'bg-indigo-600',
    switchBg: 'bg-indigo-500',
    tint: '#c7d2fe', // indigo-200
  },

  // Window coverings / blinds - violet
  window_covering: {
    bg: 'bg-violet-500',
    bgOff: 'bg-violet-100 dark:bg-violet-950',
    text: 'text-white',
    textOff: 'text-violet-600 dark:text-violet-400',
    cardBg: 'bg-violet-100/80 dark:bg-violet-950/50',
    cardBgHover: 'hover:bg-violet-200/80 dark:hover:bg-violet-900/50',
    cardBorder: 'ring-violet-300 dark:ring-violet-700',
    accent: 'bg-violet-500 hover:bg-violet-600',
    accentHover: 'hover:bg-violet-600',
    accentMuted: 'bg-violet-200 dark:bg-violet-900',
    accentMutedHover: 'hover:bg-violet-300 dark:hover:bg-violet-800',
    sliderTrack: 'bg-violet-500',
    sliderThumb: 'bg-violet-600',
    switchBg: 'bg-violet-500',
    tint: '#ddd6fe', // violet-200
  },

  // Sensors - emerald/teal
  motion_sensor: {
    bg: 'bg-emerald-500',
    bgOff: 'bg-emerald-100 dark:bg-emerald-950',
    text: 'text-white',
    textOff: 'text-emerald-600 dark:text-emerald-400',
    cardBg: 'bg-emerald-100/80 dark:bg-emerald-950/50',
    cardBgHover: 'hover:bg-emerald-200/80 dark:hover:bg-emerald-900/50',
    cardBorder: 'ring-emerald-300 dark:ring-emerald-700',
    accent: 'bg-emerald-500 hover:bg-emerald-600',
    accentHover: 'hover:bg-emerald-600',
    accentMuted: 'bg-emerald-200 dark:bg-emerald-900',
    accentMutedHover: 'hover:bg-emerald-300 dark:hover:bg-emerald-800',
    sliderTrack: 'bg-emerald-500',
    sliderThumb: 'bg-emerald-600',
    switchBg: 'bg-emerald-500',
    tint: '#a7f3d0', // emerald-200
  },
  occupancy_sensor: {
    bg: 'bg-emerald-500',
    bgOff: 'bg-emerald-100 dark:bg-emerald-950',
    text: 'text-white',
    textOff: 'text-emerald-600 dark:text-emerald-400',
    cardBg: 'bg-emerald-100/80 dark:bg-emerald-950/50',
    cardBgHover: 'hover:bg-emerald-200/80 dark:hover:bg-emerald-900/50',
    cardBorder: 'ring-emerald-300 dark:ring-emerald-700',
    accent: 'bg-emerald-500 hover:bg-emerald-600',
    accentHover: 'hover:bg-emerald-600',
    accentMuted: 'bg-emerald-200 dark:bg-emerald-900',
    accentMutedHover: 'hover:bg-emerald-300 dark:hover:bg-emerald-800',
    sliderTrack: 'bg-emerald-500',
    sliderThumb: 'bg-emerald-600',
    switchBg: 'bg-emerald-500',
    tint: '#a7f3d0', // emerald-200
  },
  contact_sensor: {
    bg: 'bg-emerald-500',
    bgOff: 'bg-emerald-100 dark:bg-emerald-950',
    text: 'text-white',
    textOff: 'text-emerald-600 dark:text-emerald-400',
    cardBg: 'bg-emerald-100/80 dark:bg-emerald-950/50',
    cardBgHover: 'hover:bg-emerald-200/80 dark:hover:bg-emerald-900/50',
    cardBorder: 'ring-emerald-300 dark:ring-emerald-700',
    accent: 'bg-emerald-500 hover:bg-emerald-600',
    accentHover: 'hover:bg-emerald-600',
    accentMuted: 'bg-emerald-200 dark:bg-emerald-900',
    accentMutedHover: 'hover:bg-emerald-300 dark:hover:bg-emerald-800',
    sliderTrack: 'bg-emerald-500',
    sliderThumb: 'bg-emerald-600',
    switchBg: 'bg-emerald-500',
    tint: '#a7f3d0', // emerald-200
  },
  temperature_sensor: {
    bg: 'bg-rose-500',
    bgOff: 'bg-rose-100 dark:bg-rose-950',
    text: 'text-white',
    textOff: 'text-rose-600 dark:text-rose-400',
    cardBg: 'bg-rose-100/80 dark:bg-rose-950/50',
    cardBgHover: 'hover:bg-rose-200/80 dark:hover:bg-rose-900/50',
    cardBorder: 'ring-rose-300 dark:ring-rose-700',
    accent: 'bg-rose-500 hover:bg-rose-600',
    accentHover: 'hover:bg-rose-600',
    accentMuted: 'bg-rose-200 dark:bg-rose-900',
    accentMutedHover: 'hover:bg-rose-300 dark:hover:bg-rose-800',
    sliderTrack: 'bg-rose-500',
    sliderThumb: 'bg-rose-600',
    switchBg: 'bg-rose-500',
    tint: '#fecdd3', // rose-200
  },
  humidity_sensor: {
    bg: 'bg-sky-500',
    bgOff: 'bg-sky-100 dark:bg-sky-950',
    text: 'text-white',
    textOff: 'text-sky-600 dark:text-sky-400',
    cardBg: 'bg-sky-100/80 dark:bg-sky-950/50',
    cardBgHover: 'hover:bg-sky-200/80 dark:hover:bg-sky-900/50',
    cardBorder: 'ring-sky-300 dark:ring-sky-700',
    accent: 'bg-sky-500 hover:bg-sky-600',
    accentHover: 'hover:bg-sky-600',
    accentMuted: 'bg-sky-200 dark:bg-sky-900',
    accentMutedHover: 'hover:bg-sky-300 dark:hover:bg-sky-800',
    sliderTrack: 'bg-sky-500',
    sliderThumb: 'bg-sky-600',
    switchBg: 'bg-sky-500',
    tint: '#bae6fd', // sky-200
  },
  light_sensor: {
    bg: 'bg-amber-500',
    bgOff: 'bg-amber-100 dark:bg-amber-950',
    text: 'text-white',
    textOff: 'text-amber-600 dark:text-amber-400',
    cardBg: 'bg-amber-100/80 dark:bg-amber-950/50',
    cardBgHover: 'hover:bg-amber-200/80 dark:hover:bg-amber-900/50',
    cardBorder: 'ring-amber-300 dark:ring-amber-700',
    accent: 'bg-amber-500 hover:bg-amber-600',
    accentHover: 'hover:bg-amber-600',
    accentMuted: 'bg-amber-200 dark:bg-amber-900',
    accentMutedHover: 'hover:bg-amber-300 dark:hover:bg-amber-800',
    sliderTrack: 'bg-amber-500',
    sliderThumb: 'bg-amber-600',
    switchBg: 'bg-amber-500',
    tint: '#fde68a', // amber-200
  },
  smoke_sensor: {
    bg: 'bg-red-500',
    bgOff: 'bg-red-100 dark:bg-red-950',
    text: 'text-white',
    textOff: 'text-red-600 dark:text-red-400',
    cardBg: 'bg-red-100/80 dark:bg-red-950/50',
    cardBgHover: 'hover:bg-red-200/80 dark:hover:bg-red-900/50',
    cardBorder: 'ring-red-300 dark:ring-red-700',
    accent: 'bg-red-500 hover:bg-red-600',
    accentHover: 'hover:bg-red-600',
    accentMuted: 'bg-red-200 dark:bg-red-900',
    accentMutedHover: 'hover:bg-red-300 dark:hover:bg-red-800',
    sliderTrack: 'bg-red-500',
    sliderThumb: 'bg-red-600',
    switchBg: 'bg-red-500',
    tint: '#fecaca', // red-200
  },
  carbon_monoxide_sensor: {
    bg: 'bg-red-500',
    bgOff: 'bg-red-100 dark:bg-red-950',
    text: 'text-white',
    textOff: 'text-red-600 dark:text-red-400',
    cardBg: 'bg-red-100/80 dark:bg-red-950/50',
    cardBgHover: 'hover:bg-red-200/80 dark:hover:bg-red-900/50',
    cardBorder: 'ring-red-300 dark:ring-red-700',
    accent: 'bg-red-500 hover:bg-red-600',
    accentHover: 'hover:bg-red-600',
    accentMuted: 'bg-red-200 dark:bg-red-900',
    accentMutedHover: 'hover:bg-red-300 dark:hover:bg-red-800',
    sliderTrack: 'bg-red-500',
    sliderThumb: 'bg-red-600',
    switchBg: 'bg-red-500',
    tint: '#fecaca', // red-200
  },
  carbon_dioxide_sensor: {
    bg: 'bg-red-500',
    bgOff: 'bg-red-100 dark:bg-red-950',
    text: 'text-white',
    textOff: 'text-red-600 dark:text-red-400',
    cardBg: 'bg-red-100/80 dark:bg-red-950/50',
    cardBgHover: 'hover:bg-red-200/80 dark:hover:bg-red-900/50',
    cardBorder: 'ring-red-300 dark:ring-red-700',
    accent: 'bg-red-500 hover:bg-red-600',
    accentHover: 'hover:bg-red-600',
    accentMuted: 'bg-red-200 dark:bg-red-900',
    accentMutedHover: 'hover:bg-red-300 dark:hover:bg-red-800',
    sliderTrack: 'bg-red-500',
    sliderThumb: 'bg-red-600',
    switchBg: 'bg-red-500',
    tint: '#fecaca', // red-200
  },
  leak_sensor: {
    bg: 'bg-blue-500',
    bgOff: 'bg-blue-100 dark:bg-blue-950',
    text: 'text-white',
    textOff: 'text-blue-600 dark:text-blue-400',
    cardBg: 'bg-blue-100/80 dark:bg-blue-950/50',
    cardBgHover: 'hover:bg-blue-200/80 dark:hover:bg-blue-900/50',
    cardBorder: 'ring-blue-300 dark:ring-blue-700',
    accent: 'bg-blue-500 hover:bg-blue-600',
    accentHover: 'hover:bg-blue-600',
    accentMuted: 'bg-blue-200 dark:bg-blue-900',
    accentMutedHover: 'hover:bg-blue-300 dark:hover:bg-blue-800',
    sliderTrack: 'bg-blue-500',
    sliderThumb: 'bg-blue-600',
    switchBg: 'bg-blue-500',
    tint: '#bfdbfe', // blue-200
  },
  air_quality_sensor: {
    bg: 'bg-teal-500',
    bgOff: 'bg-teal-100 dark:bg-teal-950',
    text: 'text-white',
    textOff: 'text-teal-600 dark:text-teal-400',
    cardBg: 'bg-teal-100/80 dark:bg-teal-950/50',
    cardBgHover: 'hover:bg-teal-200/80 dark:hover:bg-teal-900/50',
    cardBorder: 'ring-teal-300 dark:ring-teal-700',
    accent: 'bg-teal-500 hover:bg-teal-600',
    accentHover: 'hover:bg-teal-600',
    accentMuted: 'bg-teal-200 dark:bg-teal-900',
    accentMutedHover: 'hover:bg-teal-300 dark:hover:bg-teal-800',
    sliderTrack: 'bg-teal-500',
    sliderThumb: 'bg-teal-600',
    switchBg: 'bg-teal-500',
    tint: '#99f6e4', // teal-200
  },

  // Water/Irrigation - blue/green
  valve: {
    bg: 'bg-blue-500',
    bgOff: 'bg-blue-100 dark:bg-blue-950',
    text: 'text-white',
    textOff: 'text-blue-600 dark:text-blue-400',
    cardBg: 'bg-blue-100/80 dark:bg-blue-950/50',
    cardBgHover: 'hover:bg-blue-200/80 dark:hover:bg-blue-900/50',
    cardBorder: 'ring-blue-300 dark:ring-blue-700',
    accent: 'bg-blue-500 hover:bg-blue-600',
    accentHover: 'hover:bg-blue-600',
    accentMuted: 'bg-blue-200 dark:bg-blue-900',
    accentMutedHover: 'hover:bg-blue-300 dark:hover:bg-blue-800',
    sliderTrack: 'bg-blue-500',
    sliderThumb: 'bg-blue-600',
    switchBg: 'bg-blue-500',
    tint: '#bfdbfe', // blue-200
  },
  faucet: {
    bg: 'bg-blue-500',
    bgOff: 'bg-blue-100 dark:bg-blue-950',
    text: 'text-white',
    textOff: 'text-blue-600 dark:text-blue-400',
    cardBg: 'bg-blue-100/80 dark:bg-blue-950/50',
    cardBgHover: 'hover:bg-blue-200/80 dark:hover:bg-blue-900/50',
    cardBorder: 'ring-blue-300 dark:ring-blue-700',
    accent: 'bg-blue-500 hover:bg-blue-600',
    accentHover: 'hover:bg-blue-600',
    accentMuted: 'bg-blue-200 dark:bg-blue-900',
    accentMutedHover: 'hover:bg-blue-300 dark:hover:bg-blue-800',
    sliderTrack: 'bg-blue-500',
    sliderThumb: 'bg-blue-600',
    switchBg: 'bg-blue-500',
    tint: '#bfdbfe', // blue-200
  },
  irrigation_system: {
    bg: 'bg-green-500',
    bgOff: 'bg-green-100 dark:bg-green-950',
    text: 'text-white',
    textOff: 'text-green-600 dark:text-green-400',
    cardBg: 'bg-green-100/80 dark:bg-green-950/50',
    cardBgHover: 'hover:bg-green-200/80 dark:hover:bg-green-900/50',
    cardBorder: 'ring-green-300 dark:ring-green-700',
    accent: 'bg-green-500 hover:bg-green-600',
    accentHover: 'hover:bg-green-600',
    accentMuted: 'bg-green-200 dark:bg-green-900',
    accentMutedHover: 'hover:bg-green-300 dark:hover:bg-green-800',
    sliderTrack: 'bg-green-500',
    sliderThumb: 'bg-green-600',
    switchBg: 'bg-green-500',
    tint: '#bbf7d0', // green-200
  },

  // Audio - purple
  speaker: {
    bg: 'bg-purple-500',
    bgOff: 'bg-purple-100 dark:bg-purple-950',
    text: 'text-white',
    textOff: 'text-purple-600 dark:text-purple-400',
    cardBg: 'bg-purple-100/80 dark:bg-purple-950/50',
    cardBgHover: 'hover:bg-purple-200/80 dark:hover:bg-purple-900/50',
    cardBorder: 'ring-purple-300 dark:ring-purple-700',
    accent: 'bg-purple-500 hover:bg-purple-600',
    accentHover: 'hover:bg-purple-600',
    accentMuted: 'bg-purple-200 dark:bg-purple-900',
    accentMutedHover: 'hover:bg-purple-300 dark:hover:bg-purple-800',
    sliderTrack: 'bg-purple-500',
    sliderThumb: 'bg-purple-600',
    switchBg: 'bg-purple-500',
    tint: '#e9d5ff', // purple-200
  },
  smart_speaker: {
    bg: 'bg-purple-500',
    bgOff: 'bg-purple-100 dark:bg-purple-950',
    text: 'text-white',
    textOff: 'text-purple-600 dark:text-purple-400',
    cardBg: 'bg-purple-100/80 dark:bg-purple-950/50',
    cardBgHover: 'hover:bg-purple-200/80 dark:hover:bg-purple-900/50',
    cardBorder: 'ring-purple-300 dark:ring-purple-700',
    accent: 'bg-purple-500 hover:bg-purple-600',
    accentHover: 'hover:bg-purple-600',
    accentMuted: 'bg-purple-200 dark:bg-purple-900',
    accentMutedHover: 'hover:bg-purple-300 dark:hover:bg-purple-800',
    sliderTrack: 'bg-purple-500',
    sliderThumb: 'bg-purple-600',
    switchBg: 'bg-purple-500',
    tint: '#e9d5ff', // purple-200
  },
  microphone: {
    bg: 'bg-purple-500',
    bgOff: 'bg-purple-100 dark:bg-purple-950',
    text: 'text-white',
    textOff: 'text-purple-600 dark:text-purple-400',
    cardBg: 'bg-purple-100/80 dark:bg-purple-950/50',
    cardBgHover: 'hover:bg-purple-200/80 dark:hover:bg-purple-900/50',
    cardBorder: 'ring-purple-300 dark:ring-purple-700',
    accent: 'bg-purple-500 hover:bg-purple-600',
    accentHover: 'hover:bg-purple-600',
    accentMuted: 'bg-purple-200 dark:bg-purple-900',
    accentMutedHover: 'hover:bg-purple-300 dark:hover:bg-purple-800',
    sliderTrack: 'bg-purple-500',
    sliderThumb: 'bg-purple-600',
    switchBg: 'bg-purple-500',
    tint: '#e9d5ff', // purple-200
  },

  // Camera/Doorbell - slate/amber
  camera: {
    bg: 'bg-slate-600',
    bgOff: 'bg-slate-200 dark:bg-slate-800',
    text: 'text-white',
    textOff: 'text-slate-600 dark:text-slate-400',
    cardBg: 'bg-slate-200/80 dark:bg-slate-800/50',
    cardBgHover: 'hover:bg-slate-300/80 dark:hover:bg-slate-700/50',
    cardBorder: 'ring-slate-400 dark:ring-slate-600',
    accent: 'bg-slate-600 hover:bg-slate-700',
    accentHover: 'hover:bg-slate-700',
    accentMuted: 'bg-slate-300 dark:bg-slate-700',
    accentMutedHover: 'hover:bg-slate-400 dark:hover:bg-slate-600',
    sliderTrack: 'bg-slate-600',
    sliderThumb: 'bg-slate-700',
    switchBg: 'bg-slate-600',
    tint: '#e2e8f0', // slate-200
  },
  doorbell: {
    bg: 'bg-amber-500',
    bgOff: 'bg-amber-100 dark:bg-amber-950',
    text: 'text-white',
    textOff: 'text-amber-600 dark:text-amber-400',
    cardBg: 'bg-amber-100/80 dark:bg-amber-950/50',
    cardBgHover: 'hover:bg-amber-200/80 dark:hover:bg-amber-900/50',
    cardBorder: 'ring-amber-300 dark:ring-amber-700',
    accent: 'bg-amber-500 hover:bg-amber-600',
    accentHover: 'hover:bg-amber-600',
    accentMuted: 'bg-amber-200 dark:bg-amber-900',
    accentMutedHover: 'hover:bg-amber-300 dark:hover:bg-amber-800',
    sliderTrack: 'bg-amber-500',
    sliderThumb: 'bg-amber-600',
    switchBg: 'bg-amber-500',
    tint: '#fde68a', // amber-200
  },

  // Buttons/Remotes - pink
  stateless_programmable_switch: {
    bg: 'bg-pink-500',
    bgOff: 'bg-pink-100 dark:bg-pink-950',
    text: 'text-white',
    textOff: 'text-pink-600 dark:text-pink-400',
    cardBg: 'bg-pink-100/80 dark:bg-pink-950/50',
    cardBgHover: 'hover:bg-pink-200/80 dark:hover:bg-pink-900/50',
    cardBorder: 'ring-pink-300 dark:ring-pink-700',
    accent: 'bg-pink-500 hover:bg-pink-600',
    accentHover: 'hover:bg-pink-600',
    accentMuted: 'bg-pink-200 dark:bg-pink-900',
    accentMutedHover: 'hover:bg-pink-300 dark:hover:bg-pink-800',
    sliderTrack: 'bg-pink-500',
    sliderThumb: 'bg-pink-600',
    switchBg: 'bg-pink-500',
    tint: '#fbcfe8', // pink-200
  },

  // Scenes - amber (Zap)
  scene: {
    bg: 'bg-amber-400',
    bgOff: 'bg-amber-100 dark:bg-amber-950',
    text: 'text-amber-900',
    textOff: 'text-amber-600 dark:text-amber-400',
    cardBg: 'bg-amber-100/80 dark:bg-amber-950/50',
    cardBgHover: 'hover:bg-amber-200/80 dark:hover:bg-amber-900/50',
    cardBorder: 'ring-amber-300 dark:ring-amber-700',
    accent: 'bg-amber-500 hover:bg-amber-600',
    accentHover: 'hover:bg-amber-600',
    accentMuted: 'bg-amber-200 dark:bg-amber-900',
    accentMutedHover: 'hover:bg-amber-300 dark:hover:bg-amber-800',
    sliderTrack: 'bg-amber-500',
    sliderThumb: 'bg-amber-600',
    switchBg: 'bg-amber-500',
    tint: '#fde68a', // amber-200
  },

  // Bridges/Hubs - slate grey
  bridge: {
    bg: 'bg-slate-500',
    bgOff: 'bg-slate-100 dark:bg-slate-950',
    text: 'text-white',
    textOff: 'text-slate-600 dark:text-slate-400',
    cardBg: 'bg-slate-100/80 dark:bg-slate-950/50',
    cardBgHover: 'hover:bg-slate-200/80 dark:hover:bg-slate-900/50',
    cardBorder: 'ring-slate-300 dark:ring-slate-700',
    accent: 'bg-slate-500 hover:bg-slate-600',
    accentHover: 'hover:bg-slate-600',
    accentMuted: 'bg-slate-200 dark:bg-slate-900',
    accentMutedHover: 'hover:bg-slate-300 dark:hover:bg-slate-800',
    sliderTrack: 'bg-slate-500',
    sliderThumb: 'bg-slate-600',
    switchBg: 'bg-slate-500',
    tint: '#e2e8f0', // slate-200
  },
};

// Default colors for unknown types
export const DEFAULT_ICON_COLOR: IconColor = {
  bg: 'bg-primary',
  bgOff: 'bg-muted',
  text: 'text-primary-foreground',
  textOff: 'text-muted-foreground',
  cardBg: 'bg-primary/15',
  cardBgHover: 'hover:bg-primary/20',
  cardBorder: 'ring-primary/30',
  accent: 'bg-primary hover:bg-primary/90',
  accentHover: 'hover:bg-primary/90',
  accentMuted: 'bg-primary/20',
  accentMutedHover: 'hover:bg-primary/30',
  sliderTrack: 'bg-primary',
  sliderThumb: 'bg-primary',
  switchBg: 'bg-primary',
  tint: '#e2e8f0', // slate-200
};

// Get icon colors for a service type
/**
 * A timer that has just run out.
 *
 * The whole tile turns green rather than the glyph alone, because the point is
 * to be noticed from across a room. Pastel deliberately: it replaces the
 * accessory's own colour for ten seconds, and a saturated green beside a wall
 * of glass tiles reads as an error rather than as a finished timer.
 */
export const TIMER_FINISHED_COLOR: IconColor = {
  bg: 'bg-emerald-200 dark:bg-emerald-800',
  bgOff: 'bg-emerald-100 dark:bg-emerald-900',
  text: 'text-emerald-900 dark:text-emerald-50',
  textOff: 'text-emerald-800 dark:text-emerald-100',
  cardBg: 'bg-emerald-100/70 dark:bg-emerald-900/40',
  cardBgHover: 'hover:bg-emerald-100/80 dark:hover:bg-emerald-900/50',
  cardBorder: 'ring-emerald-200 dark:ring-emerald-800',
  accent: 'bg-emerald-300 hover:bg-emerald-400',
  accentHover: 'hover:bg-emerald-400',
  accentMuted: 'bg-emerald-100 dark:bg-emerald-900',
  accentMutedHover: 'hover:bg-emerald-200 dark:hover:bg-emerald-800',
  sliderTrack: 'bg-emerald-300',
  sliderThumb: 'bg-emerald-400',
  switchBg: 'bg-emerald-300',
  tint: '#d1fae5', // emerald-100
  tintAlpha: 0.7,
};

export const getIconColor = (serviceType: ServiceType | string | null): IconColor => {
  if (!serviceType) return DEFAULT_ICON_COLOR;
  return ICON_COLORS[serviceType] || DEFAULT_ICON_COLOR;
};

// Icon style types:
// - 'standard': Service-type colored icons only
// - 'colourful': Full color system (card backgrounds, colored controls, etc.)
export type IconStyle = 'standard' | 'colourful';

// Widget color context - provides colors to child components
export interface WidgetColorContext {
  colors: IconColor;
  isOn: boolean;
}
