import React, { memo } from 'react';
import { TIMER_FINISHED_COLOR } from './iconColors';
import { Plus, Minus, Play, Square, ToggleLeft, ListChecks, Hash, Timer, SlidersHorizontal, Type, CalendarClock, ChevronDown, Check } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
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
/**
 * The unselected state of any pill/chip sitting on a widget's translucent
 * tile. Must set its own text colour, and `onDark` must be WidgetWrapper's
 * rule — `!isOn && isDarkBackground` — not isDarkBackground alone: an ON
 * tile takes a pale accent fill (a lights group goes yellow) where white
 * ink disappears.
 */
export function UNSELECTED_CHIP(onDark: boolean): string {
  return onDark
    ? 'bg-white/15 hover:bg-white/25 text-white'
    : 'bg-black/10 hover:bg-black/20 text-slate-900';
}

const SEGMENTED_MAX_OPTIONS = 4;

/**
 * Whether a set of options can be laid out as a row of pills, or needs a menu.
 *
 * Counting options was never the real question — the labels are the author's
 * own words, and three of them can be "On/Off/Auto" or "Idle/Running/
 * Cancelled". The second set overran the header row and left the last pill
 * sliced down the middle, because the only gate was `length > 3`.
 *
 * So both the count and the text are budgeted. The character budgets are
 * approximations of the space available rather than measurements: at these
 * font sizes a character averages a little over half its height in width, and
 * the exact point where a pill row stops fitting depends on a tile width that
 * changes with the grid. Erring small costs a menu where pills would just have
 * fitted; erring large costs the clipped row this replaced.
 */
function fitsAsPills(options: string[], maxCount: number, maxChars: number, maxLabel: number): boolean {
  if (options.length === 0 || options.length > maxCount) return false;
  if (options.some(o => o.length > maxLabel)) return false;
  return options.reduce((n, o) => n + o.length, 0) <= maxChars;
}

/**
 * The alternate presentation: what the current mode is, and a menu to change it.
 *
 * Used wherever the options will not fit as pills — a long list, long labels,
 * or the cramped header of a collapsed tile. It replaced a native `<select>`
 * in the expanded panel too, which had been the long-list fallback and was the
 * one control on the dashboard that still read as a form field on glass.
 *
 * Radix renders the menu in a portal, but React events propagate through the
 * *component* tree rather than the DOM, so a click inside it still reaches the
 * tile's own handlers — which would expand the tile and run its press
 * animation. Hence the stopped propagation on the content as well as the
 * trigger.
 */
const ModeMenu: React.FC<{
  options: string[];
  value: string;
  onSelect: (v: string) => void;
  label: string;
  dark: boolean;
  /** 'compact' is the header-row pill; 'panel' is the full-width control. */
  variant: 'compact' | 'panel';
  large?: boolean;
}> = ({ options, value, onSelect, label, dark, variant, large }) => {
  const compact = variant === 'compact';
  const trigger = compact
    ? `flex h-7 max-w-[9.5rem] items-center gap-1 rounded-full pl-2.5 pr-1.5 text-[11px] font-medium transition active:scale-95 `
      + (dark ? 'bg-white/20 text-white hover:bg-white/30' : 'bg-black/10 text-slate-800 hover:bg-black/15')
    : `${large ? 'h-11 text-[14px]' : 'h-9 text-sm'} flex w-full items-center justify-between gap-2 rounded-lg px-3 font-medium transition-colors `
      + (dark ? 'bg-white/15 text-white hover:bg-white/25' : 'bg-black/10 text-slate-900 hover:bg-black/15');

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={label}
          className={trigger}
          onClick={e => e.stopPropagation()}
          onPointerDown={e => e.stopPropagation()}
        >
          <span className="truncate">{value || 'Select'}</span>
          <ChevronDown className={compact ? 'h-3 w-3 shrink-0 opacity-70' : 'h-4 w-4 shrink-0 opacity-70'} />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="max-h-64 overflow-y-auto"
        onClick={e => e.stopPropagation()}
        onPointerDown={e => e.stopPropagation()}
      >
        {options.map(option => (
          <DropdownMenuItem
            key={option}
            onSelect={() => onSelect(option)}
            className={option === value ? 'font-semibold' : ''}
          >
            <Check className={`mr-2 h-4 w-4 ${option === value ? 'opacity-100' : 'opacity-0'}`} />
            <span className="truncate">{option}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

const ModeSegmented: React.FC<{
  options: string[];
  value: string;
  onSelect: (v: string) => void;
  label: string;
  large?: boolean;
}> = ({ options, value, onSelect, label, large }) => {
  const { colors, iconStyle, isOn } = useWidgetColors();
  // Unselected pills carried a translucent black fill and NO text colour, so
  // they inherited the theme's dark foreground. Colour follows the tile:
  // white only when the tile is OFF over a dark wallpaper.
  const { isDarkBackground } = useBackgroundContext();
  const onDark = !isOn && isDarkBackground;
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
            // The mode it is already in is shown, not offered.
            disabled={isActive}
            onClick={e => { e.stopPropagation(); onSelect(o); }}
            className={`flex-1 basis-[5.5rem] truncate rounded-lg px-2 transition-colors ${large ? 'h-11 text-[14px]' : 'h-9 text-xs'} `
              + (isActive
                ? `${selected} font-semibold cursor-default`
                : `${UNSELECTED_CHIP(onDark)} font-normal`)}
          >
            {o}
          </button>
        );
      })}
    </div>
  );
};

