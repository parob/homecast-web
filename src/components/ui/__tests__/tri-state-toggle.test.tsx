// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { TriStateToggle } from '../tri-state-toggle';
import { BackgroundContext } from '@/contexts/BackgroundContext';

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

  // A quarter of each length follows the text size and three quarters is fixed,
  // anchored at the LARGE setting — where the switch this replaces was 50px,
  // and where these numbers are quoted. Sized purely in pixels it sat still
  // while the switches around it grew; sized purely in rem it halved in area
  // across the range.
  const thumb = (root: HTMLElement) =>
    Array.from(root.querySelectorAll('span')).find(s => s.style.transform !== '')!;
  const fill = (root: HTMLElement) =>
    Array.from(root.querySelectorAll('span')).find(s => s.style.opacity !== '')!;

  /** What a calc() length comes to at a given root font size. */
  const at = (css: string, rootPx: number) => {
    const m = css.match(/calc\((-?[\d.]+)px \+ (-?[\d.]+)rem\)/)!;
    return parseFloat(m[1]) + parseFloat(m[2]) * rootPx;
  };
  const offsetOf = (root: HTMLElement) =>
    thumb(root).style.transform.slice('translateX('.length, -1);

  it.each([
    ['off', 5, '0'],
    ['mixed', 21.25, '1'],
    ['on', 25, '1'],
  ] as const)('parks a wide %s at %spx with the track at %s of the on colour', (state, px, opacity) => {
    const { container } = render(<TriStateToggle state={state} onCheckedChange={vi.fn()} wide />);
    const root = container.firstElementChild as HTMLElement;
    // Off and on take the ordinary geometry, because the extra room is only
    // there to hold three stops and at either end there are two — so `on` lands
    // at 25, an ordinary switch's far stop, not at the wide track's 37.5.
    expect(at(offsetOf(root), 20)).toBe(px);
    // Anything on means fully on-coloured: seven of eight lights lit must not
    // look half switched off. The thumb is what says how many.
    expect(fill(root).style.opacity).toBe(opacity);
  });

  it.each([
    ['off', 5],
    ['mixed', 15],
    ['on', 25],
  ] as const)('parks a narrow %s at %spx', (state, px) => {
    const { container } = render(<TriStateToggle state={state} onCheckedChange={vi.fn()} />);
    const root = container.firstElementChild as HTMLElement;
    expect(at(offsetOf(root), 20)).toBe(px);
  });

  it('is the size the switch it replaces was, at the large text setting', () => {
    // Large is the anchor: it is where the old fully-rem switch came to 50px,
    // and that is the size this control is meant to be. 50 wide, 30 tall, a
    // 20px thumb, ends at 5 and 25 — ui/switch.tsx at 20px root, exactly.
    const { container } = render(<TriStateToggle state="off" onCheckedChange={vi.fn()} />);
    const root = container.firstElementChild as HTMLElement;
    expect(at(root.style.width, 20)).toBe(50);
    expect(at(root.style.height, 20)).toBe(30);
    expect(at(thumb(root).style.width, 20)).toBe(20);
    expect(at(offsetOf(root), 20)).toBe(5);
  });

  it('barely moves across the rest of the range', () => {
    // The whole point of anchoring high and damping down: essentially one size
    // that nudges with the text, rather than a control that halves in area.
    // Fully rem it would have run 35 / 40 / 50.
    const { container } = render(<TriStateToggle state="off" onCheckedChange={vi.fn()} />);
    const width = (container.firstElementChild as HTMLElement).style.width;

    expect(at(width, 20)).toBe(50);      // large — as it was before
    expect(at(width, 16)).toBe(47.5);    // medium
    expect(at(width, 14)).toBe(46.25);   // small
    // under 10% across the whole range, against 43% for a fully-rem control
    expect(at(width, 20) - at(width, 14)).toBeLessThan(at(width, 20) * 0.1);
  });

  it('only spreads while it is in the middle, and animates back', () => {
    // The extra room exists to hold three stops. At either end there are two,
    // like every other switch, so it gives the width back rather than standing
    // out in a row of tiles.
    const { container, rerender } = render(
      <TriStateToggle state="mixed" onCheckedChange={vi.fn()} wide />
    );
    const root = () => container.firstElementChild as HTMLElement;
    expect(at(root().style.width, 20)).toBe(62.5);               // the wide track
    // and the change is animated, not a jump
    expect(root().className).toContain('transition-[width,background-color]');

    rerender(<TriStateToggle state="on" onCheckedChange={vi.fn()} wide />);
    expect(at(root().style.width, 20)).toBe(50);                 // the ordinary one

    rerender(<TriStateToggle state="off" onCheckedChange={vi.fn()} wide />);
    expect(at(root().style.width, 20)).toBe(50);
  });

  it('takes the track colour from the wallpaper behind it', () => {
    // The app's real light/dark axis is the background image, not a theme class.
    const light = render(<TriStateToggle state="off" onCheckedChange={vi.fn()} />);
    expect((light.container.firstElementChild as HTMLElement).className).toContain('bg-input');
    cleanup();

    const dark = render(
      <BackgroundContext.Provider value={{ isDarkBackground: true } as never}>
        <TriStateToggle state="off" onCheckedChange={vi.fn()} />
      </BackgroundContext.Provider>
    );
    const root = dark.container.firstElementChild as HTMLElement;
    expect(root.className).toContain('bg-white/20');
    expect(root.className).not.toContain('bg-input');
    // and the thumb with it, or it disappears into the track
    expect(thumb(root).className).toContain('bg-white/70');
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
