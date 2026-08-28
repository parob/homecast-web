// @vitest-environment jsdom
/**
 * The panel a shortcut card opens into, rendered.
 *
 * The write set is unit-tested next door; what is checked here is that the
 * panel really is the group widget over the action's members, that the controls
 * appear on the "some member supports it" rule rather than "all of them do",
 * and that moving one writes through the ordinary action runner.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';

vi.mock('@/lib/config', () => ({
  isCommunity: false,
  getCommunityMode: () => null,
  isRelayMode: () => false,
  isClientMode: () => false,
  isRelaySetupComplete: () => false,
  config: { isCommunity: false, apiBase: 'https://api.test', graphqlUrl: 'https://api.test/', wsUrl: 'wss://api.test/ws' },
}));

import type { HomeKitAccessory } from '@/native/homekit-bridge';
import { deriveHomeActions } from '../catalog';
import { ActionGroupPanel } from '../ActionGroupPanel';

if (!window.ResizeObserver) {
  window.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
}
if (!window.matchMedia) {
  window.matchMedia = ((query: string) => ({
    matches: false, media: query, onchange: null,
    addEventListener: () => {}, removeEventListener: () => {},
    addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

type Char = { characteristicType: string; value: unknown; isWritable?: boolean };

function acc(id: string, serviceType: string, chars: Char[]): HomeKitAccessory {
  return {
    id,
    name: id,
    roomName: 'Room',
    category: 'other',
    isReachable: true,
    services: [{
      id: `${id}-svc`,
      name: serviceType,
      serviceType,
      characteristics: chars.map((c, j) => ({
        id: `${id}-char-${j}`,
        characteristicType: c.characteristicType,
        value: c.value,
        isReadable: true,
        isWritable: c.isWritable ?? true,
      })),
    }],
  } as HomeKitAccessory;
}

const dimmable = (id: string, on: boolean, brightness = 50) =>
  acc(id, 'lightbulb', [
    { characteristicType: 'power_state', value: on },
    { characteristicType: 'brightness', value: brightness },
  ]);

/** A bulb that only switches — what "some support it" is about. */
const plain = (id: string, on: boolean) =>
  acc(id, 'lightbulb', [{ characteristicType: 'power_state', value: on }]);

const colour = (id: string, on: boolean) =>
  acc(id, 'lightbulb', [
    { characteristicType: 'power_state', value: on },
    { characteristicType: 'brightness', value: 50 },
    { characteristicType: 'hue', value: 120 },
    { characteristicType: 'saturation', value: 40 },
  ]);

function renderPanel(accessories: HomeKitAccessory[]) {
  const onRunAction = vi.fn().mockResolvedValue(undefined);
  const onToggle = vi.fn();
  const action = deriveHomeActions(accessories).find(a => a.id === 'lights')!;
  render(
    <ActionGroupPanel
      action={action}
      accessories={accessories}
      homeId="HOME-1"
      onRunAction={onRunAction}
      onToggle={onToggle}
    />
  );
  return { onRunAction, onToggle, action };
}

/** Every write the runner was handed, flattened out of the synthetic action. */
const writesFrom = (onRunAction: ReturnType<typeof vi.fn>, call = 0) =>
  onRunAction.mock.calls[call][0].steps.flatMap((s: { writes: unknown[] }) => s.writes);

describe('the shortcut panel', () => {
  afterEach(cleanup);

  it('is the group widget, named for the action', () => {
    renderPanel([dimmable('a', true)]);
    expect(screen.getByText('All lights')).toBeTruthy();
  });

  it('offers brightness when only SOME members dim', () => {
    renderPanel([dimmable('dim', true), plain('bare', true)]);
    // The rule the panel was asked for: present when some support it, and it
    // simply does nothing for the ones that do not.
    expect(screen.getByLabelText('Brightness')).toBeTruthy();
  });

  it('offers no brightness when no member dims', () => {
    renderPanel([plain('a', true), plain('b', true)]);
    expect(screen.queryByLabelText('Brightness')).toBeNull();
  });

  it('offers colour when only SOME members have it', () => {
    renderPanel([colour('rgb', true), dimmable('white', true), plain('bare', true)]);
    expect(screen.getByLabelText('More colours')).toBeTruthy();
  });

  it('offers no colour when nothing in the set has it', () => {
    renderPanel([dimmable('white', true), plain('bare', true)]);
    expect(screen.queryByLabelText('More colours')).toBeNull();
  });

  it('sends a colour to every member that has it, and to no other', () => {
    // The swatch row is the cheapest real interaction that reaches `onSlider`,
    // and colour is the case the rule was actually asked about: most of a big
    // home's bulbs are white, and they must not be written to at all.
    const { onRunAction } = renderPanel([
      colour('rgb-a', true),
      colour('rgb-b', true),
      dimmable('white', true),
      plain('bare', true),
    ]);

    fireEvent.click(screen.getByLabelText('Blue'));

    // Hue and saturation are two writes, because a hue without a saturation
    // cannot express a colour.
    expect(onRunAction).toHaveBeenCalledTimes(2);

    const hue = writesFrom(onRunAction, 0);
    expect(hue.map((w: { accessoryId: string }) => w.accessoryId)).toEqual(['rgb-a', 'rgb-b']);
    // Absolute, and the same for both — not a shift from where each one was.
    expect(hue.map((w: { value: unknown }) => w.value)).toEqual([220, 220]);
    expect(hue.every((w: { characteristicType: string }) => w.characteristicType === 'hue')).toBe(true);

    const saturation = writesFrom(onRunAction, 1);
    expect(saturation.map((w: { accessoryId: string }) => w.accessoryId)).toEqual(['rgb-a', 'rgb-b']);
    expect(saturation.every((w: { characteristicType: string }) => w.characteristicType === 'saturation')).toBe(true);

    // Ridden through the ordinary runner as a one-shot: there is no direction
    // to pick, so the synthetic action carries no toggle — and it keeps the
    // action's own id, which is what lights the pending ring on the card.
    expect(onRunAction.mock.calls[0][0].id).toBe('lights');
    expect(onRunAction.mock.calls[0][0].toggle).toBeUndefined();
  });

  it('writes to a member that is switched off as well as the lit ones', () => {
    // "Every light", not only the ones currently on: a dark bulb still takes
    // the colour, and that is how it comes up right when it is next turned on.
    const { onRunAction } = renderPanel([colour('lit', true), colour('dark', false)]);

    fireEvent.click(screen.getByLabelText('Red'));

    expect(writesFrom(onRunAction, 0).map((w: { accessoryId: string }) => w.accessoryId))
      .toEqual(['lit', 'dark']);
  });

  it('hands the master toggle back to the card’s own runner', () => {
    // Not a separate write path: the panel's toggle and the card's toggle are
    // one control in two places, so a press in either aborts a run in flight
    // from the other.
    const { onToggle, action } = renderPanel([dimmable('a', true), dimmable('b', true)]);
    fireEvent.click(screen.getByRole('switch'));
    expect(onToggle).toHaveBeenCalledWith(action, false);
  });
});
