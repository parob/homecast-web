// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { TEXT_SCALE_BASE_PX, TEXT_SCALES, textScalePx } from '../text-scale';

/**
 * The contract this file exists to pin: the setting changes how large type is
 * and nothing else. It used to be the root font size, so every rem in the app
 * — control heights, the tab bar, icons, padding — shrank with the words.
 */
describe('text scale', () => {
  afterEach(() => {
    document.documentElement.style.removeProperty('font-size');
    document.documentElement.style.removeProperty('--text-scale');
  });

  const apply = (size: keyof typeof TEXT_SCALES) => {
    document.documentElement.style.fontSize = `${TEXT_SCALE_BASE_PX}px`;
    document.documentElement.style.setProperty('--text-scale', String(TEXT_SCALES[size]));
  };

  it('leaves the root font size — and so every rem — alone at all three rungs', () => {
    const roots = (['small', 'medium', 'large'] as const).map(size => {
      apply(size);
      return getComputedStyle(document.documentElement).fontSize;
    });
    expect(new Set(roots).size).toBe(1);
    expect(roots[0]).toBe(`${TEXT_SCALE_BASE_PX}px`);
  });

  it('renders type at the sizes the old root font size did', () => {
    // Small was a 16px root, medium 18, large 20 — the rungs people already
    // chose between. Base × scale has to land back on them or the setting
    // silently changed what "Small" means.
    expect(TEXT_SCALE_BASE_PX * TEXT_SCALES.small).toBe(16);
    expect(TEXT_SCALE_BASE_PX * TEXT_SCALES.medium).toBe(18);
    expect(TEXT_SCALE_BASE_PX * TEXT_SCALES.large).toBe(20);
  });

  it('reports what a 1rem font comes to, for canvas text that cannot inherit', () => {
    apply('small');
    expect(textScalePx()).toBe(16);
    apply('large');
    expect(textScalePx()).toBe(20);
  });

  it('falls back to the browser default before anything has been applied', () => {
    // Every page mounts before the dashboard applies the setting, and some
    // never do. A chart there should draw at 1×, not at nothing.
    expect(textScalePx()).toBe(16);
  });
});
