// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { TriStateToggle } from '../tri-state-toggle';

describe('TriStateToggle — off and on', () => {
  afterEach(cleanup);

  it('is one switch, and a press anywhere flips it', () => {
    // The familiar behaviour has to survive: a light switch that suddenly needs
    // aiming would feel broken.
    const onCheckedChange = vi.fn();
    render(<TriStateToggle state="off" onCheckedChange={onCheckedChange} label="Kitchen lights" />);

    const control = screen.getByRole('switch');
    expect(control.getAttribute('aria-checked')).toBe('false');
    expect(control.getAttribute('aria-label')).toBe('Kitchen lights');

    fireEvent.click(control);
    expect(onCheckedChange).toHaveBeenCalledTimes(1);
    expect(onCheckedChange).toHaveBeenCalledWith(true);
  });

  it('flips the other way when it is already on', () => {
    const onCheckedChange = vi.fn();
    render(<TriStateToggle state="on" onCheckedChange={onCheckedChange} />);
    expect(screen.getByRole('switch').getAttribute('aria-checked')).toBe('true');
    fireEvent.click(screen.getByRole('switch'));
    expect(onCheckedChange).toHaveBeenCalledWith(false);
  });
});

describe('TriStateToggle — mixed', () => {
  afterEach(cleanup);

  it('is two commands, because that is what it is offering', () => {
    // Not a switch: ARIA allows aria-checked="mixed" on a checkbox and never on
    // a switch, and here the control genuinely is two separate presses.
    render(<TriStateToggle state="mixed" onCheckedChange={vi.fn()} label="Kitchen lights" />);
    expect(screen.queryByRole('switch')).toBeNull();
    const group = screen.getByRole('group');
    expect(group.getAttribute('aria-label')).toBe('Kitchen lights');
    expect(screen.getAllByRole('button').map(b => b.getAttribute('aria-label')))
      .toEqual(['Turn all off', 'Turn all on']);
  });

  it('sends each half to its own end', () => {
    const onCheckedChange = vi.fn();
    render(<TriStateToggle state="mixed" onCheckedChange={onCheckedChange} />);

    fireEvent.click(screen.getByRole('button', { name: 'Turn all off' }));
    expect(onCheckedChange).toHaveBeenLastCalledWith(false);

    fireEvent.click(screen.getByRole('button', { name: 'Turn all on' }));
    expect(onCheckedChange).toHaveBeenLastCalledWith(true);
    expect(onCheckedChange).toHaveBeenCalledTimes(2);
  });

  it('never offers the middle as an outcome', () => {
    // Whatever is pressed, the callback is a boolean. The world puts the thumb
    // in the middle; the user can only move it off.
    const onCheckedChange = vi.fn();
    render(<TriStateToggle state="mixed" onCheckedChange={onCheckedChange} />);
    screen.getAllByRole('button').forEach(b => fireEvent.click(b));
    onCheckedChange.mock.calls.forEach(([value]) => expect(typeof value).toBe('boolean'));
  });

  it('carries the count to a screen reader', () => {
    render(<TriStateToggle state="mixed" onCheckedChange={vi.fn()} label="Kitchen lights" description="3 of 8 on" />);
    const group = screen.getByRole('group');
    const describedBy = group.getAttribute('aria-describedby')!;
    expect(document.getElementById(describedBy)?.textContent).toBe('3 of 8 on');
  });
});

