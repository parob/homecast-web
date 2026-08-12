// @vitest-environment jsdom
//
// A timer must read the same in the MQTT browser as it does on the dashboard.
//
// The browser deliberately renders the real widget from a synthetic accessory
// built out of the flat MQTT payload, so any field the bridge does not publish
// — or the adapter does not map — shows up as a tile that says less than the
// dashboard's does. This pins the readout of both against one another.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { VirtualAccessoryWidget } from '@/components/widgets/VirtualAccessoryWidget';
import { AccessoryWidget } from '@/components/widgets/AccessoryWidget';
import { mqttToAccessory } from '../widget-adapter';
import type { WidgetProps } from '@/components/widgets/types';

vi.mock('@/lib/config', () => ({
  isCommunity: false,
  getCommunityMode: () => null,
  isRelayMode: () => false,
  isClientMode: () => false,
  isRelaySetupComplete: () => false,
  config: { isCommunity: false, apiBase: 'https://api.test', graphqlUrl: 'https://api.test/', wsUrl: 'wss://api.test/ws' },
}));

if (!window.matchMedia) {
  window.matchMedia = ((q: string) => ({
    matches: false, media: q, onchange: null,
    addEventListener: () => {}, removeEventListener: () => {},
    addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

const STARTED = 1_760_000_000_000;
const DURATION = 300_000;

/** What the relay hands the dashboard through accessories.list. */
function relayAccessory(extra: Record<string, unknown>) {
  return {
    id: 'timer-1',
    name: 'Porch Cooldown',
    category: 'Other',
    isReachable: true,
    isVirtual: true,
    virtualType: 'timer',
    isUserEditable: true,
    services: [{
      id: 'timer-1:svc',
      name: 'Porch Cooldown',
      serviceType: 'virtual',
      characteristics: [{
        id: 'timer-1:virtual_timer',
        characteristicType: 'virtual_timer',
        value: extra.virtualTimerState ?? 'idle',
        isReadable: true,
        isWritable: true,
      }],
    }],
    ...extra,
  };
}

/**
 * `viaDispatcher` renders the way the MQTT inspector does — through
 * AccessoryWidget, which chooses the component from the accessory's service
 * types. The dashboard reaches VirtualAccessoryWidget the same way, but the
 * synthetic accessory is shaped by the adapter rather than the relay, so the
 * choice is worth making explicit rather than assumed.
 */
function readoutOf(accessory: unknown, viaDispatcher = false): string {
  cleanup();
  const W = viaDispatcher ? AccessoryWidget : VirtualAccessoryWidget;
  render(<W {...({
    accessory,
    getEffectiveValue: (_i: string, _c: string, v: unknown) => v,
    onSetValue: () => {},
    onSlider: () => {},
    onToggle: () => {},
  } as unknown as WidgetProps)} />);
  return document.body.textContent || '';
}

describe('timer parity: MQTT browser vs dashboard', () => {
  afterEach(cleanup);

  it('shows the same running countdown from either source', () => {
    const running = {
      virtualTimerState: 'active',
      virtualStartedAt: STARTED,
      virtualEndsAt: STARTED + DURATION,
      virtualDurationMs: DURATION,
    };
    const fromRelay = readoutOf(relayAccessory(running));

    // Exactly what the cloud bridge publishes for a running timer.
    const adapted = mqttToAccessory(
      'homecast/county-hall-2d10/porch/porch-cooldown-2c12',
      JSON.stringify({
        timer: 'active',
        timer_started_at: STARTED,
        timer_ends_at: STARTED + DURATION,
        timer_duration_ms: DURATION,
      }),
      true,
    );
    expect(adapted).toBeTruthy();
    const fromMqtt = readoutOf(adapted!.accessory, true);

    expect(fromMqtt).toBe(fromRelay);
  });

  it('shows the same idle timer from either source', () => {
    // Idle publishes no instants — the relay sends none either, because there
    // is no run to describe. Both should still say how long it runs for.
    const fromRelay = readoutOf(relayAccessory({
      virtualTimerState: 'idle',
      virtualDurationMs: DURATION,
    }));

    const adapted = mqttToAccessory(
      'homecast/county-hall-2d10/porch/porch-cooldown-2c12',
      JSON.stringify({ timer: 'idle', timer_duration_ms: DURATION }),
      true,
    );
    const fromMqtt = readoutOf(adapted!.accessory, true);

    expect(fromMqtt).toBe(fromRelay);
  });

  it('shows the same finished timer from either source', () => {
    const fromRelay = readoutOf(relayAccessory({
      virtualTimerState: 'idle',
      virtualDurationMs: DURATION,
      virtualFinishedAt: STARTED + DURATION,
    }));

    const adapted = mqttToAccessory(
      'homecast/county-hall-2d10/porch/porch-cooldown-2c12',
      JSON.stringify({
        timer: 'idle',
        timer_duration_ms: DURATION,
        timer_finished_at: STARTED + DURATION,
      }),
      true,
    );
    const fromMqtt = readoutOf(adapted!.accessory, true);

    expect(fromMqtt).toBe(fromRelay);
  });
});

describe('a finish instant that was never stamped', () => {
  afterEach(cleanup);

  it('derives the last run from an end instant that has passed', () => {
    // What a retained MQTT payload looks like for a run that ended while
    // nothing was watching: the instants describe the run, but no source ever
    // recorded a separate "finished at".
    const ended = Date.now() - 60_000;
    const adapted = mqttToAccessory(
      'homecast/county-hall-2d10/porch/porch-cooldown-2c12',
      JSON.stringify({
        timer: 'idle',
        timer_started_at: ended - DURATION,
        timer_ends_at: ended,
        timer_duration_ms: DURATION,
      }),
      true,
    );

    // Identical to the same timer reporting the finish outright.
    const explicit = readoutOf(relayAccessory({
      virtualTimerState: 'idle',
      virtualDurationMs: DURATION,
      virtualFinishedAt: ended,
    }));

    expect(readoutOf(adapted!.accessory, true)).toBe(explicit);
  });

  it('does not read a running countdown as already finished', () => {
    // endsAt is in the future here — it describes what is happening, not what
    // happened, and must not be mistaken for a previous run.
    const adapted = mqttToAccessory(
      'homecast/county-hall-2d10/porch/porch-cooldown-2c12',
      JSON.stringify({
        timer: 'active',
        timer_started_at: Date.now(),
        timer_ends_at: Date.now() + DURATION,
        timer_duration_ms: DURATION,
      }),
      true,
    );

    expect(readoutOf(adapted!.accessory, true)).not.toMatch(/Time’s up/);
  });
});
