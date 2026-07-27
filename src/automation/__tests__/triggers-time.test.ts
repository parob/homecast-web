/**
 * Scheduling coverage for TriggerManager.
 *
 * Roughly 85% of TriggerManager was untested because no automation test used
 * fake timers — including the time/time_pattern/sun paths and
 * `recalculateTimeTriggers()`, which is the fix from "Automation: fix missed
 * time triggers" (0d75350).
 *
 * Sun triggers additionally resolved against lat 0 / lon 0 in production
 * because `setLocation` had no callers; these tests pin the location down.
 */

import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { TriggerManager } from '../engine/TriggerManager';
import { StateStore } from '../state/StateStore';
import { calculateSunTimes, getNextSunEvent, isSunUp } from '../state/SunCalculator';
import type { Trigger, TriggerData } from '../types/automation';

// A fixed, unambiguous instant: 2026-03-15 10:00:00 local.
const NOW = new Date(2026, 2, 15, 10, 0, 0, 0);

// London — far enough from lat 0 / lon 0 that a mis-wired location is obvious.
const LONDON = { latitude: 51.5074, longitude: -0.1278 };

let store: StateStore;
let manager: TriggerManager;
let fired: TriggerData[];

function register(trigger: Trigger, automationId = 'auto-1') {
  manager.registerTriggers(automationId, [trigger], (data) => { fired.push(data); });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  store = new StateStore();
  manager = new TriggerManager(store);
  manager.initialize();
  fired = [];
});

afterEach(() => {
  manager.teardown();
  vi.useRealTimers();
});

describe('time triggers', () => {
  it('fires at the configured time later today', () => {
    register({ id: 't1', type: 'time', at: '10:30' });

    vi.advanceTimersByTime(29 * 60_000);
    expect(fired).toHaveLength(0);

    vi.advanceTimersByTime(60_000);
    expect(fired).toHaveLength(1);
    expect(fired[0].triggerType).toBe('time');
  });

  it('rolls over to tomorrow when the time has already passed', () => {
    register({ id: 't1', type: 'time', at: '09:00' });

    vi.advanceTimersByTime(22 * 60 * 60_000);
    expect(fired).toHaveLength(0);

    vi.advanceTimersByTime(60 * 60_000 + 1000);
    expect(fired).toHaveLength(1);
  });

  it('reschedules itself for the following day', () => {
    register({ id: 't1', type: 'time', at: '10:30' });

    vi.advanceTimersByTime(31 * 60_000);
    expect(fired).toHaveLength(1);

    vi.advanceTimersByTime(24 * 60 * 60_000);
    expect(fired).toHaveLength(2);
  });

  it('honours a weekday filter', () => {
    // NOW is a Sunday (day 0); restrict to Monday only.
    register({ id: 't1', type: 'time', at: '10:30', weekdays: [1] });

    vi.advanceTimersByTime(31 * 60_000);
    expect(fired).toHaveLength(0);

    vi.advanceTimersByTime(24 * 60 * 60_000);
    expect(fired).toHaveLength(1);
  });

  it('supports seconds precision', () => {
    register({ id: 't1', type: 'time', at: '10:00:30' });

    vi.advanceTimersByTime(29_000);
    expect(fired).toHaveLength(0);
    vi.advanceTimersByTime(1_500);
    expect(fired).toHaveLength(1);
  });

  it('stops firing once unregistered', () => {
    register({ id: 't1', type: 'time', at: '10:30' });
    manager.unregisterTriggers('auto-1');

    vi.advanceTimersByTime(2 * 60 * 60_000);
    expect(fired).toHaveLength(0);
  });
});

describe('time_pattern triggers', () => {
  it('fires on a repeating minute interval', () => {
    register({ id: 't1', type: 'time_pattern', minutes: '/5' });

    vi.advanceTimersByTime(5 * 60_000);
    const afterFirst = fired.length;
    expect(afterFirst).toBeGreaterThanOrEqual(1);

    vi.advanceTimersByTime(10 * 60_000);
    expect(fired.length).toBeGreaterThan(afterFirst);
  });

  it('fires on a seconds interval', () => {
    register({ id: 't1', type: 'time_pattern', seconds: '/30' });

    vi.advanceTimersByTime(90_000);
    expect(fired.length).toBeGreaterThanOrEqual(2);
  });

  it('stops on teardown', () => {
    register({ id: 't1', type: 'time_pattern', seconds: '/10' });
    vi.advanceTimersByTime(30_000);
    const before = fired.length;

    manager.teardown();
    vi.advanceTimersByTime(60_000);

    expect(fired.length).toBe(before);
  });
});

