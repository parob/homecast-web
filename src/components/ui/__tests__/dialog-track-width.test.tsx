// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { Dialog, DialogContent, DialogTitle } from '../dialog';

/**
 * A dialog may never be laid out wider than itself.
 *
 * `DialogContent` is a grid, and a grid's `auto` column has a FLOOR of its
 * items' min-content width — a floor that is allowed to overflow the box the
 * track sits in. The Analytics popup found that: recharts renders
 * `<svg width="391" style="width:100%">`, min-content is taken from the pixel
 * attribute, and the 391px track inside a 378px content box laid every row out
 * 13px past the right padding, where the popup's `overflow-x-hidden` clipped
 * the captions mid-word ("how many of 1 are unlocke…"). It ratchets, too:
 * recharts then measures the wider track and re-renders to match.
 *
 * `minmax(0, 1fr)` caps the track at the dialog's own width, so content shrinks
 * (truncates, wraps, re-measures) instead of pushing the layout outwards.
 *
 * jsdom has no layout, so what is pinned here is the declaration.
 */

const content = () => document.body.querySelector<HTMLElement>('[role="dialog"]');

describe('dialog content track', () => {
  afterEach(cleanup);

  it('caps its grid column at the dialog width', () => {
    render(
      <Dialog open>
        <DialogContent>
          <DialogTitle>Status · County Hall</DialogTitle>
        </DialogContent>
      </Dialog>,
    );

    const el = content();
    expect(el).not.toBeNull();
    expect(el!.className).toContain('grid-cols-[minmax(0,1fr)]');
  });

  it('still lets a caller choose its own columns', () => {
    render(
      <Dialog open>
        <DialogContent className="grid-cols-2">
          <DialogTitle>Two up</DialogTitle>
        </DialogContent>
      </Dialog>,
    );

    // tailwind-merge drops the default when a caller names a conflicting one,
    // so the class list must not carry both.
    const el = content();
    expect(el!.className).toContain('grid-cols-2');
    expect(el!.className).not.toContain('minmax(0,1fr)');
  });
});
