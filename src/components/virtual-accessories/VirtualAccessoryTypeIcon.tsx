import {
  ToggleLeft, ListChecks, Hash, Timer, SlidersHorizontal, Type, CalendarClock,
  type LucideIcon,
} from 'lucide-react';
import { VIRTUAL_TYPES, type CreatableVirtualType } from '@/automation/virtual-accessories/catalogue';

/**
 * Icons kept here rather than in the catalogue so the catalogue stays free of
 * React — it is imported by the engine's serialization path, which runs in
 * contexts with no DOM.
 */
const ICONS: Record<string, LucideIcon> = {
  ToggleLeft, ListChecks, Hash, Timer, SlidersHorizontal, Type, CalendarClock,
};

export function VirtualAccessoryTypeIcon({
  type, className,
}: {
  type: CreatableVirtualType;
  className?: string;
}) {
  const Icon = ICONS[VIRTUAL_TYPES[type].icon] ?? Hash;
  return <Icon className={className} aria-hidden />;
}
