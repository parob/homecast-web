import React from 'react';
import { VirtualDateTimePanel } from './VirtualDateTimePanel';

/**
 * A date and time field that reads the same on every platform.
 *
 * `<input type="datetime-local">` is drawn by the platform, not by us. Chrome
 * lays it out as editable segments — `31/07/2026, 15:25` with a picker button —
 * while WebKit on Mac Catalyst and iOS hands it to the OS and gets a single
 * run of prose back: `31 Jul 2026 at 15:25`, no segments, no indicator. Same
 * markup, same value, two visibly different controls, and no CSS reaches
 * inside either one. So the segments are ours.
 *
 * So is the picker, in `VirtualDateTimePanel`. Keeping a real date input around
 * for `showPicker()` was the cheaper idea and it does nothing at all in
 * Catalyst's WKWebView — which left the Mac app with a field you could only
 * type into, the complaint this whole control exists to answer. Clicking the
 * field opens ours instead, on every platform, and typing still works.
 *
 * The layout isn't hardcoded: `Intl.DateTimeFormat.formatToParts` says which
 * order this locale writes and which separators it uses, and the segments are
 * rendered in exactly that order. A British browser gets `31/07/2026, 15:25`,
 * an American one `07/31/2026, 15:25` — the same thing Chrome does, only now
 * the Mac app does it too.
 *
 * Time is always 24-hour. The stored value is 24-hour ISO text that automation
 * expressions compare as strings, and a field that disagreed with what the
 * automation would see is a field that lies.
 */

type Field = 'day' | 'month' | 'year' | 'hour' | 'minute';

const FIELDS: readonly Field[] = ['day', 'month', 'year', 'hour', 'minute'];

export type DateParts = Record<Field, string>;

const EMPTY: DateParts = { day: '', month: '', year: '', hour: '', minute: '' };

const LIMITS: Record<Field, { len: number; min: number; max: number }> = {
  day: { len: 2, min: 1, max: 31 },
  month: { len: 2, min: 1, max: 12 },
  year: { len: 4, min: 0, max: 9999 },
  hour: { len: 2, min: 0, max: 23 },
  minute: { len: 2, min: 0, max: 59 },
};

const PLACEHOLDERS: Record<Field, string> = {
  day: 'dd', month: 'mm', year: 'yyyy', hour: 'hh', minute: 'mm',
};

const LABELS: Record<Field, string> = {
  day: 'Day', month: 'Month', year: 'Year', hour: 'Hour', minute: 'Minute',
};

const isField = (type: string): type is Field => (FIELDS as readonly string[]).includes(type);

function pad(value: string, len: number): string {
  return value.padStart(len, '0');
}

function daysInMonth(year: string, month: string): number {
  const y = Number(year), m = Number(month);
  if (!Number.isFinite(y) || !Number.isFinite(m) || m < 1 || m > 12) return 31;
  return new Date(y, m, 0).getDate();
}

/**
 * Storage text → segments.
 *
 * Reads the three shapes the control writes — `YYYY-MM-DD`, `HH:mm` and
 * `YYYY-MM-DDTHH:mm` — and tolerates a trailing `:ss` on anything that came
 * from somewhere else, because an automation can write this characteristic too.
 */
export function parseStored(value: unknown): DateParts {
  const out = { ...EMPTY };
  if (typeof value !== 'string') return out;
  const date = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (date) { out.year = date[1]; out.month = date[2]; out.day = date[3]; }
  const time = /(?:^|T)(\d{2}):(\d{2})/.exec(value);
  if (time) { out.hour = time[1]; out.minute = time[2]; }
  return out;
}

/**
 * Segments → storage text.
 *
 * `null` means "not finished" — a half-typed date must never be written, or
 * every keystroke would publish a different wrong day. An empty field is a
 * real answer though, and clears the value.
 */
