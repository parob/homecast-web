// @vitest-environment jsdom
//
// Driving the left menu's swipe with real touch sequences.
//
// jsdom does no hit testing and has no Touch constructor, so the events are
// hand-built — but the sequence is the real one (touchstart, a run of
// touchmoves, touchend), because the bugs worth catching here are all about
// what the gesture has decided by the second or third move.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';

import { useEdgeSwipeOpen, useSwipeToClose } from '../useDrawerSwipe';

type Point = { x: number; y: number };

function touchEvent(type: string, at: Point, target: EventTarget, time: number) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'touches', {
    value: type === 'touchend' ? [] : [{ clientX: at.x, clientY: at.y, target }],
  });
  Object.defineProperty(event, 'timeStamp', { value: time });
  return event;
}

/** A whole gesture: down at `from`, dragged through `path`, lifted. */
function swipe(target: EventTarget, from: Point, path: Point[], step = 40) {
  let time = 1000;
  target.dispatchEvent(touchEvent('touchstart', from, target, time));
  for (const point of path) {
    time += step;
    target.dispatchEvent(touchEvent('touchmove', point, target, time));
  }
  target.dispatchEvent(touchEvent('touchend', path.at(-1) ?? from, target, time));
}

afterEach(() => { document.body.innerHTML = ''; });

