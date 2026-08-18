import * as React from "react";
import { cn } from "@/lib/utils";
import { useBackgroundContext } from "@/contexts/BackgroundContext";
import type { TriState } from "@/components/widgets/shared/powerState";

/**
 * A switch with three positions, the middle one of which you cannot choose.
 *
 * Three of eight lights on is a fact about the house, and a binary switch has
 * nowhere to put it — so it rounded to "on" and quietly decided for you which
 * way the next press would go. The thumb parks in the middle instead, and the
 * press becomes a choice: all off, or all on. The middle is display-only. The
 * world puts the thumb there; the user can only move it off.
 *
 * Deliberately not built on @radix-ui/react-switch. Radix's Root is boolean and
 * swallows the click to flip it, so splitting the hit target would mean fighting
 * the primitive for the one behaviour that matters here. `shared/VerticalToggle`
 * already hand-rolls `role="switch"` for the same reason.
 */

interface TriStateToggleProps {
  state: TriState;
  /** true = all on, false = all off. The middle is never an outcome. */
  onCheckedChange: (next: boolean) => void;
  disabled?: boolean;
  /** Accessible name for the thing being switched, e.g. "Kitchen lights". */
  label?: string;
  /** Detail for the accessible description, e.g. "3 of 8 on". */
  description?: string;
  /** Track fill for the on state; mirrors the same prop on `ui/switch.tsx`. */
  checkedColorClass?: string;
  /**
   * A quarter wider *while it is in the middle*, for a control that can reach it.
   *
   * Off by default, and that default is load-bearing: this component backs
   * every ordinary accessory switch through `ColoredSwitch`, and widening it
   * unconditionally silently widened all thirteen of them — leaving them out of
   * step with the `ui/switch.tsx` switches everywhere else. Only a control with
   * three stops to show has earned the extra room — and only while it is
   * actually showing them: at either end there are two stops like anything
   * else, so it animates back to the ordinary width and stops being the odd one
   * out in a row of tiles.
   */
  wide?: boolean;
  /**
   * Off-state track. Defaults to something legible on the wallpaper actually
   * behind it — see the dark-background note on the component.
   */
  uncheckedColorClass?: string;
  /** Off-state thumb, same reasoning. */
  uncheckedThumbClass?: string;
  className?: string;
}

/**
 * A length that follows the text size, but only halfway.
 *
 * Two failures bracket this. Sized in pixels, the toggle sat still while every
 * rem-sized switch around it grew with the Small/Medium/Large preference, and
 * looked shrunken on the large setting. Sized purely in rem it tracked them
 * exactly — and then a control that is 45px at medium becomes 40 at small,
 * which is small for a thumb you are meant to hit, and 50 at large, which is a
 * lot of furniture for a tile.
 *
 * So only a quarter of each length follows the type and three quarters is
 * fixed: it moves in the same direction, at a quarter of the rate.
 *
 * The sizes below are quoted at the LARGE setting, not the middle one, and that
 * is deliberate: large is where the pre-existing switch was 50px, and that is
 * the size this control is meant to be. Anchoring there and damping downwards
 * makes it essentially one size that nudges with the text — 47.5 at small,
 * 48.75 at medium, 50 at large — rather than a control that halves in area
 * across the range.
 *
 * The cost is real and worth knowing: at the medium setting this is 48.75px
 * against `ui/switch.tsx`'s 40, so the two no longer match on the commonest
 * setting. That switch is a settings-screen control and this is a tile control,
 * so they are rarely in shot together, and they remain the same shape, height
 * ratio and colour — which is what makes them read as one family.
 */
interface Len { px: number; rem: number }

/** How much of a length follows the root font size. The rest is fixed. */
const SCALE_SHARE = 0.25;

/** The root size the numbers below are quoted at: the large text setting. */
const ANCHOR_ROOT = 20;

/** Split a size-at-large into its fixed and scaling parts. */
const len = (atLarge: number): Len => ({
  px: atLarge * (1 - SCALE_SHARE),
  rem: (atLarge * SCALE_SHARE) / ANCHOR_ROOT,
});

const sub = (a: Len, ...rest: Len[]): Len =>
  rest.reduce((acc, r) => ({ px: acc.px - r.px, rem: acc.rem - r.rem }), a);
const half = (a: Len): Len => ({ px: a.px / 2, rem: a.rem / 2 });

const css = (v: Len) => `calc(${v.px}px + ${v.rem}rem)`;
const toPx = (v: Len, root: number) => v.px + v.rem * root;

