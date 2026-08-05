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
  /** Narrow bar (landscape, beside secondary controls) — shrinks the readout. */
  dense?: boolean;
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
  dense,
}) => {
  const { heroDense } = useWidgetColors();
  const isDense = dense ?? heroDense;
  const trackRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState<number | null>(null);
  // Commit while the finger is still down so the bulb tracks the drag, but no
  // faster than this — every commit is a round trip to the device.
  const lastCommit = useRef(0);

  const display = dragging ?? value;
  const pct = max > min ? ((display - min) / (max - min)) * 100 : 0;
  const clampedPct = Math.max(0, Math.min(100, pct));

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
    const now = performance.now();
    if (now - lastCommit.current > 250) {
      lastCommit.current = now;
      onCommit(next);
    }
  }, [disabled, onCommit, valueFromY]);

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

  const readout = formatValue ? formatValue(display) : `${Math.round(display)}%`;

  return (
    <div
      ref={trackRef}
      role="slider"
      aria-valuenow={Math.round(display)}
      aria-valuemin={min}
      aria-valuemax={max}
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
      className={`relative w-full overflow-hidden rounded-3xl select-none ring-1 ring-inset ring-black/10 ${trackClassName} ${
        disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'
      } ${className}`}
      style={{ touchAction: 'none' }}
    >
      <div
        className={`absolute inset-x-0 ${invert ? 'top-0' : 'bottom-0'} ${fillClassName} ${
          dragging === null ? 'transition-[height] duration-base ease-standard' : ''
        }`}
        style={{ height: `${clampedPct}%`, ...fillStyle }}
      />

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
