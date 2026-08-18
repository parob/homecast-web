// @vitest-environment jsdom
//
// What the swatch row does when the tile is too narrow for eight colours.
//
// It used to wrap, and the first thing over the edge was the "more colours"
// button — which then sat alone on a second line, reading as some other control
// rather than the tail of the swatches. Now the row never wraps: the presets
// that don't fit are dropped, and the picker beside them is where the rest of
// the spectrum already lives.
import { describe, it, expect, afterEach, beforeAll, afterAll } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { ColorSwatchRow, COLOR_PRESETS } from '../shared/ColorSwatchRow';

// jsdom lays nothing out, so the row measures itself as zero-width and shows
// everything. These stand in for a real layout: every swatch 30px wide, inside
// a row whose width each test sets.
let rowWidth = 1000;
const original = {
  offsetWidth: Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetWidth'),
  clientWidth: Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth'),
};

beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, 'offsetWidth', { configurable: true, get: () => 30 });
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => rowWidth });
});

afterAll(() => {
  if (original.offsetWidth) Object.defineProperty(HTMLElement.prototype, 'offsetWidth', original.offsetWidth);
  if (original.clientWidth) Object.defineProperty(HTMLElement.prototype, 'clientWidth', original.clientWidth);
});

afterEach(cleanup);

/** @param hsl the colour the light is currently on. */
function renderRow(width: number, hsl = { hue: 0, saturation: 100 }) {
  rowWidth = width;
  render(
    <ColorSwatchRow
      hue={hsl.hue}
      saturation={hsl.saturation}
      onSelect={() => {}}
      onTogglePicker={() => {}}
      pickerOpen={false}
    />
  );
  const picker = screen.getByLabelText('More colours');
  const presets = Array.from(picker.parentElement!.querySelector('div')!.children) as HTMLElement[];
  return { picker, presets, names: presets.map(el => el.getAttribute('aria-label')) };
}

describe('ColorSwatchRow', () => {
  it('shows every preset when they all fit', () => {
    const { names } = renderRow(1000);
    expect(names).toEqual(COLOR_PRESETS.map(p => p.name));
  });

  it('drops the presets past what fits rather than wrapping', () => {
    // Three 30px swatches, and no room for a fourth.
    const { names, presets } = renderRow(100);
    expect(names).toEqual(['Red', 'Orange', 'Yellow']);
    expect(presets[0].parentElement!.className).not.toContain('flex-wrap');
  });

  it('keeps the colour the light is on visible, in the last slot', () => {
    // Pink is the eighth preset, so a three-wide row would have cut it.
    const { names } = renderRow(100, { hue: 320, saturation: 70 });
    expect(names).toEqual(['Red', 'Orange', 'Pink']);
    expect(screen.getByLabelText('Pink').getAttribute('aria-pressed')).toBe('true');
  });

  it('keeps the picker button out of the presets, however narrow', () => {
    const { picker, presets } = renderRow(20);
    expect(presets[0].parentElement!.contains(picker)).toBe(false);
    expect(picker.parentElement).toBe(presets[0].parentElement!.parentElement);
    // Never nothing: one swatch survives a row with no room for even one.
    expect(presets).toHaveLength(1);
  });
});