const THUMB = len(20);    // ui/switch.tsx's h-4 w-4, at the large setting
const PAD = len(5);       // its translate-x-1
const HEIGHT = len(30);   // its h-6
const NARROW = len(50);   // its w-10
const WIDE = len(62.5);   // a quarter wider, for three stops

function geometry(wide: boolean) {
  const track = wide ? WIDE : NARROW;
  return {
    track,
    min: PAD,
    max: sub(track, THUMB, PAD),
    mid: half(sub(track, THUMB)),
  };
}

/** The live root font size, which is what a rem is worth right now. */
function remPx(): number {
  if (typeof document === 'undefined') return 16;
  return parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
}

/** Past this the gesture is a swipe and the press that follows it is not a tap. */
const SWIPE_SLOP = 6;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export function TriStateToggle({
  state,
  onCheckedChange,
  disabled = false,
  label,
  description,
  checkedColorClass,
  wide = false,
  uncheckedColorClass,
  uncheckedThumbClass,
  className,
}: TriStateToggleProps) {
  // The app's real light/dark axis is the wallpaper, not a theme class — see
  // WidgetWrapper. An off track of `bg-input` is a pale grey that vanishes into
  // a light wallpaper and glares against a dark one, and the switch reads as
  // permanently half-lit either way. The context carries a safe default, so
  // this still renders standalone (the MQTT browser, tests) without a provider.
  const { isDarkBackground } = useBackgroundContext();
  const offTrack = uncheckedColorClass ?? (isDarkBackground ? 'bg-white/20' : 'bg-input');
  const offThumb = uncheckedThumbClass ?? (isDarkBackground ? 'bg-white/70' : 'bg-background');
  // The extra room is for the middle, so it is only taken in the middle. The
  // geometry follows, which is what makes the thumb's end stops line up with an
  // ordinary switch's the moment it gets there.
  const spread = wide && state === 'mixed';
  const { track, min: MIN_X, max: MAX_X, mid: MID_X } = geometry(spread);
  const thumbX: Record<TriState, Len> = { off: MIN_X, mixed: MID_X, on: MAX_X };
  const descriptionId = React.useId();
  const onButtonRef = React.useRef<HTMLButtonElement>(null);
  const switchRef = React.useRef<HTMLButtonElement>(null);
  const hasFocus = React.useRef(false);
  /** Set by a swipe, read by the click it produces, so one gesture acts once. */
  const justDragged = React.useRef(false);
  const [dragX, setDragX] = React.useState<number | null>(null);

  // The DOM shape changes with the state, and the state changes when a device
  // does — so the press that resolves a mixed group unmounts the very element a
  // keyboard user was standing on. Track focus, and take it back on the far side
  // rather than dropping the user at the top of the document.
  React.useLayoutEffect(() => {
    if (!hasFocus.current) return;
    const active = document.activeElement;
    if (active && active !== document.body) return;
    (state === 'mixed' ? onButtonRef : switchRef).current?.focus();
  }, [state]);

  const commit = (next: boolean, e: React.SyntheticEvent) => {
    // Every control in a widget stops here: the card underneath is itself a
    // press target that expands the tile.
    e.stopPropagation();
    if (disabled) return;
    if (justDragged.current) return; // the swipe already said what it wanted
    onCheckedChange(next);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (disabled) return;
    if (e.key === 'ArrowLeft' || e.key === 'Home') {
      e.preventDefault();
      commit(false, e);
    } else if (e.key === 'ArrowRight' || e.key === 'End') {
      e.preventDefault();
      commit(true, e);
    }
  };

  /**
   * Drag the thumb rather than aiming at a half.
   *
   * Move and release are taken from the window, not from a captured pointer:
   * capturing retargets the click, and in the mixed state the click has to
   * reach whichever half-button it started on.
   */
  const startDrag = (e: React.PointerEvent) => {
    e.stopPropagation();
    justDragged.current = false;
    if (disabled) return;

    const startX = e.clientX;
    const root = remPx();
    const from = toPx(thumbX[state], root);
    const lo = toPx(MIN_X, root);
    const hi = toPx(MAX_X, root);
    let moved = false;

    const onMove = (ev: PointerEvent) => {
      const dx = ev.clientX - startX;
      // The slop stays in pixels — it is a property of the finger, not of the
      // text-size setting — while the position it produces is in rem.
      if (!moved && Math.abs(dx) > SWIPE_SLOP) moved = true;
      if (moved) setDragX(clamp(from + dx, lo, hi));
    };

    const onEnd = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onEnd);
      window.removeEventListener('pointercancel', onEnd);
      setDragX(null);
      if (!moved) return;

      justDragged.current = true;
      const next = ev.clientX - startX > 0;
      // From an end, only the journey away from it means anything; a nudge
      // back towards the end you are already at should not write to anybody.
      if (state === 'mixed' || next !== (state === 'on')) onCheckedChange(next);
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onEnd);
    window.addEventListener('pointercancel', onEnd);
  };

  const focusProps = {
    onFocus: () => { hasFocus.current = true; },
    onBlur: () => { hasFocus.current = false; },
  };

  const dragging = dragX !== null;
  const root = remPx();
  const restX = thumbX[state];
  // At rest the offset stays a calc, so it keeps tracking the text size without
  // needing a re-render; mid-drag it is whatever the finger says.
  const offset = dragging ? `${dragX}px` : css(restX);
  const xPx = dragging ? (dragX as number) : toPx(restX, root);

  /**
   * Anything on means the track is on-coloured — the middle looks exactly like
   * the right-hand end, and only the thumb says which it is.
   *
   * A half-strength middle was the obvious reading of "part-way", but it made
   * a group with seven of eight lights lit look half switched off, which is the
   * opposite of what it is. Colour answers "is anything on"; the thumb answers
   * "how many". Ramping over the first half of the travel rather than switching
   * at a threshold is what keeps a drag continuous under the finger.
   */
  const fillOpacity = clamp((xPx - toPx(MIN_X, root)) / (toPx(MID_X, root) - toPx(MIN_X, root)), 0, 1);

  const fill = (
    <span
      aria-hidden
      className={cn(
        'absolute inset-0',
        !dragging && 'transition-opacity duration-base ease-standard',
        checkedColorClass || 'bg-primary',
      )}
      style={{ opacity: fillOpacity }}
    />
  );

  const thumb = (
    <span
      aria-hidden
      className={cn(
        'pointer-events-none absolute left-0 block rounded-full shadow-sm',
        !dragging && 'transition-transform duration-base ease-standard',
        state === 'off' && !dragging ? offThumb : 'bg-white/60',
      )}
      style={{ width: css(THUMB), height: css(THUMB), top: css(PAD), transform: `translateX(${offset})` }}
    />
  );

  const trackClasses = cn(
    'relative inline-flex shrink-0 items-center overflow-hidden rounded-full transition-[width,background-color] duration-base ease-standard',
    offTrack,
    disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer active:scale-90',
    className,
  );
  // touch-action keeps the page scrollable off a mis-grab: vertical still pans,
  // horizontal is ours.
  const trackStyle = { width: css(track), height: css(HEIGHT), touchAction: 'pan-y' as const };

  // Mixed genuinely is two commands, so it gets two buttons — and ARIA agrees:
  // aria-checked="mixed" is valid on checkbox, never on switch.
  if (state === 'mixed') {
    return (
      <div
        role="group"
        aria-label={label}
        aria-describedby={description ? descriptionId : undefined}
        className={cn(trackClasses, 'focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2 focus-within:ring-offset-background')}
        style={trackStyle}
        onPointerDown={startDrag}
        onKeyDown={handleKeyDown}
        {...focusProps}
      >
        {fill}
        {thumb}
        {description && <span id={descriptionId} className="sr-only">{description}</span>}
        <button
          type="button"
          aria-label="Turn all off"
          disabled={disabled}
          onClick={(e) => commit(false, e)}
          className="relative z-[1] h-full w-1/2 focus:outline-none disabled:cursor-not-allowed"
        />
        <button
          type="button"
          ref={onButtonRef}
          aria-label="Turn all on"
          disabled={disabled}
          onClick={(e) => commit(true, e)}
          className="relative z-[1] h-full w-1/2 focus:outline-none disabled:cursor-not-allowed"
        />
      </div>
    );
  }

  // Off and on keep the switch every user already knows: one target, tap
  // anywhere, no aiming.
  const checked = state === 'on';
  return (
    <button
      type="button"
      role="switch"
      ref={switchRef}
      aria-checked={checked}
      aria-label={label}
      aria-describedby={description ? descriptionId : undefined}
      disabled={disabled}
      onClick={(e) => commit(!checked, e)}
      onPointerDown={startDrag}
      onKeyDown={handleKeyDown}
      className={cn(trackClasses, 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background')}
      style={trackStyle}
      {...focusProps}
    >
      {fill}
      {thumb}
      {description && <span id={descriptionId} className="sr-only">{description}</span>}
    </button>
  );
}
