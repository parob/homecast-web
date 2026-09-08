import { describe, it, expect } from 'vitest';
import {
  RELAY_DISABLED_KEY,
  clearStorageKeeping,
  readRelayDisabled,
  writeRelayDisabled,
} from '../relay-preference';

/** The Storage contract, in memory: enough to watch what a wipe keeps. */
function fakeStorage(initial: Record<string, string> = {}): Storage {
  const m = new Map(Object.entries(initial));
  return {
    get length() { return m.size; },
    clear: () => m.clear(),
    getItem: (k: string) => (m.has(k) ? m.get(k)! : null),
    key: (i: number) => [...m.keys()][i] ?? null,
    removeItem: (k: string) => { m.delete(k); },
    setItem: (k: string, v: string) => { m.set(k, v); },
  } as Storage;
}

describe('relay preference', () => {
  it('is on by default and off only when explicitly told', () => {
    const s = fakeStorage();
    expect(readRelayDisabled(s)).toBe(false);
    writeRelayDisabled(true, s);
    expect(readRelayDisabled(s)).toBe(true);
    expect(s.getItem(RELAY_DISABLED_KEY)).toBe('true');
    writeRelayDisabled(false, s);
    expect(readRelayDisabled(s)).toBe(false);
    expect(s.getItem(RELAY_DISABLED_KEY)).toBeNull();
  });

  it('survives a wipe, which takes everything else', () => {
    // The three wipes (switch install type, login-page reset, reset and
    // uninstall) used to call localStorage.clear() and silently turned the
    // relay back on. This is the one decision about the machine that must
    // outlive a sign-out.
    const s = fakeStorage({ [RELAY_DISABLED_KEY]: 'true', 'homecast-token': 'x', 'homecast-selected-home': 'y' });
    clearStorageKeeping(s);
    expect(s.length).toBe(1);
    expect(readRelayDisabled(s)).toBe(true);
  });

  it('keeps nothing it was not told to, and copes with an absent key', () => {
    const s = fakeStorage({ 'homecast-token': 'x' });
    clearStorageKeeping(s);
    expect(s.length).toBe(0);
    expect(readRelayDisabled(s)).toBe(false);
  });
});
