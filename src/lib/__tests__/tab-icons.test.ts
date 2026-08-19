import { describe, it, expect } from 'vitest';
import { TAB_ICON_GROUPS, TAB_ICON_KEYS, isTabIconKey, normalizeTabIcon } from '../tab-icons';
import { MAPPED_ICON_KEYS } from '@/components/layout/tabIconComponents';

describe('tab icon vocabulary', () => {
  it('gives every offered key a glyph', () => {
    // A key in the vocabulary with no component would render a hole in the
    // picker, which is a build-time mistake and should fail like one.
    expect([...TAB_ICON_KEYS].sort()).toEqual([...MAPPED_ICON_KEYS].sort());
  });

  it('has no duplicate keys across groups', () => {
    expect(new Set(TAB_ICON_KEYS).size).toBe(TAB_ICON_KEYS.length);
  });

  it('every group offers something', () => {
    for (const group of TAB_ICON_GROUPS) expect(group.keys.length).toBeGreaterThan(0);
  });

  /**
   * The point of storing our own key rather than a lucide export name: a value
   * already sitting in someone's settings blob has to survive us retiring the
   * icon it names, and survive being read by a client on an older bundle.
   */
  it('treats a retired or malformed key as no override at all', () => {
    expect(normalizeTabIcon('sofa')).toBe('sofa');
    expect(normalizeTabIcon('icon-we-removed')).toBeUndefined();
    expect(normalizeTabIcon(undefined)).toBeUndefined();
    expect(normalizeTabIcon(42)).toBeUndefined();
    expect(normalizeTabIcon(null)).toBeUndefined();
  });

  it('isTabIconKey narrows only for keys it actually has', () => {
    expect(isTabIconKey('lightbulb')).toBe(true);
    expect(isTabIconKey('Lightbulb')).toBe(false); // the lucide name, not ours
    expect(isTabIconKey('')).toBe(false);
  });
});
