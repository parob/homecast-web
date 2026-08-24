// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react';
import { WindowCoveringWidget } from '../WindowCoveringWidget';
import type { HomeKitAccessory } from '@/lib/graphql/types';

window.matchMedia = window.matchMedia || (((query: string) => ({
  matches: false, media: query, onchange: null,
  addListener: () => {}, removeListener: () => {},
  addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false,
})) as unknown as typeof window.matchMedia);

vi.mock('@/lib/config', () => ({ isCommunity: false, config: { version: 'test', isStaging: false } }));
vi.mock('@/lib/accessoryRefresh', () => ({ requestAccessoryRefresh: vi.fn() }));
vi.mock('@/contexts/DealsContext', () => ({
  useDeals: () => ({ isTracked: () => false, openPriceHistory: vi.fn() }),
}));
vi.mock('@/contexts/HistoryContext', () => ({
  useHistory: () => ({
    historyAvailable: () => true,
    analyticsAvailable: true,
    analyticsAvailableFor: () => true,
    openHistory: vi.fn(),
    openGroupHistory: vi.fn(),
    openAnalytics: vi.fn(),
  }),
}));
vi.mock('../VirtualAccessoryEditContext', () => ({
  useVirtualAccessoryEditor: () => undefined,
  useVirtualAccessoryRemover: () => undefined,
}));

const STOPPED = 2;
const DECREASING = 0;

interface BlindOpts {
  /** RAW positions, as the device reports them. */
  current: number;
  target: number;
  positionState?: number | null;
  manufacturer?: string;
  holdPosition?: boolean;
}

/**
 * A roller blind. Coverage-reporting by default — 100 raw means fully shut —
 * because that is what nearly every covering on the market does.
 */
const makeBlind = ({ current, target, positionState = STOPPED, manufacturer = 'Aqara', holdPosition = false }: BlindOpts): HomeKitAccessory => ({
  id: 'BLIND-1', name: 'Bedroom Blind', roomName: 'Bedroom', isReachable: true,
  services: [
    {
      id: 'info', name: 'Info', serviceType: 'accessory_information',
      characteristics: [
        { id: 'mk', characteristicType: 'manufacturer', value: manufacturer, isReadable: true, isWritable: false },
        { id: 'md', characteristicType: 'model', value: 'Curtain Driver E1', isReadable: true, isWritable: false },
      ],
    },
    {
      id: 'wc', name: 'Blind', serviceType: 'window_covering',
      characteristics: [
        { id: 'cp', characteristicType: 'current_position', value: current, isReadable: true, isWritable: false },
        { id: 'tp', characteristicType: 'target_position', value: target, isReadable: true, isWritable: true },
        ...(positionState === null ? [] : [
          { id: 'ps', characteristicType: 'position_state', value: positionState, isReadable: true, isWritable: false },
        ]),
        ...(holdPosition ? [
          { id: 'hp', characteristicType: 'hold_position', value: false, isReadable: false, isWritable: true },
        ] : []),
      ],
    },
  ],
} as unknown as HomeKitAccessory);

const renderBlind = (opts: BlindOpts, handlers: { onSlider?: ReturnType<typeof vi.fn>; onSetValue?: ReturnType<typeof vi.fn> } = {}) => {
  const onSlider = handlers.onSlider ?? vi.fn();
  const widget = (o: BlindOpts) => (
    <WindowCoveringWidget
      accessory={makeBlind(o)}
      onToggle={vi.fn()}
      onSlider={onSlider}
      onSetValue={handlers.onSetValue}
      getEffectiveValue={(_id, _type, serverValue) => serverValue}
      onFinishEditing={vi.fn()}
      compact={false}
      expanded
    />
  );
  const result = render(widget(opts));
  /**
   * Push a new device state in, the way the caches do.
   *
   * Both kinds of update arrive through this one door in the real app: the
   * optimistic target write, which lands before the relay is called, and the
   * device's own position reports, which trickle in afterwards.
   */
  const update = (next: Partial<BlindOpts>) => result.rerender(widget({ ...opts, ...next }));
  return { ...result, onSlider, update };
};

const slider = () => screen.getByRole('slider');

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe('what the bar draws', () => {
  it('shows the commanded position, not the one the blind is crawling away from', () => {
    // Told to open fully; still physically shut. The readout used to follow the
    // current position, so releasing a drag threw the bar back to where the
    // blind was and crept up over the next half-minute.
    renderBlind({ current: 100, target: 0 });
    expect(screen.getByText('Open')).toBeTruthy();
    // …and the device's own position rides along as the second edge.
    expect(screen.getByTestId('slider-travel')).toBeTruthy();
    expect(slider().getAttribute('aria-valuetext')).toBe('Open, currently Closed');
  });

  it('draws one plain fill once the blind has arrived', () => {
    renderBlind({ current: 0, target: 0 });
    expect(screen.queryByTestId('slider-travel')).toBeNull();
    expect(slider().getAttribute('aria-valuetext')).toBeNull();
  });

  it('reads the position the way the maker reports it', () => {
    // Lutron reports openness, so raw 100 is wide open — the same picture the
    // Aqara above draws from raw 0.
    renderBlind({ current: 0, target: 100, manufacturer: 'Lutron' });
    expect(screen.getByText('Open')).toBeTruthy();
  });
});