/**
 * The same picker, shrunk into the header row of a collapsed tile.
 *
 * Separate from `ModeSegmented` because the two answer different questions.
 * Expanded, the tile is already about this accessory and the row is a control.
 * Collapsed, it sits among a wall of tiles and has to say which mode is on from
 * across the room — so the selected option is filled in the accessory's own
 * colour, exactly as the expanded picker fills it, rather than merely ringed.
 * A ring on a translucent pill over a photo is close to invisible, which is
 * what this replaced.
 *
 * It is its own component so it can read the widget's colour: `headerAction` is
 * built in the parent's render, outside the card's provider, but the element it
 * returns is mounted inside it.
 */
const CompactModePills: React.FC<{
  options: string[];
  value: unknown;
  onSelect: (v: string) => void;
  name: string;
  dark: boolean;
}> = ({ options, value, onSelect, name, dark }) => {
  const { colors, iconStyle } = useWidgetColors();
  const selected = iconStyle === 'colourful'
    ? `${colors.accent} text-white ring-1 ring-inset ring-white/45`
    : 'bg-primary text-primary-foreground ring-1 ring-inset ring-white/45';
  const idle = dark
    ? 'bg-white/15 text-white/75 hover:bg-white/30 hover:text-white'
    : 'bg-black/10 text-slate-700 hover:bg-black/20 hover:text-slate-900';

  return (
    <span className="flex items-center gap-1" role="group" aria-label={`Set ${name}`}>
      {options.map(option => {
        const isActive = value === option;
        return (
          <button
            key={option}
            type="button"
            aria-label={`Set ${name} to ${option}`}
            aria-pressed={isActive}
            // The mode it is already in is shown, not offered — and a disabled
            // button swallows the press, so the tile doesn't expand either.
            disabled={isActive}
            className={'flex h-7 items-center justify-center rounded-full px-2.5 text-[11px] transition '
              + (isActive ? `${selected} font-semibold cursor-default` : `${idle} font-medium active:scale-90`)}
            onClick={e => { e.stopPropagation(); onSelect(option); }}
          >
            {option}
          </button>
        );
      })}
    </span>
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
  // Nothing else changes on press — the new value arrives seconds later — so
  // the tile needs its own reason to repaint the moment the button is hit.
  const [, repaint] = React.useReducer((n: number) => n + 1, 0);
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

  /**
   * Start or cancel, from wherever it was pressed.
   *
   * Shared so the compact tile's button and the expanded one cannot drift —
   * the optimism and the write have to happen together or the tile lies.
   */
  const toggleTimer = () => {
    if (readOnly) return;
    noteTimerIntent(accessory.id, !running);
    repaint();
    set(running ? 'idle' : 'active');
  };

  const set = (v: unknown) => {
    if (readOnly) return;
    if (typeof v === 'number' && !onSetValue) onSlider(accessory.id, charType, v);
    else onSetValue?.(accessory.id, charType, v);
  };

  const numeric = Number(value);
  const step = char?.stepValue ?? 1;
  // From the live poll in preference to the characteristic. A virtual state
  // change announces onto the engine's own trigger bus, not outward to
  // clients, so `value` is only as fresh as the last accessories.list —
  // minutes. Every other timer input below already prefers liveTimer; this one
  // did not, so a finished timer went on claiming it was running, its
  // countdown parked at 0:00, and the alert's running→idle moment never came.
  const reportedRunning = liveTimer ? liveTimer.state === 'active' : value === 'active';
  const running = charType === 'virtual_timer'
    ? optimisticRunning(accessory.id, reportedRunning)
    : reportedRunning;
  // Declared before `control`: renderControl() reads it for the counter, and
  // calling it any earlier would hit the temporal dead zone.
  const configuredMs = definition?.type === 'timer' ? durationToMs(definition.duration) : undefined;
  const timerTarget = charType === 'virtual_timer'
    ? countdownTarget(
      accessory.id, running,
      liveTimer?.startedAt ?? meta.virtualStartedAt,
      liveTimer?.endsAt ?? meta.virtualEndsAt,
      configuredMs ?? liveTimer?.durationMs ?? meta.virtualDurationMs,
    )
    : undefined;
  // Watched here rather than taken from a reported instant, because every
  // reported one arrives on a 10s poll and the alert only lasts 5s.
  // Two ways to learn a timer ran out, and the later one wins. Watching the
  // countdown locally catches it immediately; the reported instant catches the
  // ones this tile wasn't mounted for — including a page opened seconds after
  // it fired. Neither alone is enough.
  // A third way to learn it ran out, for sources that never carried a finish
  // instant of their own: a countdown that is no longer running but whose end
  // instant has passed ended AT that instant, by arithmetic. MQTT is the case
  // that needs it — a retained payload describes the run without stamping when
  // it stopped — and it costs nothing where a real one is reported, because
  // the derived value is the same number.
  //
  // Guarded on not-running: a live countdown's `endsAt` is in the future and
  // says nothing about a previous run.
  const derivedFinish = charType === 'virtual_timer' && !running
    ? (() => {
      const endsAt = liveTimer?.endsAt ?? meta.virtualEndsAt;
      return typeof endsAt === 'number' && endsAt <= Date.now() ? endsAt : undefined;
    })()
    : undefined;
  const reportedFinish = charType === 'virtual_timer'
    ? (liveTimer?.finishedAt ?? meta.virtualFinishedAt ?? derivedFinish)
    : undefined;
  const watchedFinish = charType === 'virtual_timer'
    ? noteCountdown(accessory.id, running, timerTarget)
    : undefined;
  const ranOutAt = charType === 'virtual_timer'
    ? mostRecent(watchedFinish, reportedFinish)
    : undefined;
  // Hook is called unconditionally — every other type simply never runs down,
  // so it reads false.
  const recentlyFinished = useRecentlyFinished(ranOutAt, TIMER_ALERT_MS);
  // A finish instant outlives the run after it, so a timer started again inside
  // the alert window would otherwise still be shouting. Running wins.
  const alerting = charType === 'virtual_timer' && !running && recentlyFinished;
  const display = charType === 'virtual_timer'
    ? (
      alerting
        // role=status so a screen reader hears it too — the animation says
        // nothing to anyone who can't see it, and that is the whole point of
        // the alert window.
        ? <span
            role="status"
            // Dark on the pastel tile. The subtitle is muted by default,
            // which on a green card left the one word that matters as the
            // faintest thing on it — hence the override.
            className="timer-finished !text-emerald-950 dark:!text-emerald-50 font-semibold"
          >
            Time’s up
          </span>
        : <TimerReadout
        accessoryId={accessory.id}
        running={running}
        startedAt={liveTimer?.startedAt ?? meta.virtualStartedAt}
        endsAt={liveTimer?.endsAt ?? meta.virtualEndsAt}
        durationMs={configuredMs ?? liveTimer?.durationMs ?? meta.virtualDurationMs}
        finishedAt={reportedFinish}
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
      // The accessory's own colour cannot say "this just went off", so for
      // the alert the whole tile takes the finished palette — the glyph alone
      // was easy to miss from across a room.
      colorOverride={alerting ? TIMER_FINISHED_COLOR : undefined}
      // Worth doing without opening the tile first — a switch gets its toggle
      // here, and expanding to press one button is the same friction. Only when
      // compact: at full size the control is already in the body, and two
      // buttons doing one thing is one too many.
      headerAction={compact && !readOnly ? renderCompactAction() : undefined}
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

  /**
   * The one-press version of this accessory, for a tile that hasn't been opened.
   *
   * Only what fits and what reads at a glance: a timer starts, a counter goes
   * up and down, a mode with a handful of options offers them. Anything longer
   * — text, a date, a mode with a real list — needs the room the expanded tile
   * gives it, and a cramped version would be worse than opening it.
   */
  function renderCompactAction(): React.ReactNode {
    const round = 'flex h-7 w-7 items-center justify-center rounded-full transition active:scale-90 '
      + (isDarkBackground
        ? 'bg-white/20 text-white hover:bg-white/30'
        : 'bg-black/10 text-slate-800 hover:bg-black/15');
    // The tile expands on click; none of these should.
    const press = (fn: () => void) => (e: React.MouseEvent) => { e.stopPropagation(); fn(); };

    switch (charType) {
      case 'virtual_timer':
        return (
          <button
            type="button"
            aria-label={running ? `Cancel ${accessory.name}` : `Start ${accessory.name}`}
            className={round}
            onClick={press(toggleTimer)}
          >
            {running ? <Square className="h-3 w-3" /> : <Play className="h-3 w-3" />}
          </button>
        );

      case 'virtual_count':
        return (
          <span className="flex items-center gap-1">
            <button
              type="button"
              aria-label={`Decrease ${accessory.name}`}
              className={round}
              onClick={press(() => set(clamp(numeric - step, char)))}
            >
              <Minus className="h-3 w-3" />
            </button>
            <button
              type="button"
              aria-label={`Increase ${accessory.name}`}
              className={round}
              onClick={press(() => set(clamp(numeric + step, char)))}
            >
              <Plus className="h-3 w-3" />
            </button>
          </span>
        );

      case 'virtual_mode': {
        // Three short words is the most a tile header holds. "Idle / Running /
        // Cancelled" is also three, and it ran off the edge — so the labels are
        // budgeted too, and anything longer becomes a menu rather than nothing:
        // changing the mode is the whole point of the tile.
        const options = definition?.type === 'input_select'
          ? definition.options
          : meta.virtualOptions;
        if (!options || options.length === 0) return undefined;
        if (!fitsAsPills(options, 3, 16, 8)) {
          return (
            <ModeMenu
              options={options}
              value={typeof value === 'string' ? value : ''}
              onSelect={set}
              label={`Set ${accessory.name}`}
              dark={isDarkBackground}
              variant="compact"
            />
          );
        }
        return (
          <CompactModePills
            options={options}
            value={value}
            onSelect={set}
            name={accessory.name}
            dark={isDarkBackground}
          />
        );
      }

      default:
        return undefined;
    }
  }

  function renderControl(): React.ReactNode {
    switch (charType) {
      case 'virtual_mode': {
        const options = meta.virtualOptions ?? [];
        const current = typeof value === 'string' ? value : '';
        // A value that is no longer an option still has to show, or the tile
        // would misrepresent the current mode.
        const shown = current && !options.includes(current) ? [current, ...options] : options;
        // Wider budgets than the header row: this control has the tile's full
        // width and is allowed to wrap onto a second line. What it must not do
        // is truncate — a pill reading "Cancell…" tells you less than a menu.
        if (shown.length > 1 && fitsAsPills(shown, SEGMENTED_MAX_OPTIONS, 40, 14)) {
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
          <ModeMenu
            options={shown}
            value={current}
            onSelect={set}
            label={`Set ${accessory.name}`}
            dark={isDarkBackground}
            variant="panel"
            large={expanded}
          />
        );
      }

      case 'virtual_number':
        // Always a field. Nudging to a number you already know is a punishment
        // — reaching 40 was forty presses — and a number helper exists to hold
        // a value someone has in mind, not one they arrive at by degrees.
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

      case 'virtual_count':
        // A counter keeps its buttons: counting up and down IS the thing.
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
            onClick={toggleTimer}
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
const TIMER_ALERT_MS = 10_000;

/**
 * How close to zero a countdown has to have been for going idle to count as
 * having run out. Wide enough to cover the trip from the relay saying so to
 * this browser hearing it.
 */
const RAN_OUT_TOLERANCE_MS = 1500;

/**
 * What the user just told a timer to do, until the relay says the same.
 *
 * Pressing start is the moment the user finds out whether the button works, and
 * the answer used to take seconds: the value comes back through the accessory
 * cache, and the tile did not move until it did. So the press is believed at
 * once and the countdown starts from it — the happy path is overwhelmingly the
 * common one, and a control that waits to be told what it already knows feels
 * broken even when nothing is wrong.
 *
 * Held only until the truth agrees, or briefly: an intent that is never
 * confirmed is a write that failed, and continuing to show it would be a lie
 * rather than an optimism.
 */
const timerIntent = new Map<string, { want: boolean; at: number }>();

/** How long a press is believed without confirmation. */
const INTENT_MS = 15_000;

function noteTimerIntent(accessoryId: string, want: boolean): void {
  timerIntent.set(accessoryId, { want, at: Date.now() });
}

function optimisticRunning(accessoryId: string, reported: boolean): boolean {
  const intent = timerIntent.get(accessoryId);
  if (!intent) return reported;
  if (reported === intent.want || Date.now() - intent.at > INTENT_MS) {
    timerIntent.delete(accessoryId);
    return reported;
  }
  return intent.want;
}

/** When a timer was last seen to reach zero here, by accessory id. */
const localTimerFinishes = new Map<string, number>();

/** What each countdown was last seen doing, so the run-down can be spotted. */
const lastCountdownSeen = new Map<string, { running: boolean; target?: number }>();

/**
 * Where a running countdown is heading, or undefined if it isn't running.
 *
 * Shared by the tile and its readout so the two cannot disagree about when the
 * timer ends — the tile needs it to tell a run-down from a cancellation, and
 * the readout needs it to draw the clock.
 */
function countdownTarget(
  accessoryId: string,
  running: boolean,
  startedAt?: number,
  endsAt?: number,
  durationMs?: number,
): number | undefined {
  // A locally-noted start is a guess — the moment a tile first saw the timer
  // running — so it is the last resort, never something that overrides what
  // the relay actually knows.
  //
  // Except when what the relay "knows" is the PREVIOUS run. The accessory
  // carries the last start it was fetched with, and that fetch is minutes old,
  // so pressing start on a timer that has run before pointed the countdown at
  // an instant already in the past and the tile sat at 0:00 until the next
  // poll replaced it — the button looked dead.
  //
  // Only at the transition into running, though. "Target has passed" is also
  // true at the honest END of a run, for the moment between the countdown
  // reaching zero and the relay saying so, and adopting a local start there
  // restarted the clock: the timer visibly ran through a second time. What
  // makes a reported start wrong is that it belongs to a run that is over,
  // which is knowable only when this run begins.
  const reported = startedAt !== undefined && durationMs !== undefined
    ? startedAt + durationMs
    : endsAt;
  const justStarted = running && !(lastCountdownSeen.get(accessoryId)?.running ?? false);
  if (justStarted && reported !== undefined && reported <= Date.now()) {
    localTimerStarts.set(accessoryId, Date.now());
  }
  const localStart = localTimerStarts.get(accessoryId);
  const needsGuess = running && localStart === undefined
    && startedAt === undefined && endsAt === undefined;
  if (!running) {
    localTimerStarts.delete(accessoryId);
    return undefined;
  }
  if (needsGuess && !localTimerStarts.has(accessoryId)) {
    localTimerStarts.set(accessoryId, Date.now());
  }
  // Start + duration in preference to endsAt: the duration is configuration
  // this browser already holds, so it stays right even when the relay's copy
  // is out of date. endsAt is the same arithmetic done by the relay.
  // A local start, once taken for this run, is used for the whole of it — the
  // reported one is known to be from a previous run and never improves.
  const begin = localStart ?? startedAt;
  if (begin !== undefined && durationMs !== undefined) return begin + durationMs;
  return localStart !== undefined ? undefined : endsAt;
}

/**
 * The instant this timer last ran out, watching the countdown itself.
 *
 * A reported finish instant cannot carry the alert on its own. Both
 * `virtualFinishedAt` and the timer info behind it reach this browser by poll —
 * `STATE_POLL_MS` is 10s against a 5s alert — so the news that a timer is up
 * usually arrives after the window it was meant to open has already shut. The
 * animation could hardly ever fire, whatever the CSS said.
 *
 * The countdown's end, by contrast, is arithmetic this browser already holds,
 * so it knows the exact instant without asking anyone.
 *
 * So the run-down is spotted here instead, from running going false while the
 * clock was at zero. Cancelling leaves time on it, which is the only thing
 * separating the two by the time they reach this browser — both arrive as
 * simply 'idle'.
 *
 * Module scope for the same reason localTimerStarts is: the compact and
 * expanded tiles are separate instances of this widget, and both have to agree
 * about whether this timer is currently shouting.
 */
/** The later of two instants, or whichever one exists. */
function mostRecent(a: number | undefined, b: number | undefined): number | undefined {
  if (a === undefined) return b;
  if (b === undefined) return a;
  return Math.max(a, b);
}

function noteCountdown(accessoryId: string, running: boolean, target: number | undefined): number | undefined {
  const prev = lastCountdownSeen.get(accessoryId);
  if (prev?.running && !running && prev.target !== undefined
      && Date.now() >= prev.target - RAN_OUT_TOLERANCE_MS) {
    localTimerFinishes.set(accessoryId, Date.now());
  }
  lastCountdownSeen.set(accessoryId, { running, target });
  return localTimerFinishes.get(accessoryId);
}

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

  const target = countdownTarget(accessoryId, running, startedAt, endsAt, durationMs);

  // Only a running countdown decays. A finish time is a fixed instant, so once
  // the timer stops there is nothing left to re-render for.
  //
  // Each tick is scheduled onto the countdown's own second boundary rather than
  // onto a free-running 1s interval. setInterval fires at whatever phase it
  // happens to start at and never sooner than its delay, so its sampling drifts
  // against the instant the displayed number actually changes — and each time
  // the drift crosses one, a second is skipped (21, then 19) or shown twice.
  // Re-deriving the delay every tick also makes it self-correcting, so a busy
  // main thread costs one late frame instead of a permanent offset.
  React.useEffect(() => {
    if (!running || target === undefined) return;
    let id: ReturnType<typeof setTimeout>;
    const schedule = () => {
      const left = target - Date.now();
      if (left <= 0) { setNow(Date.now()); return; }
      // Time until the displayed second changes, plus a hair so we land just
      // past the boundary rather than on it.
      id = setTimeout(() => { setNow(Date.now()); schedule(); }, ((left - 1) % 1000) + 1 + 8);
    };
    schedule();
    return () => clearTimeout(id);
  }, [running, target]);

  // Idle says nothing about whether this timer has ever run. When we know it
  // has, say when — that is the whole question you ask about a timer you
  // weren't watching, and it stands until the next start.
  if (!running) return <>{finishedAt !== undefined ? `Finished ${formatFinished(finishedAt, now)}` : 'Idle'}</>;
  if (target === undefined) return <>Running</>;

  // Clamped to the timer's own length: startedAt is stamped on the relay Mac
  // and `now` read from this browser, and in cloud mode those are different
  // machines. Half a second of clock skew is ordinary and used to render a five
  // minute timer as 5:01 the moment it started.
  const left = Math.max(0, Math.min(target - now, durationMs ?? Infinity));
  // ceil, not round: "0:20" means up to twenty seconds are left, and every
  // number holds the screen for a full second. Rounding changed the display on
  // the half-second, so the first and last numbers each flashed by in half the
  // time the others took.
  const total = Math.ceil(left / 1000);
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