describe('TriStateToggle — keyboard', () => {
  afterEach(cleanup);

  it('aims with the arrows, since a keyboard cannot press half a control', () => {
    const onCheckedChange = vi.fn();
    render(<TriStateToggle state="mixed" onCheckedChange={onCheckedChange} />);
    const group = screen.getByRole('group');

    fireEvent.keyDown(group, { key: 'ArrowLeft' });
    expect(onCheckedChange).toHaveBeenLastCalledWith(false);
    fireEvent.keyDown(group, { key: 'ArrowRight' });
    expect(onCheckedChange).toHaveBeenLastCalledWith(true);
    fireEvent.keyDown(group, { key: 'Home' });
    expect(onCheckedChange).toHaveBeenLastCalledWith(false);
    fireEvent.keyDown(group, { key: 'End' });
    expect(onCheckedChange).toHaveBeenLastCalledWith(true);
    expect(onCheckedChange).toHaveBeenCalledTimes(4);
  });

  it('also aims from a plain on/off state', () => {
    const onCheckedChange = vi.fn();
    render(<TriStateToggle state="on" onCheckedChange={onCheckedChange} />);
    fireEvent.keyDown(screen.getByRole('switch'), { key: 'ArrowLeft' });
    expect(onCheckedChange).toHaveBeenLastCalledWith(false);
  });

  it('ignores keys that mean nothing here', () => {
    const onCheckedChange = vi.fn();
    render(<TriStateToggle state="mixed" onCheckedChange={onCheckedChange} />);
    fireEvent.keyDown(screen.getByRole('group'), { key: 'ArrowUp' });
    fireEvent.keyDown(screen.getByRole('group'), { key: 'a' });
    expect(onCheckedChange).not.toHaveBeenCalled();
  });
});

describe('TriStateToggle — disabled', () => {
  afterEach(cleanup);

  it('blocks the press, the halves and the keyboard alike', () => {
    const onCheckedChange = vi.fn();
    const { rerender } = render(<TriStateToggle state="on" onCheckedChange={onCheckedChange} disabled />);
    fireEvent.click(screen.getByRole('switch'));
    fireEvent.keyDown(screen.getByRole('switch'), { key: 'ArrowLeft' });

    rerender(<TriStateToggle state="mixed" onCheckedChange={onCheckedChange} disabled />);
    screen.getAllByRole('button').forEach(b => fireEvent.click(b));
    fireEvent.keyDown(screen.getByRole('group'), { key: 'ArrowRight' });

    expect(onCheckedChange).not.toHaveBeenCalled();
  });
});

describe('TriStateToggle — where the thumb sits', () => {
  afterEach(cleanup);

  // 50px track, 16px thumb, 4px of padding: the ends sit at 4 and 30 and the
  // middle at 17, exactly between them. A quarter wider than ui/switch.tsx's
  // 40px because at that width the three stops are 13px apart and the middle
  // stopped reading as the middle; the height and the thumb are unchanged, so
  // it still lines up with an ordinary switch beside it.
  const thumb = (root: HTMLElement) =>
    Array.from(root.querySelectorAll('span')).find(s => s.style.transform !== '')!;
  const fill = (root: HTMLElement) =>
    Array.from(root.querySelectorAll('span')).find(s => s.style.opacity !== '')!;

  it.each([
    ['off', 'translateX(4px)', '0'],
    ['mixed', 'translateX(17px)', '0.5'],
    ['on', 'translateX(30px)', '1'],
  ] as const)('parks %s at %s with the track at %s of the on colour', (state, offset, opacity) => {
    const { container } = render(<TriStateToggle state={state} onCheckedChange={vi.fn()} />);
    const root = container.firstElementChild as HTMLElement;
    expect(thumb(root).style.transform).toBe(offset);
    // Mixed is the on colour at half strength over the off track — literally
    // halfway between the two ends, rather than a half-filled bar.
    expect(fill(root).style.opacity).toBe(opacity);
  });

  it('keeps an ordinary switch\'s height and thumb, and is a quarter wider', () => {
    const { container } = render(<TriStateToggle state="off" onCheckedChange={vi.fn()} />);
    const root = container.firstElementChild as HTMLElement;
    expect(root.style.width).toBe('50px');       // ui/switch.tsx is 40
    expect(root.className).toContain('h-6');     // same height
    expect(thumb(root).style.width).toBe('16px'); // same thumb
  });

  it('paints the fill in the colour it was given', () => {
    const { container } = render(
      <TriStateToggle state="mixed" onCheckedChange={vi.fn()} checkedColorClass="bg-amber-500" />
    );
    expect(fill(container.firstElementChild as HTMLElement).className).toContain('bg-amber-500');
  });
});

