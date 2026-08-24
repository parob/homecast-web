// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { VerticalSlider } from '../shared/VerticalSlider';

/**
 * The bar is 200px tall and starts at the top of the viewport, so a clientY of
 * N is N% down it — which makes every coordinate in these tests readable as the
 * coverage it produces on an inverted bar.
 */
const TRACK = { top: 0, bottom: 200, height: 200, left: 0, right: 40, width: 40, x: 0, y: 0, toJSON: () => ({}) };

const slider = () => screen.getByRole('slider');

/** jsdom implements none of the pointer-capture API React's handlers lean on. */
const prepare = (el: HTMLElement) => {
  el.getBoundingClientRect = () => TRACK as DOMRect;
  el.setPointerCapture = vi.fn();
  el.releasePointerCapture = vi.fn();
  el.hasPointerCapture = vi.fn(() => true);
  return el;
};

const travel = () => screen.queryByTestId('slider-travel');
const targetEdge = () => screen.queryByTestId('slider-target-edge');

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe('the ghost track', () => {
  it('draws nothing extra when command and device agree', () => {
    render(<VerticalSlider value={60} ghostValue={60} onCommit={() => {}} />);
    expect(travel()).toBeNull();
    expect(targetEdge()).toBeNull();
  });

  it('draws nothing extra when no device reading is supplied at all', () => {
    // Every other widget passes no ghost, and must look exactly as it did.
    render(<VerticalSlider value={60} onCommit={() => {}} />);
    expect(travel()).toBeNull();
  });

  it('fills only as far as both readings agree, and bands the rest', () => {
    // Told to close to 80% coverage; the blind is still at 30%.
    render(<VerticalSlider value={80} ghostValue={30} invert onCommit={() => {}} />);
    expect(travel()!.style.height).toBe('50%');
    // The band starts where the confirmed fill stops, measured from the top,
    // because an inverted bar hangs its fill from there.
    expect(travel()!.style.top).toBe('30%');
    // The value — the thing the finger set — is where the crisp edge goes.
    expect(targetEdge()!.style.top).toBe('80%');
  });

  it('bands the same way when the device is ahead of the command', () => {
    // Told to open (0% coverage) from a blind still fully down. The outstanding
    // travel is a retraction, and it must be drawn as outstanding just the
    // same — otherwise pressing Open leaves the bar looking untouched.
    render(<VerticalSlider value={0} ghostValue={100} invert onCommit={() => {}} />);
    expect(travel()!.style.height).toBe('100%');
    expect(travel()!.style.top).toBe('0%');
    expect(targetEdge()!.style.top).toBe('0%');
  });

  it('anchors to the bottom on an ordinary upward-filling bar', () => {
    render(<VerticalSlider value={80} ghostValue={30} onCommit={() => {}} />);
    expect(travel()!.style.bottom).toBe('30%');
    expect(targetEdge()!.style.bottom).toBe('80%');
  });

  it('tells a screen reader both numbers, not just the command', () => {
    render(<VerticalSlider value={80} ghostValue={30} readoutValue={30} invert onCommit={() => {}} formatValue={(v) => `${v}%`} />);
    expect(slider().getAttribute('aria-valuetext')).toBe('30%, heading for 80%');
  });

  it('says nothing extra once the device has arrived', () => {
    render(<VerticalSlider value={80} ghostValue={80} invert onCommit={() => {}} />);
    expect(slider().getAttribute('aria-valuetext')).toBeNull();
  });

  it('pulses the target edge only while the device has yet to start', () => {
    const { rerender } = render(<VerticalSlider value={80} ghostValue={30} invert pending onCommit={() => {}} />);
    expect(targetEdge()!.className).toContain('animate-pulse-edge');

    rerender(<VerticalSlider value={80} ghostValue={30} invert onCommit={() => {}} />);
    expect(targetEdge()!.className).not.toContain('animate-pulse-edge');
  });
});

describe('when the write is sent', () => {
  it('streams targets through the drag in live mode', () => {
    const onCommit = vi.fn();
    render(<VerticalSlider value={0} onCommit={onCommit} />);
    const el = prepare(slider());

    fireEvent.pointerDown(el, { clientY: 200, pointerId: 1 });
    // Three moves spaced past the 250ms throttle: three writes.
    for (const y of [150, 100, 50]) {
      vi.advanceTimersByTime(300);
      vi.setSystemTime(Date.now());
      fireEvent.pointerMove(el, { clientY: y, pointerId: 1 });
    }
    expect(onCommit.mock.calls.length).toBeGreaterThan(1);
  });

  it('sends exactly one write per drag in release mode', () => {
    const onCommit = vi.fn();
    render(<VerticalSlider value={0} commitMode="release" onCommit={onCommit} />);
    const el = prepare(slider());

    fireEvent.pointerDown(el, { clientY: 200, pointerId: 1 });
    for (const y of [150, 100, 50]) {
      vi.advanceTimersByTime(300);
      fireEvent.pointerMove(el, { clientY: y, pointerId: 1 });
    }
    // A blind must not be re-targeted eight times on the way to one position.
    expect(onCommit).not.toHaveBeenCalled();

    fireEvent.pointerUp(el, { clientY: 50, pointerId: 1 });
    expect(onCommit).toHaveBeenCalledTimes(1);
    // 50px down a 200px bar, filling upward: 75%.
    expect(onCommit).toHaveBeenCalledWith(75);
  });

  it('still follows the finger while it withholds the write', () => {
    // The drag is local state either way — release mode costs no smoothness.
    render(<VerticalSlider value={0} commitMode="release" onCommit={() => {}} />);
    const el = prepare(slider());

    fireEvent.pointerDown(el, { clientY: 200, pointerId: 1 });
    fireEvent.pointerMove(el, { clientY: 50, pointerId: 1 });
    expect(slider().getAttribute('aria-valuenow')).toBe('75');
  });
});


describe('what the number says', () => {
  it('reports the device, not the order, once the finger is off', () => {
    // The regression this exists to catch: the fill moved to the target and
    // took the readout with it, so pressing Open printed "Open" across a bar
    // drawn over a window that was still shut. A fill can shade an outstanding
    // command; a word cannot.
    render(<VerticalSlider value={100} ghostValue={0} readoutValue={0} invert onCommit={() => {}} />);
    expect(screen.getByText('0%')).toBeTruthy();
  });

  it('still draws the fill to the order', () => {
    // The other half of the same bar: the number stays honest, and the picture
    // still answers the press immediately.
    render(<VerticalSlider value={100} ghostValue={0} readoutValue={0} invert onCommit={() => {}} />);
    expect(targetEdge()!.style.top).toBe('100%');
    expect(travel()!.style.height).toBe('100%');
  });

  it('follows the finger while dragging, over both', () => {
    // Mid-drag the only question being asked is what you are setting.
    render(<VerticalSlider value={0} ghostValue={0} readoutValue={0} commitMode="release" onCommit={() => {}} />);
    const el = prepare(slider());
    fireEvent.pointerDown(el, { clientY: 200, pointerId: 1 });
    fireEvent.pointerMove(el, { clientY: 50, pointerId: 1 });
    expect(screen.getByText('75%')).toBeTruthy();
  });

  it('falls back to the value when no device reading is given', () => {
    // Every other widget passes no readoutValue and must be unchanged.
    render(<VerticalSlider value={42} onCommit={() => {}} />);
    expect(screen.getByText('42%')).toBeTruthy();
  });
});
