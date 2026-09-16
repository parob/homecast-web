// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { ExpandedOverlay } from '../ExpandedOverlay';

vi.mock('@/hooks/use-mobile', () => ({ useIsMobile: () => false }));
globalThis.ResizeObserver = class {
  observe() {} unobserve() {} disconnect() {}
} as unknown as typeof ResizeObserver;
afterEach(cleanup);

async function open(onClose = vi.fn()) {
  const view = render(<div><ExpandedOverlay isExpanded onClose={onClose}><button>Widget control</button></ExpandedOverlay></div>);
  await waitFor(() => expect(document.body.hasAttribute('data-scroll-locked')).toBe(true));
  return { ...view, onClose };
}

describe('expanded widget scroll and navigation', () => {
  it('distinguishes a backdrop tap from a drag before dismissing', async () => {
    const { onClose } = await open();
    const backdrop = document.querySelector('.fixed-full-screen')!;
    const touch = (type: string, y: number) => {
      const event = new MouseEvent(type, { bubbles: true, clientX: 5, clientY: y });
      Object.defineProperties(event, { pointerType: { value: 'touch' }, pointerId: { value: 1 } });
      act(() => { backdrop.dispatchEvent(event); });
    };
    touch('pointerdown', 500);
    expect(onClose).not.toHaveBeenCalled();
    touch('pointermove', 200);
    touch('pointerup', 200);
    expect(onClose).not.toHaveBeenCalled();
    touch('pointerdown', 500);
    touch('pointerup', 500);
    expect(onClose).toHaveBeenCalledTimes(1);
    const click = new MouseEvent('click', { bubbles: true, cancelable: true });
    backdrop.dispatchEvent(click);
    expect(click.defaultPrevented).toBe(true);
  });

  it('blocks background wheel/keyboard without dismissing, and releases its body lock on unmount', async () => {
    const { unmount, onClose } = await open();
    const wheel = new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: 400 });
    document.body.dispatchEvent(wheel);
    expect(wheel.defaultPrevented).toBe(true);
    const key = new KeyboardEvent('keydown', { key: 'PageDown', bubbles: true, cancelable: true });
    document.body.dispatchEvent(key);
    expect(key.defaultPrevented).toBe(true);
    expect(onClose).not.toHaveBeenCalled();
    unmount();
    expect(document.body.hasAttribute('data-scroll-locked')).toBe(false);
    const after = new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: 400 });
    document.body.dispatchEvent(after);
    expect(after.defaultPrevented).toBe(false);
  });

  it('does not consume browser pinch-to-zoom', async () => {
    await open();
    const pinch = new WheelEvent('wheel', { bubbles: true, cancelable: true, ctrlKey: true, deltaY: 20 });
    document.body.dispatchEvent(pinch);
    expect(pinch.defaultPrevented).toBe(false);
  });

  it('leaves scrolling in portalled non-modal controls above the widget alone', async () => {
    await open();
    const popup = document.createElement('div');
    popup.style.zIndex = '10060';
    document.body.append(popup);
    try {
      const wheel = new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: 100 });
      popup.dispatchEvent(wheel);
      expect(wheel.defaultPrevented).toBe(false);
    } finally { popup.remove(); }
  });

  for (const activation of ['pointer', 'click', 'keyboard']) {
    it(`dismisses for ${activation} header activation without swallowing the action`, async () => {
      const { onClose } = await open();
      const header = document.createElement('header');
      header.dataset.expandedOverlayDismiss = '';
      header.style.zIndex = '10040';
      const button = document.createElement('button');
      const activate = vi.fn();
      button.addEventListener('click', activate);
      header.append(button);
      document.body.append(header);
      try {
        act(() => {
          if (activation === 'pointer') fireEvent.pointerDown(button);
          else if (activation === 'keyboard') fireEvent.keyDown(button, { key: 'Enter' });
          else button.click(); // Native bridge / assistive activation.
        });
        expect(onClose).toHaveBeenCalledTimes(1);
        if (activation !== 'click') act(() => button.click());
        expect(activate).toHaveBeenCalledTimes(1);
      } finally { header.remove(); }
    });
  }
});
