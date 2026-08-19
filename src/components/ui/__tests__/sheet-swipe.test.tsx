// @vitest-environment jsdom
//
// A left sheet is a menu, so the gesture that opened it has to be able to put
// it back. The wiring is the interesting part: Content cannot reach the Root's
// open state, so it closes through a Close of its own.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';

import { Sheet, SheetContent, SheetTitle } from '../sheet';

function touchEvent(type: string, x: number, y: number, target: EventTarget, time: number) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'touches', {
    value: type === 'touchend' ? [] : [{ clientX: x, clientY: y, target }],
  });
  Object.defineProperty(event, 'timeStamp', { value: time });
  return event;
}

function swipeLeft(target: EventTarget) {
  target.dispatchEvent(touchEvent('touchstart', 220, 300, target, 1000));
  target.dispatchEvent(touchEvent('touchmove', 190, 301, target, 1040));
  target.dispatchEvent(touchEvent('touchmove', 130, 303, target, 1080));
  target.dispatchEvent(touchEvent('touchend', 130, 303, target, 1120));
}

function renderSheet(props: React.ComponentProps<typeof SheetContent>, onOpenChange = vi.fn()) {
  render(
    <Sheet open onOpenChange={onOpenChange}>
      <SheetContent aria-describedby={undefined} {...props}>
        <SheetTitle>Navigation</SheetTitle>
        <button>Kitchen</button>
      </SheetContent>
    </Sheet>,
  );
  return onOpenChange;
}

afterEach(() => { vi.restoreAllMocks(); });

describe('SheetContent swipe-to-close', () => {
  it('closes a left sheet swiped back out', () => {
    const onOpenChange = renderSheet({ side: 'left' });
    swipeLeft(screen.getByText('Kitchen'));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('leaves a right sheet alone — a swipe left is into it, not out of it', () => {
    const onOpenChange = renderSheet({ side: 'right' });
    swipeLeft(screen.getByText('Kitchen'));
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it('honours disableSwipeToClose', () => {
    const onOpenChange = renderSheet({ side: 'left', disableSwipeToClose: true });
    swipeLeft(screen.getByText('Kitchen'));
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it('keeps its close out of the accessibility tree', () => {
    renderSheet({ side: 'left', hideCloseButton: true });
    // The visible ✕ is gone; the one the swipe uses must not read as a second
    // button to a screen reader.
    expect(screen.queryAllByRole('button', { name: /close/i })).toHaveLength(0);
  });
});

describe('the ✕ in the corner', () => {
  const closeButtons = () => screen.queryAllByRole('button', { name: /close/i });

  it('is off by default on a left sheet', () => {
    // A left sheet is a menu: it opens onto its nav, so the ✕ lands on the
    // first row. This is a default rather than four call sites remembering —
    // the ✕ came back once already because one of them did not.
    renderSheet({ side: 'left' });
    expect(closeButtons()).toHaveLength(0);
  });

  it('is still on by default everywhere else', () => {
    renderSheet({ side: 'right' });
    expect(closeButtons()).toHaveLength(1);
  });

  it('comes back for a left sheet that asks', () => {
    renderSheet({ side: 'left', hideCloseButton: false });
    expect(closeButtons()).toHaveLength(1);
  });
});
