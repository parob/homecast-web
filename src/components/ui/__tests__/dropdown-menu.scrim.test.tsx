// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem,
} from '../dropdown-menu';
import { Button } from '../button';

/**
 * The scrim's elevation is load-bearing and looks like a typo.
 *
 * `AppHeader` and `MobileTabBar` are both `fixed z-[10001]`, which makes each a
 * stacking context: a scrim painted above them covers everything inside them,
 * and nothing within can climb back out. The header's own ⋮ went white on open
 * and then disappeared under the dim, because no z-index on the trigger can
 * escape its own stacking context.
 *
 * So the scrim sits *below* the app chrome, and a trigger in ordinary page flow
 * lifts over it under its own steam. Both halves are asserted here so a later
 * "tidy the z-indexes" cannot quietly restore the bug.
 */
const APP_CHROME_Z = 10001; // AppHeader, MobileTabBar

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
  it('sits below the app chrome, so a header trigger is not buried by it', () => {
    open(true);
    const z = zOf(scrimEl()?.className ?? '');
    expect(z).toBeDefined();
    expect(z!).toBeLessThan(APP_CHROME_Z);
  });

  it('positions the trigger while open, or its z-index would do nothing', () => {
    const trigger = open(true);
    // z-index has no effect on a static element — the class pair has to travel
    // together or the lift silently does nothing.
    expect(trigger.className).toContain('data-[state=open]:relative');
    const triggerZ = zOf(trigger.className);
    expect(triggerZ!).toBeGreaterThan(zOf(scrimEl()?.className ?? '')!);
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
