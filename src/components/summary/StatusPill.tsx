/**
 * StatusPill - collapsed entry point for the AreaSummary bubbles.
 *
 * On the whole-home view the sensor bubbles are one row among Scenes and
 * Automations, so they sit behind a pill of the same shape rather than always
 * being on screen. Room views keep AreaSummary inline — a single room's
 * readings are short enough to earn the space.
 */

import { ChevronRight, Gauge } from 'lucide-react';
import { useSensorAggregation } from '@/hooks/useSensorAggregation';
import type { HomeKitAccessory } from '@/native/homekit-bridge';
import { cn } from '@/lib/utils';

interface StatusPillProps {
  accessories: HomeKitAccessory[];
  open: boolean;
  onToggle: () => void;
  isDarkBackground?: boolean;
}

/**
 * Compact bubble button for the sensor-summary row. Toggles the AreaSummary
 * rendered elsewhere on the page. Renders nothing when there is no sensor data,
 * matching AreaSummary itself — an empty section has nothing to open.
 */
export function StatusPill({ accessories, open, onToggle, isDarkBackground }: StatusPillProps) {
  const sensorData = useSensorAggregation(accessories);

  if (!sensorData.hasData) return null;

  // No count, unlike the Scenes and Automations pills. Theirs is the number of
  // things you can open; the bubbles here are groupings of readings, so a
  // number would say six when twelve accessories are reporting.
  return (
    <button
      type="button"
      onClick={onToggle}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium transition-colors',
        isDarkBackground
          ? (open ? 'bg-white/25 text-white' : 'bg-black/25 text-white/90 hover:bg-black/35')
          : (open ? 'bg-primary/15 text-primary' : 'bg-muted text-muted-foreground hover:bg-muted/80'),
      )}
    >
      <Gauge className="h-3 w-3" />
      <span>Status</span>
      <ChevronRight className={cn('h-3 w-3 transition-transform', open && 'rotate-90')} />
    </button>
  );
}

export default StatusPill;
