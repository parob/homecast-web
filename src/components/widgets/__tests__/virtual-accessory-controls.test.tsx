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

// jsdom has no matchMedia, and the widget tree reaches a breakpoint hook.
if (!window.matchMedia) {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

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

  // Characteristic values are JSON-encoded in the cache, as HomeKit sends them.
  // This widget read them raw while every other one decodes, so a string came
  // back wearing its quotes: the tile showed `"yo"`, editing it wrote
  // `"\"yo\""`, and each round added another layer.
  it('shows the value, not its JSON encoding', () => {
    cleanup();
    const encoded = accessoryFor('virtual_text');
    encoded.services[0].characteristics[0].value = JSON.stringify('how are you');

    render(
      <VirtualAccessoryWidget
        {...({
          accessory: encoded,
          getEffectiveValue: (_i: string, _c: string, v: unknown) => v,
          onSetValue: () => {},
          onSlider: () => {},
          onToggle: () => {},
        } as unknown as WidgetProps)}
      />,
    );

    expect((screen.getByLabelText('Set Test Value') as HTMLInputElement).value)
      .toBe('how are you');
  });

  it('treats a JSON-encoded "active" as a running timer', () => {
    cleanup();
    const encoded = accessoryFor('virtual_timer');
    encoded.services[0].characteristics[0].value = JSON.stringify('active');

    render(
      <VirtualAccessoryWidget
        {...({
          accessory: encoded,
          getEffectiveValue: (_i: string, _c: string, v: unknown) => v,
          onSetValue: () => {},
          onSlider: () => {},
          onToggle: () => {},
        } as unknown as WidgetProps)}
      />,
    );

    expect(screen.getByLabelText('Cancel Test Value')).toBeTruthy();
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

  // A native date input is drawn by the platform: WebKit on Mac Catalyst gave
  // back `31 Jul 2026 at 15:25` where Chrome gave `31/07/2026, 15:25`, and no
  // CSS reaches inside either. The segments are ours now, so the definition
  // decides which of them exist rather than which `type` attribute is set.
  it('offers the date-time segments the definition actually needs', () => {
    const cases: [Record<string, unknown>, string[]][] = [
      [{ virtualHasDate: true, virtualHasTime: true }, ['Day', 'Month', 'Year', 'Hour', 'Minute']],
      [{ virtualHasDate: true, virtualHasTime: false }, ['Day', 'Month', 'Year']],
      [{ virtualHasDate: false, virtualHasTime: true }, ['Hour', 'Minute']],
    ];

    for (const [extra, expected] of cases) {
      cleanup();
      renderWidget('virtual_datetime', extra);
      const shown = ['Day', 'Month', 'Year', 'Hour', 'Minute'].filter(s => screen.queryByLabelText(s));
      expect(shown.sort()).toEqual([...expected].sort());
    }
  });

  it('writes a whole date-time only once every segment is filled', () => {
    const writes = renderWidget('virtual_datetime', { virtualHasDate: true, virtualHasTime: true });

    fireEvent.change(screen.getByLabelText('Day'), { target: { value: '31' } });
    fireEvent.change(screen.getByLabelText('Month'), { target: { value: '7' } });
    fireEvent.change(screen.getByLabelText('Year'), { target: { value: '2026' } });
    // A half-typed date must never reach the relay — a write here would set the
    // value to a day the user never chose.
    expect(writes).toEqual([]);

    fireEvent.change(screen.getByLabelText('Hour'), { target: { value: '15' } });
    fireEvent.change(screen.getByLabelText('Minute'), { target: { value: '25' } });
    fireEvent.keyDown(screen.getByLabelText('Minute'), { key: 'Enter' });

    expect(writes).toEqual([['va-1', 'virtual_datetime', '2026-07-31T15:25']]);
  });

  it('keeps the storage format each date-time shape had before', () => {
    cleanup();
    const dateOnly = renderWidget('virtual_datetime', { virtualHasDate: true, virtualHasTime: false });
    fireEvent.change(screen.getByLabelText('Day'), { target: { value: '01' } });
    fireEvent.change(screen.getByLabelText('Month'), { target: { value: '02' } });
    fireEvent.change(screen.getByLabelText('Year'), { target: { value: '2026' } });
    fireEvent.keyDown(screen.getByLabelText('Year'), { key: 'Enter' });
    expect(dateOnly).toEqual([['va-1', 'virtual_datetime', '2026-02-01']]);

    cleanup();
    const timeOnly = renderWidget('virtual_datetime', { virtualHasDate: false, virtualHasTime: true });
    fireEvent.change(screen.getByLabelText('Hour'), { target: { value: '09' } });
    fireEvent.change(screen.getByLabelText('Minute'), { target: { value: '05' } });
    fireEvent.keyDown(screen.getByLabelText('Minute'), { key: 'Enter' });
    expect(timeOnly).toEqual([['va-1', 'virtual_datetime', '09:05']]);
  });

  it('shows a stored date-time in the segments it was saved from', () => {
    cleanup();
    const saved = accessoryFor('virtual_datetime');
    saved.services[0].characteristics[0].value = '2026-07-31T15:25';

    render(
      <VirtualAccessoryWidget
        {...({
          accessory: { ...saved, virtualHasDate: true, virtualHasTime: true },
          getEffectiveValue: (_i: string, _c: string, v: unknown) => v,
          onSetValue: () => {},
          onSlider: () => {},
          onToggle: () => {},
        } as unknown as WidgetProps)}
      />,
    );

    expect((screen.getByLabelText('Day') as HTMLInputElement).value).toBe('31');
    expect((screen.getByLabelText('Month') as HTMLInputElement).value).toBe('07');
    expect((screen.getByLabelText('Year') as HTMLInputElement).value).toBe('2026');
    expect((screen.getByLabelText('Hour') as HTMLInputElement).value).toBe('15');
    expect((screen.getByLabelText('Minute') as HTMLInputElement).value).toBe('25');
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
          accessory: { ...running, id: 'timer-ends', virtualEndsAt: Date.now() + 125_000, virtualDurationMs: 300_000 },
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

  // A compact tile is a glance. A text field or a date picker crammed into that
  // row dominated it and read as a stray white box sitting on the glass — so
  // the control belongs to the expanded body, and the compact tile keeps only
  // the value.
  it('keeps controls out of the compact tile', () => {
    cleanup();
    const props = {
      accessory: accessoryFor('virtual_text'),
      getEffectiveValue: (_i: string, _c: string, v: unknown) => v,
      onSetValue: () => {},
      onSlider: () => {},
      onToggle: () => {},
      compact: true,
    } as unknown as WidgetProps;
    render(<VirtualAccessoryWidget {...props} />);

    expect(screen.queryByLabelText('Set Test Value')).toBeNull();
    // ...but it still says what it holds.
    expect(screen.getByText('Test Value')).toBeTruthy();
  });

  // The tile collapses when the pointer leaves it, which unmounts the field.
  // `blur` does not fire on unmount, so anything typed and not yet confirmed
  // simply disappeared — you edited the text and nothing happened.
  it('commits a half-typed value if the field is torn down', () => {
    cleanup();
    const writes: unknown[][] = [];
    const props = {
      accessory: accessoryFor('virtual_text'),
      getEffectiveValue: (_i: string, _c: string, v: unknown) => v,
      onSetValue: (...args: unknown[]) => { writes.push(args); },
      onSlider: () => {},
      onToggle: () => {},
    } as unknown as WidgetProps;
    const { unmount } = render(<VirtualAccessoryWidget {...props} />);

    fireEvent.change(screen.getByLabelText('Set Test Value'), { target: { value: 'back monday' } });
    unmount();

    expect(writes).toEqual([['va-1', 'virtual_text', 'back monday']]);
  });

  // Clicking + forty times to reach 40 is not a control, so a number can be
  // configured to offer a field instead of a stepper.
  it('offers a stepper or a field for a number, as configured', () => {
    cleanup();
    renderWidget('virtual_number');
    expect(screen.getByLabelText('Increase Test Value')).toBeTruthy();
    expect(screen.queryByLabelText('Set Test Value')).toBeNull();

    cleanup();
    const writes = renderWidget('virtual_number', { virtualControl: 'field' });
    expect(screen.queryByLabelText('Increase Test Value')).toBeNull();

    const input = screen.getByLabelText('Set Test Value');
    fireEvent.change(input, { target: { value: '40' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(writes).toEqual([['va-1', 'virtual_number', 40]]);
  });

  it('never writes a number for a box left empty or half-typed', () => {
    cleanup();
    const writes = renderWidget('virtual_number', { virtualControl: 'field' });
    const input = screen.getByLabelText('Set Test Value');

    for (const value of ['', '-', 'abc']) {
      fireEvent.change(input, { target: { value } });
      fireEvent.keyDown(input, { key: 'Enter' });
    }

    expect(writes).toEqual([]);
  });

  // Pressing start updates the tile optimistically, but the remaining time it
  // holds was read while the timer was idle — zero. It read 0:00 on start.
  it('counts a just-started timer down from its configured duration', () => {
    cleanup();
    const started = accessoryFor('virtual_timer');
    started.services[0].characteristics[0].value = 'active';

    render(
      <VirtualAccessoryWidget
        {...({
          // No endsAt — exactly what the relay reports the instant you press
          // start, and what an older relay bundle reports always.
          accessory: { ...started, id: 'timer-optimistic', virtualDurationMs: 300_000 },
          getEffectiveValue: (_i: string, _c: string, v: unknown) => v,
          onSetValue: () => {},
          onSlider: () => {},
          onToggle: () => {},
        } as unknown as WidgetProps)}
      />,
    );

    expect(screen.getByText('5:00 left')).toBeTruthy();
  });

  // The countdown is anchored to when the timer ENDS, not to how much was left
  // when someone last looked. A span is only true at the instant it was
  // measured, and the accessory list is fetched minutes apart — so an end that
  // has been sitting in a cache for a while still reads correctly.
  it('reads a cached end time correctly however old it is', () => {
    cleanup();
    const running = accessoryFor('virtual_timer');
    running.services[0].characteristics[0].value = 'active';

    render(
      <VirtualAccessoryWidget
        {...({
          accessory: {
            ...running,
            id: 'timer-cached',
            virtualEndsAt: Date.now() + 90_000,
            // A remaining span from when the list was fetched, long stale, and
            // deliberately disagreeing. The end time is what counts.
            virtualRemainingMs: 300_000,
            virtualDurationMs: 300_000,
          },
          getEffectiveValue: (_i: string, _c: string, v: unknown) => v,
          onSetValue: () => {},
          onSlider: () => {},
          onToggle: () => {},
        } as unknown as WidgetProps)}
      />,
    );

    expect(screen.getByText('1:30 left')).toBeTruthy();
  });

  // The compact tile and the expanded tile are separate instances of this
  // widget rendering the same accessory. With the anchor held per instance,
  // expanding a timer that had been counting down for two minutes pinned a
  // fresh end and restarted it at five.
  it('does not restart the countdown when a second tile mounts', () => {
    cleanup();
    vi.useFakeTimers();
    try {
      const running = accessoryFor('virtual_timer');
      running.services[0].characteristics[0].value = 'active';
      // No endsAt — the relay hasn't reported one, so the end is pinned locally.
      const props = {
        accessory: { ...running, id: 'timer-two-tiles', virtualDurationMs: 300_000 },
        getEffectiveValue: (_i: string, _c: string, v: unknown) => v,
        onSetValue: () => {},
        onSlider: () => {},
        onToggle: () => {},
      } as unknown as WidgetProps;

      const first = render(<VirtualAccessoryWidget {...props} />);
      expect(screen.getByText('5:00 left')).toBeTruthy();

      vi.advanceTimersByTime(60_000);
      first.unmount();

      // A second tile for the same accessory, mounted a minute later.
      render(<VirtualAccessoryWidget {...props} />);
      expect(screen.getByText('4:00 left')).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });

  // The whole point of start-plus-duration: it is two facts that don't decay,
  // so a tile mounted at any moment computes the same answer. A remaining span
  // could only ever be right at the instant it was measured.
  it('reads the same remaining time whenever a tile renders', () => {
    cleanup();
    vi.useFakeTimers();
    try {
      const running = accessoryFor('virtual_timer');
      running.services[0].characteristics[0].value = 'active';
      const startedAt = Date.now();
      const props = {
        accessory: {
          ...running, id: 'timer-derived', virtualStartedAt: startedAt, virtualDurationMs: 300_000,
        },
        getEffectiveValue: (_i: string, _c: string, v: unknown) => v,
        onSetValue: () => {},
        onSlider: () => {},
        onToggle: () => {},
      } as unknown as WidgetProps;

      for (const [advance, expected] of [[0, '5:00 left'], [90_000, '3:30 left'], [180_000, '2:00 left']] as const) {
        cleanup();
        vi.setSystemTime(startedAt + advance);
        render(<VirtualAccessoryWidget {...props} />);
        expect(screen.getByText(expected)).toBeTruthy();
      }
    } finally {
      vi.useRealTimers();
    }
  });

  it('offers nothing when the accessory is not user-editable', () => {
    cleanup();
    renderWidget('virtual_text', { isUserEditable: false });

    expect(screen.queryByLabelText('Set Test Value')).toBeNull();
  });
});
