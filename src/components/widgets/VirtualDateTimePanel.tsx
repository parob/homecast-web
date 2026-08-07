import React from 'react';
import { Minus, Plus } from 'lucide-react';
import { Calendar } from '@/components/ui/calendar';
import type { DateParts } from './VirtualDateTimeControl';

/**
 * The picker, drawn by us.
 *
 * `showPicker()` on a real date input was the first attempt — it kept each
 * platform's own picker at no cost. It is a no-op in Mac Catalyst's WKWebView,
 * which is the one place this had to work, so the field was left as somewhere
 * to type and nothing else. Nothing about a platform picker is worth that.
 *
 * The calendar itself is `react-day-picker`, through the app's own `Calendar`
 * wrapper — already a dependency, and already the answer to month arithmetic,
 * locale weekdays, keyboard navigation and the grid's accessibility. Only two
 * things are ours: the classes, because the tile is glass over a photo and the
 * theme colours it ships with are drawn for a solid popover, and the time row,
 * which no calendar has.
 *
 * Inline, inside the tile, deliberately: the expanded tile closes on any
 * `pointerdown` outside its own content and collapses when the pointer leaves
 * it, so a portalled popover would be dismissed by the very click that picked
 * a date. Growing the tile is the one thing that overlay already expects — it
 * holds off its collapse for a moment after a resize.
 */

/** Locale's first weekday as `react-day-picker` counts it: 0 = Sunday. */
function weekStartsOn(): 0 | 1 | 2 | 3 | 4 | 5 | 6 {
  try {
    const locale = new Intl.Locale(
      new Intl.DateTimeFormat().resolvedOptions().locale,
    ) as Intl.Locale & {
      weekInfo?: { firstDay: number };
      getWeekInfo?: () => { firstDay: number };
    };
    // `Intl` counts 1 = Monday … 7 = Sunday.
    const first = (locale.getWeekInfo?.() ?? locale.weekInfo)?.firstDay;
    if (first) return (first % 7) as 0 | 1 | 2 | 3 | 4 | 5 | 6;
  } catch {
    // Older engines have neither; Monday is the safer default of the two.
  }
  return 1;
}

const NARROW_WEEKDAY = new Intl.DateTimeFormat(undefined, { weekday: 'narrow' });
const CAPTION = new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' });

interface PanelProps {
  parts: DateParts;
  hasDate: boolean;
  hasTime: boolean;
  onChange: (next: DateParts) => void;
  onClose: () => void;
  dark: boolean;
}

