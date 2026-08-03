/**
 * Virtual accessory definition sync — the path that decides whether a helper a user
 * created actually exists in the running engine.
 *
 * The failure this guards against is specific: one stored in the database
 * and absent from the engine looks completely correct in the UI, and every
 * automation referencing it resolves to nothing and quietly does nothing. So
 * these tests are about what survives a sync, not about what a sync stores.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { StateStore } from '../state/StateStore';
import { HelperManager } from '../state/HelperManager';
import type { HelperDefinition } from '../types/automation';

function mode(name = 'Home Mode', options = ['Home', 'Away']): HelperDefinition {
  return { id: 'mode', name, homeId: 'H', type: 'input_select', options, initialValue: options[0] };
}
function counter(step = 1): HelperDefinition {
  return { id: 'count', name: 'Door Opens', homeId: 'H', type: 'counter', initial: 0, step };
}
function timer(minutes = 5): HelperDefinition {
  return { id: 'timer', name: 'Cooldown', homeId: 'H', type: 'timer', duration: { minutes } };
}

describe('HelperManager.replaceAll', () => {
  let store: StateStore;
  let manager: HelperManager;
  let events: Array<[string, unknown]>;

  beforeEach(() => {
    store = new StateStore();
    events = [];
    manager = new HelperManager(store, (t, d) => events.push([t, d]), () => {});
  });

  it('keeps the value of a helper the sync did not change', () => {
    manager.replaceAll([mode(), counter()]);
    manager.selectOption('mode', 'Away');
    manager.incrementCounter('count');

    // An unrelated edit elsewhere re-sends the whole set.
    manager.replaceAll([mode(), counter()]);

    expect(store.getHelperState('mode')).toBe('Away');
    expect(store.getHelperState('count')).toBe(1);
  });

  it('keeps the value when the definition itself changed', () => {
    manager.replaceAll([counter(1)]);
    manager.incrementCounter('count');
    manager.incrementCounter('count');
    expect(store.getHelperState('count')).toBe(2);

    manager.replaceAll([counter(5)]);  // step edited

    expect(store.getHelperState('count')).toBe(2);
    manager.incrementCounter('count');
    expect(store.getHelperState('count')).toBe(7);  // new step applied
  });

  it('removes a helper that is absent from the set', () => {
    manager.replaceAll([mode(), counter()]);
    manager.replaceAll([mode()]);

    expect(manager.getHelper('count')).toBeUndefined();
    expect(manager.getAllHelpers().map(h => h.id)).toEqual(['mode']);
  });

  it('does not disturb a running timer when nothing about it changed', () => {
    vi.useFakeTimers();
    try {
      manager.replaceAll([timer()]);
      manager.startTimer('timer');
      expect(store.getHelperState('timer')).toBe('active');

      events.length = 0;
      manager.replaceAll([timer()]);

      expect(store.getHelperState('timer')).toBe('active');
      expect(events.map(([t]) => t)).not.toContain('timer.cancelled');
    } finally {
      vi.useRealTimers();
    }
  });

  it('cancels a running timer whose duration was edited, rather than leaving it orphaned', () => {
    vi.useFakeTimers();
    try {
      manager.replaceAll([timer(5)]);
      manager.startTimer('timer');

      manager.replaceAll([timer(10)]);
      expect(store.getHelperState('timer')).toBe('idle');

      // The old countdown must not still fire — that was the bug re-registering
      // over the top of a live timeout would have caused.
      events.length = 0;
      vi.advanceTimersByTime(10 * 60_000);
      expect(events.map(([t]) => t)).not.toContain('timer.finished');
    } finally {
      vi.useRealTimers();
    }
  });

  it('gives a brand-new helper its initial value', () => {
    manager.replaceAll([mode()]);
    manager.selectOption('mode', 'Away');
    manager.replaceAll([mode(), counter()]);

    expect(store.getHelperState('mode')).toBe('Away');  // survivor
    expect(store.getHelperState('count')).toBe(0);      // newcomer
  });
});

describe('HelperManager.apply', () => {
  let store: StateStore;
  let manager: HelperManager;

  beforeEach(() => {
    store = new StateStore();
    manager = new HelperManager(store, () => {}, () => {});
    manager.replaceAll([
      mode(), counter(),
      { id: 'flag', name: 'Guest', homeId: 'H', type: 'input_boolean', initialValue: false },
    ]);
  });

  it('routes every operation to the same place an automation action would', () => {
    manager.apply('flag', 'turn_on');
    expect(store.getHelperState('flag')).toBe(true);

    manager.apply('flag', 'toggle');
    expect(store.getHelperState('flag')).toBe(false);

    manager.apply('mode', 'set', { value: 'Away' });
    expect(store.getHelperState('mode')).toBe('Away');

    manager.apply('count', 'increment');
    expect(store.getHelperState('count')).toBe(1);

    manager.apply('count', 'reset');
    expect(store.getHelperState('count')).toBe(0);
  });

  it('throws on an operation nobody wired up, rather than accepting it silently', () => {
    expect(() => manager.apply('flag', 'levitate' as never)).toThrow(/Unknown helper operation/);
  });

  it('reports every registered helper, including ones never touched', () => {
    expect(Object.keys(manager.getAllStates()).sort()).toEqual(['count', 'flag', 'mode']);
  });
});
