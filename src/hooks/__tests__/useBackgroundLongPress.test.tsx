// @vitest-environment jsdom
/**
 * The hold on the page itself.
 *
 * The decisions are unit-tested in lib/long-press; what is left here is the
 * part that only listeners can get wrong — when the timer is armed, and every
 * way it has to be called off.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, cleanup, act } from '@testing-library/react';
import { useRef } from 'react';
import { useBackgroundLongPress } from '../useBackgroundLongPress';
import { LIFT_DELAY_IDLE, LIFT_SLOP } from '@/lib/long-press';

function Host({ onLift, enabled = true }: { onLift: () => void; enabled?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useBackgroundLongPress(ref, onLift, enabled);
  return (
    <div ref={ref} data-testid="host">
      <span data-testid="page-text">Kitchen</span>
      <div data-draggable-item="" data-testid="tile">Lamp</div>
    </div>
  );
}

/** jsdom has no PointerEvent, and clientX/Y are read-only on the base Event. */
function pointer(type: string, x = 0, y = 0): Event {
  const e = new Event(type, { bubbles: true });
  Object.defineProperty(e, 'clientX', { value: x });
  Object.defineProperty(e, 'clientY', { value: y });
  return e;
}

function press(testId: string, x = 0, y = 0) {
  document.querySelector(`[data-testid="${testId}"]`)!.dispatchEvent(pointer('pointerdown', x, y));
}

function hold(ms = LIFT_DELAY_IDLE) {
  act(() => { vi.advanceTimersByTime(ms); });
}

describe('holding the page', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); cleanup(); });

  it('enters after the hold, not before it', () => {
    const onLift = vi.fn();
    render(<Host onLift={onLift} />);

    press('page-text');
    hold(LIFT_DELAY_IDLE - 1);
    expect(onLift).not.toHaveBeenCalled();

    hold(1);
    expect(onLift).toHaveBeenCalledTimes(1);
  });

  it('ignores a press on a tile, which lifts itself', () => {
    // Both firing would enter the mode twice over, and the second one would
    // land while dnd-kit was already measuring.
    const onLift = vi.fn();
    render(<Host onLift={onLift} />);

    press('tile');
    hold();
    expect(onLift).not.toHaveBeenCalled();
  });

  it('gives up once the finger travels — that is a scroll', () => {
    const onLift = vi.fn();
    render(<Host onLift={onLift} />);

    press('page-text', 100, 100);
    window.dispatchEvent(pointer('pointermove', 100, 100 + LIFT_SLOP + 1));
    hold();
    expect(onLift).not.toHaveBeenCalled();
  });

  it('tolerates a wobble that is not a scroll', () => {
    const onLift = vi.fn();
    render(<Host onLift={onLift} />);

    press('page-text', 100, 100);
    window.dispatchEvent(pointer('pointermove', 100 + LIFT_SLOP, 100));
    hold();
    expect(onLift).toHaveBeenCalledTimes(1);
  });

  it('gives up when the finger lifts early — that was a tap', () => {
    const onLift = vi.fn();
    render(<Host onLift={onLift} />);

    press('page-text');
    hold(LIFT_DELAY_IDLE - 10);
    window.dispatchEvent(pointer('pointerup'));
    hold();
    expect(onLift).not.toHaveBeenCalled();
  });

  it('gives up on a momentum scroll, which produces no pointermove at all', () => {
    const onLift = vi.fn();
    render(<Host onLift={onLift} />);

    press('page-text');
    // Capture phase, so the scroller's own scroll reaches us.
    window.dispatchEvent(new Event('scroll', { bubbles: true }));
    hold();
    expect(onLift).not.toHaveBeenCalled();
  });

  it('does not fire on return from the background', () => {
    const onLift = vi.fn();
    render(<Host onLift={onLift} />);

    press('page-text');
    document.dispatchEvent(new Event('visibilitychange'));
    hold();
    expect(onLift).not.toHaveBeenCalled();
  });

  it('does nothing at all when disabled', () => {
    // Desktop, and any device already in Edit Layout.
    const onLift = vi.fn();
    render(<Host onLift={onLift} enabled={false} />);

    press('page-text');
    hold();
    expect(onLift).not.toHaveBeenCalled();
  });

  it('re-arms cleanly for a second hold', () => {
    const onLift = vi.fn();
    render(<Host onLift={onLift} />);

    press('page-text');
    hold();
    window.dispatchEvent(pointer('pointerup'));

    press('page-text');
    hold();
    expect(onLift).toHaveBeenCalledTimes(2);
  });

  it('fires once, not once per pointerdown, when a press restarts', () => {
    const onLift = vi.fn();
    render(<Host onLift={onLift} />);

    press('page-text');
    press('page-text');   // a second finger, or a re-dispatch
    hold();
    expect(onLift).toHaveBeenCalledTimes(1);
  });
});
