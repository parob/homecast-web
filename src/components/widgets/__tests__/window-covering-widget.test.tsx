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

/**
 * The big number inside the bar, and the status line outside it.
 *
 * They deliberately say the same words now — both read the device — so a bare
 * getByText is ambiguous, and that ambiguity is the fix working. Scope instead.
 */
const barReadout = () => slider().querySelector('.tabular-nums')?.textContent ?? '';
const subtitleHas = (text: string) =>
  screen.getAllByText(text).some(el => !slider().contains(el));

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe('what the bar draws', () => {
  it('draws the fill to the command, so a press lands at once', () => {
    // Told to open fully; still physically shut. Drawing the current position
    // instead meant releasing a drag threw the bar back to where the blind was
    // and crept up over the next half-minute.
    renderBlind({ current: 100, target: 0 });
    expect(screen.getByTestId('slider-travel')).toBeTruthy();
    // The fill runs the whole way: raw 0 coverage is wide open.
    expect(screen.getByTestId('slider-target-edge').style.top).toBe('0%');
  });

  it('prints where the blind is, never where it was sent', () => {
    // The regression: the fill moving to the target took the readout with it,
    // so this said "Open" over a window that was still shut.
    renderBlind({ current: 100, target: 0 });
    expect(barReadout()).toBe('Closed');
    expect(slider().getAttribute('aria-valuetext')).toBe('Closed, heading for Open');
  });

  it('lets the number climb as the blind actually travels', () => {
    const { update } = renderBlind({ current: 100, target: 0 });
    expect(barReadout()).toBe('Closed');
    // Coverage falling on a coverage-reporting blind is the blind going up.
    update({ current: 40, target: 0, positionState: DECREASING });
    expect(barReadout()).toBe('60%');
    update({ current: 0, target: 0 });
    expect(barReadout()).toBe('Open');
  });

  it('draws one plain fill once the blind has arrived', () => {
    renderBlind({ current: 0, target: 0 });
    expect(screen.queryByTestId('slider-travel')).toBeNull();
    expect(slider().getAttribute('aria-valuetext')).toBeNull();
  });

  it('reads the position the way the maker reports it', () => {
    // Lutron reports openness, so raw 100 is wide open — the same picture the
    // Aqara above draws from raw 0.
    renderBlind({ current: 100, target: 100, manufacturer: 'Lutron' });
    expect(barReadout()).toBe('Open');
  });
});

