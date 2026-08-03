import {
  ToggleLeft, ListChecks, Hash, Timer, SlidersHorizontal, Type, CalendarClock,
  type LucideIcon,
} from 'lucide-react';
import { HELPER_TYPES, type CreatableHelperType } from '@/automation/helpers/catalogue';

/**
 * Icons kept here rather than in the catalogue so the catalogue stays free of
 * React — it is imported by the engine's serialization path, which runs in
 * contexts with no DOM.
 */
const ICONS: Record<string, LucideIcon> = {
  ToggleLeft, ListChecks, Hash, Timer, SlidersHorizontal, Type, CalendarClock,
};

export function HelperTypeIcon({
  type, className,
}: {
  type: CreatableHelperType;
  className?: string;
}) {
  const Icon = ICONS[HELPER_TYPES[type].icon] ?? Hash;
  return <Icon className={className} aria-hidden />;
}
