// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, within, act } from '@testing-library/react';
import type { HomeKitAccessory } from '@/native/homekit-bridge';
import { ActionsSection } from '../ActionsSection';
import { LayoutEditProvider } from '@/contexts/LayoutEditContext';

function acc(id: string, serviceType: string, chars: Array<[string, unknown]>): HomeKitAccessory {
  return {
    id,
    name: id,
    roomName: 'Room',
    category: 'other',
    isReachable: true,
    services: [{
      id: `svc-${id}`,
      name: serviceType,
      serviceType,
      characteristics: chars.map(([characteristicType, value], j) => ({
        id: `char-${id}-${j}`, characteristicType, value, isReadable: true, isWritable: true,
      })),
    }],
  } as HomeKitAccessory;
}

const lightOn = acc('l1', 'lightbulb', [['power_state', true]]);
const lightOff = acc('l2', 'lightbulb', [['power_state', false]]);
const lockOpen = acc('k1', 'lock', [['lock_current_state', 0], ['lock_target_state', false]]);
const lockShut = acc('k2', 'lock', [['lock_current_state', 1], ['lock_target_state', true]]);
const alarm = acc('s1', 'security_system', [
  ['security_system_current_state', 3], ['security_system_target_state', 3],
]);

/**
 * A one-way action's card is itself the button; a two-way action's card is not,
 * because its toggle is. So the card is found by id rather than by role.
 */
const card = (id: string) => screen.getByTestId(`action-${id}`);

/** The single switch on a card whose action is all-on or all-off. */
const switchOn = (id: string) => within(card(id)).getByRole('switch');

/** The half of a mixed card's toggle that goes the given way. */
const half = (id: string, direction: 'on' | 'off') =>
  within(card(id)).getByRole('button', { name: `Turn all ${direction}` });

function renderSection(
  accessories: HomeKitAccessory[],
  props: Partial<React.ComponentProps<typeof ActionsSection>> = {},
  layoutEdit: { touchMode: boolean; editMode: boolean } = { touchMode: false, editMode: false },
) {
  const onRunAction = vi.fn().mockResolvedValue(undefined);
  render(
    <LayoutEditProvider value={layoutEdit}>
      <ActionsSection
        accessories={accessories}
        homeLayout={null}
        open
        onRunAction={onRunAction}
        {...props}
      />
    </LayoutEditProvider>
  );
  return { onRunAction };
}

