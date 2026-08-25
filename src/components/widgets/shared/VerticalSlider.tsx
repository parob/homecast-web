import React, { useCallback, useRef, useState } from 'react';
import type { LucideIcon } from 'lucide-react';
import { useWidgetColors } from '../WidgetCard';

interface VerticalSliderProps {
  value: number;
  min?: number;
  max?: number;
  /** Values snap to this increment while dragging. */
  step?: number;
  onCommit: (value: number) => void;
  disabled?: boolean;
  /** Tailwind classes for the filled portion. */
  fillClassName?: string;
  /** Inline styles for the filled portion — for live device colour. */
  fillStyle?: React.CSSProperties;
  /** Tailwind classes for the unfilled track. */
  trackClassName?: string;
  icon?: LucideIcon;
  /** Rendered under the value, e.g. "Brightness". */
  label?: string;
  /** Overrides the default "45%" readout. */
  formatValue?: (value: number) => string;
  className?: string;
  /** Inverts the fill so it grows downward — blinds close from the top. */
  invert?: boolean;
  /**
   * When to tell the device. 'live' commits on a throttle as the finger moves,
   * which is what makes a bulb track the drag; 'release' sends exactly one
   * write, on lift.
   *
   * A blind is not a bulb. It takes seconds to travel, so the eight
   * intermediate targets a two-second drag emits on 'live' are eight real
   * re-targetings of a motor that has not reached the first one — and on a slow
   * link they land *after* the finger is up, so the blind spends the next
   * half-minute chasing positions the user has already passed through and
   * abandoned. The drag itself is local state either way, so 'release' costs
   * nothing in smoothness.
   */
  commitMode?: 'live' | 'release';
  /**
   * A second position to mark: where the device actually is, when that differs
   * from where it has been told to go.
   *
   * With this set the bar tells two things at once. The solid fill is the part
   * both readings agree on — real, confirmed, already true. The lighter band
   * between them is the outstanding travel, and it shrinks as the device
   * reports its way across. So the value can jump to the target the instant a
   * command is sent (no snapping back to a stale reading on release) without
   * the bar ever claiming a blind is somewhere it is not: the claim and the
   * fact are drawn as different things.
   */
  ghostValue?: number;
  /**
   * Draws the target edge pulsing — a write is out and the device has not moved
   * yet. Purely presentational; the slider does not track requests itself.
   */
  pending?: boolean;
  /**
   * What the printed readout says when the finger is off, if that is not the
   * value the fill draws.
   *
   * The two came apart when the fill moved to the target. A fill that runs
   * ahead of the device is honest — the lighter band says plainly that the
   * travel is outstanding — but a *word* has no such shading. "Open" printed
   * over a shut blind is simply false, and it is the one part of the control
   * that cannot hedge. So the number reports where the device is and the fill
   * reports where it was sent; between them the bar says both things at once
   * without either having to lie.
   *
   * Dragging still wins over both: while the finger is down the readout is what
   * you are setting, because that is the only question being asked.
   */
  readoutValue?: number;
  /** Narrow bar (landscape, beside secondary controls) — shrinks the readout. */
  dense?: boolean;
  /**
   * Keeps a gradient fill sized to the whole track and crops it, instead of
   * squashing the full range into however tall the fill happens to be. A colour
   * temperature bar at 10% should show the warm end, not the entire warm-to-cool
   * sweep compressed into a sliver.
   */
  fixedGradient?: boolean;
}

/**
 * The tall drag-anywhere control Apple Home uses for brightness, fan speed,
 * volume and shade position.
 *
 * There is deliberately no thumb: the boundary between fill and track is the
 * value, which is what lets the whole bar be the hit target rather than a
 * handle you have to catch. Grabbing anywhere jumps there and starts dragging,
 * the same as Apple's.
 */
