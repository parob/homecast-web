// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act, cleanup } from '@testing-library/react';
import { AreaSummary } from '../AreaSummary';
import type { HomeKitAccessory } from '@/native/homekit-bridge';

// The analytics buttons are gated on HistoryContext. Standing up the real
// provider would mean an Apollo client and the storage-stats poll; what the
// component actually depends on is three values.
const history = vi.hoisted(() => ({
  openStatusHistory: vi.fn(),
  recording: true,
}));

vi.mock('@/contexts/HistoryContext', () => ({
  useHistory: () => ({
    defaultHomeId: 'HOME-1',
    historyAvailable: () => history.recording,
    analyticsAvailable: history.recording,
    analyticsAvailableFor: () => history.recording,
    openHistory: vi.fn(),
    openGroupHistory: vi.fn(),
    openStatusHistory: history.openStatusHistory,
    openAnalytics: vi.fn(),
  }),
}));

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

const sensor: HomeKitAccessory = {
  id: 'acc-1',
  name: 'Hallway Sensor',
  roomName: 'Hallway',
  category: 'sensor',
  isReachable: true,
  services: [
    {
      id: 'svc-1',
      name: 'Sensor',
      serviceType: 'motion_sensor',
      characteristics: [
        { id: 'c1', characteristicType: 'motion_detected', value: false, isReadable: true, isWritable: false },
        { id: 'c2', characteristicType: 'current_temperature', value: 21.4, isReadable: true, isWritable: false },
      ],
    },
  ],
};

function rowButton() {
  return screen.getByRole('button', { name: 'Analytics' });
}

describe('AreaSummary analytics buttons', () => {
  beforeEach(() => {
    history.recording = true;
    history.openStatusHistory.mockClear();
    vi.stubGlobal('ResizeObserver', ResizeObserverStub);
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('offers a row-level button covering every bubble', async () => {
    render(<AreaSummary accessories={[sensor]} />);

    await act(async () => {
      fireEvent.click(rowButton());
    });

    expect(history.openStatusHistory).toHaveBeenCalledTimes(1);
    const [homeId, scope] = history.openStatusHistory.mock.calls[0];
    expect(homeId).toBe('HOME-1');
    expect(scope.title).toBe('Status');
    expect(scope.categories.map((c: { key: string }) => c.key)).toEqual(['temperature', 'motion']);
  });

  it('passes the caller-supplied scope through to "Open in Analytics"', async () => {
    const analyticsScope = { level: 'category' as const, category: 'climate' as const, room: 'Hallway' };
    render(<AreaSummary accessories={[sensor]} analyticsScope={analyticsScope} />);

    await act(async () => {
      fireEvent.click(rowButton());
    });

    expect(history.openStatusHistory.mock.calls[0][1].analyticsScope).toEqual(analyticsScope);
  });

  it('scopes the button inside a bubble to that bubble alone', async () => {
    render(<AreaSummary accessories={[sensor]} />);

    const bubble = screen.getByRole('button', { name: /21\.4/ });
    await act(async () => {
      fireEvent.pointerDown(bubble, { pointerType: 'mouse', button: 0 });
      fireEvent.click(bubble, { detail: 1 });
    });

    // Radix mirrors tooltip content into a visually hidden a11y copy, so the
    // button genuinely exists twice — either one is the same button.
    const [inPanel] = screen.getAllByRole('button', { name: 'Analytics for 21.4°C' });
    await act(async () => {
      fireEvent.click(inPanel);
    });

    const [, scope] = history.openStatusHistory.mock.calls[0];
    expect(scope.title).toBe('Temperature');
    expect(scope.categories.map((c: { key: string }) => c.key)).toEqual(['temperature']);
    // Closed before the dialog opens — a tooltip left behind a modal is a
    // panel nobody can dismiss.
    expect(bubble.getAttribute('data-state')).toBe('closed');
  });

  it('offers nothing when the home does not record', () => {
    history.recording = false;
    render(<AreaSummary accessories={[sensor]} />);

    expect(screen.queryByRole('button', { name: 'Analytics' })).toBeNull();
  });
});
