// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem,
} from '../dropdown-menu';
import { Button } from '../button';

/**
 * The trigger of an open menu must not be buried by its own scrim.
 *
 * Two attempts failed before this one, both trying to raise the trigger above
 * the scrim with z-index. That can never work: `AppHeader` and `MobileTabBar`
 * are `fixed z-[10001]`, a dnd-kit drag transform and a `backdrop-filter` glass
 * tile each open a stacking context, and nothing inside one paints above
 * something outside it whatever z-index it carries.
 *
 * Nothing is reordered now — the scrim is clipped so it never paints over the
 * trigger at all (see `scrimCutout`). What is asserted here is that no z-index
 * race has crept back in, since reaching for one is the obvious wrong move.
 */
function zOf(className: string): number | undefined {
  const m = className.match(/z-\[(\d+)\]/);
  return m ? Number(m[1]) : undefined;
}

function open(scrim: boolean) {
  render(
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button aria-label="More">⋮</Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent scrim={scrim}>
        <DropdownMenuItem>Rename</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>,
  );
  // Grabbed before opening: Radix aria-hidden's everything outside an open
  // menu, so getByRole can no longer see the trigger once it is up.
  const trigger = screen.getByRole('button', { name: 'More' });
  fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false });
  return trigger;
}

const scrimEl = () => document.body.querySelector<HTMLElement>('[aria-hidden="true"].fixed.inset-0');

describe('context-menu scrim', () => {
  it('renders a scrim under the menu', () => {
    open(true);
    const z = zOf(scrimEl()?.className ?? '');
    expect(z).toBeDefined();
    // Under the menu itself, which portals to 10060.
    expect(z!).toBeLessThan(10060);
  });

  it('does not try to win a z-index race with the trigger', () => {
    const trigger = open(true);
    // Both halves of the old attempt. Either one returning is the bug coming
    // back: the button goes white and then vanishes under the dim.
    expect(trigger.className).not.toContain('data-[state=open]:relative');
    expect(zOf(trigger.className)).toBeUndefined();
  });

  it('draws no scrim for an ordinary dropdown', () => {
    open(false);
    expect(scrimEl()).toBeNull();
  });

  /**
   * Radix's Portal renders `<Primitive.div asChild>` — `Children.only` — and a
   * `{cond && ...}` that evaluates to false still counts as a second child.
   * A sibling scrim therefore threw on every menu that did not ask for one.
   */
  it('renders a menu without a scrim at all, rather than throwing', () => {
    expect(() => open(false)).not.toThrow();
    expect(screen.getByText('Rename')).toBeTruthy();
  });
});
