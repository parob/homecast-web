import { describe, it, expect } from 'vitest';
import {
  TAB_BAR_MODES, TAB_BAR_MODE_LABELS, TAB_BAR_MODE_HINTS,
  DEFAULT_TAB_BAR_MODE, normalizeTabBarMode, tabBarScrolls,
} from '../tab-bar-mode';

describe('tab bar modes', () => {
  it('names all three, and defaults to the one people already had', () => {
    expect(TAB_BAR_MODES).toEqual(['regular', 'compact', 'icon']);
    expect(DEFAULT_TAB_BAR_MODE).toBe('regular');
  });

  it('describes every mode it offers', () => {
    for (const mode of TAB_BAR_MODES) {
      expect(TAB_BAR_MODE_LABELS[mode]).toBeTruthy();
      expect(TAB_BAR_MODE_HINTS[mode]).toBeTruthy();
    }
  });

  /**
   * Settings are a JSON blob that outlives any one build, and a client on an
   * older bundle reads the same one — so an unknown mode has to mean "the usual
   * bar" rather than nothing at all.
   */
  it('falls back to regular for anything it does not recognise', () => {
    expect(normalizeTabBarMode('icon')).toBe('icon');
    expect(normalizeTabBarMode('mode-we-removed')).toBe('regular');
    expect(normalizeTabBarMode(undefined)).toBe('regular');
    expect(normalizeTabBarMode(3)).toBe('regular');
  });

  /** The other two are sized to always fit, which is why they need no scroller. */
  it('lets only regular outgrow the bar', () => {
    expect(tabBarScrolls('regular')).toBe(true);
    expect(tabBarScrolls('compact')).toBe(false);
    expect(tabBarScrolls('icon')).toBe(false);
  });
});
