// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, within, act } from '@testing-library/react';
import type { HomeKitAccessory } from '@/native/homekit-bridge';
import { ActionsSection } from '../ActionsSection';

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

const card = (label: string) => screen.getByText(label).closest('[role="button"]')!;

function renderSection(accessories: HomeKitAccessory[], props: Partial<React.ComponentProps<typeof ActionsSection>> = {}) {
  const onRunAction = vi.fn().mockResolvedValue(undefined);
  render(
    <ActionsSection
      accessories={accessories}
      homeLayout={null}
      open
      onRunAction={onRunAction}
      {...props}
    />
  );
  return { onRunAction };
}

describe('ActionsSection', () => {
  afterEach(cleanup);

  it('renders one card per action, labelled by direction and subtitled by state', () => {
    renderSection([lightOn, lightOff]);
    const lights = card('Turn all lights off');
    expect(within(lights as HTMLElement).getByText('1 of 2 on')).toBeTruthy();
    // A lone pair of lights also earns the everything-off card
    expect(screen.getByText('Turn everything off')).toBeTruthy();
  });

  it('runs an action on click', () => {
    const { onRunAction } = renderSection([lightOn]);
    fireEvent.click(card('Turn all lights off'));
    expect(onRunAction).toHaveBeenCalledTimes(1);
    expect(onRunAction.mock.calls[0][0].id).toBe('lights');
  });

  it('runs an action from the keyboard', () => {
    const { onRunAction } = renderSection([lightOn]);
    fireEvent.keyDown(card('Turn all lights off'), { key: 'Enter' });
    expect(onRunAction).toHaveBeenCalledTimes(1);
    // The card now reads "Turning the lights off", and is inert while it does.
    fireEvent.keyDown(card('Turning the lights off'), { key: ' ' });
    expect(onRunAction).toHaveBeenCalledTimes(1);
  });

  it('ignores a second press while the first is still in flight', async () => {
    let release: () => void = () => {};
    const onRunAction = vi.fn(() => new Promise<void>(resolve => { release = resolve; }));
    render(
      <ActionsSection accessories={[lightOn]} homeLayout={null} open onRunAction={onRunAction} />
    );

    fireEvent.click(card('Turn all lights off'));
    fireEvent.click(card('Turning the lights off'));
    fireEvent.click(card('Turning the lights off'));
    expect(onRunAction).toHaveBeenCalledTimes(1);

    await act(async () => { release(); });
    // and it goes back to naming the direction once it is done
    fireEvent.click(card('Turn all lights off'));
    expect(onRunAction).toHaveBeenCalledTimes(2);
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

    fireEvent.click(card('Turn all lights off'));
    const running = card('Turning the lights off') as HTMLElement;
    // Seeded before the first write settles, so the count never starts blank
    expect(within(running).getByText('0 of 1 accessory')).toBeTruthy();

    await act(async () => { report(1, 4); });
    expect(within(card('Turning the lights off') as HTMLElement).getByText('1 of 4 accessories')).toBeTruthy();

    // and the live region is marked so it is announced, not just seen
    expect(within(card('Turning the lights off') as HTMLElement)
      .getByText('1 of 4 accessories').getAttribute('aria-live')).toBe('polite');

    await act(async () => { release(); });
    // back to reporting state once it finishes
    expect(within(card('Turn all lights off') as HTMLElement).getByText('1 of 1 on')).toBeTruthy();
  });

  it('leaves a nothing-to-do action in place, dimmed and unpressable', () => {
    // Every lock already secured: the card stays so the grid doesn't reflow,
    // but it no longer does anything.
    const { onRunAction } = renderSection([lockShut]);
    const lockUp = card('Lock up');
    expect(within(lockUp as HTMLElement).getByText('All locked')).toBeTruthy();
    expect(lockUp.getAttribute('aria-disabled')).toBe('true');
    expect(lockUp.className).toContain('opacity-50');

    fireEvent.click(lockUp);
    expect(onRunAction).not.toHaveBeenCalled();
  });

  it('disables every card for a view-only member', () => {
    const { onRunAction } = renderSection([lightOn, lockOpen], { isViewOnly: true });
    fireEvent.click(card('Turn all lights off'));
    fireEvent.click(card('Lock up'));
    expect(onRunAction).not.toHaveBeenCalled();
  });

  it('asks before arming, and only runs once confirmed', () => {
    const { onRunAction } = renderSection([alarm]);
    fireEvent.click(card('Arm security'));
    expect(onRunAction).not.toHaveBeenCalled();

    const dialog = screen.getByRole('alertdialog');
    expect(within(dialog).getByText('Arm security?')).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Arm security' }));
    expect(onRunAction).toHaveBeenCalledTimes(1);
    expect(onRunAction.mock.calls[0][0].id).toBe('security');
  });

  it('does not run when the confirmation is cancelled', () => {
    const { onRunAction } = renderSection([alarm]);
    fireEvent.click(card('Arm security'));
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Cancel' }));
    expect(onRunAction).not.toHaveBeenCalled();
  });

  it('omits actions hidden for this home', () => {
    renderSection([lightOn], { homeLayout: { visibility: { hiddenActions: ['lights'] } } });
    expect(screen.queryByText('Turn all lights off')).toBeNull();
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
