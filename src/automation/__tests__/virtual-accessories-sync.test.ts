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
import { VirtualAccessoryManager } from '../state/VirtualAccessoryManager';
import type { VirtualAccessoryDefinition } from '../types/automation';

function mode(name = 'Home Mode', options = ['Home', 'Away']): VirtualAccessoryDefinition {
  return { id: 'mode', name, homeId: 'H', type: 'input_select', options, initialValue: options[0] };
}
function counter(step = 1): VirtualAccessoryDefinition {
  return { id: 'count', name: 'Door Opens', homeId: 'H', type: 'counter', initial: 0, step };
}
function timer(minutes = 5): VirtualAccessoryDefinition {
  return { id: 'timer', name: 'Cooldown', homeId: 'H', type: 'timer', duration: { minutes } };
}

describe('VirtualAccessoryManager.replaceAll', () => {
  let store: StateStore;
  let manager: VirtualAccessoryManager;
  let events: Array<[string, unknown]>;

  beforeEach(() => {
    store = new StateStore();
    events = [];
    manager = new VirtualAccessoryManager(store, (t, d) => events.push([t, d]), () => {});
  });

  it('keeps the value of a helper the sync did not change', () => {
    manager.replaceAll([mode(), counter()]);
    manager.selectOption('mode', 'Away');
    manager.incrementCounter('count');

    // An unrelated edit elsewhere re-sends the whole set.
    manager.replaceAll([mode(), counter()]);

    expect(store.getVirtualState('mode')).toBe('Away');
    expect(store.getVirtualState('count')).toBe(1);
  });

  it('keeps the value when the definition itself changed', () => {
    manager.replaceAll([counter(1)]);
    manager.incrementCounter('count');
    manager.incrementCounter('count');
    expect(store.getVirtualState('count')).toBe(2);

    manager.replaceAll([counter(5)]);  // step edited

    expect(store.getVirtualState('count')).toBe(2);
    manager.incrementCounter('count');
    expect(store.getVirtualState('count')).toBe(7);  // new step applied
  });

  it('removes a helper that is absent from the set', () => {
    manager.replaceAll([mode(), counter()]);
    manager.replaceAll([mode()]);

    expect(manager.getVirtualAccessory('count')).toBeUndefined();
    expect(manager.getAllVirtualAccessories().map(h => h.id)).toEqual(['mode']);
  });

  it('does not disturb a running timer when nothing about it changed', () => {
    vi.useFakeTimers();
    try {
      manager.replaceAll([timer()]);
      manager.startTimer('timer');
      expect(store.getVirtualState('timer')).toBe('active');

      events.length = 0;
      manager.replaceAll([timer()]);

      expect(store.getVirtualState('timer')).toBe('active');
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
      expect(store.getVirtualState('timer')).toBe('idle');

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

    expect(store.getVirtualState('mode')).toBe('Away');  // survivor
    expect(store.getVirtualState('count')).toBe(0);      // newcomer
  });
});

describe('VirtualAccessoryManager.apply', () => {
  let store: StateStore;
  let manager: VirtualAccessoryManager;

  beforeEach(() => {
    store = new StateStore();
    manager = new VirtualAccessoryManager(store, () => {}, () => {});
    manager.replaceAll([
      mode(), counter(),
      { id: 'flag', name: 'Guest', homeId: 'H', type: 'input_boolean', initialValue: false },
    ]);
  });

  it('routes every operation to the same place an automation action would', () => {
    manager.apply('flag', 'turn_on');
    expect(store.getVirtualState('flag')).toBe(true);

    manager.apply('flag', 'toggle');
    expect(store.getVirtualState('flag')).toBe(false);

    manager.apply('mode', 'set', { value: 'Away' });
    expect(store.getVirtualState('mode')).toBe('Away');

    manager.apply('count', 'increment');
    expect(store.getVirtualState('count')).toBe(1);

    manager.apply('count', 'reset');
    expect(store.getVirtualState('count')).toBe(0);
  });

  it('throws on an operation nobody wired up, rather than accepting it silently', () => {
    expect(() => manager.apply('flag', 'levitate' as never)).toThrow(/Unknown helper operation/);
  });

  it('reports every registered helper, including ones never touched', () => {
    expect(Object.keys(manager.getAllStates()).sort()).toEqual(['count', 'flag', 'mode']);
  });
});