describe('saying whether anything is actually happening', () => {
  it('marks a command the device has not acted on yet', () => {
    const { onSlider, update } = renderBlind({ current: 100, target: 100 });
    expect(subtitleHas('Closed')).toBe(true);

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
    expect(subtitleHas('Closed')).toBe(true);
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


describe('how far open it says it is', () => {
  it('climbs the ladder as the blind travels', () => {
    // The subtitle, which is the plain-language half of the same reading. Every
    // one of these used to be the single phrase "Currently Partially Open".
    const { update } = renderBlind({ current: 100, target: 100 });
    expect(subtitleHas('Closed')).toBe(true);

    update({ current: 85, target: 85 });
    expect(subtitleHas('Slightly Open')).toBe(true);

    update({ current: 50, target: 50 });
    expect(subtitleHas('Half Open')).toBe(true);

    update({ current: 10, target: 10 });
    expect(subtitleHas('Mostly Open')).toBe(true);

    update({ current: 0, target: 0 });
    expect(subtitleHas('Open')).toBe(true);
    // The bar's number and the subtitle now agree, both read from the device
    // rather than one from the device and one from the last order.
    expect(barReadout()).toBe('Open');
  });
});

/** The sweeping arc PendingRing draws; the track beside it is not animated. */
const spinners = () => document.querySelectorAll('span.animate-spin[aria-hidden="true"]');

describe('the spinner while it travels', () => {
  it('spins from the press, before the device has said anything', () => {
    // The write is confirmed in milliseconds and the motor turns for another
    // half a minute. The tile used to look idle for all of it.
    const { update } = renderBlind({ current: 100, target: 100 });
    expect(spinners()).toHaveLength(0);

    fireEvent.click(screen.getByRole('button', { name: /open/i }));
    update({ target: 0 });
    expect(spinners().length).toBeGreaterThan(0);
  });

  it('keeps spinning while the device reports itself moving', () => {
    renderBlind({ current: 40, target: 0, positionState: DECREASING });
    expect(spinners().length).toBeGreaterThan(0);
  });

  it('stops once the blind arrives', () => {
    const { update } = renderBlind({ current: 100, target: 100 });
    fireEvent.click(screen.getByRole('button', { name: /open/i }));
    update({ target: 0 });
    expect(spinners().length).toBeGreaterThan(0);

    update({ current: 0, target: 0 });
    expect(spinners()).toHaveLength(0);
  });

  it('does not spin for ever on a blind that settles short of its target', () => {
    // The reason this is not keyed on isMoving. A blind resting at 97 for a
    // target of 100 satisfies "target differs from current" permanently, which
    // is fine for the word "Opening" and useless as a spinner — a tile that
    // spins for ever reports nothing at all.
    renderBlind({ current: 3, target: 0, positionState: STOPPED });
    expect(spinners()).toHaveLength(0);
    // …and the wording still describes the gap, which is its job, not the ring's.
    expect(subtitleHas('Opening')).toBe(true);
  });

  it('is silent on a blind nobody has touched', () => {
    renderBlind({ current: 50, target: 50 });
    expect(spinners()).toHaveLength(0);
  });
});

describe('the spinner lasts the whole journey', () => {
  it('never blinks out across a full travel that reports as it goes', () => {
    // The requirement stated plainly: spinning at the press, at every step of
    // the way, and only stopping on arrival. Checked at each report rather than
    // at the ends, because a spinner that drops out mid-travel and comes back
    // is worse than one that never appeared.
    const { update } = renderBlind({ current: 100, target: 100 });
    fireEvent.click(screen.getByRole('button', { name: /open/i }));
    update({ target: 0 });
    expect(spinners().length).toBeGreaterThan(0);

    for (const current of [92, 74, 51, 28, 9]) {
      update({ current, target: 0, positionState: DECREASING });
      expect(spinners().length).toBeGreaterThan(0);
    }

    update({ current: 0, target: 0, positionState: STOPPED });
    expect(spinners()).toHaveLength(0);
  });

  it('survives a bridge that drops back to Stopped mid-travel', () => {
    // Plenty of bridges republish Stopped between position reports. Leaning on
    // position_state alone would strobe the ring for the whole journey; the
    // outstanding command is what carries it across the gaps.
    const { update } = renderBlind({ current: 100, target: 100 });
    fireEvent.click(screen.getByRole('button', { name: /open/i }));
    update({ target: 0 });

    update({ current: 80, target: 0, positionState: STOPPED });
    expect(spinners().length).toBeGreaterThan(0);
    update({ current: 60, target: 0, positionState: DECREASING });
    expect(spinners().length).toBeGreaterThan(0);
    update({ current: 30, target: 0, positionState: STOPPED });
    expect(spinners().length).toBeGreaterThan(0);
  });

  it('covers the travel of a blind that publishes no position_state at all', () => {
    // No device account of movement to lean on — the command is the only thing
    // that knows the journey is still going.
    const { update } = renderBlind({ current: 100, target: 100, positionState: null });
    fireEvent.click(screen.getByRole('button', { name: /open/i }));
    update({ target: 0, positionState: null });

    for (const current of [70, 40, 10]) {
      update({ current, target: 0, positionState: null });
      expect(spinners().length).toBeGreaterThan(0);
    }

    update({ current: 0, target: 0, positionState: null });
    expect(spinners()).toHaveLength(0);
  });
});