describe('useEdgeSwipeOpen', () => {
  it('opens on a drag in from the left edge', () => {
    const onOpen = vi.fn();
    renderHook(() => useEdgeSwipeOpen({ enabled: true, onOpen }));

    swipe(document.body, { x: 8, y: 300 }, [{ x: 30, y: 302 }, { x: 90, y: 305 }]);
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it('ignores a drag that starts away from the edge', () => {
    const onOpen = vi.fn();
    renderHook(() => useEdgeSwipeOpen({ enabled: true, onOpen }));

    swipe(document.body, { x: 160, y: 300 }, [{ x: 220, y: 302 }]);
    expect(onOpen).not.toHaveBeenCalled();
  });

  it('leaves a vertical scroll alone, even when it later drifts sideways', () => {
    const onOpen = vi.fn();
    renderHook(() => useEdgeSwipeOpen({ enabled: true, onOpen }));

    swipe(document.body, { x: 8, y: 300 }, [
      { x: 10, y: 340 },   // decides: vertical
      { x: 120, y: 380 },  // and stays decided
    ]);
    expect(onOpen).not.toHaveBeenCalled();
  });

  it('ignores a drag going the wrong way', () => {
    const onOpen = vi.fn();
    renderHook(() => useEdgeSwipeOpen({ enabled: true, onOpen }));

    // Hard to do from x=8, but a right-to-left flick out of the edge zone is
    // exactly what closing looks like, and must not re-open.
    swipe(document.body, { x: 20, y: 300 }, [{ x: 4, y: 300 }]);
    expect(onOpen).not.toHaveBeenCalled();
  });

  it('stands down while a dialog is over the page', () => {
    const onOpen = vi.fn();
    document.body.innerHTML = '<div role="dialog" data-state="open"></div>';
    renderHook(() => useEdgeSwipeOpen({ enabled: true, onOpen }));

    swipe(document.body, { x: 8, y: 300 }, [{ x: 90, y: 300 }]);
    expect(onOpen).not.toHaveBeenCalled();
  });

  it('does nothing when disabled', () => {
    const onOpen = vi.fn();
    renderHook(() => useEdgeSwipeOpen({ enabled: false, onOpen }));

    swipe(document.body, { x: 8, y: 300 }, [{ x: 90, y: 300 }]);
    expect(onOpen).not.toHaveBeenCalled();
  });

  it('only answers touches inside the dialog it is scoped to', () => {
    const onOpen = vi.fn();
    document.body.innerHTML =
      '<div role="dialog" data-state="open"><div id="content"><span id="row"></span></div></div>' +
      '<div id="outside"></div>';
    const container = { current: document.getElementById('content') as HTMLElement };
    renderHook(() => useEdgeSwipeOpen({ enabled: true, onOpen, container }));

    swipe(document.getElementById('outside')!, { x: 8, y: 300 }, [{ x: 90, y: 300 }]);
    expect(onOpen).not.toHaveBeenCalled();

    // Inside the dialog but outside the content's own padding still counts —
    // the edge the user aims for is the dialog's, not the screen's.
    swipe(document.getElementById('row')!, { x: 8, y: 300 }, [{ x: 90, y: 300 }]);
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it('runs page-wide when its container has no dialog over it', () => {
    // The same component hosted as a whole page — /analytics rather than the
    // dashboard's dialog. There is no layer to be inside of.
    const onOpen = vi.fn();
    document.body.innerHTML = '<main><div id="content"></div></main>';
    const container = { current: document.getElementById('content') as HTMLElement };
    renderHook(() => useEdgeSwipeOpen({ enabled: true, onOpen, container }));

    swipe(document.querySelector('main')!, { x: 8, y: 300 }, [{ x: 90, y: 300 }]);
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it('stays quiet while its container is unmounted', () => {
    const onOpen = vi.fn();
    renderHook(() => useEdgeSwipeOpen({ enabled: true, onOpen, container: { current: null } }));

    swipe(document.body, { x: 8, y: 300 }, [{ x: 90, y: 300 }]);
    expect(onOpen).not.toHaveBeenCalled();
  });
});

describe('the click a finished swipe leaves behind', () => {
  it('is spent, not delivered to whatever ended up under the finger', () => {
    const onOpen = vi.fn();
    const onRowClick = vi.fn();
    document.body.innerHTML = '<button id="row">Kitchen</button>';
    document.getElementById('row')!.addEventListener('click', onRowClick);
    renderHook(() => useEdgeSwipeOpen({ enabled: true, onOpen }));

    swipe(document.body, { x: 8, y: 300 }, [{ x: 30, y: 300 }, { x: 90, y: 300 }]);
    expect(onOpen).toHaveBeenCalledTimes(1);

    document.getElementById('row')!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    expect(onRowClick).not.toHaveBeenCalled();
  });

  it('stands down after the one click, so the next tap lands', () => {
    const onOpen = vi.fn();
    const onRowClick = vi.fn();
    document.body.innerHTML = '<button id="row">Kitchen</button>';
    document.getElementById('row')!.addEventListener('click', onRowClick);
    renderHook(() => useEdgeSwipeOpen({ enabled: true, onOpen }));

    swipe(document.body, { x: 8, y: 300 }, [{ x: 30, y: 300 }, { x: 90, y: 300 }]);
    const row = document.getElementById('row')!;
    row.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    row.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    expect(onRowClick).toHaveBeenCalledTimes(1);
  });

  it('stands down when a new gesture starts, click or no click', () => {
    // The usual case: the browser suppressed the click itself, and the user
    // goes straight on to tap something in the menu they just opened.
    const onOpen = vi.fn();
    const onRowClick = vi.fn();
    document.body.innerHTML = '<button id="row">Kitchen</button>';
    const row = document.getElementById('row')!;
    row.addEventListener('click', onRowClick);
    renderHook(() => useEdgeSwipeOpen({ enabled: true, onOpen }));

    swipe(document.body, { x: 8, y: 300 }, [{ x: 30, y: 300 }, { x: 90, y: 300 }]);
    row.dispatchEvent(touchEvent('touchstart', { x: 90, y: 300 }, row, 2000));
    row.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    expect(onRowClick).toHaveBeenCalledTimes(1);
  });
});

describe('useSwipeToClose', () => {
  function panelWith(markup = '<button id="row">Kitchen</button>') {
    document.body.innerHTML = `<div id="panel">${markup}</div>`;
    return document.getElementById('panel') as HTMLElement;
  }

  it('closes on a drag back out to the left', () => {
    const panel = panelWith();
    const onClose = vi.fn();
    renderHook(() => useSwipeToClose(panel, onClose));

    swipe(document.getElementById('row')!, { x: 200, y: 300 }, [{ x: 170, y: 301 }, { x: 120, y: 303 }]);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes on a flick, before the full distance', () => {
    const panel = panelWith();
    const onClose = vi.fn();
    renderHook(() => useSwipeToClose(panel, onClose));

    swipe(document.getElementById('row')!, { x: 200, y: 300 }, [{ x: 170, y: 300 }], 20);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('leaves a scroll through the menu alone', () => {
    const panel = panelWith();
    const onClose = vi.fn();
    renderHook(() => useSwipeToClose(panel, onClose));

    swipe(document.getElementById('row')!, { x: 200, y: 300 }, [{ x: 198, y: 240 }, { x: 100, y: 160 }]);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('does not close on a drag the other way', () => {
    const panel = panelWith();
    const onClose = vi.fn();
    renderHook(() => useSwipeToClose(panel, onClose));

    swipe(document.getElementById('row')!, { x: 100, y: 300 }, [{ x: 180, y: 300 }]);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('leaves a slider inside the menu its own drag', () => {
    const panel = panelWith('<span id="thumb" role="slider"></span>');
    const onClose = vi.fn();
    renderHook(() => useSwipeToClose(panel, onClose));

    swipe(document.getElementById('thumb')!, { x: 200, y: 300 }, [{ x: 100, y: 300 }]);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('is off when there is no panel', () => {
    const onClose = vi.fn();
    renderHook(() => useSwipeToClose(null, onClose));

    swipe(document.body, { x: 200, y: 300 }, [{ x: 100, y: 300 }]);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('lets go of the document when it unmounts', () => {
    const panel = panelWith();
    const onClose = vi.fn();
    const { unmount } = renderHook(() => useSwipeToClose(panel, onClose));
    unmount();

    swipe(document.getElementById('row')!, { x: 200, y: 300 }, [{ x: 100, y: 300 }]);
    expect(onClose).not.toHaveBeenCalled();
  });
});
