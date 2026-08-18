import { describe, it, expect } from 'vitest';
import { resolveCanvasTint, THEME_CANVAS } from '../canvas-tint';
import { PRESET_IMAGES, PRESET_SOLID_COLORS, PRESET_GRADIENTS } from '../colorUtils';
import type { BackgroundSettings } from '../graphql/types';

const bg = (over: Partial<BackgroundSettings>): BackgroundSettings => ({
  type: 'none', blur: 20, brightness: 50, ...over,
});

const firstKey = (o: Record<string, unknown>) => Object.keys(o)[0];

describe('resolveCanvasTint', () => {
  it('uses the theme colour when there is no wallpaper', () => {
    // Not a hardcoded #ffffff: the page really is the theme colour here, and a
    // literal would fight any future dark mode.
    expect(resolveCanvasTint({ background: null, sampledTopColor: null, isDark: false })).toBe(THEME_CANVAS);
    expect(resolveCanvasTint({ background: undefined, sampledTopColor: null, isDark: false })).toBe(THEME_CANVAS);
    expect(resolveCanvasTint({ background: bg({ type: 'none' }), sampledTopColor: null, isDark: false })).toBe(THEME_CANVAS);
  });

  it('never falls back to white once a wallpaper is set', () => {
    // The original bug: every one of these fell through to '#ffffff'.
    // 'solid-white' is excluded on purpose — see the test below.
    const cases = [
      bg({ type: 'custom', customUrl: 'https://example.test/a.jpg' }),
      bg({ type: 'preset', presetId: firstKey(PRESET_IMAGES) }),
      bg({ type: 'preset', presetId: 'solid-blue' }),
      bg({ type: 'preset', presetId: firstKey(PRESET_GRADIENTS) }),
      bg({ type: 'preset', presetId: 'a-preset-we-do-not-know' }),
    ];
    for (const background of cases) {
      for (const isDark of [true, false]) {
        for (const sampledTopColor of [null, '#123456']) {
          const tint = resolveCanvasTint({ background, sampledTopColor, isDark });
          expect(tint).not.toBe(THEME_CANVAS);
          expect(tint.toLowerCase()).not.toBe('#ffffff');
          expect(tint.toLowerCase()).not.toBe('#fff');
        }
      }
    }
  });

  it('does paint white when the wallpaper itself is white', () => {
    // Not the bug. A white canvas under a white wallpaper is the correct
    // answer; what was wrong was reaching white by falling through.
    const tint = resolveCanvasTint({
      background: bg({ type: 'preset', presetId: 'solid-white' }),
      sampledTopColor: null,
      isDark: false,
    });
    expect(tint.toLowerCase()).toBe('#ffffff');
  });

  it('drops the flat grey placeholders the old code flashed', () => {
    // '#aaaaaa' over a dark nature photograph was the visible flash.
    const pending = resolveCanvasTint({
      background: bg({ type: 'custom', customUrl: 'https://example.test/a.jpg' }),
      sampledTopColor: null,
      isDark: true,
    });
    expect(pending.toLowerCase()).not.toBe('#aaaaaa');
    expect(pending.toLowerCase()).not.toBe('#888888');
  });

  it('places the pending tint on the right side of mid grey', () => {
    const shared = { background: bg({ type: 'custom', customUrl: 'https://example.test/a.jpg' }), sampledTopColor: null };
    const channel = (hex: string) => parseInt(hex.slice(1, 3), 16);
    expect(channel(resolveCanvasTint({ ...shared, isDark: true }))).toBeLessThan(128);
    expect(channel(resolveCanvasTint({ ...shared, isDark: false }))).toBeGreaterThan(128);
  });

  it('prefers the sampled colour over the placeholder once it lands', () => {
    const shared = { background: bg({ type: 'custom', customUrl: 'https://example.test/a.jpg' }), isDark: true };
    const pending = resolveCanvasTint({ ...shared, sampledTopColor: null });
    const sampled = resolveCanvasTint({ ...shared, sampledTopColor: '#204080' });
    expect(sampled).not.toBe(pending);
  });

  it('resolves solid and gradient presets without waiting for a sample', () => {
    for (const presetId of [firstKey(PRESET_SOLID_COLORS), firstKey(PRESET_GRADIENTS)]) {
      const withSample = resolveCanvasTint({ background: bg({ type: 'preset', presetId }), sampledTopColor: '#abcdef', isDark: false });
      const without = resolveCanvasTint({ background: bg({ type: 'preset', presetId }), sampledTopColor: null, isDark: false });
      // Known up front, so sampling cannot change the answer.
      expect(withSample).toBe(without);
    }
  });
});
