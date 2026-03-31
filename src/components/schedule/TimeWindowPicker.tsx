import { Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';
import type { TimeWindow } from '@/lib/graphql/types';

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

const DAYS = [
  { key: 'mon', label: 'M' },
  { key: 'tue', label: 'T' },
  { key: 'wed', label: 'W' },
  { key: 'thu', label: 'T' },
  { key: 'fri', label: 'F' },
  { key: 'sat', label: 'S' },
  { key: 'sun', label: 'S' },
];

const WEEKDAY_PRESET = ['mon', 'tue', 'wed', 'thu', 'fri'];
const WEEKEND_PRESET = ['sat', 'sun'];
const ALL_DAYS_PRESET = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];

interface TimeWindowPickerProps {
  windows: TimeWindow[];
  onChange: (windows: TimeWindow[]) => void;
}

export function TimeWindowPicker({ windows, onChange }: TimeWindowPickerProps) {
  const addWindow = () => {
    onChange([
      ...windows,
      { days: WEEKDAY_PRESET, start: '09:00', end: '17:00' },
    ]);
  };

  const updateWindow = (index: number, updates: Partial<TimeWindow>) => {
    const newWindows = [...windows];
    newWindows[index] = { ...newWindows[index], ...updates };
    onChange(newWindows);
  };

  const removeWindow = (index: number) => {
    onChange(windows.filter((_, i) => i !== index));
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <Label className="text-sm font-medium">Time Windows</Label>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={addWindow}
          className="h-7 px-2 text-xs"
        >
          <Plus className="h-3 w-3 mr-1" />
          Add Window
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        Restrict access to specific times of day
      </p>

      {windows.length === 0 ? (
        <p className="text-xs text-muted-foreground italic py-2">
          No time restrictions - access allowed anytime
        </p>
      ) : (
        <div className="space-y-3">
          {windows.map((window, index) => (
            <TimeWindowItem
              key={index}
              window={window}
              onChange={(updates) => updateWindow(index, updates)}
              onRemove={() => removeWindow(index)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

interface TimeWindowItemProps {
  window: TimeWindow;
  onChange: (updates: Partial<TimeWindow>) => void;
  onRemove: () => void;
}

function TimeWindowItem({ window, onChange, onRemove }: TimeWindowItemProps) {
  const toggleDay = (day: string) => {
    const newDays = window.days.includes(day)
      ? window.days.filter((d) => d !== day)
      : [...window.days, day];
    onChange({ days: newDays });
  };

  const applyPreset = (preset: string[]) => {
    onChange({ days: preset });
  };

  const isWeekdays =
    WEEKDAY_PRESET.every((d) => window.days.includes(d)) &&
    !window.days.some((d) => WEEKEND_PRESET.includes(d));
  const isWeekends =
    WEEKEND_PRESET.every((d) => window.days.includes(d)) &&
    !window.days.some((d) => WEEKDAY_PRESET.includes(d));
  const isAllDays = ALL_DAYS_PRESET.every((d) => window.days.includes(d));

  return (
    <div className="p-3 rounded-lg border bg-muted/30 space-y-3">
      {/* Day presets */}
      <div className="flex items-center justify-between">
        <div className="flex gap-1">
          <button
            type="button"
            onClick={() => applyPreset(WEEKDAY_PRESET)}
            className={cn(
              'px-2 py-1 text-xs rounded-md transition-colors',
              isWeekdays
                ? 'bg-primary text-primary-foreground'
                : 'bg-muted hover:bg-muted-foreground/20'
            )}
          >
            Weekdays
          </button>
          <button
            type="button"
            onClick={() => applyPreset(WEEKEND_PRESET)}
            className={cn(
              'px-2 py-1 text-xs rounded-md transition-colors',
              isWeekends
                ? 'bg-primary text-primary-foreground'
                : 'bg-muted hover:bg-muted-foreground/20'
            )}
          >
            Weekends
          </button>
          <button
            type="button"
            onClick={() => applyPreset(ALL_DAYS_PRESET)}
            className={cn(
              'px-2 py-1 text-xs rounded-md transition-colors',
              isAllDays
                ? 'bg-primary text-primary-foreground'
                : 'bg-muted hover:bg-muted-foreground/20'
            )}
          >
            Every Day
          </button>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-6 w-6"
          onClick={onRemove}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>

      {/* Day checkboxes */}
      <div className="flex justify-between gap-1">
        {DAYS.map((day, idx) => (
          <button
            key={`${day.key}-${idx}`}
            type="button"
            onClick={() => toggleDay(day.key)}
            className={cn(
              'w-8 h-8 rounded-full text-xs font-medium transition-colors',
              window.days.includes(day.key)
                ? 'bg-primary text-primary-foreground'
                : 'bg-muted hover:bg-muted-foreground/20'
            )}
          >
            {day.label}
          </button>
        ))}
      </div>

      {/* Time range */}
      <div className="flex items-center gap-2">
        <div className="flex-1">
          <Label className="text-xs text-muted-foreground">From</Label>
          <Select value={window.start} onValueChange={(v) => onChange({ start: v })}>
            <SelectTrigger className="w-full mt-1">
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
        </div>
        <span className="text-muted-foreground mt-5">-</span>
        <div className="flex-1">
          <Label className="text-xs text-muted-foreground">Until</Label>
          <Select value={window.end} onValueChange={(v) => onChange({ end: v })}>
            <SelectTrigger className="w-full mt-1">
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
        </div>
      </div>
    </div>
  );
}
