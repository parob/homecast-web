import React, { memo } from 'react';
import { Plus, Minus, Play, Square, ToggleLeft, ListChecks, Hash, Timer, SlidersHorizontal, Type, CalendarClock } from 'lucide-react';
import { WidgetCard, useWidgetColors } from './WidgetCard';
import { WidgetProps, parseCharacteristicValue } from './types';
import { useBackgroundContext } from '@/contexts/BackgroundContext';
import { useVirtualAccessoryDefinition, useVirtualTimerInfo } from './VirtualAccessoryEditContext';
import { VirtualDateTimeControl, formatStored } from './VirtualDateTimeControl';
import { durationToMs } from '@/automation/types/automation';

/**
 * A helper accessory — a value the automation engine owns.
 *
 * It is an accessory like any other by the time it reaches here: it arrived
 * through `accessories.list`, it is grouped into a room, it is shared and
 * hidden and searched by the same code. All that is left is drawing the control
 * for a characteristic HomeKit doesn't have, which is exactly the job of a
 * widget.
 */

/** Characteristic → how to draw it. Mirrors relay/helper-accessories.ts. */
const VIRTUAL_CHARS = [
  'virtual_mode', 'virtual_count', 'virtual_number',
  'virtual_timer', 'virtual_text', 'virtual_datetime',
] as const;

/**
 * Controls sit on a translucent, photo-backed tile, so `bg-background` drew
 * them as stark white rectangles floating over the glass. They take the tile's
 * own treatment instead, chosen the way every other widget chooses it — from
 * `isDarkBackground`, not from a `dark:` variant, because the tile is dark when
 * the wallpaper behind it is, which Tailwind's dark mode knows nothing about.
 *
 * `color-scheme` matters more than it looks: it is what makes a native date
 * picker's calendar and its little clock glyph render dark rather than as a
 * white slab.
 *
 * `min-w-0` matters too — a `datetime-local` input has a wide intrinsic size
 * and will happily overflow its container without it.
 */
function fieldClass(dark: boolean, large?: boolean): string {
  return `${large ? 'h-11' : 'h-9'} w-full min-w-0 max-w-full box-border rounded-md border px-2.5 text-sm `
    + 'outline-none transition-colors '
    + (dark
      ? 'bg-white/15 border-white/25 text-white focus:border-white/50 [color-scheme:dark]'
      : 'bg-white/70 border-slate-300 text-slate-900 focus:border-slate-400 [color-scheme:light]');
}

/**
 * A mode picker drawn the way the rest of the app draws one.
 *
 * A native `<select>` is a bordered rectangle with a system chevron. Beside a
 * fan's slider and a lock's switch it reads as a form field dropped onto the
 * dashboard, which is exactly what stood out. Every other multi-choice control
 * here — alarm modes, thermostat modes, purifier modes — is a row of pills, so
 * a short option list becomes one too, with the same selected treatment.
 *
 * Long lists keep the select: a dozen pills wrap into a block that buries the
 * tile, and at that length a dropdown is genuinely the better control.
 */
const SEGMENTED_MAX_OPTIONS = 4;

const ModeSegmented: React.FC<{
  options: string[];
  value: string;
  onSelect: (v: string) => void;
  label: string;
  large?: boolean;
}> = ({ options, value, onSelect, label, large }) => {
  const { colors, iconStyle } = useWidgetColors();
  const selected = iconStyle === 'colourful'
    ? `${colors.accent} text-white ring-2 ring-inset ring-white/45`
    : 'bg-primary hover:bg-primary/90 text-primary-foreground ring-2 ring-inset ring-white/45';

  return (
    // Wraps rather than truncates: mode names are the author's own words, and
    // "Vacat…" tells you less than a second row costs.
    <div className="flex flex-wrap gap-1.5" role="group" aria-label={label}>
      {options.map(o => {
        const isActive = o === value;
        return (
          <button
            key={o}
            type="button"
            aria-pressed={isActive}
            onClick={e => { e.stopPropagation(); onSelect(o); }}
            className={`flex-1 basis-[5.5rem] truncate rounded-lg px-2 transition-colors ${large ? 'h-11 text-[14px]' : 'h-9 text-xs'} `
              + (isActive ? `${selected} font-semibold` : 'bg-black/15 hover:bg-black/25 font-normal')}
          >
            {o}
          </button>
        );
      })}
    </div>
  );
};

