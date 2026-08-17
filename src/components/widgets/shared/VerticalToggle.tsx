import React from 'react';
import type { LucideIcon } from 'lucide-react';
import type { TriState } from './powerState';

interface VerticalToggleProps {
  checked: boolean;
  /** Aggregate state, when the caller has more than one thing to report. */
  state?: TriState;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  icon?: LucideIcon;
  onLabel?: string;
  offLabel?: string;
  /**
   * What is being switched, e.g. "Kitchen lamps". Only needed when `state` can
   * be mixed: the control is then two buttons that name their own directions,
   * so the thing they act on has to be named by the group around them. On or
   * off, the state word is the accessible name and this is unused.
   */
  label?: string;
  /** Detail for the accessible description, e.g. "3 of 8 on". */
  description?: string;
  /** Track fill for the on state; defaults to the widget primary. */
  activeClassName?: string;
  width?: number;
  height?: number;
}

/**
 * A big vertical rocker for accessories that are simply on or off.
 *
 * A plain switch has nothing to drag, so it gets a switch rather than a slider:
 * the knob rides to the top when on and the bottom when off, and the whole
 * track is the hit target. Sized in px — the expanded panel has a fixed width
 * and must not scale with the text-size preference.
 *
 * No label under it: every widget that uses this puts On/Off in its subtitle,
 * two lines above, so the word appeared twice in one small panel. The state is
 * legible from the knob's position and the track's fill; the words go to the
 * accessible name.
 *
 * The middle position is the same bargain as `TriStateToggle`: display-only,
 * split into two targets, top for on and bottom for off. Today both call sites
 * drive a single accessory and so can never reach it — it is here so the
 * control does not have to be rewritten the first time one aggregates.
 */
export const VerticalToggle: React.FC<VerticalToggleProps> = ({
  checked,
  state,
  onChange,
  disabled = false,
  icon: Icon,
  onLabel = 'On',
  offLabel = 'Off',
  label,
  description,
  activeClassName = 'bg-primary',
  width = 96,
  height = 200,
}) => {
  const pad = 8;
  const knob = width - pad * 2;
  const descriptionId = React.useId();
  const resolved: TriState = state ?? (checked ? 'on' : 'off');

  const knobTop = resolved === 'on'
    ? pad
    : resolved === 'off'
      ? height - knob - pad
      : (height - knob) / 2;

  const fillHeight = resolved === 'on' ? '100%' : resolved === 'off' ? '0%' : '50%';

  const press = (next: boolean, e: React.SyntheticEvent) => {
    e.stopPropagation();
    if (!disabled) onChange(next);
  };

  const shell = `relative overflow-hidden rounded-full ring-1 ring-inset ring-black/10 bg-black/15 ${
    disabled ? 'cursor-not-allowed opacity-55 grayscale' : 'cursor-pointer active:scale-[0.98]'
  }`;

  const body = (
    <>
      {/* Anchored to the bottom so the fill rises as the thing comes on. */}
      <span
        aria-hidden
        className={`absolute inset-x-0 bottom-0 transition-[height] duration-base ease-standard ${activeClassName}`}
        style={{ height: fillHeight }}
      />
      {/* The knob carries the icon, so the eye follows one object up and down
          rather than reading a fill level. */}
      <span
        className="absolute left-0 right-0 mx-auto flex items-center justify-center rounded-full bg-white shadow-md transition-[top] duration-base ease-standard"
        style={{ width: knob, height: knob, top: knobTop }}
      >
        {Icon && (
          <Icon
            style={{ width: knob * 0.4, height: knob * 0.4 }}
            className={resolved === 'off' ? 'text-slate-500' : 'text-slate-900'}
            strokeWidth={1.75}
          />
        )}
      </span>
      {description && <span id={descriptionId} className="sr-only">{description}</span>}
    </>
  );

  return (
    <div className="flex flex-col items-center">
      {resolved === 'mixed' ? (
        <div
          role="group"
          aria-label={label}
          aria-describedby={description ? descriptionId : undefined}
          className={shell}
          style={{ width, height }}
        >
          {body}
          <button
            type="button"
            aria-label={`Turn all ${onLabel.toLowerCase()}`}
            disabled={disabled}
            onClick={(e) => press(true, e)}
            className="absolute inset-x-0 top-0 z-[1] h-1/2 focus:outline-none disabled:cursor-not-allowed"
          />
          <button
            type="button"
            aria-label={`Turn all ${offLabel.toLowerCase()}`}
            disabled={disabled}
            onClick={(e) => press(false, e)}
            className="absolute inset-x-0 bottom-0 z-[1] h-1/2 focus:outline-none disabled:cursor-not-allowed"
          />
        </div>
      ) : (
        <button
          type="button"
          role="switch"
          aria-checked={checked}
          aria-label={checked ? onLabel : offLabel}
          aria-describedby={description ? descriptionId : undefined}
          disabled={disabled}
          onClick={(e) => press(!checked, e)}
          className={`${shell} transition-colors duration-base ease-standard`}
          style={{ width, height }}
        >
          {body}
        </button>
      )}
    </div>
  );
};
