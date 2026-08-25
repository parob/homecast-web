// @vitest-environment jsdom
//
// WidgetWrapper is where a tile's colour is actually painted, for every widget
// type and all three presentations, and it had no test at all. These pin the
// two things the proportional tint changed: the fill is an inline rgba (a class
// cannot carry a runtime alpha — Tailwind has no safelist), and the ink follows
// that fill rather than the wallpaper.

import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { WidgetWrapper } from '../WidgetWrapper';
import { BackgroundContext } from '@/contexts/BackgroundContext';
import { TINT_ALPHA } from '@/lib/widget-tint';

const YELLOW = '#fef08a'; // yellow-200, a lightbulb's accent

function paint(
  props: Partial<React.ComponentProps<typeof WidgetWrapper>>,
  bg: { isDarkBackground: boolean; effectiveLuminance: number | null },
) {
  const { container } = render(
    <BackgroundContext.Provider value={{ hasBackground: true, ...bg }}>
      <WidgetWrapper iconStyle="colourful" tint={YELLOW} {...props}>
        <h3>Kitchen</h3>
      </WidgetWrapper>
    </BackgroundContext.Provider>,
  );
  const root = container.firstElementChild as HTMLElement;
  const glass = root.querySelector<HTMLElement>('.backdrop-blur-xl')!;
  return { root, glass };
}

const LIGHT = { isDarkBackground: false, effectiveLuminance: 1 };
const DARK = { isDarkBackground: true, effectiveLuminance: 0.03 };

afterEach(cleanup);

describe('WidgetWrapper fill', () => {
  it('paints the fill inline, never as a class', () => {
    // A generated `bg-yellow-200/37` would be purged and the tile would render
    // untinted, which is the whole reason this is an inline style.
    const { glass } = paint({ isOn: true, intensity: 0.5 }, LIGHT);
    expect(glass.style.backgroundColor).toMatch(/^rgba\(/);
    expect(glass.className).not.toMatch(/bg-\w+-\d00/);
  });

  it('reproduces the old off and full-on colours exactly', () => {
    expect(paint({ isOn: false }, LIGHT).glass.style.backgroundColor)
      .toBe('rgba(241, 245, 249, 0.8)');   // was bg-slate-100/80
    expect(paint({ isOn: false }, DARK).glass.style.backgroundColor)
      .toBe('rgba(0, 0, 0, 0.2)');         // was bg-black/20
    expect(paint({ isOn: true, intensity: 1 }, LIGHT).glass.style.backgroundColor)
      .toBe(`rgba(254, 240, 138, ${TINT_ALPHA})`); // was bg-yellow-200/75
  });

  it('leaves a binary accessory looking exactly as it did', () => {
    // No intensity prop at all — a lock, a switch.
    expect(paint({ isOn: true }, LIGHT).glass.style.backgroundColor)
      .toBe(`rgba(254, 240, 138, ${TINT_ALPHA})`);
  });

  it('lands a half-on accessory between the two', () => {
    const off = paint({ isOn: false }, LIGHT).glass.style.backgroundColor;
    const half = paint({ isOn: true, intensity: 0.5 }, LIGHT).glass.style.backgroundColor;
    const full = paint({ isOn: true, intensity: 1 }, LIGHT).glass.style.backgroundColor;
    expect(new Set([off, half, full]).size).toBe(3);
  });

  it('paints the standard style its shared blue whatever the accent says', () => {
    const { glass } = paint({ isOn: true, intensity: 1, iconStyle: 'standard' }, LIGHT);
    expect(glass.style.backgroundColor).toBe(`rgba(191, 219, 254, ${TINT_ALPHA})`);
  });
});

describe('WidgetWrapper ink', () => {
  const whiteInk = (root: HTMLElement) => root.className.includes('[&_h3]:!text-white');

  it('keeps the cases the old rule got right', () => {
    expect(whiteInk(paint({ isOn: false }, DARK).root)).toBe(true);
    expect(whiteInk(paint({ isOn: false }, LIGHT).root)).toBe(false);
    expect(whiteInk(paint({ isOn: true, intensity: 1 }, DARK).root)).toBe(false);
    expect(whiteInk(paint({ isOn: true, intensity: 1 }, LIGHT).root)).toBe(false);
  });

  it('goes white for a barely-on light over a dark wallpaper', () => {
    // The case `!isOn && isDarkBackground` got wrong: on, so it took dark ink
    // over what is very nearly black.
    expect(whiteInk(paint({ isOn: true, intensity: 0 }, DARK).root)).toBe(true);
  });
});

describe('WidgetWrapper hairline', () => {
  it('overrides the ring colour inline so Tailwind cannot supply its default blue', () => {
    const { root } = paint({ isOn: false }, LIGHT);
    expect(root.className).toContain('ring-1');
    expect(root.className).toContain('ring-inset');
    expect(root.style.getPropertyValue('--tw-ring-color')).toBe('rgba(226, 232, 240, 1)');
  });

  it('fades the ring out as the fill comes up, rather than dropping it', () => {
    // The class has to stay applied: an inset box-shadow cannot interpolate to
    // `none`, so removing it would snap while everything else fades.
    const { root } = paint({ isOn: true, intensity: 1 }, LIGHT);
    expect(root.className).toContain('ring-1');
    expect(root.style.getPropertyValue('--tw-ring-color')).toBe('rgba(226, 232, 240, 0)');
  });

  it('stays transparent over a dark wallpaper, as it always was', () => {
    const { root } = paint({ isOn: false }, DARK);
    expect(root.style.getPropertyValue('--tw-ring-color')).toBe('transparent');
  });
});