describe('saying whether anything is actually happening', () => {
  it('marks a command the device has not acted on yet', () => {
    const { onSlider, update } = renderBlind({ current: 100, target: 100 });
    expect(screen.getByText('Currently Closed')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /open/i }));
    expect(onSlider).toHaveBeenCalledWith('BLIND-1', 'target_position', 0);

    // The optimistic write reaches the cache before the relay is called.
    update({ target: 0 });

    // The write is out, the motor has not turned: an ellipsis and a pulse, not
    // a flat claim that the blind is moving.
    expect(screen.getByText('Opening…')).toBeTruthy();
    expect(screen.getByTestId('slider-target-edge').className).toContain('animate-pulse-edge');
  });

  it('drops the ellipsis once the device reports it is moving', () => {
    const { update } = renderBlind({ current: 100, target: 100 });
    fireEvent.click(screen.getByRole('button', { name: /open/i }));
    update({ target: 0 });
    expect(screen.getByText('Opening…')).toBeTruthy();

    // The blind starts: raw coverage falling on a coverage-reporting device is
    // the blind going up.
    update({ target: 0, current: 88, positionState: DECREASING });
    expect(screen.getByText('Opening')).toBeTruthy();
    expect(screen.getByTestId('slider-target-edge').className).not.toContain('animate-pulse-edge');
  });

  it('says so when the write comes back rejected', () => {
    const { update, container } = renderBlind({ current: 100, target: 100 });
    fireEvent.click(screen.getByRole('button', { name: /open/i }));
    update({ target: 0 });
    expect(container.querySelector('.animate-nudge')).toBeNull();

    // writeCharacteristic puts target_position back on failure. The bar draws
    // the target, so it is about to slide away from where the user put it.
    update({ target: 100 });
    expect(container.querySelector('.animate-nudge')).toBeTruthy();
    expect(screen.getByText('Currently Closed')).toBeTruthy();
  });

  it('does not cry failure at a surface that never reflects the write', () => {
    // A view whose write path does not feed this accessory back. Nothing to
    // report — and emphatically not a rejection.
    const { container } = renderBlind({ current: 100, target: 100 });
    fireEvent.click(screen.getByRole('button', { name: /open/i }));
    act(() => { vi.advanceTimersByTime(5000); });
    expect(container.querySelector('.animate-nudge')).toBeNull();
  });
});

describe('stopping it where it stands', () => {
  it('offers Stop instead of Open and Close while it travels', () => {
    renderBlind({ current: 60, target: 0, positionState: DECREASING });
    expect(screen.getByRole('button', { name: /stop/i })).toBeTruthy();
    // Mid-travel, redirecting is what the bar is for; the two end stops are
    // the ones that had nothing to offer.
    expect(screen.queryByRole('button', { name: /^open$/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /^close$/i })).toBeNull();
  });

  it('commands the position it is passing through when hold_position is absent', () => {
    const { onSlider } = renderBlind({ current: 60, target: 0, positionState: DECREASING });
    fireEvent.click(screen.getByRole('button', { name: /stop/i }));
    // Raw, untouched: a blind told where it already is has arrived.
    expect(onSlider).toHaveBeenCalledWith('BLIND-1', 'target_position', 60);
  });

  it('prefers hold_position when the covering and the surface both offer it', () => {
    const onSetValue = vi.fn();
    const { onSlider } = renderBlind(
      { current: 60, target: 0, positionState: DECREASING, holdPosition: true },
      { onSetValue },
    );
    fireEvent.click(screen.getByRole('button', { name: /stop/i }));
    expect(onSetValue).toHaveBeenCalledWith('BLIND-1', 'hold_position', true);
    expect(onSlider).not.toHaveBeenCalled();
  });

  it('falls back when the surface cannot write anything but numbers', () => {
    // Shared views pass no onSetValue at all, and hold_position is write-only.
    const { onSlider } = renderBlind({ current: 60, target: 0, positionState: DECREASING, holdPosition: true });
    fireEvent.click(screen.getByRole('button', { name: /stop/i }));
    expect(onSlider).toHaveBeenCalledWith('BLIND-1', 'target_position', 60);
  });

  it('goes back to Open and Close once it settles', () => {
    renderBlind({ current: 60, target: 60 });
    expect(screen.queryByRole('button', { name: /stop/i })).toBeNull();
    expect(screen.getByRole('button', { name: /open/i })).toBeTruthy();
  });
});