function buttonClass(dark: boolean, large?: boolean): string {
  return `${large ? 'h-11' : 'h-9'} inline-flex items-center justify-center gap-1.5 rounded-md border px-2.5 `
    + 'text-sm transition-colors '
    + (dark
      ? 'bg-white/15 border-white/25 text-white hover:bg-white/25'
      : 'bg-white/70 border-slate-300 text-slate-900 hover:bg-white');
}

const ICONS: Record<string, React.ElementType> = {
  virtual_mode: ListChecks,
  virtual_count: Hash,
  virtual_number: SlidersHorizontal,
  virtual_timer: Timer,
  virtual_text: Type,
  virtual_datetime: CalendarClock,
};

interface VirtualAccessoryShape {
  virtualType?: string;
  isUserEditable?: boolean;
  virtualOptions?: string[];
  virtualHasDate?: boolean;
  virtualHasTime?: boolean;
  virtualTimerState?: string;
  virtualStartedAt?: number;
  virtualEndsAt?: number;
  virtualRemainingMs?: number;
  virtualDurationMs?: number;
  virtualFinishedAt?: number;
  virtualControl?: string;
  /**
   * Pre-rename spellings, read but never written — the same inbound-alias
   * pattern `power_state` uses. In cloud mode the relay's WebView keeps its
   * cached bundle until the Mac app restarts, so for a while after a deploy a
   * new browser is reading a relay that still emits the old names. Without
   * these the tile renders as an unknown type in that window.
   */
  helperType?: string;
  helperOptions?: string[];
}

