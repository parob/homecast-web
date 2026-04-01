/**
 * AreaSummary - Aggregated sensor summary bar for HomeKit accessories.
 * Shows temperature, humidity, motion, lock status, contact sensors, and battery alerts.
 * Displays at the top of home/room/collection views with hover tooltips for breakdowns.
 */

import { useMemo, useRef, useState } from 'react';
import {
  Thermometer,
  Droplets,
  Activity,
  Lock,
  LockOpen,
  DoorOpen,
  BatteryWarning,
} from 'lucide-react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { useSensorAggregation, type SensorReading } from '@/hooks/useSensorAggregation';
import type { HomeKitAccessory } from '@/native/homekit-bridge';
import { cn } from '@/lib/utils';

// ============================================================================
// Types
// ============================================================================

interface AreaSummaryProps {
  accessories: HomeKitAccessory[];
  isDarkBackground?: boolean;
  className?: string;
}

// ============================================================================
// Helper Components
// ============================================================================

interface SummaryItemProps {
  icon: React.ReactNode;
  label: string;
  tooltip: React.ReactNode;
  variant?: 'default' | 'warning' | 'success';
  isDarkBackground?: boolean;
}

function SummaryItem({ icon, label, tooltip, variant = 'default', isDarkBackground }: SummaryItemProps) {
  const [open, setOpen] = useState(false);
  const clickedRef = useRef(false);

  const variantStyles = {
    default: isDarkBackground
      ? 'bg-black/25 text-white/90 hover:bg-black/35'
      : 'bg-muted text-muted-foreground hover:bg-muted/80',
    warning: isDarkBackground
      ? 'bg-amber-950/50 text-amber-200 hover:bg-amber-950/60'
      : 'bg-amber-100 text-amber-700 hover:bg-amber-200',
    success: isDarkBackground
      ? 'bg-emerald-950/50 text-emerald-200 hover:bg-emerald-950/60'
      : 'bg-emerald-100 text-emerald-700 hover:bg-emerald-200',
  };

  const tooltipStyles = isDarkBackground
    ? 'bg-black/35 backdrop-blur-md text-white border-none'
    : 'bg-white/60 backdrop-blur-md text-foreground shadow-[0_0_15px_rgba(0,0,0,0.6)] border border-gray-200';

  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip
        open={open}
        onOpenChange={(value) => {
          // If the tooltip is being closed but we just clicked, keep it open
          if (!value && clickedRef.current) {
            clickedRef.current = false;
            return;
          }
          setOpen(value);
        }}
      >
        <TooltipTrigger asChild>
          <button
            type="button"
            onClick={() => {
              clickedRef.current = true;
              setOpen(prev => !prev);
            }}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium transition-colors cursor-default',
              variantStyles[variant]
            )}
          >
            {icon}
            <span>{label}</span>
          </button>
        </TooltipTrigger>
        <TooltipContent
          side="bottom"
          className={cn(
            'max-w-xs max-h-[75vh] overflow-y-auto shadow-lg',
            tooltipStyles
          )}
        >
          {tooltip}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

type SummaryVariant = 'default' | 'warning' | 'success';
type ItemVariant = 'default' | 'warning' | 'success' | 'danger';

interface ReadingListProps {
  title: string;
  readings: SensorReading[];
  formatValue: (value: number | boolean) => string;
  getItemVariant?: (value: number | boolean) => ItemVariant;
  isDarkBackground?: boolean;
  variant?: SummaryVariant;
}