describe('TriStateToggle — swiping', () => {
  afterEach(cleanup);

  const swipe = (el: Element, dx: number) => {
    fireEvent.pointerDown(el, { clientX: 100 });
    fireEvent(window, new PointerEvent('pointermove', { clientX: 100 + dx, bubbles: true }));
    fireEvent(window, new PointerEvent('pointerup', { clientX: 100 + dx, bubbles: true }));
  };

  it('takes a drag to either end from the middle', () => {
    const onCheckedChange = vi.fn();
    const { rerender } = render(<TriStateToggle state="mixed" onCheckedChange={onCheckedChange} />);
    swipe(screen.getByRole('group'), 20);
    expect(onCheckedChange).toHaveBeenLastCalledWith(true);

    rerender(<TriStateToggle state="mixed" onCheckedChange={onCheckedChange} />);
    swipe(screen.getByRole('group'), -20);
    expect(onCheckedChange).toHaveBeenLastCalledWith(false);
  });

  it('drags an ordinary switch across too', () => {
    const onCheckedChange = vi.fn();
    render(<TriStateToggle state="off" onCheckedChange={onCheckedChange} />);
    swipe(screen.getByRole('switch'), 20);
    expect(onCheckedChange).toHaveBeenCalledWith(true);
  });

  it('ignores a nudge back towards the end it is already at', () => {
    // Otherwise a stray drag on a group that is already fully on would write to
    // every member to tell them so.
    const onCheckedChange = vi.fn();
    render(<TriStateToggle state="on" onCheckedChange={onCheckedChange} />);
    swipe(screen.getByRole('switch'), 20);
    expect(onCheckedChange).not.toHaveBeenCalled();
  });

  it('does not also fire the click the drag ends with', () => {
    // One gesture, one write. pointerup is followed by a click on the same
    // element, and without the guard a swipe would act twice — the second time
    // in whichever direction a plain tap would have gone.
    const onCheckedChange = vi.fn();
    render(<TriStateToggle state="mixed" onCheckedChange={onCheckedChange} />);
    const group = screen.getByRole('group');
    swipe(group, 20);
    fireEvent.click(screen.getByRole('button', { name: 'Turn all off' }));
    expect(onCheckedChange).toHaveBeenCalledTimes(1);
    expect(onCheckedChange).toHaveBeenCalledWith(true);
  });

  it('leaves a press below the slop as an ordinary tap', () => {
    const onCheckedChange = vi.fn();
    render(<TriStateToggle state="off" onCheckedChange={onCheckedChange} />);
    const control = screen.getByRole('switch');
    fireEvent.pointerDown(control, { clientX: 100 });
    fireEvent(window, new PointerEvent('pointermove', { clientX: 102, bubbles: true }));
    fireEvent(window, new PointerEvent('pointerup', { clientX: 102, bubbles: true }));
    expect(onCheckedChange).not.toHaveBeenCalled();  // the drag did nothing
    fireEvent.click(control);
    expect(onCheckedChange).toHaveBeenCalledWith(true);  // the tap still works
  });

  it('does not drag when disabled', () => {
    const onCheckedChange = vi.fn();
    render(<TriStateToggle state="mixed" onCheckedChange={onCheckedChange} disabled />);
    swipe(screen.getByRole('group'), 20);
    expect(onCheckedChange).not.toHaveBeenCalled();
  });
});

describe('TriStateToggle — the card underneath', () => {
  afterEach(cleanup);

  it('keeps its press to itself', () => {
    // Every widget control stops here: the card behind it is a press target of
    // its own that expands the tile.
    const onCardClick = vi.fn();
    render(
      <div onClick={onCardClick}>
        <TriStateToggle state="off" onCheckedChange={vi.fn()} />
      </div>
    );
    fireEvent.click(screen.getByRole('switch'));
    expect(onCardClick).not.toHaveBeenCalled();
  });
});