export function buildStored(parts: DateParts, hasDate: boolean, hasTime: boolean): string | null {
  const needed: Field[] = [
    ...(hasDate ? (['day', 'month', 'year'] as Field[]) : []),
    ...(hasTime ? (['hour', 'minute'] as Field[]) : []),
  ];
  const filled = needed.filter(f => parts[f] !== '');
  if (filled.length === 0) return '';
  if (filled.length !== needed.length) return null;

  const year = pad(parts.year, 4);
  const month = pad(String(clamp(parts.month, 1, 12)), 2);
  const day = pad(String(clamp(parts.day, 1, daysInMonth(year, month))), 2);
  const hour = pad(String(clamp(parts.hour, 0, 23)), 2);
  const minute = pad(String(clamp(parts.minute, 0, 59)), 2);

  if (hasDate && hasTime) return `${year}-${month}-${day}T${hour}:${minute}`;
  return hasDate ? `${year}-${month}-${day}` : `${hour}:${minute}`;
}

function clamp(value: string, min: number, max: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return min;
  return Math.min(max, Math.max(min, Math.trunc(n)));
}

function formatOptions(hasDate: boolean, hasTime: boolean): Intl.DateTimeFormatOptions {
  return {
    ...(hasDate ? { day: '2-digit' as const, month: '2-digit' as const, year: 'numeric' as const } : {}),
    ...(hasTime ? { hour: '2-digit' as const, minute: '2-digit' as const, hourCycle: 'h23' as const } : {}),
  };
}

/**
 * The value as a sentence, for the tile's subtitle.
 *
 * The same formatter that lays the segments out, so the collapsed tile and the
 * open one say the date the same way. Anything unparseable is shown as it was
 * stored rather than as an error — the characteristic is free text underneath,
 * and a value we can't read is still a value the user put there.
 */
export function formatStored(value: unknown, hasDate: boolean, hasTime: boolean): string {
  if (typeof value !== 'string' || value === '') return '—';
  const parts = parseStored(value);
  const needed: Field[] = [
    ...(hasDate ? (['day', 'month', 'year'] as Field[]) : []),
    ...(hasTime ? (['hour', 'minute'] as Field[]) : []),
  ];
  if (needed.some(f => parts[f] === '')) return value;
  const date = new Date(
    Number(parts.year || '2000'), Number(parts.month || '1') - 1, Number(parts.day || '1'),
    Number(parts.hour || '0'), Number(parts.minute || '0'),
  );
  if (Number.isNaN(date.getTime())) return value;
  try {
    return new Intl.DateTimeFormat(undefined, formatOptions(hasDate, hasTime)).format(date);
  } catch {
    return value;
  }
}

interface VirtualDateTimeControlProps {
  label: string;
  value: unknown;
  hasDate: boolean;
  hasTime: boolean;
  onCommit: (value: string) => void;
  /** Enter means finished, so the tile that opened for the edit can close. */
  onDone?: () => void;
  /** The tile's own field styling — glass, not `bg-background`. */
  className: string;
  dark: boolean;
}