function ReadingList({ title, readings, formatValue, getItemVariant, isDarkBackground, variant = 'default' }: ReadingListProps) {
  // Group readings by room
  const roomGroups = useMemo(() => {
    const groups = new Map<string, SensorReading[]>();
    for (const reading of readings) {
      const roomKey = reading.roomName || 'Unknown';
      const existing = groups.get(roomKey) || [];
      existing.push(reading);
      groups.set(roomKey, existing);
    }
    return Array.from(groups.entries());
  }, [readings]);

  const hasMultipleRooms = roomGroups.length > 1;

  // Color schemes based on variant
  const colorSchemes = {
    default: {
      muted: isDarkBackground ? 'text-white/60' : 'text-muted-foreground',
      border: isDarkBackground ? 'border-white/20' : 'border-muted',
    },
    warning: {
      muted: isDarkBackground ? 'text-amber-200/70' : 'text-amber-600',
      border: isDarkBackground ? 'border-amber-400/30' : 'border-amber-300',
    },
    success: {
      muted: isDarkBackground ? 'text-emerald-200/70' : 'text-emerald-600',
      border: isDarkBackground ? 'border-emerald-400/30' : 'border-emerald-300',
    },
  };

  // Per-item value colors
  const itemColors = {
    default: isDarkBackground ? 'text-white/60' : 'text-muted-foreground',
    warning: isDarkBackground ? 'text-amber-300' : 'text-amber-600',
    success: isDarkBackground ? 'text-emerald-300' : 'text-emerald-600',
    danger: isDarkBackground ? 'text-red-300' : 'text-red-600',
  };

  const { muted: mutedTextClass, border: borderClass } = colorSchemes[variant];

  const getValueClass = (value: number | boolean) => {
    if (!getItemVariant) return mutedTextClass;
    return itemColors[getItemVariant(value)];
  };

  const renderReading = (reading: SensorReading) => (
    <div key={reading.accessoryId} className="flex items-center justify-between gap-2">
      <span className="truncate">{reading.accessoryName}</span>
      <span className={cn('shrink-0 font-medium', getValueClass(reading.value))}>
        {formatValue(reading.value)}
      </span>
    </div>
  );

  return (
    <div className="space-y-1.5">
      <div className="font-medium text-sm">{title}</div>
      {hasMultipleRooms ? (
        // Tree structure grouped by room
        <div className="text-xs space-y-1.5">
          {roomGroups.map(([roomName, roomReadings]) => (
            <div key={roomName}>
              <div className={cn('font-medium', mutedTextClass)}>
                {roomName}
              </div>
              <div className={cn('mt-0.5 space-y-0.5 pl-2 ml-1')}>
                {roomReadings.map(renderReading)}
              </div>
            </div>
          ))}
        </div>
      ) : (
        // Flat list for single room
        <div className="text-xs space-y-0.5 ml-2 pl-2">
          {readings.map(renderReading)}
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Format helpers
// ============================================================================

function formatTemperature(value: number): string {
  return `${value.toFixed(1)}°C`;
}

function formatHumidity(value: number): string {
  return `${Math.round(value)}%`;
}

function formatTemperatureRange(min: number, max: number, avg: number, count: number): string {
  if (count === 1) {
    return formatTemperature(avg);
  }
  if (Math.abs(max - min) < 0.5) {
    return formatTemperature(avg);
  }
  return `${formatTemperature(min)} – ${formatTemperature(max)}`;
}

function formatHumidityRange(min: number, max: number, avg: number, count: number): string {
  if (count === 1) {
    return formatHumidity(avg);
  }
  if (Math.abs(max - min) < 3) {
    return formatHumidity(avg);
  }
  return `${formatHumidity(min)} – ${formatHumidity(max)}`;
}

function formatLockState(value: number | boolean): string {
  if (typeof value === 'boolean') return value ? 'Locked' : 'Unlocked';
  switch (value) {
    case 0:
      return 'Unlocked';
    case 1:
      return 'Locked';
    case 2:
      return 'Jammed';
    default:
      return 'Unknown';
  }
}

function formatContactState(value: number | boolean): string {
  if (typeof value === 'boolean') return value ? 'Open' : 'Closed';
  return value === 0 ? 'Closed' : 'Open';
}

function formatMotionState(value: number | boolean): string {
  return value ? 'Motion detected' : 'No motion';
}

// ============================================================================
// Main Component
// ============================================================================

export function AreaSummary({ accessories, isDarkBackground = false, className }: AreaSummaryProps) {
  const sensorData = useSensorAggregation(accessories);

  // Build summary items
  const items = useMemo(() => {
    const result: React.ReactNode[] = [];

    // Temperature
    if (sensorData.temperature) {
      const { avg, min, max, readings } = sensorData.temperature;
      const label = formatTemperatureRange(min, max, avg, readings.length);
      result.push(
        <SummaryItem
          key="temperature"
          icon={<Thermometer className="h-3.5 w-3.5" />}
          label={label}
          isDarkBackground={isDarkBackground}
          tooltip={
            <ReadingList
              title={`Temperature: ${formatTemperature(avg)} (avg)`}
              readings={readings}
              formatValue={(v) => formatTemperature(v as number)}
              isDarkBackground={isDarkBackground}
            />
          }
        />
      );
    }

    // Humidity
    if (sensorData.humidity) {
      const { avg, min, max, readings } = sensorData.humidity;
      const label = formatHumidityRange(min, max, avg, readings.length);
      result.push(
        <SummaryItem
          key="humidity"
          icon={<Droplets className="h-3.5 w-3.5" />}
          label={label}
          isDarkBackground={isDarkBackground}
          tooltip={
            <ReadingList
              title={`Humidity: ${formatHumidity(avg)} (avg)`}
              readings={readings}
              formatValue={(v) => formatHumidity(v as number)}
              isDarkBackground={isDarkBackground}
            />
          }
        />
      );
    }

    // Motion
    if (sensorData.motion) {
      const { activeCount, totalCount, readings } = sensorData.motion;
      const hasMotion = activeCount > 0;
      const label = hasMotion ? `${activeCount} active` : 'No motion';
      result.push(
        <SummaryItem
          key="motion"
          icon={<Activity className="h-3.5 w-3.5" />}
          label={label}
          variant={hasMotion ? 'warning' : 'default'}
          isDarkBackground={isDarkBackground}
          tooltip={
            <ReadingList
              title={`Motion: ${activeCount}/${totalCount} active`}
              readings={readings}
              formatValue={formatMotionState}
              getItemVariant={(v) => v ? 'warning' : 'default'}
              isDarkBackground={isDarkBackground}
              variant={hasMotion ? 'warning' : 'default'}
            />
          }
        />
      );
    }

    // Locks
    if (sensorData.locks) {
      const { lockedCount, unlockedCount, jammedCount, readings } = sensorData.locks;
      const totalCount = readings.length;
      const allLocked = lockedCount === totalCount;
      const hasIssue = unlockedCount > 0 || jammedCount > 0;

      let label: string;
      let LockIcon = Lock;
      if (allLocked) {
        label = totalCount === 1 ? 'Locked' : `${lockedCount}/${totalCount} locked`;
      } else if (jammedCount > 0) {
        label = `${jammedCount} jammed`;
        LockIcon = LockOpen;
      } else {
        label = `${unlockedCount} unlocked`;
        LockIcon = LockOpen;
      }

      result.push(
        <SummaryItem
          key="locks"
          icon={<LockIcon className="h-3.5 w-3.5" />}
          label={label}
          variant={hasIssue ? 'warning' : 'success'}
          isDarkBackground={isDarkBackground}
          tooltip={
            <ReadingList
              title={`Locks: ${lockedCount}/${totalCount} locked`}
              readings={readings}
              formatValue={formatLockState}
              getItemVariant={(v) => {
                if (v === 1) return 'success'; // Locked
                if (v === 2) return 'danger';  // Jammed
                return 'warning'; // Unlocked
              }}
              isDarkBackground={isDarkBackground}
              variant={hasIssue ? 'warning' : 'success'}
            />
          }
        />
      );
    }

    // Contact sensors
    if (sensorData.contacts) {
      const { openCount, closedCount, readings } = sensorData.contacts;
      const hasOpen = openCount > 0;
      const label = hasOpen ? `${openCount} open` : 'All closed';

      result.push(
        <SummaryItem
          key="contacts"
          icon={<DoorOpen className="h-3.5 w-3.5" />}
          label={label}
          variant={hasOpen ? 'warning' : 'default'}
          isDarkBackground={isDarkBackground}
          tooltip={
            <ReadingList
              title={`Contacts: ${openCount} open, ${closedCount} closed`}
              readings={readings}
              formatValue={formatContactState}
              getItemVariant={(v) => v === 0 ? 'success' : 'warning'} // 0 = Closed, 1 = Open
              isDarkBackground={isDarkBackground}
              variant={hasOpen ? 'warning' : 'default'}
            />
          }
        />
      );
    }

    // Low battery
    if (sensorData.lowBattery) {
      const { count, readings } = sensorData.lowBattery;
      result.push(
        <SummaryItem
          key="battery"
          icon={<BatteryWarning className="h-3.5 w-3.5" />}
          label={`${count} low`}
          variant="warning"
          isDarkBackground={isDarkBackground}
          tooltip={
            <ReadingList
              title={`Low Battery: ${count} device${count !== 1 ? 's' : ''}`}
              readings={readings}
              formatValue={() => 'Low battery'}
              getItemVariant={() => 'warning'}
              isDarkBackground={isDarkBackground}
              variant="warning"
            />
          }
        />
      );
    }

    return result;
  }, [sensorData, isDarkBackground]);

  // Don't render if no sensor data
  if (!sensorData.hasData) {
    return null;
  }

  return (
    <div className={cn('flex flex-wrap items-center gap-2', className)}>
      {items}
    </div>
  );
}

export default AreaSummary;