export const VirtualAccessoryWidget: React.FC<WidgetProps> = memo((props) => {
  const {
    accessory, getEffectiveValue, onSetValue, onSlider, compact, expanded, disabled,
    onExpandToggle, onDebug, iconStyle, editMode, editModeType, isHiddenUi,
    homeName, disableTooltip, onRemove, removeLabel, onHide, hideLabel,
    isHidden, showHiddenItems, onToggleShowHidden, onShare, locationSubtitle,
    onEdit, editLabel, onFinishEditing,
  } = props;

  const { isDarkBackground } = useBackgroundContext();
  // Configuration comes from the definition the browser already holds, not from
  // the relay — so a duration is known even while the relay serves an older
  // bundle that doesn't publish one.
  const definition = useVirtualAccessoryDefinition(accessory?.id);
  // Polled, so it is current; the accessory's own copy is as old as the last
  // accessories.list, which is minutes. Preferred wherever it has an answer —
  // a timer running out is exactly the moment the accessory has not heard about.
  const liveTimer = useVirtualTimerInfo(accessory?.id);
  const FIELD_CLASS = fieldClass(isDarkBackground, expanded);
  const BUTTON_CLASS = buttonClass(isDarkBackground, expanded);

  const raw = accessory as unknown as VirtualAccessoryShape;
  const meta: VirtualAccessoryShape = {
    ...raw,
    virtualType: raw.virtualType ?? raw.helperType,
    virtualOptions: raw.virtualOptions ?? raw.helperOptions,
  };
  const service = (accessory.services || [])[0];
  const char = (service?.characteristics || []).find(
    c => (VIRTUAL_CHARS as readonly string[]).includes(c.characteristicType),
  );

  // Characteristic values are JSON-encoded in the cache, exactly as HomeKit
  // sends them — every other widget decodes with parseCharacteristicValue and
  // this one read them raw. A string came back wearing its quotes, so the tile
  // showed `"yo"`, editing it wrote `"\"yo\""`, and each round added a layer.
  // It also made `value === 'active'` false for a timer that really was active.
  const value = char
    ? parseCharacteristicValue(getEffectiveValue(accessory.id, char.characteristicType, char.value))
    : undefined;
  const charType = char?.characteristicType ?? '';
  const Icon = ICONS[charType] ?? ToggleLeft;

  // Read-only, view-only share, or edit mode: show the value, offer nothing.
  // A control that looks live and isn't is worse than no control.
  const readOnly = disabled || editMode || meta.isUserEditable === false || !char;

  const set = (v: unknown) => {
    if (readOnly) return;
    if (typeof v === 'number' && !onSetValue) onSlider(accessory.id, charType, v);
    else onSetValue?.(accessory.id, charType, v);
  };

  const numeric = Number(value);
  const step = char?.stepValue ?? 1;
  const running = value === 'active';
  // Declared before `control`: renderControl() reads it for the counter, and
  // calling it any earlier would hit the temporal dead zone.
  const configuredMs = definition?.type === 'timer' ? durationToMs(definition.duration) : undefined;
  // Hook is called unconditionally — every other type simply has no finish
  // instant, so it reads false.
  const recentlyFinished = useRecentlyFinished(meta.virtualFinishedAt, TIMER_ALERT_MS);
  // A finish instant outlives the run after it, so a timer started again within
  // five seconds would otherwise still be shouting. Running wins.
  const alerting = charType === 'virtual_timer' && !running && recentlyFinished;
  const display = charType === 'virtual_timer'
    ? (
      alerting
        // role=status so a screen reader hears it too — the animation says
        // nothing to anyone who can't see it, and this is the whole point of
        // the five seconds.
        ? <span role="status">Time’s up</span>
        : <TimerReadout
        accessoryId={accessory.id}
        running={running}
        startedAt={liveTimer?.startedAt ?? meta.virtualStartedAt}
        endsAt={liveTimer?.endsAt ?? meta.virtualEndsAt}
        durationMs={configuredMs ?? liveTimer?.durationMs ?? meta.virtualDurationMs}
        finishedAt={liveTimer?.finishedAt ?? meta.virtualFinishedAt}
      />
    )
    : charType === 'virtual_datetime'
      // Read the same way the field writes it, or the collapsed tile says
      // `2026-07-31T15:25` about a field that says `31/07/2026, 15:25`.
      ? formatStored(value, meta.virtualHasDate !== false, meta.virtualHasTime !== false)
      : formatValue(charType, value);
  const control = readOnly ? undefined : renderControl();

  return (
    <WidgetCard
      title={accessory.name}
      subtitle={display}
      // The alarm rides on the icon, never on the tile. An animated transform
      // (or opacity) on an ancestor of a backdrop-filter element establishes a
      // new backdrop root, which switches the widget's glass off for as long as
      // it runs — see the entrance animation this was learned from.
      icon={<Icon className={`h-4 w-4${alerting ? ' timer-alarm' : ''}`} />}
      // Lighting the tile for the alert reuses the on-state tint, which is a
      // colour change only, so the glass survives it. WidgetWrapper fades tints
      // over 300ms, so it comes up and settles rather than blinking.
      isOn={charType === 'virtual_timer' ? (running || alerting) : false}
      isReachable={accessory.isReachable}
      accessory={accessory}
      compact={compact}
      expanded={expanded}
      onExpandToggle={onExpandToggle}
      onDebug={onDebug}
      serviceType="switch"
      iconStyle={iconStyle}
      editMode={editMode}
      editModeType={editModeType}
      isHiddenUi={isHiddenUi}
      homeName={homeName}
      disableTooltip={disableTooltip}
      onRemove={onRemove}
      removeLabel={removeLabel}
      onHide={onHide}
      hideLabel={hideLabel}
      isHidden={isHidden}
      showHiddenItems={showHiddenItems}
      onToggleShowHidden={onToggleShowHidden}
      onShare={onShare}
      locationSubtitle={locationSubtitle}
      onEdit={onEdit}
      editLabel={editLabel}
      // The control lives in the expanded body, not the header. A compact tile
      // is a glance — a text field or a date picker crammed into that row
      // dominated it and read as a stray white box sitting on the glass. The
      // value stays in the subtitle either way, so a compact tile still tells
      // you what it holds; expanding is what offers to change it.
      childrenVisible={control !== undefined}
    >
      {control !== undefined && (
        <div className="pt-1" onClick={e => e.stopPropagation()}>{control}</div>
      )}
    </WidgetCard>
  );

  function renderControl(): React.ReactNode {
    switch (charType) {
      case 'virtual_mode': {
        const options = meta.virtualOptions ?? [];
        const current = typeof value === 'string' ? value : '';
        // A value that is no longer an option still has to show, or the tile
        // would misrepresent the current mode.
        const shown = current && !options.includes(current) ? [current, ...options] : options;
        if (shown.length > 1 && shown.length <= SEGMENTED_MAX_OPTIONS) {
          return (
            <ModeSegmented
              options={shown}
              value={current}
              onSelect={set}
              label={`Set ${accessory.name}`}
              large={expanded}
            />
          );
        }
        return (
          <select
            className={FIELD_CLASS}
            aria-label={`Set ${accessory.name}`}
            value={current}
            onClick={e => e.stopPropagation()}
            onChange={e => set(e.target.value)}
          >
            {shown.map(o => <option key={o} value={o}>{o}</option>)}
          </select>
        );
      }

      case 'virtual_count':
      case 'virtual_number':
        // A field where the author asked for one: clicking + forty times to
        // reach 40 is not a control, it's a punishment.
        if (charType === 'virtual_number' && meta.virtualControl === 'field') {
          return (
            <VirtualNumberField
              label={accessory.name}
              value={numeric}
              min={char?.minValue}
              max={char?.maxValue}
              step={step}
              onCommit={v => set(clamp(v, char))}
              onDone={onFinishEditing}
              className={FIELD_CLASS}
            />
          );
        }
        return (
          <div className="flex items-center justify-between gap-2">
            <button
              type="button"
              aria-label={`Decrease ${accessory.name}`}
              className={`${BUTTON_CLASS} flex-1`}
              onClick={() => set(clamp(numeric - step, char))}
            >
              <Minus className="h-4 w-4" />
            </button>
            <span className="text-base tabular-nums min-w-[3rem] text-center">{display}</span>
            <button
              type="button"
              aria-label={`Increase ${accessory.name}`}
              className={`${BUTTON_CLASS} flex-1`}
              onClick={() => set(clamp(numeric + step, char))}
            >
              <Plus className="h-4 w-4" />
            </button>
          </div>
        );

      case 'virtual_timer':
        return (
          <button
            type="button"
            aria-label={running ? `Cancel ${accessory.name}` : `Start ${accessory.name}`}
            className={`${BUTTON_CLASS} w-full`}
            onClick={() => set(running ? 'idle' : 'active')}
          >
            {running ? <Square className="h-4 w-4" /> : <Play className="h-4 w-4" />}
            {running ? 'Cancel' : 'Start'}
          </button>
        );

      case 'virtual_text':
        return (
          <VirtualTextControl
            label={accessory.name}
            value={typeof value === 'string' ? value : ''}
            onCommit={set}
            onDone={onFinishEditing}
            className={FIELD_CLASS}
          />
        );

      case 'virtual_datetime':
        // Segments of our own rather than a native date input: WebKit hands
        // that one to the OS, so the Mac app drew `31 Jul 2026 at 15:25` where
        // the browser drew `31/07/2026, 15:25`. The platform's picker is still
        // there, opened from the field itself. Same characteristic, same
        // storage format — sortable ISO-ish text the engine keeps verbatim and
        // expressions compare — only the drawing is ours now.
        return (
          <VirtualDateTimeControl
            label={accessory.name}
            value={value}
            hasDate={meta.virtualHasDate !== false}
            hasTime={meta.virtualHasTime !== false}
            onCommit={set}
            onDone={onFinishEditing}
            className={FIELD_CLASS}
            dark={isDarkBackground}
          />
        );

      default:
        return undefined;
    }
  }
});

