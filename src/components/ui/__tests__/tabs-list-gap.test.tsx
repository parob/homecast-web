// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { Tabs, TabsList, TabsTrigger } from '../tabs';

/**
 * A segmented tab bar spaces its tabs the same way it insets them.
 *
 * `TabsList` carried `p-1` and no `gap`, so the 4px showed on all four outer
 * edges of the group and nowhere between the tabs — measured on the Sharing
 * screen, every outer inset was 5px and the seam was 0.00px, the two triggers
 * exactly adjacent.
 *
 * It only became visible once both tabs had a background at once, which is the
 * resting state on iOS: `TabsTrigger` has `hover:bg-background/60` and `:hover`
 * sticks there after a tap. The white active pill then butted straight up
 * against the hovered one and the pair read as a single welded shape.
 *
 * jsdom has no layout, so what is pinned here is the declaration.
 */

const list = () => document.body.querySelector<HTMLElement>('[role="tablist"]');

const bar = (listClassName?: string) => (
  <Tabs defaultValue="shared">
    <TabsList className={listClassName}>
      <TabsTrigger value="shared">Shared Items</TabsTrigger>
      <TabsTrigger value="apps">Authorized Apps</TabsTrigger>
    </TabsList>
  </Tabs>
);

describe('tabs list spacing', () => {
  afterEach(cleanup);

  it('separates its tabs by the same step it insets them', () => {
    render(bar());

    const el = list();
    expect(el).not.toBeNull();
    expect(el!.className).toContain('p-1');
    expect(el!.className).toContain('gap-1');
  });

  it('still lets a caller choose its own spacing', () => {
    render(bar('gap-2'));

    // tailwind-merge drops the default when a caller names a conflicting one,
    // so the class list must not carry both.
    const el = list();
    expect(el!.className).toContain('gap-2');
    expect(el!.className).not.toContain('gap-1');
  });
});
