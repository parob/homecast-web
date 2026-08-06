import React from 'react';
import type { LucideIcon } from 'lucide-react';

interface VerticalToggleProps {
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  icon?: LucideIcon;
  onLabel?: string;
  offLabel?: string;
  /** Track fill for the on state; defaults to the widget primary. */
  activeClassName?: string;
  width?: number;
  height?: number;
}

/**
 * A big vertical rocker for devices that are simply on or off.
 *
 * A plain switch has nothing to drag, so it gets a switch rather than a slider:
 * the knob rides to the top when on and the bottom when off, and the whole
 * track is the hit target. Sized in px — the expanded panel has a fixed width
 * and must not scale with the text-size preference.
 */
export const VerticalToggle: React.FC<VerticalToggleProps> = ({
  checked,
  onChange,
  disabled = false,
  icon: Icon,
  onLabel = 'On',
  offLabel = 'Off',
  activeClassName = 'bg-primary',
  width = 116,
  height = 232,
}) => {
  const pad = 8;
  const knob = width - pad * 2;

  return (
    <div className="flex flex-col items-center gap-[10px]">
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={checked ? onLabel : offLabel}
        disabled={disabled}
        onClick={(e) => { e.stopPropagation(); if (!disabled) onChange(!checked); }}
        className={`relative overflow-hidden rounded-full ring-1 ring-inset ring-black/10 transition-colors duration-base ease-standard ${
          checked ? activeClassName : 'bg-black/15'
        } ${disabled ? 'cursor-not-allowed opacity-55 grayscale' : 'cursor-pointer active:scale-[0.98]'}`}
        style={{ width, height }}
      >
        {/* The knob carries the icon, so the eye follows one object up and down
            rather than reading a fill level. */}
        <span
          className="absolute left-0 right-0 mx-auto flex items-center justify-center rounded-full bg-white shadow-md transition-[top] duration-base ease-standard"
          style={{
            width: knob,
            height: knob,
            top: checked ? pad : height - knob - pad,
          }}
        >
          {Icon && (
            <Icon
              style={{ width: knob * 0.4, height: knob * 0.4 }}
              className={checked ? 'text-slate-900' : 'text-slate-500'}
              strokeWidth={1.75}
            />
          )}
        </span>
      </button>
      <div className="text-[16px] font-medium">{checked ? onLabel : offLabel}</div>
    </div>
  );
};
