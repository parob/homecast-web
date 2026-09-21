import React from 'react';
import type { LucideIcon } from 'lucide-react';

interface CircleControlProps {
  /** Icon for the current state — swap it yourself for locked/unlocked etc. */
  icon: LucideIcon;
  /** Drives the filled vs hollow treatment. */
  isActive: boolean;
  /** State in words: "Locked", "Open", "Running". The accessible name. */
  label: string;
  /** Secondary line — battery, time remaining: what the subtitle doesn't say. */
  detail?: string;
  onPress: () => void;
  disabled?: boolean;
  /** Background for the active state; defaults to the widget's primary. */
  activeClassName?: string;
  /** Diameter in px. Fixed, like the rest of the expanded panel. */
  size?: number;
}

/**
 * The big round press-target Apple Home gives a lock or a garage door: one
 * thing to hit.
 *
 * The state is NOT written underneath: all three widgets that use this put the
 * same words in their subtitle — "Locked", "Open", "Running", jammed and
 * mid-move states included — so the panel said it twice in a space the size of
 * a playing card. `detail` stays, because battery and time-remaining are the
 * parts the subtitle doesn't carry.
 *
 * Sized in px rather than rem — the expanded panel has a fixed width, so its
 * controls must not scale with the text-size preference.
 */
export const CircleControl: React.FC<CircleControlProps> = ({
  icon: Icon,
  isActive,
  label,
  detail,
  onPress,
  disabled = false,
  activeClassName = 'bg-primary text-primary-foreground',
  size = 148,
}) => (
  <div className="flex flex-col items-center justify-center gap-[10px]">
    <button
      type="button"
      aria-pressed={isActive}
      aria-label={label}
      disabled={disabled}
      onClick={(e) => { e.stopPropagation(); if (!disabled) onPress(); }}
      className={`flex items-center justify-center rounded-full ring-1 ring-inset ring-black/10 transition-[transform,background-color] duration-fast ease-standard ${
        isActive ? activeClassName : 'bg-white/50 text-foreground'
      } ${disabled ? 'cursor-not-allowed opacity-55' : 'cursor-pointer hover:brightness-105 active:scale-95'}`}
      style={{ width: size, height: size }}
    >
      <Icon style={{ width: size * 0.36, height: size * 0.36 }} strokeWidth={1.75} />
    </button>
    {/* `tile-ink` is load-bearing, not decoration. WidgetWrapper flips a tile
        over a dark wallpaper to white ink with a list of ELEMENT names —
        h3, p, span — plus that class for anything else. A bare div matched
        none of them, so on a dark wallpaper the title and subtitle beside this
        line went white and the line itself kept the card's dark foreground:
        rgb(2,8,23) on a tile filled rgba(0,0,0,.2). The battery reading on an
        expanded lock was invisible (homecast-cloud#167). */}
    {detail && <div className="tile-ink text-[12px] opacity-70 text-center">{detail}</div>}
  </div>
);
