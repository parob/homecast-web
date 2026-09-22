import { describe, it, expect } from 'vitest';
import { viewKeyOf, VIEW_PARAMS } from '../view-key';

/**
 * parob/homecast-cloud#175 — a room entered from a scrolled home opened with
 * its title clipped off the top, because the only thing resetting scroll keyed
 * on `pathname` and the dashboard never changes its pathname.
 */
describe('viewKeyOf', () => {
  it('THE DEFECT: entering a room is a different view, though the pathname is identical', () => {
    const home = viewKeyOf('/portal', '?home=h1');
    const room = viewKeyOf('/portal', '?home=h1&room=r1');

    // Keying on the pathname alone, these two are the same and nothing resets.
    expect('/portal').toBe('/portal');
    expect(room).not.toBe(home);
  });

  it('treats each view-identifying param as a navigation', () => {
    const base = viewKeyOf('/portal', '?home=h1');
    for (const param of VIEW_PARAMS) {
      if (param === 'home') continue;
      expect(
        viewKeyOf('/portal', `?home=h1&${param}=x`),
        `${param} should identify a different view`,
      ).not.toBe(base);
    }
  });

  it('moves between two rooms', () => {
    expect(viewKeyOf('/portal', '?home=h1&room=r2')).not.toBe(viewKeyOf('/portal', '?home=h1&room=r1'));
  });

  it('goes back from a room to its home', () => {
    expect(viewKeyOf('/portal', '?home=h1')).not.toBe(viewKeyOf('/portal', '?home=h1&room=r1'));
  });

  it('does NOT treat opening settings as a navigation', () => {
    // Settings is a dialog over the page. Resetting the page behind it would
    // lose the reader's place for nothing, and again when it closes.
    expect(viewKeyOf('/portal', '?home=h1&settings=general')).toBe(viewKeyOf('/portal', '?home=h1'));
  });

  it('ignores unrelated params', () => {
    expect(viewKeyOf('/portal', '?home=h1&utm_source=x')).toBe(viewKeyOf('/portal', '?home=h1'));
  });

  it('does not depend on the order params appear in the URL', () => {
    expect(viewKeyOf('/portal', '?room=r1&home=h1')).toBe(viewKeyOf('/portal', '?home=h1&room=r1'));
  });

  it('still distinguishes different pathnames', () => {
    expect(viewKeyOf('/portal', '')).not.toBe(viewKeyOf('/settings', ''));
  });

  it('is stable for the same view', () => {
    expect(viewKeyOf('/portal', '?home=h1&room=r1')).toBe(viewKeyOf('/portal', '?home=h1&room=r1'));
  });

  it('treats an absent param and an empty one alike', () => {
    expect(viewKeyOf('/portal', '?home=h1&room=')).toBe(viewKeyOf('/portal', '?home=h1'));
  });
});