describe('ActionsSection', () => {
  afterEach(cleanup);

  it('renders one card per action, labelled by direction and subtitled by state', () => {
    renderSection([lightOn, lightOff]);
    expect(within(card('lights')).getByText('1 of 2 on')).toBeTruthy();
    expect(screen.getByText('All lights')).toBeTruthy();
    // A lone pair of lights also earns the everything-off card
    expect(screen.getByText('Turn everything off')).toBeTruthy();
  });

  it('gives a two-way action a toggle, and a one-way action a card that is the button', () => {
    renderSection([lightOn, lockOpen]);
    // Lights can go either way, so the control says which way and the card
    // itself is inert.
    expect(within(card('lights')).getByRole('switch')).toBeTruthy();
    expect(card('lights').getAttribute('role')).toBeNull();
    // Lock up is one-way on purpose: no toggle, and the card still presses.
    expect(within(card('locks')).queryByRole('switch')).toBeNull();
    expect(card('locks').getAttribute('role')).toBe('button');
  });

  it('parks the thumb in the middle when only some are on, and offers both ends', () => {
    const { onRunAction } = renderSection([lightOn, lightOff]);
    // Mixed is two commands, so it is two buttons and never a switch.
    expect(within(card('lights')).queryByRole('switch')).toBeNull();

    fireEvent.click(half('lights', 'off'));
    expect(onRunAction.mock.calls[0][1].direction).toBe(false);

    cleanup();
    const second = renderSection([lightOn, lightOff]);
    fireEvent.click(half('lights', 'on'));
    expect(second.onRunAction.mock.calls[0][1].direction).toBe(true);
  });

  it('runs an action from its toggle', () => {
    const { onRunAction } = renderSection([lightOn]);
    fireEvent.click(switchOn('lights'));
    expect(onRunAction).toHaveBeenCalledTimes(1);
    expect(onRunAction.mock.calls[0][0].id).toBe('lights');
    // Every light is on, so the only way left is off.
    expect(onRunAction.mock.calls[0][1].direction).toBe(false);
  });

  it('runs an action from the keyboard, aiming with the arrow keys', async () => {
    // A keyboard user cannot aim at a half, so the arrows are the only way to
    // reach either end of a mixed toggle.
    const { onRunAction } = renderSection([lightOn, lightOff]);
    fireEvent.keyDown(within(card('lights')).getByRole('group'), { key: 'ArrowRight' });
    expect(onRunAction.mock.calls[0][1].direction).toBe(true);

    // Inert while that run is in flight, so let it settle before aiming back.
    await act(async () => {});
    fireEvent.keyDown(within(card('lights')).getByRole('group'), { key: 'ArrowLeft' });
    expect(onRunAction.mock.calls[1][1].direction).toBe(false);
  });

  it('no longer runs when the card body is pressed', () => {
    // The toggle is the only way in: a press anywhere else would have to guess
    // a direction, which is the guess the toggle exists to stop making.
    const { onRunAction } = renderSection([lightOn]);
    fireEvent.click(card('lights'));
    fireEvent.keyDown(card('lights'), { key: 'Enter' });
    expect(onRunAction).not.toHaveBeenCalled();
  });

  it('stays live while it runs, and the next press calls off the last', async () => {
    // Half a house changing its mind is exactly when you want the control back.
    // The press is not swallowed: it aborts the run in flight and starts its own.
    const signals: Array<AbortSignal | undefined> = [];
    let release: () => void = () => {};
    const onRunAction = vi.fn((_a, opts) => {
      signals.push(opts.signal);
      return new Promise<void>(resolve => { release = resolve; });
    });
    render(
      <ActionsSection accessories={[lightOn]} homeLayout={null} open onRunAction={onRunAction} />
    );

    fireEvent.click(switchOn('lights'));
    expect(screen.getByText('Turning the lights off')).toBeTruthy();
    expect(signals[0]!.aborted).toBe(false);

    fireEvent.click(switchOn('lights'));
    expect(onRunAction).toHaveBeenCalledTimes(2);
    expect(signals[0]!.aborted).toBe(true);   // the first was called off
    expect(signals[1]!.aborted).toBe(false);

    await act(async () => { release(); });
  });

  it('does not let a superseded run clear the state of the one that replaced it', async () => {
    // An aborted run finishes late — its issued writes still have to settle —
    // and its `finally` would otherwise wipe its replacement's running label.
    const resolvers: Array<() => void> = [];
    const onRunAction = vi.fn(() => new Promise<void>(resolve => { resolvers.push(resolve); }));
    render(
      <ActionsSection accessories={[lightOn]} homeLayout={null} open onRunAction={onRunAction} />
    );

    fireEvent.click(switchOn('lights'));
    fireEvent.click(switchOn('lights'));
    await act(async () => { resolvers[0](); });      // the abandoned one lands
    expect(screen.getByText('Turning the lights off')).toBeTruthy();  // still running

    await act(async () => { resolvers[1](); });      // the live one lands
    expect(screen.getByText('All lights')).toBeTruthy();
  });

  it('still bars a second press on a one-way action, which has no "stop" to mean', async () => {
    let release: () => void = () => {};
    const onRunAction = vi.fn((_a: unknown, _opts?: { signal?: AbortSignal }) =>
      new Promise<void>(resolve => { release = resolve; }));
    render(
      <ActionsSection accessories={[lockOpen]} homeLayout={null} open onRunAction={onRunAction} />
    );

    fireEvent.click(card('locks'));
    fireEvent.click(card('locks'));
    expect(onRunAction).toHaveBeenCalledTimes(1);
    // and it runs without a signal: there is nothing to call off
    expect(onRunAction.mock.calls[0][1]?.signal).toBeUndefined();

    await act(async () => { release(); });
  });

  it('narrates the direction the user chose, not the one the catalog would have', async () => {
    // With one light on and one off, the catalog's own next press is "off". Ask
    // for on, and the card has to say so — its runningLabel would have claimed
    // the opposite exactly when the user had just overridden it.
    const onRunAction = vi.fn(() => new Promise<void>(() => {}));
    render(
      <ActionsSection accessories={[lightOn, lightOff]} homeLayout={null} open onRunAction={onRunAction} />
    );
    fireEvent.click(half('lights', 'on'));
    expect(screen.getByText('Turning the lights on')).toBeTruthy();
    expect(screen.queryByText('Turning the lights off')).toBeNull();
  });

  it('says what it is doing, and counts up as writes settle', async () => {
    let release: () => void = () => {};
    let report: (done: number, total: number) => void = () => {};
    const onRunAction = vi.fn((_a, opts) => {
      report = opts.onProgress;
      return new Promise<void>(resolve => { release = resolve; });
    });
    render(
      <ActionsSection accessories={[lightOn]} homeLayout={null} open onRunAction={onRunAction} />
    );

    fireEvent.click(switchOn('lights'));
    // Seeded before the first write settles, so the count never starts blank
    expect(within(card('lights')).getByText('0 of 1 accessory')).toBeTruthy();

    await act(async () => { report(1, 4); });
    expect(within(card('lights')).getByText('1 of 4 accessories')).toBeTruthy();

    // and the live region is marked so it is announced, not just seen
    expect(within(card('lights')).getByText('1 of 4 accessories').getAttribute('aria-live')).toBe('polite');

    await act(async () => { release(); });
    // back to reporting state once it finishes
    expect(within(card('lights')).getByText('1 of 1 on')).toBeTruthy();
  });

  it('leaves a nothing-to-do action in place, dimmed and unpressable', () => {
    // Every lock already secured: the card stays so the grid doesn't reflow,
    // but it no longer does anything.
    const { onRunAction } = renderSection([lockShut]);
    const lockUp = card('locks');
    expect(within(lockUp).getByText('All locked')).toBeTruthy();
    expect(lockUp.getAttribute('aria-disabled')).toBe('true');
    expect(lockUp.className).toContain('opacity-50');

    fireEvent.click(lockUp);
    expect(onRunAction).not.toHaveBeenCalled();
  });

  it('never dims a two-way action, because neither end is the end of the road', () => {
    // Every light already on used to be "nothing to do". It is not: off is
    // still somewhere to go, and dimming would strand the user at that end.
    const { onRunAction } = renderSection([lightOn]);
    expect(card('lights').className).not.toContain('opacity-50');
    fireEvent.click(switchOn('lights'));
    expect(onRunAction).toHaveBeenCalledTimes(1);
  });

  it('disables every card for a view-only member', () => {
    const { onRunAction } = renderSection([lightOn, lockOpen], { isViewOnly: true });
    fireEvent.click(switchOn('lights'));
    fireEvent.click(card('locks'));
    expect(onRunAction).not.toHaveBeenCalled();
  });

  it('asks before arming, and only runs once confirmed', () => {
    const { onRunAction } = renderSection([alarm]);
    fireEvent.click(card('security'));
    expect(onRunAction).not.toHaveBeenCalled();

    const dialog = screen.getByRole('alertdialog');
    expect(within(dialog).getByText('Arm security?')).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Arm security' }));
    expect(onRunAction).toHaveBeenCalledTimes(1);
    expect(onRunAction.mock.calls[0][0].id).toBe('security');
  });

  it('does not run when the confirmation is cancelled', () => {
    const { onRunAction } = renderSection([alarm]);
    fireEvent.click(card('security'));
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Cancel' }));
    expect(onRunAction).not.toHaveBeenCalled();
  });

  it('omits actions hidden for this home', () => {
    renderSection([lightOn], { homeLayout: { visibility: { hiddenActions: ['lights'] } } });
    expect(screen.queryByText('All lights')).toBeNull();
    // everything-off is not hidden, so it survives
    expect(screen.getByText('Turn everything off')).toBeTruthy();
  });

  it('renders nothing for a home with no actionable accessories', () => {
    const sensor = acc('m', 'motion_sensor', [['motion_detected', true]]);
    const { container } = render(
      <ActionsSection accessories={[sensor]} homeLayout={null} open onRunAction={vi.fn()} />
    );
    expect(container.querySelectorAll('[role="button"]')).toHaveLength(0);
  });
});

describe('hiding an action', () => {
  afterEach(cleanup);

  it('offers Hide Action on right-click, and reports which one', () => {
    const onHideAction = vi.fn();
    renderSection([lightOn], { homeId: 'HOME-1', onHideAction });

    fireEvent.contextMenu(card('lights'));
    fireEvent.click(screen.getByText('Hide Action'));

    expect(onHideAction).toHaveBeenCalledTimes(1);
    // The stable id, not the label — the label flips with live device state.
    expect(onHideAction.mock.calls[0][0]).toBe('lights');
  });

  it('offers nothing to right-click on touch, where Edit Layout owns hiding', () => {
    renderSection(
      [lightOn],
      { homeId: 'HOME-1', onHideAction: vi.fn() },
      { touchMode: true, editMode: false },
    );
    fireEvent.contextMenu(card('lights'));
    expect(screen.queryByText('Hide Action')).toBeNull();
  });

  it('offers nothing where there is nothing to write to', () => {
    // A view-only member, or a home we do not have the id for: the Dashboard
    // withholds the handler rather than the menu offering a no-op.
    renderSection([lightOn], { homeId: 'HOME-1' });
    fireEvent.contextMenu(card('lights'));
    expect(screen.queryByText('Hide Action')).toBeNull();
  });
});