export const VirtualDateTimeControl: React.FC<VirtualDateTimeControlProps> = ({
  label, value, hasDate: wantDate, hasTime: wantTime, onCommit, onDone, className, dark,
}) => {
  // The editor won't let a user save a date-time helper that includes neither,
  // but the flags arrive over the wire from a relay that may be older than the
  // rule. A field with no segments in it is not a field.
  const hasDate = wantDate || !wantTime;
  const hasTime = wantTime || !wantDate;
  // Same draft discipline as the text control: the value is re-read every 10s
  // while the tile is open, so binding the segments straight to it would
  // overwrite a half-typed date. `null` means "following the value".
  const [draft, setDraft] = React.useState<DateParts | null>(null);
  const stored = typeof value === 'string' ? value : '';
  const parts = draft ?? parseStored(stored);
  const inputs = React.useRef<Partial<Record<Field, HTMLInputElement | null>>>({});
  const [open, setOpen] = React.useState(false);
  const wrapper = React.useRef<HTMLDivElement | null>(null);

  const layout = React.useMemo(() => {
    const sample = new Date(2026, 6, 31, 15, 25);
    try {
      return new Intl.DateTimeFormat(undefined, formatOptions(hasDate, hasTime)).formatToParts(sample);
    } catch {
      return [] as Intl.DateTimeFormatPart[];
    }
  }, [hasDate, hasTime]);

  const order = React.useMemo(
    () => layout.map(p => p.type).filter(isField),
    [layout],
  );

  // Held in a ref as well as in state, because a commit has to be idempotent
  // within one event: Enter commits and then blurs the segment, and the blur
  // handler's closure still holds the draft React has not re-rendered away
  // yet. Reading state there would write the same date a second time.
  const latest = React.useRef({ draft, stored, onCommit, hasDate, hasTime });
  latest.current = { draft, stored, onCommit, hasDate, hasTime };

  // Leaving the panel — via Done or a press outside it — is what makes the
  // pending choice real. Declared as a function so the outside-press effect
  // above can call it without ordering games.
  function closePanel() {
    commit();
    setOpen(false);
  }

  const commit = () => {
    const pending = latest.current.draft;
    latest.current.draft = null;
    if (pending) {
      const next = buildStored(pending, hasDate, hasTime);
      if (next !== null && next !== stored) onCommit(next);
    }
    setDraft(null);
  };

  // A press anywhere else closes the panel. In a compact tile the overlay
  // collapses on an outside press anyway, but an always-expanded grid tile has
  // no such thing, and a panel that only ever closes from its own Done button
  // is a panel left open.
  React.useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!wrapper.current?.contains(e.target as Node | null)) closePanel();
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [open]);

  // Commit on the way out too. `blur` doesn't fire when a field is unmounted,
  // and this one lives in a tile that collapses the moment the pointer leaves
  // it — so a date typed and not yet confirmed would simply disappear.
  React.useEffect(() => () => {
    const l = latest.current;
    if (!l.draft) return;
    const next = buildStored(l.draft, l.hasDate, l.hasTime);
    if (next !== null && next !== l.stored) l.onCommit(next);
  }, []);

  const setPart = (field: Field, text: string) => {
    setDraft(current => ({ ...(current ?? parseStored(stored)), [field]: text }));
  };

  const focusNeighbour = (field: Field, delta: number) => {
    const at = order.indexOf(field);
    const next = order[at + delta];
    if (!next) return;
    inputs.current[next]?.focus();
    inputs.current[next]?.select();
  };

  const onSegmentChange = (field: Field, raw: string) => {
    const { len, max } = LIMITS[field];
    const digits = raw.replace(/\D/g, '').slice(0, len);
    // Advance when the segment can't grow any further — typing 4 into a month
    // can only ever mean April, and waiting for a second digit that cannot
    // come is how a date field feels sticky.
    const complete = digits.length >= len || (digits !== '' && Number(digits) * 10 > max);
    setPart(field, complete && len === 2 ? pad(digits, len) : digits);
    if (complete) focusNeighbour(field, 1);
  };

  const step = (field: Field, delta: number) => {
    const { min, max } = LIMITS[field];
    const current = parts[field];
    const base = current === '' ? (delta > 0 ? min - 1 : max + 1) : Number(current);
    let next = base + delta;
    if (next > max) next = min;
    if (next < min) next = max;
    setPart(field, pad(String(next), field === 'year' ? 4 : 2));
  };

  const onSegmentKeyDown = (field: Field, e: React.KeyboardEvent<HTMLInputElement>) => {
    // The dashboard listens for bare keys as shortcuts; typing a date is not
    // one of them.
    e.stopPropagation();
    switch (e.key) {
      case 'ArrowUp': e.preventDefault(); step(field, 1); break;
      case 'ArrowDown': e.preventDefault(); step(field, -1); break;
      case 'ArrowLeft': e.preventDefault(); focusNeighbour(field, -1); break;
      case 'ArrowRight': e.preventDefault(); focusNeighbour(field, 1); break;
      case 'Backspace':
      case 'Delete': e.preventDefault(); setPart(field, ''); break;
      case 'Enter':
        commit();
        setOpen(false);
        e.currentTarget.blur();
        onDone?.();
        break;
      case 'Escape':
        setDraft(null);
        setOpen(false);
        e.currentTarget.blur();
        break;
      default: break;
    }
  };

  // One blur per segment would commit five times crossing the field. Only
  // leaving the group as a whole counts.
  const onGroupBlur = (e: React.FocusEvent<HTMLDivElement>) => {
    if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
    commit();
  };

  // Any click in the field opens the picker — including one on the digits,
  // which is where a hand naturally goes. The segment still takes focus
  // underneath, so the caret is where it was pressed and typing carries on
  // over the top of an open panel.
  const onGroupClick = (e: React.MouseEvent<HTMLDivElement>) => {
    e.stopPropagation();
    setOpen(true);
    if ((e.target as HTMLElement).tagName === 'INPUT') return;
    const first = order.find(f => parts[f] === '') ?? order[0];
    if (!first) return;
    inputs.current[first]?.focus();
    inputs.current[first]?.select();
  };

  // A pick lands in the draft, not on the device.
  //
  // Writing it straight through meant every step of choosing a date was its own
  // change: picking a day, then an hour, then a minute sent three, and each one
  // was a value the user had not finished expressing. Two of them were wrong by
  // construction. Nothing else in the widget behaves that way — a typed date
  // waits for the group to lose focus — so the picker now waits too, and the
  // draft is committed by the same routes that already commit a typed one:
  // Done, a press outside, Enter, or the tile collapsing.
  //
  // It still replaces anything half-typed: pressing a day is a finished
  // decision about that field, even though the value as a whole isn't.
  const onPicked = (next: DateParts) => {
    latest.current.draft = next;
    setDraft(next);
  };

  // The box is as wide as its digits, and `dd` is wider than `31` — letters are
  // not tabular. The hint is set smaller so it fits the same box rather than
  // being clipped to `dd/mr/yyyy`, which is how it first read.
  const segmentClass = 'min-w-0 bg-transparent p-0 text-center tabular-nums outline-none rounded-[3px] '
    + 'placeholder:text-[0.78em] placeholder:opacity-50 '
    + (dark ? 'focus:bg-white/25' : 'focus:bg-slate-900/10');

  return (
    <div ref={wrapper} className="w-full">
      <div
        role="group"
        aria-label={`Set ${label}`}
        className={`${className} inline-flex items-center cursor-pointer `
          + (dark ? 'focus-within:border-white/50' : 'focus-within:border-slate-400')}
        onClick={onGroupClick}
        onBlur={onGroupBlur}
      >
        {layout.map((part, i) => {
          if (!isField(part.type)) {
            return (
              <span key={`lit-${i}`} className="select-none opacity-70 whitespace-pre">{part.value}</span>
            );
          }
          const { len } = LIMITS[part.type];
          return (
            <input
              key={part.type}
              ref={el => { inputs.current[part.type as Field] = el; }}
              type="text"
              inputMode="numeric"
              autoComplete="off"
              spellCheck={false}
              className={segmentClass}
              // Exactly as wide as its digits: `tabular-nums` makes every digit
              // one `ch`, so the separators sit tight against the numbers the
              // way Chrome's own segments do. Slack here reads as `31 / 07`.
              style={{ width: `${len}ch` }}
              aria-label={LABELS[part.type]}
              placeholder={PLACEHOLDERS[part.type]}
              value={parts[part.type]}
              onFocus={e => e.currentTarget.select()}
              onChange={e => onSegmentChange(part.type as Field, e.target.value)}
              onKeyDown={e => onSegmentKeyDown(part.type as Field, e)}
            />
          );
        })}
      </div>

      {open && (
        <VirtualDateTimePanel
          parts={parts}
          hasDate={hasDate}
          hasTime={hasTime}
          onChange={onPicked}
          onClose={closePanel}
          dark={dark}
        />
      )}
    </div>
  );
};

VirtualDateTimeControl.displayName = 'VirtualDateTimeControl';
