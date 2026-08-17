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
 *
 * Geometry matches `ui/switch.tsx` exactly — h-6 w-10 track, h-4 w-4 thumb — so
 * this drops into a widget header without shifting anything beside it.
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

/** Thumb offsets, in Tailwind translate steps. Mixed is the exact midpoint. */
const THUMB_X: Record<TriState, string> = {
  off: 'translate-x-1',
  mixed: 'translate-x-3',
  on: 'translate-x-5',
};

const FILL_WIDTH: Record<TriState, string> = {
  off: '0%',
  mixed: '50%',
  on: '100%',
};

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
    if (!disabled) onCheckedChange(next);
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

  const focusProps = {
    onFocus: () => { hasFocus.current = true; },
    onBlur: () => { hasFocus.current = false; },
  };

  // Not rounded: the track clips it, so a half fill ends flush at the midpoint
  // instead of tapering to a pill inside a pill.
  const fill = (
    <span
      aria-hidden
      className={cn(
        'absolute inset-y-0 left-0 transition-[width] duration-base ease-standard',
        checkedColorClass || 'bg-primary',
      )}
      style={{ width: FILL_WIDTH[state] }}
    />
  );

  const thumb = (
    <span
      aria-hidden
      className={cn(
        'pointer-events-none absolute left-0 top-1 block h-4 w-4 rounded-full shadow-sm transition-transform duration-base ease-standard',
        state === 'off' ? 'bg-background' : 'bg-white/60',
        THUMB_X[state],
      )}
    />
  );

  const trackClasses = cn(
    'relative inline-flex h-6 w-10 shrink-0 items-center overflow-hidden rounded-full bg-input transition-colors duration-base ease-standard',
    disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer active:scale-90',
    className,
  );

  // Mixed genuinely is two commands, so it gets two buttons — and ARIA agrees:
  // aria-checked="mixed" is valid on checkbox, never on switch.
  if (state === 'mixed') {
    return (
      <div
        role="group"
        aria-label={label}
        aria-describedby={description ? descriptionId : undefined}
        className={cn(trackClasses, 'focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2 focus-within:ring-offset-background')}
        onPointerDown={(e) => e.stopPropagation()}
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
      onPointerDown={(e) => e.stopPropagation()}
      onKeyDown={handleKeyDown}
      className={cn(trackClasses, 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background')}
      {...focusProps}
    >
      {fill}
      {thumb}
      {description && <span id={descriptionId} className="sr-only">{description}</span>}
    </button>
  );
}
