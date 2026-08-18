import React, { useState, useLayoutEffect } from 'react';
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
 * How many swatches fit on one line, measured rather than assumed.
 *
 * The row lives in tiles of several widths — a group panel, a single bulb, a
 * phone — and there is no width at which every preset always fits. Sizes come
 * off the rendered swatches instead of being written down a second time here,
 * so changing the circle size or the gap in the markup can't put this out.
 *
 * Returns null until the first measurement, which means "show them all".
 */
function useVisibleSwatchCount(total: number) {
  const [row, setRow] = useState<HTMLDivElement | null>(null);
  const [count, setCount] = useState<number | null>(null);

  useLayoutEffect(() => {
    if (!row) return;
    const measure = () => {
      const first = row.children[0] as HTMLElement | undefined;
      const swatch = first?.offsetWidth ?? 0;
      if (!swatch) return;
      const style = getComputedStyle(row);
      const gap = parseFloat(style.columnGap) || 0;
      const inner =
        row.clientWidth - (parseFloat(style.paddingLeft) || 0) - (parseFloat(style.paddingRight) || 0);
      // n swatches need n widths and n-1 gaps, so lending the line one extra
      // gap makes the division come out whole.
      const fits = Math.floor((inner + gap) / (swatch + gap));
      setCount(Math.max(1, Math.min(total, fits)));
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(row);
    return () => observer.disconnect();
  }, [row, total]);

  return [setRow, count] as const;
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

  const [rowRef, visibleCount] = useVisibleSwatchCount(COLOR_PRESETS.length);

  const visible = (() => {
    if (visibleCount === null || visibleCount >= COLOR_PRESETS.length) return COLOR_PRESETS;
    const shown = COLOR_PRESETS.slice(0, visibleCount);
    // The colour the light is on has to be one you can see, or a row that has
    // dropped the tail reports no selection at all. It takes the last slot
    // rather than pushing in, so the swatches ahead of it stay put.
    const active = COLOR_PRESETS.findIndex(isActive);
    if (active >= visibleCount) shown[visibleCount - 1] = COLOR_PRESETS[active];
    return shown;
  })();

  return (
    // The picker button is a sibling of the presets, not the last item in the
    // same row. Sharing a row it was the first thing to fall off the end, and a
    // "more colours" control alone on a second line reads as a different
    // control entirely rather than the tail of this one. The presets don't wrap
    // either — past what fits they are dropped, and the picker they sit beside
    // is where the rest of the spectrum already lives.
    <div className="flex items-center gap-[6px]" onClick={(e) => e.stopPropagation()}>
      <div
        ref={rowRef}
        // The negative margins are cancelled by equal padding: the swatches
        // stay exactly where they were, and the selection ring gets room to
        // sit outside the circle without the overflow clip cutting it off.
        className="-mx-1 -my-1 flex min-w-0 flex-1 items-center gap-[6px] overflow-hidden px-1 py-1"
      >
        {visible.map((p) => {
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
      </div>
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
