import { format } from 'date-fns';
import { CalendarIcon, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Calendar } from '@/components/ui/calendar';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { TimeWindowPicker } from './TimeWindowPicker';
import type { AccessSchedule, TimeWindow } from '@/lib/graphql/types';

// Generate time options in 30-minute increments
const TIME_OPTIONS = Array.from({ length: 48 }, (_, i) => {
  const hours = Math.floor(i / 2);
  const minutes = (i % 2) * 30;
  const value = `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;
  const label = new Date(2000, 0, 1, hours, minutes).toLocaleTimeString([], {
    hour: 'numeric',
    minute: '2-digit',
  });
  return { value, label };
});

// Common timezones
const TIMEZONES = [
  { value: 'US/Eastern', label: 'Eastern (US)' },
  { value: 'US/Central', label: 'Central (US)' },
  { value: 'US/Mountain', label: 'Mountain (US)' },
  { value: 'US/Pacific', label: 'Pacific (US)' },
  { value: 'UTC', label: 'UTC' },
  { value: 'Europe/London', label: 'London' },
  { value: 'Europe/Paris', label: 'Paris' },
  { value: 'Europe/Berlin', label: 'Berlin' },
  { value: 'Asia/Tokyo', label: 'Tokyo' },
  { value: 'Asia/Shanghai', label: 'Shanghai' },
  { value: 'Australia/Sydney', label: 'Sydney' },
];

interface SchedulePickerProps {
  schedule: AccessSchedule | null;
  onChange: (schedule: AccessSchedule | null) => void;
}

export function SchedulePicker({ schedule, onChange }: SchedulePickerProps) {
  const isLimited = schedule !== null;

  const handleToggleLimited = (enabled: boolean) => {
    if (enabled) {
      onChange({
        timezone: getDefaultTimezone(),
      });
    } else {
      onChange(null);
    }
  };

  const handleStartsAtChange = (date: Date | undefined) => {
    if (!schedule) return;
    onChange({
      ...schedule,
      starts_at: date?.toISOString(),
    });
  };

  const handleExpiresAtChange = (date: Date | undefined) => {
    if (!schedule) return;
    onChange({
      ...schedule,
      expires_at: date?.toISOString(),
    });
  };

  const handleTimeWindowsChange = (windows: TimeWindow[]) => {
    if (!schedule) return;
    onChange({
      ...schedule,
      time_windows: windows.length > 0 ? windows : undefined,
    });
  };

  const handleTimezoneChange = (tz: string) => {
    if (!schedule) return;
    onChange({
      ...schedule,
      timezone: tz,
    });
  };

  const getDefaultTimezone = (): string => {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone;
    } catch {
      return 'UTC';
    }
  };

  const parseDate = (isoStr?: string): Date | undefined => {
    if (!isoStr) return undefined;
    try {
      return new Date(isoStr);
    } catch {
      return undefined;
    }
  };

  return (
    <div className="space-y-4">
      {/* Toggle for limited access */}
      <div className="flex items-center justify-between">
        <div className="space-y-0.5">
          <Label className="text-sm font-medium">Limited Access</Label>
          <p className="text-xs text-muted-foreground">
            Restrict when this passcode can be used
          </p>
        </div>
        <Switch checked={isLimited} onCheckedChange={handleToggleLimited} />
      </div>

      {isLimited && (
        <div className="space-y-4 pt-2 border-t">
          {/* Start Date */}
          <div className="space-y-2">
            <Label className="text-sm">Start Date (optional)</Label>
            <DateTimePicker
              date={parseDate(schedule?.starts_at)}
              onChange={handleStartsAtChange}
              placeholder="Immediately"
              minDate={new Date()}
            />
          </div>

          {/* Expiration Date */}
          <div className="space-y-2">
            <Label className="text-sm">Expiration Date (optional)</Label>
            <DateTimePicker
              date={parseDate(schedule?.expires_at)}
              onChange={handleExpiresAtChange}
              placeholder="Never"
              minDate={parseDate(schedule?.starts_at) || new Date()}
            />
          </div>

          {/* Time Windows */}
          <TimeWindowPicker
            windows={schedule?.time_windows || []}
            onChange={handleTimeWindowsChange}
          />

          {/* Timezone (only show if time windows are set) */}
          {(schedule?.time_windows?.length ?? 0) > 0 && (
            <div className="space-y-2">
              <Label className="text-sm">Timezone</Label>
              <Select
                value={schedule?.timezone || getDefaultTimezone()}
                onValueChange={handleTimezoneChange}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="z-[10050]">
                  {TIMEZONES.map((tz) => (
                    <SelectItem key={tz.value} value={tz.value}>
                      {tz.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

interface DateTimePickerProps {
  date: Date | undefined;
  onChange: (date: Date | undefined) => void;
  placeholder?: string;
  minDate?: Date;
}

function DateTimePicker({
  date,
  onChange,
  placeholder = 'Select date',
  minDate,
}: DateTimePickerProps) {
  const timeValue = date ? format(date, 'HH:mm') : '00:00';
  // Round to nearest 30 min for the select
  const roundedTimeValue = (() => {
    if (!date) return '00:00';
    const hours = date.getHours();
    const minutes = date.getMinutes() < 30 ? '00' : '30';
    return `${hours.toString().padStart(2, '0')}:${minutes}`;
  })();

  const handleDateSelect = (selectedDate: Date | undefined) => {
    if (!selectedDate) {
      onChange(undefined);
      return;
    }
    // Combine with existing time
    const [hours, minutes] = timeValue.split(':').map(Number);
    const combined = new Date(selectedDate);
    combined.setHours(hours, minutes, 0, 0);
    onChange(combined);
  };

  const handleTimeChange = (newTime: string) => {
    if (date) {
      const [hours, minutes] = newTime.split(':').map(Number);
      const updated = new Date(date);
      updated.setHours(hours, minutes, 0, 0);
      onChange(updated);
    }
  };

  const handleClear = () => {
    onChange(undefined);
  };

  return (
    <div className="flex gap-2">
      <Popover modal>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            className={cn(
              'flex-1 justify-start text-left font-normal',
              !date && 'text-muted-foreground'
            )}
          >
            <CalendarIcon className="mr-2 h-4 w-4" />
            {date ? format(date, 'PPP') : placeholder}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0 z-[10050]" align="start">
          <Calendar
            mode="single"
            selected={date}
            onSelect={handleDateSelect}
            disabled={(d) => (minDate ? d < minDate : false)}
            initialFocus
          />
        </PopoverContent>
      </Popover>

      {date && (
        <>
          <Select value={roundedTimeValue} onValueChange={handleTimeChange}>
            <SelectTrigger className="w-[110px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="z-[10050] max-h-[200px]">
              {TIME_OPTIONS.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={handleClear}
            className="h-10 w-10"
          >
            <X className="h-4 w-4" />
          </Button>
        </>
      )}
    </div>
  );
}

/**
 * Format a schedule into a human-readable summary
 */
export function formatScheduleSummary(schedule: AccessSchedule | null): string {
  if (!schedule) return 'Always';

  const parts: string[] = [];

  // Start date
  if (schedule.starts_at) {
    const start = new Date(schedule.starts_at);
    parts.push(`Starts ${format(start, 'MMM d, yyyy')}`);
  }

  // Expiration
  if (schedule.expires_at) {
    const expiry = new Date(schedule.expires_at);
    parts.push(`Expires ${format(expiry, 'MMM d, yyyy')}`);
  }

  // Time windows
  if (schedule.time_windows && schedule.time_windows.length > 0) {
    const window = schedule.time_windows[0];
    const formatDays = (days: string[]): string => {
      if (days.length === 7) return 'Daily';
      if (
        days.length === 5 &&
        ['mon', 'tue', 'wed', 'thu', 'fri'].every((d) => days.includes(d))
      )
        return 'Weekdays';
      if (days.length === 2 && days.includes('sat') && days.includes('sun'))
        return 'Weekends';
      return days.map((d) => d.charAt(0).toUpperCase() + d.slice(1, 3)).join(', ');
    };

    const formatTime = (timeStr: string): string => {
      const [hours, minutes] = timeStr.split(':').map(Number);
      const date = new Date();
      date.setHours(hours, minutes);
      return format(date, 'h:mm a');
    };

    parts.push(
      `${formatDays(window.days)} ${formatTime(window.start)}-${formatTime(window.end)}`
    );

    if (schedule.time_windows.length > 1) {
      parts.push(`+${schedule.time_windows.length - 1} more`);
    }
  }

  return parts.length > 0 ? parts.join(' · ') : 'Limited';
}
