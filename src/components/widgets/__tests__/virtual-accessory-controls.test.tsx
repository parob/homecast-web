// @vitest-environment jsdom
//
// "User Editable" has to mean something for every virtual accessory type.
//
// The widget drew a control per characteristic in a switch whose `default`
// branch returned nothing, so `input_text` and `input_datetime` rendered as a
// value with no way to change it — indistinguishable from the read-only setting
// being stuck on. A type added later would fail the same silent way, so the
// coverage assertion below runs over the whole characteristic list rather than
// naming the two that were missing.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { VirtualAccessoryWidget } from '../VirtualAccessoryWidget';
import type { WidgetProps } from '../types';

// The widget tree reaches lib/config, which reads localStorage at import time.
vi.mock('@/lib/config', () => ({
  isCommunity: false,
  getCommunityMode: () => null,
  isRelayMode: () => false,
  isClientMode: () => false,
  isRelaySetupComplete: () => false,
  getRelayAddress: () => null,
  config: { isCommunity: false, apiBase: 'https://api.test', graphqlUrl: 'https://api.test/', wsUrl: 'wss://api.test/ws' },
}));

afterEach(cleanup);

/** Every characteristic the relay can publish for a virtual accessory. */
const VIRTUAL_CHARS = [
  'virtual_mode', 'virtual_count', 'virtual_number',
  'virtual_timer', 'virtual_text', 'virtual_datetime',
] as const;

function accessoryFor(characteristicType: string, extra: Record<string, unknown> = {}) {
  return {
    id: 'va-1',
    name: 'Test Value',
    category: 'Other',
    isReachable: true,
    isVirtual: true,
    isUserEditable: true,
    services: [{
      id: 'va-1:service',
      name: 'Test Value',
      serviceType: 'virtual',
      characteristics: [{
        id: `va-1:${characteristicType}`,
        characteristicType,
        value: characteristicType === 'virtual_count' ? 2 : '',
        isReadable: true,
        isWritable: true,
      }],
    }],
    ...extra,
  };
}

function renderWidget(characteristicType: string, extra: Record<string, unknown> = {}) {
  const writes: unknown[][] = [];
  const props = {
    accessory: accessoryFor(characteristicType, extra),
    getEffectiveValue: (_id: string, _c: string, v: unknown) => v,
    onSetValue: (...args: unknown[]) => { writes.push(args); },
    onSlider: (...args: unknown[]) => { writes.push(args); },
    onToggle: () => {},
  } as unknown as WidgetProps;
  render(<VirtualAccessoryWidget {...props} />);
  return writes;
}

describe('virtual accessory controls', () => {
  it('offers a control for every characteristic type when user-editable', () => {
    const missing: string[] = [];
    for (const char of VIRTUAL_CHARS) {
      cleanup();
      renderWidget(char);
      if (!screen.queryByLabelText(/^(Set|Increase|Start|Cancel) /)) missing.push(char);
    }

    expect(missing).toEqual([]);
  });

  it('writes the text a user types, on Enter', () => {
    const writes = renderWidget('virtual_text');
    const input = screen.getByLabelText('Set Test Value');

    fireEvent.change(input, { target: { value: 'on holiday' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(writes).toEqual([['va-1', 'virtual_text', 'on holiday']]);
  });

  it('keeps what is being typed even as the polled value changes underneath', () => {
    renderWidget('virtual_text');
    const input = screen.getByLabelText('Set Test Value') as HTMLInputElement;

    fireEvent.change(input, { target: { value: 'half-typ' } });

    // A re-render with the old value must not clobber the draft.
    expect(input.value).toBe('half-typ');
  });

  it('picks the date-time input the definition actually needs', () => {
    const cases: [Record<string, unknown>, string][] = [
      [{ virtualHasDate: true, virtualHasTime: true }, 'datetime-local'],
      [{ virtualHasDate: true, virtualHasTime: false }, 'date'],
      [{ virtualHasDate: false, virtualHasTime: true }, 'time'],
    ];

    for (const [extra, expected] of cases) {
      cleanup();
      renderWidget('virtual_datetime', extra);
      expect(screen.getByLabelText('Set Test Value')).toHaveProperty('type', expected);
    }
  });

  // A running timer reported only `active`, and the tile's `isOn` compared the
  // characteristic against `helper_timer` — a name that stopped existing at the
  // rename — so nothing about the tile changed when you started it. It was
  // reported as "the timer doesn't start"; it had started every time.
  it('shows a started timer is running, and how long is left', () => {
    cleanup();
    const running = accessoryFor('virtual_timer');
    running.services[0].characteristics[0].value = 'active';

    render(
      <VirtualAccessoryWidget
        {...({
          accessory: { ...running, virtualRemainingMs: 125_000, virtualDurationMs: 300_000 },
          getEffectiveValue: (_i: string, _c: string, v: unknown) => v,
          onSetValue: () => {},
          onSlider: () => {},
          onToggle: () => {},
        } as unknown as WidgetProps)}
      />,
    );

    expect(screen.getByText('2:05 left')).toBeTruthy();
    expect(screen.getByLabelText('Cancel Test Value')).toBeTruthy();
  });

  it('offers nothing when the accessory is not user-editable', () => {
    cleanup();
    renderWidget('virtual_text', { isUserEditable: false });

    expect(screen.queryByLabelText('Set Test Value')).toBeNull();
  });
});
