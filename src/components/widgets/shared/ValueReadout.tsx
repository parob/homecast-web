import React from 'react';

interface ValueReadoutProps {
  /** The number, already formatted — "22.3", "Detected", "Closed". */
  value: string;
  /** Small suffix set beside the value, e.g. "°C" or "%". */
  unit?: string;
  /** What the value is, under it. */
  label?: string;
  /** Rendered as-is; its own size classes are overridden for the readout. */
  icon?: React.ReactNode;
  /** Tints the icon and value for alarm states. */
  tone?: 'normal' | 'warning' | 'danger';
}

/**
 * The expanded face of a read-only sensor.
 *
 * A sensor has nothing to drag, so the large view exists to make the reading
 * legible across a room rather than to offer a control. Sized in px like the
 * rest of the expanded panel, so it does not shrink with the text setting.
 */
export const ValueReadout: React.FC<ValueReadoutProps> = ({
  value,
  unit,
  label,
  icon,
  tone = 'normal',
}) => {
  const toneClass =
    tone === 'danger' ? 'text-red-500'
      : tone === 'warning' ? 'text-amber-500'
        : '';

  return (
    <div className="flex flex-col items-center justify-center gap-[6px] py-[12px]">
      {icon && (
        <div className={`flex h-[52px] w-[52px] items-center justify-center rounded-full bg-black/10 [&>svg]:h-[26px] [&>svg]:w-[26px] ${toneClass}`}>
          {icon}
        </div>
      )}
      <div className={`flex items-baseline gap-[2px] ${toneClass}`}>
        {/* A number can carry 44px; a word like "Detected" at that size shouts.
            Size by what the value actually is. */}
        <span className={`font-semibold leading-none tabular-nums ${/\d/.test(value) ? 'text-[44px]' : 'text-[30px]'}`}>{value}</span>
        {unit && <span className="text-[20px] font-medium opacity-70">{unit}</span>}
      </div>
      {label && <div className="text-[14px] opacity-70">{label}</div>}
    </div>
  );
};