export const VirtualDateTimePanel: React.FC<PanelProps> = ({
  parts, hasDate, hasTime, onChange, onClose, dark,
}) => {
  const today = new Date();
  const selected = parts.year && parts.month && parts.day
    ? new Date(Number(parts.year), Number(parts.month) - 1, Number(parts.day))
    : undefined;
  const [month, setMonth] = React.useState<Date>(selected ?? today);

  const pick = (date: Date) => {
    onChange({
      ...parts,
      year: String(date.getFullYear()).padStart(4, '0'),
      month: String(date.getMonth() + 1).padStart(2, '0'),
      day: String(date.getDate()).padStart(2, '0'),
      // A date with no time beside it can't be stored, so a time-bearing field
      // that has never been set starts at midnight rather than refusing the
      // date the user just pressed.
      hour: hasTime ? (parts.hour || '00') : parts.hour,
      minute: hasTime ? (parts.minute || '00') : parts.minute,
    });
  };

  const nudge = (field: 'hour' | 'minute', delta: number) => {
    const max = field === 'hour' ? 23 : 59;
    const current = Number(parts[field]) || 0;
    let next = current + delta;
    if (next > max) next = 0;
    if (next < 0) next = max;
    onChange({
      ...parts,
      [field]: String(next).padStart(2, '0'),
      // Same reason as above, the other way round: a time is only storable
      // once the date beside it exists.
      ...(hasDate && !parts.year
        ? {
          year: String(today.getFullYear()),
          month: String(today.getMonth() + 1).padStart(2, '0'),
          day: String(today.getDate()).padStart(2, '0'),
        }
        : {}),
    });
  };

  const now = () => {
    const d = new Date();
    onChange({
      year: String(d.getFullYear()),
      month: String(d.getMonth() + 1).padStart(2, '0'),
      day: String(d.getDate()).padStart(2, '0'),
      hour: String(d.getHours()).padStart(2, '0'),
      minute: String(d.getMinutes()).padStart(2, '0'),
    });
    setMonth(d);
  };

  const surface = dark
    ? 'bg-black/30 border-white/20 text-white'
    : 'bg-white/70 border-slate-300 text-slate-900';
  const ghost = dark ? 'hover:bg-white/20' : 'hover:bg-slate-900/10';
  const rule = dark ? 'border-white/15' : 'border-slate-300';
  const chip = 'inline-flex items-center justify-center rounded-md transition-colors ' + ghost;

  return (
    <div
      className={`mt-2 w-full rounded-lg border p-2 ${surface}`}
      onKeyDown={e => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } }}
    >
      {hasDate && (
        <Calendar
          mode="single"
          selected={selected}
          month={month}
          onMonthChange={setMonth}
          onSelect={d => d && pick(d)}
          weekStartsOn={weekStartsOn()}
          // The library's own labels come from its date-fns locale, which is
          // not the browser's. `Intl` already knows this one.
          formatters={{
            formatWeekdayName: d => NARROW_WEEKDAY.format(d),
            formatCaption: d => CAPTION.format(d),
          }}
          className="p-0"
          // Every class the wrapper ships is drawn for a solid popover —
          // `bg-accent`, `text-muted-foreground`, `bg-primary`. On glass over a
          // photo they read as stray white boxes, so the grid is restyled from
          // the tile's own light/dark instead. Fractional widths, too: this
          // panel sits in a wide expanded overlay and in a narrow grid tile.
          classNames={{
            months: 'flex flex-col',
            month: 'space-y-1 w-full',
            caption: 'flex justify-center pt-0 relative items-center h-7',
            caption_label: 'text-sm font-medium',
            nav: 'space-x-1 flex items-center',
            nav_button: `${chip} h-7 w-7 opacity-70 hover:opacity-100`,
            nav_button_previous: 'absolute left-0',
            nav_button_next: 'absolute right-0',
            table: 'w-full border-collapse',
            head_row: 'flex w-full',
            head_cell: 'flex-1 text-[10px] font-normal uppercase opacity-60',
            row: 'flex w-full mt-0.5',
            cell: 'flex-1 p-[1px] text-center relative',
            day: `h-7 w-full rounded-md text-xs tabular-nums transition-colors ${ghost}`,
            day_selected: dark
              ? 'bg-white text-slate-900 font-medium hover:bg-white'
              : 'bg-slate-900 text-white font-medium hover:bg-slate-900',
            day_today: dark ? 'ring-1 ring-white/50' : 'ring-1 ring-slate-400',
            day_outside: 'opacity-35',
            day_disabled: 'opacity-30',
            day_hidden: 'invisible',
          }}
        />
      )}

      {hasTime && (
        // Coarse on purpose: the minute steps by five, because holding a button
        // through 59 of them is not picking a time. The segments in the field
        // above take an exact minute for the rare time that matters.
        <div className={`flex items-center justify-center gap-1 ${hasDate ? `mt-2 border-t pt-2 ${rule}` : ''}`}>
          <TimeStepper label="Hour" value={parts.hour || '00'} onStep={d => nudge('hour', d)} chip={chip} />
          <span className="px-0.5 text-sm opacity-60">:</span>
          <TimeStepper label="Minute" value={parts.minute || '00'} onStep={d => nudge('minute', d * 5)} chip={chip} />
        </div>
      )}

      <div className={`mt-2 flex items-center justify-between border-t pt-2 text-xs ${rule}`}>
        <button type="button" className={`${chip} h-7 px-2`} onClick={now}>
          {hasTime ? 'Now' : 'Today'}
        </button>
        <button type="button" className={`${chip} h-7 px-2`} onClick={onClose}>Done</button>
      </div>
    </div>
  );
};

const TimeStepper: React.FC<{
  label: string;
  value: string;
  onStep: (delta: number) => void;
  chip: string;
}> = ({ label, value, onStep, chip }) => (
  <div className="flex items-center gap-1">
    <button type="button" aria-label={`Decrease ${label.toLowerCase()}`} className={`${chip} h-7 w-7`} onClick={() => onStep(-1)}>
      <Minus className="h-3.5 w-3.5" />
    </button>
    <span className="w-7 text-center text-sm tabular-nums">{value}</span>
    <button type="button" aria-label={`Increase ${label.toLowerCase()}`} className={`${chip} h-7 w-7`} onClick={() => onStep(1)}>
      <Plus className="h-3.5 w-3.5" />
    </button>
  </div>
);

VirtualDateTimePanel.displayName = 'VirtualDateTimePanel';