describe('recalculateTimeTriggers', () => {
  it('keeps a time trigger scheduled after a clock jump', () => {
    register({ id: 't1', type: 'time', at: '10:30' });

    manager.recalculateTimeTriggers();
    vi.advanceTimersByTime(31 * 60_000);

    expect(fired).toHaveLength(1);
  });

  it('does not double-fire after recalculating', () => {
    register({ id: 't1', type: 'time', at: '10:30' });

    manager.recalculateTimeTriggers();
    manager.recalculateTimeTriggers();
    vi.advanceTimersByTime(31 * 60_000);

    expect(fired).toHaveLength(1);
  });

  it('keeps a time_pattern trigger running', () => {
    register({ id: 't1', type: 'time_pattern', seconds: '/10' });
    manager.recalculateTimeTriggers();

    vi.advanceTimersByTime(30_000);

    expect(fired.length).toBeGreaterThanOrEqual(1);
  });
});

describe('sun triggers', () => {
  it('schedules against the configured location', () => {
    manager.setLocation(LONDON.latitude, LONDON.longitude);
    register({ id: 't1', type: 'sun', event: 'sunset' });

    // London sunset in mid-March is early evening — within 24h of 10:00.
    vi.advanceTimersByTime(24 * 60 * 60_000);

    expect(fired.length).toBeGreaterThanOrEqual(1);
    expect(fired[0].triggerType).toBe('sun');
  });

  it('reschedules already-registered triggers when the location arrives late', () => {
    // Location resolves asynchronously in both editions, so it usually lands
    // after the automations have been registered.
    register({ id: 't1', type: 'sun', event: 'sunrise' });
    manager.setLocation(LONDON.latitude, LONDON.longitude);

    vi.advanceTimersByTime(24 * 60 * 60_000);

    expect(fired.length).toBeGreaterThanOrEqual(1);
  });

  it('is cleared by unregistering', () => {
    manager.setLocation(LONDON.latitude, LONDON.longitude);
    register({ id: 't1', type: 'sun', event: 'sunrise' });
    manager.unregisterTriggers('auto-1');

    vi.advanceTimersByTime(48 * 60 * 60_000);

    expect(fired).toHaveLength(0);
  });
});

describe('event and system triggers', () => {
  it('fires an event trigger for a matching event type', () => {
    register({ id: 't1', type: 'event', eventType: 'doorbell.pressed' });

    manager.handleEvent('doorbell.pressed', { source: 'front' });

    expect(fired).toHaveLength(1);
  });

  it('ignores a non-matching event type', () => {
    register({ id: 't1', type: 'event', eventType: 'doorbell.pressed' });

    manager.handleEvent('doorbell.released');

    expect(fired).toHaveLength(0);
  });

  it('fires a system trigger via its namespaced event', () => {
    register({ id: 't1', type: 'system', event: 'relay_connected' });

    manager.handleEvent('system.relay_connected');

    expect(fired).toHaveLength(1);
  });

  it('fires a webhook trigger via its namespaced event', () => {
    register({ id: 't1', type: 'webhook', webhookId: 'hook-123' });

    manager.handleEvent('webhook.hook-123', { body: { ok: true } });

    expect(fired).toHaveLength(1);
  });
});

describe('template triggers', () => {
  it('fires when the expression flips to true', () => {
    store.updateDeviceState('sensor-1', 'temperature', 18);
    register({ id: 't1', type: 'template', expression: "states('sensor-1', 'temperature') > 20" });

    store.updateDeviceState('sensor-1', 'temperature', 25);

    expect(fired).toHaveLength(1);
  });

  it('does not re-fire while the expression stays true', () => {
    store.updateDeviceState('sensor-1', 'temperature', 18);
    register({ id: 't1', type: 'template', expression: "states('sensor-1', 'temperature') > 20" });

    store.updateDeviceState('sensor-1', 'temperature', 25);
    store.updateDeviceState('sensor-1', 'temperature', 30);

    expect(fired).toHaveLength(1);
  });
});