/**
 * A running countdown.
 *
 * Anchored to when it will END, not to how much is left. A remaining span is
 * only true at the instant it was measured, and the accessory list is fetched
 * minutes apart — so a tile rendering one was always showing a stale number,
 * and showed 0:00 outright whenever the last reading had been taken while the
 * timer was idle, which is exactly what pressing start produces.
 *
 * When the relay hasn't reported an end yet — the moment you press start, and
 * for as long as its bundle predates `virtualEndsAt` — the end is computed here
 * from the configured duration. That is the same arithmetic the relay does, so
 * the two agree, and it needs nothing from the relay at all.
 */
/**
 * When a countdown started, for timers the relay hasn't told us about.
 *
 * Module scope rather than component state, because a tile is not one
 * component: the compact tile and the expanded tile are separate instances of
 * this widget rendering the same accessory, so a per-instance record meant
 * expanding a timer that had been running two minutes restarted it at five.
 *
 * Only a fallback, and only for the gap between pressing start and the relay
 * reporting a start of its own — which is permanent while the relay serves a
 * bundle older than `virtualStartedAt`. A countdown that only works after the
 * Mac app is restarted is not a working countdown.
 */
const localTimerStarts = new Map<string, number>();

/** How long a timer shouts that it is up before settling into its finish time. */
const TIMER_ALERT_MS = 5000;

/**
 * True for `windowMs` after a timer last ran out.
 *
 * Keyed on the finish instant rather than on a running→idle transition. A tile
 * is not one component — the compact and expanded tiles are separate instances
 * of this widget rendering the same accessory — so a watcher for the transition
 * would miss every finish that landed while its own instance happened to be
 * unmounted. An instant says the same thing to whoever renders next, which is
 * also why opening the app three seconds after a timer fired still shows it.
 *
 * Cancelling deliberately leaves finishedAt alone (see cancelTimer in
 * VirtualAccessoryManager), so a cancelled timer stays quiet — only one that
 * actually ran down, or was finished early on purpose, announces itself.
 */
