import React from 'react';
import { Check, SlidersHorizontal } from 'lucide-react';

/** Hue/saturation presets, mirroring the spread Apple Home offers on a bulb. */
export const COLOR_PRESETS: { name: string; hue: number; saturation: number }[] = [
  { name: 'Red', hue: 0, saturation: 100 },
  { name: 'Orange', hue: 30, saturation: 100 },
  { name: 'Yellow', hue: 52, saturation: 100 },
  { name: 'Green', hue: 120, saturation: 85 },
  { name: 'Teal', hue: 175, saturation: 85 },
  { name: 'Blue', hue: 220, saturation: 90 },
  { name: 'Purple', hue: 280, saturation: 80 },
  { name: 'Pink', hue: 320, saturation: 70 },
];

interface ColorSwatchRowProps {
  hue: number;
  saturation: number;
  onSelect: (hue: number, saturation: number) => void;
  /** Toggles the full hue/saturation picker. */
  onTogglePicker: () => void;
  pickerOpen: boolean;
  disabled?: boolean;
}

/**
 * One tap for the colour you actually want, with the precise picker one more
 * tap away — the same split Apple Home uses. Presets cover the common cases so
 * the fiddly control stays out of the way until it is asked for.
 */
export const ColorSwatchRow: React.FC<ColorSwatchRowProps> = ({
  hue,
  saturation,
  onSelect,
  onTogglePicker,
  pickerOpen,
  disabled = false,
}) => {
  // Saturation is compared loosely: a bulb rounds what we send it, and an exact
  // match would leave the swatch you just tapped looking unselected.
  const isActive = (p: { hue: number; saturation: number }) =>
    Math.abs(p.hue - hue) <= 6 && Math.abs(p.saturation - saturation) <= 10;

  return (
    <div className="flex flex-wrap items-center gap-[6px]" onClick={(e) => e.stopPropagation()}>
      {COLOR_PRESETS.map((p) => {
        const active = isActive(p);
        return (
          <button
            key={p.name}
            type="button"
            aria-label={p.name}
            aria-pressed={active}
            disabled={disabled}
            onClick={() => onSelect(p.hue, p.saturation)}
            className={`flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-full transition-transform ${
              disabled ? 'cursor-not-allowed opacity-50' : 'hover:scale-110 active:scale-95'
            } ${active ? 'ring-2 ring-offset-2 ring-offset-transparent ring-white/80' : ''}`}
            style={{ backgroundColor: `hsl(${p.hue} ${p.saturation}% 50%)` }}
          >
            {active && <Check className="h-3.5 w-3.5 text-white drop-shadow" />}
          </button>
        );
      })}
      <button
        type="button"
        aria-label="More colours"
        aria-pressed={pickerOpen}
        disabled={disabled}
        onClick={onTogglePicker}
        className={`flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-full border border-current/20 transition-colors ${
          disabled ? 'cursor-not-allowed opacity-50' : 'hover:bg-white/20'
        } ${pickerOpen ? 'bg-white/25' : 'bg-white/10'}`}
      >
        <SlidersHorizontal className="h-3.5 w-3.5" />
      </button>
    </div>
  );
};