export const VerticalSlider: React.FC<VerticalSliderProps> = ({
  value,
  min = 0,
  max = 100,
  step = 1,
  onCommit,
  disabled = false,
  fillClassName = 'bg-primary',
  fillStyle,
  trackClassName = 'bg-white/40',
  icon: Icon,
  label,
  formatValue,
  className = '',
  invert = false,
  commitMode = 'live',
  ghostValue,
  pending = false,
  readoutValue,
  dense,
  fixedGradient = false,
}) => {
  const { heroDense } = useWidgetColors();
  const isDense = dense ?? heroDense;
  const trackRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState<number | null>(null);
  // Commit while the finger is still down so the bulb tracks the drag, but no
  // faster than this — every commit is a round trip to the device.
  const lastCommit = useRef(0);

  const display = dragging ?? value;
  const toPct = (v: number) => {
    const raw = max > min ? ((v - min) / (max - min)) * 100 : 0;
    return Math.max(0, Math.min(100, raw));
  };
  const clampedPct = toPct(display);

  // The two edges, ordered rather than named: which of the target and the
  // device's own reading is the further along the bar changes with the
  // direction of travel, and the drawing does not care which is which.
  const ghostPct = ghostValue === undefined ? null : toPct(ghostValue);
  const confirmedPct = ghostPct === null ? clampedPct : Math.min(clampedPct, ghostPct);
  const outstandingPct = ghostPct === null ? 0 : Math.max(clampedPct, ghostPct) - confirmedPct;

  const valueFromY = useCallback((clientY: number): number => {
    const rect = trackRef.current?.getBoundingClientRect();
    if (!rect || rect.height === 0) return display;
    const ratio = invert
      ? (clientY - rect.top) / rect.height
      : (rect.bottom - clientY) / rect.height;
    const raw = min + Math.max(0, Math.min(1, ratio)) * (max - min);
    return Math.round(raw / step) * step;
  }, [display, invert, max, min, step]);

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    if (disabled) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    setDragging(valueFromY(e.clientY));
  }, [disabled, valueFromY]);

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (disabled || !e.currentTarget.hasPointerCapture(e.pointerId)) return;
    const next = valueFromY(e.clientY);
    setDragging(next);
    if (commitMode === 'release') return;
    const now = performance.now();
    if (now - lastCommit.current > 250) {
      lastCommit.current = now;
      onCommit(next);
    }
  }, [commitMode, disabled, onCommit, valueFromY]);

  const handlePointerUp = useCallback((e: React.PointerEvent) => {
    if (disabled) return;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    setDragging(prev => {
      if (prev !== null) onCommit(prev);
      return null;
    });
  }, [disabled, onCommit]);

  // The finger if there is one, else the device's own reading, else the value.
  const readoutSource = dragging ?? readoutValue ?? value;
  const readout = formatValue ? formatValue(readoutSource) : `${Math.round(readoutSource)}%`;
  // Only worth drawing while the two disagree; once the device arrives the
  // fill's own boundary is the edge and an extra rule on top of it is noise.
  const showTravel = ghostPct !== null && outstandingPct > 0.5;
  /** Offset from whichever end the fill grows from. */
  const fromAnchor = (pct: number): React.CSSProperties =>
    invert ? { top: `${pct}%` } : { bottom: `${pct}%` };
  const targetReadout = formatValue ? formatValue(display) : `${Math.round(display)}%`;

  return (
    <div
      ref={trackRef}
      role="slider"
      aria-valuenow={Math.round(display)}
      aria-valuemin={min}
      aria-valuemax={max}
      // The gap between command and reality is the whole point of the ghost
      // track, and a screen reader gets none of it from the fill.
      aria-valuetext={showTravel ? `${readout}, heading for ${targetReadout}` : undefined}
      aria-label={label}
      aria-disabled={disabled || undefined}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      onClick={(e) => e.stopPropagation()}
      // touch-action:none — without it the browser claims the vertical drag for
      // page scrolling and the bar only ever sees a tap.
      // The ring matters: these bars sit on tiles that are already tinted with
      // the device's colour, so without a defined edge a warm fill on a warm
      // card reads as a smudge rather than a control.
      //
      // `tile-ink`/`tile-ink-track` are what let WidgetWrapper flip this bar to
      // white on a dark tile — the readout and label carry no colour of their
      // own and inherit from here. They live on the component rather than on
      // each caller because all nine sliders sit on a tile and want the same
      // thing; tagging call sites got six of them wrong. `tile-ink-track` sets
      // only a background-*color*, so a gradient track (Color Temp) still
      // paints over it.
      className={`relative w-full overflow-hidden rounded-3xl select-none ring-1 ring-inset ring-black/10 tile-ink tile-ink-track ${trackClassName} ${
        disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'
      } ${className}`}
      style={{ touchAction: 'none' }}
    >
      {/* The part both readings agree on: real, confirmed, already true. */}
      <div
        className={`absolute inset-x-0 ${invert ? 'top-0' : 'bottom-0'} ${fillClassName} ${
          dragging === null ? 'transition-[height] duration-base ease-standard' : ''
        }`}
        style={{
          height: `${confirmedPct}%`,
          // Anchored to the end the fill grows from, so the visible slice is the
          // part of the gradient that actually corresponds to the value.
          ...(fixedGradient && confirmedPct > 0
            ? {
                backgroundSize: `100% ${10000 / confirmedPct}%`,
                backgroundPosition: invert ? 'top' : 'bottom',
              }
            : {}),
          ...fillStyle,
        }}
      />

      {/* The outstanding travel. Same colour, half present — it reads as the
          command rather than as the state, and it drains as the device
          reports its way across. */}
      {showTravel && (
        <div
          data-testid="slider-travel"
          className={`absolute inset-x-0 opacity-40 ${fillClassName} ${
            dragging === null ? 'transition-all duration-base ease-standard' : ''
          }`}
          style={{
            ...fromAnchor(confirmedPct),
            height: `${outstandingPct}%`,
            ...fillStyle,
          }}
        />
      )}

      {/* Where the device actually is — the boundary between fact and order. */}
      {showTravel && ghostPct !== null && (
        <div
          className={`absolute inset-x-0 h-px bg-white/50 ${
            dragging === null ? 'transition-all duration-base ease-standard' : ''
          }`}
          style={fromAnchor(ghostPct)}
        />
      )}

      {/* Where it has been told to go. The crisp one, because it is the value:
          it lands the moment the command is sent and does not move again. */}
      {showTravel && (
        <div
          data-testid="slider-target-edge"
          className={`absolute inset-x-0 -my-px h-0.5 bg-black/50 ${pending ? 'animate-pulse-edge' : ''}`}
          style={fromAnchor(clampedPct)}
        />
      )}

      {/* Readout sits above the fill line so it stays legible at any value. */}
      <div className={`relative flex h-full flex-col items-center justify-between pointer-events-none ${isDense ? 'py-3' : 'py-4'}`}>
        <div className="px-1 text-center">
          <div className={`font-semibold tabular-nums drop-shadow-sm ${isDense ? 'text-[18px]' : 'text-[24px]'}`}>{readout}</div>
          {label && <div className={`opacity-70 ${isDense ? 'text-[10px] leading-tight' : 'text-[12px]'}`}>{label}</div>}
        </div>
        {Icon && (
          <div className={`flex items-center justify-center rounded-full bg-white/25 backdrop-blur-sm ${isDense ? 'h-[32px] w-[32px]' : 'h-[36px] w-[36px]'}`}>
            <Icon className={isDense ? 'h-[16px] w-[16px]' : 'h-[20px] w-[20px]'} />
          </div>
        )}
      </div>
    </div>
  );
};