function useRecentlyFinished(finishedAt: number | undefined, windowMs: number): boolean {
  const [, tick] = React.useState(0);
  const active = finishedAt !== undefined && Date.now() - finishedAt < windowMs;

  // One timeout to close the window — the alert doesn't count down, it just ends.
  React.useEffect(() => {
    if (!active || finishedAt === undefined) return;
    const left = windowMs - (Date.now() - finishedAt);
    const t = setTimeout(() => tick(n => n + 1), Math.max(0, left) + 50);
    return () => clearTimeout(t);
  }, [active, finishedAt, windowMs]);

  return active;
}

/**
 * When a finished timer ran out — the time itself, not how long ago.
 *
 * "3 min ago" decays the moment you stop looking at it, and the question a
 * finished timer answers is when it ended. The date comes along only when that
 * wasn't today, so the common case stays short.
 */
/**
 * Whether this browser's locale tells the time on a 12-hour clock.
 *
 * Asked once, of the same empty locale list the formatting uses, so the answer
 * is whatever the platform would have chosen anyway.
 */
const PREFERS_12_HOUR = (() => {
  try {
    return new Intl.DateTimeFormat([], { hour: 'numeric' }).resolvedOptions().hour12 === true;
  } catch {
    return false;
  }
})();

function formatFinished(at: number, now: number): string {
  const then = new Date(at);
  // hour12 is stated rather than inferred. Left to itself WebKit can render a
  // 12-hour time and drop the am/pm with it, so "4:42" gave no clue which 4:42
  // a timer ran out at — the one thing this string exists to say. Naming it
  // keeps the marker; 24-hour locales are untouched and stay unambiguous by
  // construction.
  const time = then.toLocaleTimeString([], PREFERS_12_HOUR
    ? { hour: 'numeric', minute: '2-digit', hour12: true }
    : { hour: '2-digit', minute: '2-digit', hour12: false });
  const sameDay = then.toDateString() === new Date(now).toDateString();
  return sameDay ? time : `${then.toLocaleDateString([], { day: 'numeric', month: 'short' })} ${time}`;
}

/**
 * A running countdown.
 *
 * Derived, every tick, from when the timer started and how long it runs for —
 * never from a remaining span. A span is only true at the instant it was
 * measured, and the accessory list is fetched minutes apart, so a tile
 * rendering one showed a stale number; it showed 0:00 outright whenever the
 * last reading had been taken while the timer was idle, which is the state
 * pressing start leaves behind.
 *
 * Both inputs are facts that don't decay, so every instance computes the same
 * answer at whatever moment it happens to render.
 */
