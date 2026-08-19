import { beforeEach, describe, expect, it } from 'vitest';

// This environment's localStorage is a partial stub with no methods, so install
// a real one rather than testing against a shape no browser has. Same approach
// as lib/__tests__/notice-dismissal.test.ts.
const store = new Map<string, string>();
Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => { store.set(k, String(v)); },
    removeItem: (k: string) => { store.delete(k); },
    clear: () => { store.clear(); },
    key: (i: number) => Array.from(store.keys())[i] ?? null,
    get length() { return store.size; },
  },
});

import {
  CONSENT_KEY,
  MIRROR_KEY,
  activityLoggingEnabled,
  readActivityLoggingInputs,
  resetActivityLoggingCache,
  setActivityLoggingFlags,
  shouldSendActivityLogs,
} from '../activity-logging';

const ALL_ON = { consent: 'granted', developerMode: true, sendActivityLogs: true };

describe('shouldSendActivityLogs', () => {
  it('allows only when all three switches are on', () => {
    expect(shouldSendActivityLogs(ALL_ON)).toBe(true);
  });

  it.each([
    ['analytics declined', { ...ALL_ON, consent: 'denied' }],
    ['analytics never answered', { ...ALL_ON, consent: null }],
    ['developer mode off', { ...ALL_ON, developerMode: false }],
    ['the setting itself off', { ...ALL_ON, sendActivityLogs: false }],
  ])('refuses when %s', (_label, inputs) => {
    expect(shouldSendActivityLogs(inputs)).toBe(false);
  });

  it('requires consent to be exactly "granted"', () => {
    // The GA snippet compares against this literal; anything else is not consent.
    expect(shouldSendActivityLogs({ ...ALL_ON, consent: 'true' })).toBe(false);
    expect(shouldSendActivityLogs({ ...ALL_ON, consent: 'GRANTED' })).toBe(false);
  });

  it('defaults to off with nothing configured', () => {
    expect(shouldSendActivityLogs({
      consent: null, developerMode: false, sendActivityLogs: false,
    })).toBe(false);
  });
});

describe('readActivityLoggingInputs', () => {
  beforeEach(() => {
    localStorage.clear();
    resetActivityLoggingCache();
  });

  it('combines consent with the pushed settings', () => {
    localStorage.setItem(CONSENT_KEY, 'granted');
    setActivityLoggingFlags({ developerMode: true, sendActivityLogs: true });
    expect(readActivityLoggingInputs()).toEqual(ALL_ON);
    expect(activityLoggingEnabled()).toBe(true);
  });

  it('treats a corrupt mirror as off, never as on', () => {
    // Failing open here would ship spans from someone who never agreed to it.
    localStorage.setItem(CONSENT_KEY, 'granted');
    localStorage.setItem(MIRROR_KEY, '{not json');
    expect(readActivityLoggingInputs().developerMode).toBe(false);
    expect(activityLoggingEnabled()).toBe(false);
  });

  it('requires the values to be exactly true, not merely truthy', () => {
    localStorage.setItem(CONSENT_KEY, 'granted');
    localStorage.setItem(MIRROR_KEY, JSON.stringify({
      developerMode: 1, sendActivityLogs: 'yes',
    }));
    expect(activityLoggingEnabled()).toBe(false);
  });

  it('defaults to off with nothing pushed and nothing stored', () => {
    expect(readActivityLoggingInputs()).toEqual({
      consent: null, developerMode: false, sendActivityLogs: false,
    });
  });

  it('survives a reload by reading the persisted mirror', () => {
    localStorage.setItem(CONSENT_KEY, 'granted');
    setActivityLoggingFlags({ developerMode: true, sendActivityLogs: true });
    resetActivityLoggingCache(); // as if the page had reloaded
    expect(activityLoggingEnabled()).toBe(true);
  });

  it('applies a change immediately, without waiting for a reload', () => {
    localStorage.setItem(CONSENT_KEY, 'granted');
    setActivityLoggingFlags({ developerMode: true, sendActivityLogs: true });
    expect(activityLoggingEnabled()).toBe(true);

    setActivityLoggingFlags({ developerMode: true, sendActivityLogs: false });
    expect(activityLoggingEnabled()).toBe(false);
  });

  it('still refuses when consent is withdrawn, whatever the settings say', () => {
    setActivityLoggingFlags({ developerMode: true, sendActivityLogs: true });
    localStorage.setItem(CONSENT_KEY, 'denied');
    expect(activityLoggingEnabled()).toBe(false);
  });
});
