// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act, cleanup } from '@testing-library/react';
import { AreaSummary } from '../AreaSummary';
import type { HomeKitAccessory } from '@/native/homekit-bridge';

// Radix Popper positions tooltip content with floating-ui, which needs
// ResizeObserver (absent from jsdom).
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

const motionSensor: HomeKitAccessory = {
  id: 'acc-1',
  name: 'Hallway Motion',
  roomName: 'Hallway',
  category: 'sensor',
  isReachable: true,
  services: [
    {
      id: 'svc-1',
      name: 'Motion Sensor',
      serviceType: 'motion_sensor',
      characteristics: [
        {
          id: 'char-1',
          characteristicType: 'motion_detected',
          value: false,
          isReadable: true,
          isWritable: false,
        },
      ],
    },
  ],
};

function getBubble() {
  return screen.getByRole('button', { name: /no motion/i });
}

function isOpen(bubble: HTMLElement) {
  return bubble.getAttribute('data-state') !== 'closed';
}

// Simulate a mouse hover long enough for Radix's 200ms open delay to elapse.
async function hoverOpen(bubble: HTMLElement) {
  fireEvent.pointerMove(bubble, { pointerType: 'mouse' });
  await act(async () => {
    vi.advanceTimersByTime(300);
  });
}

function click(bubble: HTMLElement) {
  fireEvent.pointerDown(bubble, { pointerType: 'mouse', button: 0 });
  fireEvent.click(bubble, { detail: 1 });
}

describe('AreaSummary sensor bubble tooltip', () => {
  beforeEach(() => {
    vi.stubGlobal('ResizeObserver', ResizeObserverStub);
    // Fake Date too so advanceTimersByTime moves the click-grace window along
    // with Radix's open-delay timer.
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
    render(<AreaSummary accessories={[motionSensor]} />);
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('opens on hover', async () => {
    const bubble = getBubble();
    expect(isOpen(bubble)).toBe(false);
    await hoverOpen(bubble);
    expect(isOpen(bubble)).toBe(true);
  });

  it('stays open when clicked right after a hover-open (no hover/click race)', async () => {
    const bubble = getBubble();
    await hoverOpen(bubble);
    await act(async () => {
      click(bubble);
    });
    expect(isOpen(bubble)).toBe(true);
  });

  it('closes on click once the grace period has passed', async () => {
    const bubble = getBubble();
    await hoverOpen(bubble);
    await act(async () => {
      vi.advanceTimersByTime(1100);
    });
    await act(async () => {
      click(bubble);
    });
    expect(isOpen(bubble)).toBe(false);
  });

  it('opens on click without hover (touch-style), then closes after the grace period', async () => {
    const bubble = getBubble();
    await act(async () => {
      click(bubble);
    });
    expect(isOpen(bubble)).toBe(true);
    await act(async () => {
      vi.advanceTimersByTime(1100);
    });
    await act(async () => {
      click(bubble);
    });
    expect(isOpen(bubble)).toBe(false);
  });

  it('still closes from non-click dismissals during the grace period (Escape)', async () => {
    const bubble = getBubble();
    await hoverOpen(bubble);
    await act(async () => {
      fireEvent.keyDown(document, { key: 'Escape' });
    });
    expect(isOpen(bubble)).toBe(false);
  });
});