describe('SunCalculator', () => {
  it('puts London sunrise before sunset', () => {
    const times = calculateSunTimes(NOW, LONDON.latitude, LONDON.longitude);

    expect(times.sunrise.getTime()).toBeLessThan(times.sunset.getTime());
  });

  it('gives different times for different locations', () => {
    const london = calculateSunTimes(NOW, LONDON.latitude, LONDON.longitude);
    const gulfOfGuinea = calculateSunTimes(NOW, 0, 0);

    // If location were ignored these would be identical — the exact bug that
    // shipped while setLocation had no callers. (Mid-March is near the equinox,
    // so the gap is minutes rather than hours; equality is the real signal.)
    expect(london.sunrise.getTime()).not.toBe(gulfOfGuinea.sunrise.getTime());
    expect(Math.abs(london.sunrise.getTime() - gulfOfGuinea.sunrise.getTime())).toBeGreaterThan(60_000);
  });

  it('gives a much longer day in London than at the equator in midsummer', () => {
    const june = new Date(2026, 5, 21, 12, 0, 0);
    const london = calculateSunTimes(june, LONDON.latitude, LONDON.longitude);
    const equator = calculateSunTimes(june, 0, 0);

    const londonDay = london.sunset.getTime() - london.sunrise.getTime();
    const equatorDay = equator.sunset.getTime() - equator.sunrise.getTime();

    expect(londonDay).toBeGreaterThan(equatorDay + 4 * 60 * 60_000);
  });

  // isSunUp/getNextSunEvent read the current clock rather than taking a date,
  // so these rely on the faked system time (10:00 local, 2026-03-15).
  it('reports the sun as up at 10:00 in London', () => {
    expect(isSunUp(LONDON.latitude, LONDON.longitude)).toBe(true);
  });

  it('reports the sun as down at 00:30 in London', () => {
    vi.setSystemTime(new Date(2026, 2, 15, 0, 30, 0));

    expect(isSunUp(LONDON.latitude, LONDON.longitude)).toBe(false);
  });

  it('returns a next sun event in the future', () => {
    const next = getNextSunEvent('sunset', LONDON.latitude, LONDON.longitude);

    expect(next.getTime()).toBeGreaterThan(NOW.getTime());
  });

  it('applies an offset to the next sun event', () => {
    const plain = getNextSunEvent('sunset', LONDON.latitude, LONDON.longitude);
    const offset = getNextSunEvent('sunset', LONDON.latitude, LONDON.longitude, -30 * 60_000);

    expect(plain.getTime() - offset.getTime()).toBe(30 * 60_000);
  });
});

describe('"for" duration on state triggers', () => {
  it('waits the full duration before firing', () => {
    store.updateDeviceState('door-1', 'contact_state', false);
    register({
      id: 't1', type: 'state', accessoryId: 'door-1',
      characteristicType: 'contact_state', to: true, for: { minutes: 5 },
    });

    store.updateDeviceState('door-1', 'contact_state', true);
    vi.advanceTimersByTime(4 * 60_000);
    expect(fired).toHaveLength(0);

    vi.advanceTimersByTime(60_000 + 100);
    expect(fired).toHaveLength(1);
  });

  it('cancels if the value reverts before the duration elapses', () => {
    // "The garage has been open for 5 minutes" must not fire if it was shut
    // after 2 — this is the semantic HomeKit's "turn off after" cannot express.
    store.updateDeviceState('door-1', 'contact_state', false);
    register({
      id: 't1', type: 'state', accessoryId: 'door-1',
      characteristicType: 'contact_state', to: true, for: { minutes: 5 },
    });

    store.updateDeviceState('door-1', 'contact_state', true);
    vi.advanceTimersByTime(2 * 60_000);
    store.updateDeviceState('door-1', 'contact_state', false);

    vi.advanceTimersByTime(10 * 60_000);
    expect(fired).toHaveLength(0);
  });

  it('restarts the wait when the value re-enters the matching state', () => {
    store.updateDeviceState('door-1', 'contact_state', false);
    register({
      id: 't1', type: 'state', accessoryId: 'door-1',
      characteristicType: 'contact_state', to: true, for: { minutes: 5 },
    });

    store.updateDeviceState('door-1', 'contact_state', true);
    vi.advanceTimersByTime(4 * 60_000);
    store.updateDeviceState('door-1', 'contact_state', false);
    store.updateDeviceState('door-1', 'contact_state', true);
    vi.advanceTimersByTime(4 * 60_000);

    expect(fired).toHaveLength(0);
    vi.advanceTimersByTime(60_000 + 100);
    expect(fired).toHaveLength(1);
  });

  it('applies to numeric_state triggers too', () => {
    store.updateDeviceState('freezer', 'temperature', -18);
    register({
      id: 't1', type: 'numeric_state', accessoryId: 'freezer',
      characteristicType: 'temperature', above: -10, for: { minutes: 10 },
    });

    store.updateDeviceState('freezer', 'temperature', -5);
    vi.advanceTimersByTime(9 * 60_000);
    expect(fired).toHaveLength(0);

    vi.advanceTimersByTime(60_000 + 100);
    expect(fired).toHaveLength(1);
  });

  it('does not fire a duration trigger after unregistering', () => {
    store.updateDeviceState('door-1', 'contact_state', false);
    register({
      id: 't1', type: 'state', accessoryId: 'door-1',
      characteristicType: 'contact_state', to: true, for: { minutes: 5 },
    });

    store.updateDeviceState('door-1', 'contact_state', true);
    manager.unregisterTriggers('auto-1');
    vi.advanceTimersByTime(10 * 60_000);

    expect(fired).toHaveLength(0);
  });
});
