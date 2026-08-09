/**
 * A virtual accessory's value has to survive the relay being rebuilt.
 *
 * Two separate faults lost every value in cloud mode, and together they made
 * the feature look like it simply didn't remember anything:
 *
 *  1. The relay pushed the new value as `automation.helper_state` with an
 *     `accessoryId`, while the server listened for `automation.virtual_state`
 *     with a `helperId` — two mismatches on one message, left behind by the
 *     helper -> virtual accessory rename. Nothing was ever stored.
 *  2. Nothing read a stored value back. `sync_all` rebuilds the whole set, and
 *     a helper being registered fresh took its definition's initial value, so
 *     every reload reset the lot.
 *
 * The first is pinned in AutomationSyncManager's own test; this covers the
 * rebuild, which is where the value is actually kept or lost.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { StateStore } from '../state/StateStore';
import { VirtualAccessoryManager } from '../state/VirtualAccessoryManager';
import type { VirtualAccessoryDefinition } from '../types/automation';

const MODE = {
  id: 'va-mode', name: 'Home Mode', type: 'input_select',
  homeId: 'HOME-1', options: ['Home', 'Away'], initialValue: 'Home',
} as VirtualAccessoryDefinition;

const COUNTER = {
  id: 'va-count', name: 'Counter', type: 'counter', homeId: 'HOME-1', initial: 0,
} as VirtualAccessoryDefinition;

const TIMER = {
  id: 'va-timer', name: 'Timer', type: 'timer', homeId: 'HOME-1',
  duration: { minutes: 5 },
} as VirtualAccessoryDefinition;

let store: StateStore;
let manager: VirtualAccessoryManager;

beforeEach(() => {
  store = new StateStore();
  manager = new VirtualAccessoryManager(store, () => {}, () => {});
});

describe('virtual accessory values across a rebuild', () => {
  it('takes the stored value when meeting a helper for the first time', () => {
    // A relay that has just reloaded: nothing registered yet, and sync_all
    // arrives carrying what the values were.
    manager.replaceAll([MODE, COUNTER], { 'va-mode': 'Away', 'va-count': 12 });

    expect(store.getVirtualState('va-mode')).toBe('Away');
    expect(store.getVirtualState('va-count')).toBe(12);
  });

  it('falls back to the initial value when nothing was stored', () => {
    manager.replaceAll([MODE], {});
    expect(store.getVirtualState('va-mode')).toBe('Home');
  });

  it('does not let a stale stored value overwrite a running helper', () => {
    manager.replaceAll([MODE], { 'va-mode': 'Away' });
    manager.selectOption('va-mode', 'Home');

    // A later sync still carries the older stored value. This engine has been
    // the one changing it, so what it holds is newer.
    manager.replaceAll([MODE], { 'va-mode': 'Away' });

    expect(store.getVirtualState('va-mode')).toBe('Home');
  });

  it('keeps a live value when the definition itself changes', () => {
    manager.replaceAll([MODE], { 'va-mode': 'Away' });
    const renamed = { ...MODE, name: 'House Mode' } as VirtualAccessoryDefinition;

    manager.replaceAll([renamed], { 'va-mode': 'Home' });

    expect(store.getVirtualState('va-mode')).toBe('Away');
  });

  it('never restores a timer — a half-elapsed countdown cannot be trusted', () => {
    manager.replaceAll([TIMER], { 'va-timer': 'active' });
    expect(store.getVirtualState('va-timer')).toBe('idle');
  });

  it('still deletes a helper missing from the set', () => {
    manager.replaceAll([MODE, COUNTER], { 'va-mode': 'Away', 'va-count': 3 });
    manager.replaceAll([MODE], { 'va-mode': 'Away' });

    expect(manager.getVirtualAccessory('va-count')).toBeUndefined();
  });
});
