import * as React from "react";
import { cn } from "@/lib/utils";
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
  className?: string;
}

/**
 * The track is `ui/switch.tsx`'s 24px tall and 16px thumb exactly, so this sits
 * in a row of ordinary switches without shifting anything — but a quarter wider,
 * 50px against 40px, because three positions in 40px put the thumb 13px from
 * each end and the middle stopped reading as the middle.
 */
const TRACK_W = 50;
const THUMB = 16;
const PAD = 4;
const MIN_X = PAD;                          // 4
const MAX_X = TRACK_W - THUMB - PAD;        // 30
const MID_X = (TRACK_W - THUMB) / 2;        // 17

const THUMB_X: Record<TriState, number> = { off: MIN_X, mixed: MID_X, on: MAX_X };

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
  className,
}: TriStateToggleProps) {
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
    const from = THUMB_X[state];
    let moved = false;

    const onMove = (ev: PointerEvent) => {
      const dx = ev.clientX - startX;
      if (!moved && Math.abs(dx) > SWIPE_SLOP) moved = true;
      if (moved) setDragX(clamp(from + dx, MIN_X, MAX_X));
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

  const x = dragX ?? THUMB_X[state];
  const dragging = dragX !== null;

  /**
   * The track's colour is the on colour laid over the off colour at the thumb's
   * own progress, so the middle is literally halfway between the two ends
   * rather than a half-filled bar — and a swipe blends continuously under the
   * finger instead of snapping when it lands.
   */
  const fillOpacity = (x - MIN_X) / (MAX_X - MIN_X);

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
        'pointer-events-none absolute left-0 top-1 block rounded-full shadow-sm',
        !dragging && 'transition-transform duration-base ease-standard',
        state === 'off' && !dragging ? 'bg-background' : 'bg-white/60',
      )}
      style={{ width: THUMB, height: THUMB, transform: `translateX(${x}px)` }}
    />
  );

  const trackClasses = cn(
    'relative inline-flex h-6 shrink-0 items-center overflow-hidden rounded-full bg-input',
    disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer active:scale-90',
    className,
  );
  // touch-action keeps the page scrollable off a mis-grab: vertical still pans,
  // horizontal is ours.
  const trackStyle = { width: TRACK_W, touchAction: 'pan-y' as const };

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