const TimerReadout: React.FC<{
  accessoryId: string;
  running: boolean;
  startedAt?: number;
  endsAt?: number;
  durationMs?: number;
  finishedAt?: number;
}> = ({ accessoryId, running, startedAt, endsAt, durationMs, finishedAt }) => {
  const [now, setNow] = React.useState(() => Date.now());

  // A locally-noted start is a guess — the moment a tile first saw the timer
  // running — so it is the last resort, never something that overrides what
  // the relay actually knows.
  const needsGuess = running && startedAt === undefined && endsAt === undefined;
  if (!running) localTimerStarts.delete(accessoryId);
  else if (needsGuess && !localTimerStarts.has(accessoryId)) {
    localTimerStarts.set(accessoryId, Date.now());
  }

  // Start + duration in preference to endsAt: the duration is configuration
  // this browser already holds, so it stays right even when the relay's copy
  // is out of date. endsAt is the same arithmetic done by the relay.
  const begin = startedAt ?? (needsGuess ? localTimerStarts.get(accessoryId) : undefined);
  const target = !running
    ? undefined
    : (begin !== undefined && durationMs !== undefined ? begin + durationMs : endsAt);

  // Only a running countdown decays. A finish time is a fixed instant, so once
  // the timer stops there is nothing left to re-render for.
  React.useEffect(() => {
    if (!running) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [running]);

  // Idle says nothing about whether this timer has ever run. When we know it
  // has, say when — that is the whole question you ask about a timer you
  // weren't watching, and it stands until the next start.
  if (!running) return <>{finishedAt !== undefined ? `Finished ${formatFinished(finishedAt, now)}` : 'Idle'}</>;
  if (target === undefined) return <>Running</>;

  const total = Math.max(0, Math.round((target - now) / 1000));
  const mm = Math.floor(total / 60);
  const ss = total % 60;
  return <>{mm}:{String(ss).padStart(2, '0')} left</>;
};

/**
 * A number you type. Same draft discipline as the text control — the value is
 * re-read while the tile is open, and binding straight to it would fight the
 * typing — but it commits a number and refuses anything that isn't one, so a
 * half-typed "-" or an empty box can't be written as 0.
 */
const VirtualNumberField: React.FC<{
  label: string;
  value: number;
  min?: number;
  max?: number;
  step: number;
  onCommit: (v: number) => void;
  onDone?: () => void;
  className: string;
}> = ({ label, value, min, max, step, onCommit, onDone, className }) => {
  const [draft, setDraft] = React.useState<string | null>(null);
  const shown = draft ?? (Number.isFinite(value) ? String(value) : '');

  const commit = () => {
    if (draft !== null) {
      const n = Number(draft);
      if (draft.trim() !== '' && Number.isFinite(n) && n !== value) onCommit(n);
    }
    setDraft(null);
  };

  const pending = React.useRef({ draft, value, onCommit });
  pending.current = { draft, value, onCommit };
  React.useEffect(() => () => {
    const p = pending.current;
    if (p.draft === null) return;
    const n = Number(p.draft);
    if (p.draft.trim() !== '' && Number.isFinite(n) && n !== p.value) p.onCommit(n);
  }, []);

  return (
    <input
      type="number"
      inputMode="decimal"
      className={className}
      aria-label={`Set ${label}`}
      value={shown}
      min={min}
      max={max}
      step={step}
      onClick={e => e.stopPropagation()}
      onChange={e => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={e => {
        e.stopPropagation();
        if (e.key === 'Enter') { commit(); (e.target as HTMLInputElement).blur(); onDone?.(); }
        if (e.key === 'Escape') { setDraft(null); (e.target as HTMLInputElement).blur(); }
      }}
    />
  );
};

/**
 * Free text needs a draft: the value is re-read every 10s while the tile is on
 * screen, and binding the input straight to it would overwrite what is being
 * typed. Committed on Enter or on leaving the field, and Escape abandons it.
 */
const VirtualTextControl: React.FC<{
  label: string;
  value: string;
  onCommit: (v: string) => void;
  /** Enter means finished, so the tile that opened for the edit can close. */
  onDone?: () => void;
  className: string;
}> = ({ label, value, onCommit, onDone, className }) => {
  const [draft, setDraft] = React.useState<string | null>(null);
  const shown = draft ?? value;

  const commit = () => {
    if (draft !== null && draft !== value) onCommit(draft);
    setDraft(null);
  };

  // Commit on the way out too. `blur` doesn't fire when a field is unmounted,
  // and this one lives in a tile that collapses — so anything typed and not
  // yet confirmed would simply disappear. Read through refs so the effect can
  // stay mount-scoped and still see the last draft.
  const pending = React.useRef({ draft, value, onCommit });
  pending.current = { draft, value, onCommit };
  React.useEffect(() => () => {
    const p = pending.current;
    if (p.draft !== null && p.draft !== p.value) p.onCommit(p.draft);
  }, []);

  return (
    <input
      type="text"
      className={className}
      aria-label={`Set ${label}`}
      value={shown}
      onClick={e => e.stopPropagation()}
      onChange={e => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={e => {
        e.stopPropagation();
        if (e.key === 'Enter') { commit(); (e.target as HTMLInputElement).blur(); onDone?.(); }
        if (e.key === 'Escape') { setDraft(null); (e.target as HTMLInputElement).blur(); }
      }}
    />
  );
};

function clamp(v: number, char?: { minValue?: number; maxValue?: number }): number {
  let out = v;
  if (typeof char?.minValue === 'number') out = Math.max(char.minValue, out);
  if (typeof char?.maxValue === 'number') out = Math.min(char.maxValue, out);
  return out;
}

function formatValue(charType: string, value: unknown): string {
  if (value === undefined || value === null || value === '') return '—';
  if (charType === 'virtual_timer') {
    return value === 'active' ? 'Running' : value === 'paused' ? 'Paused' : 'Idle';
  }
  return String(value);
}

VirtualAccessoryWidget.displayName = 'VirtualAccessoryWidget';
