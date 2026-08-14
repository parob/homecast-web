import { describe, it, expect, beforeEach } from 'vitest';

// This environment's localStorage is a partial stub (no methods at all), so
// install a real one rather than testing against a shape no browser has.
// Same approach as hooks/__tests__/homekitCachePersistence.test.ts.
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
  dismissTokens,
  isDismissed,
  withDismissal,
  isNoticeDismissed,
  dismissNotice,
  readDismissals,
} from '../notice-dismissal';

describe('dismissTokens', () => {
  it('case-folds so a home id reported uppercase and lowercase is one target', () => {
    const upper = dismissTokens({ id: 'ABCD-1234', name: 'Beach House' });
    const lower = dismissTokens({ id: 'abcd-1234', name: 'beach house' });
    expect(upper).toEqual(lower);
  });

  it('drops empty parts rather than minting a token that matches everything', () => {
    expect(dismissTokens({ id: '', name: '  ' })).toEqual([]);
    expect(dismissTokens({ id: null, name: 'Home' })).toEqual(['name:home']);
  });
});

describe('isDismissed', () => {
  it('matches on any single token — an id that was re-minted still has its name', () => {
    const stored = withDismissal([], dismissTokens({ id: 'OLD-ID', name: 'Beach House' }));
    expect(isDismissed(stored, dismissTokens({ id: 'NEW-ID', name: 'Beach House' }))).toBe(true);
  });

  it('does not match an unrelated home', () => {
    const stored = withDismissal([], dismissTokens({ id: 'A', name: 'Beach House' }));
    expect(isDismissed(stored, dismissTokens({ id: 'B', name: 'County Hall' }))).toBe(false);
  });

  it('is false for an untokenizable target', () => {
    const stored = withDismissal([], dismissTokens({ id: 'A', name: 'Beach House' }));
    expect(isDismissed(stored, dismissTokens({}))).toBe(false);
  });
});

describe('withDismissal', () => {
  it('dedupes rather than growing on every dismissal', () => {
    const tokens = dismissTokens({ id: 'A', name: 'Beach House' });
    expect(withDismissal(withDismissal([], tokens), tokens)).toEqual(tokens);
  });

  it('caps the stored list', () => {
    let stored: string[] = [];
    for (let i = 0; i < 300; i++) stored = withDismissal(stored, [`id:${i}`]);
    expect(stored.length).toBe(200);
    expect(stored).toContain('id:299');
  });
});

describe('storage round trip', () => {
  beforeEach(() => localStorage.clear());

  it('survives an id whose case changed between reads', () => {
    dismissNotice('editrights', { id: 'ABCD', name: 'Beach House' });
    expect(isNoticeDismissed('editrights', { id: 'abcd', name: 'Beach House' })).toBe(true);
  });

  it('keeps notices independent', () => {
    dismissNotice('editrights', { id: 'A', name: 'Beach House' });
    expect(isNoticeDismissed('somethingelse', { id: 'A', name: 'Beach House' })).toBe(false);
  });

  it('honours a dismissal written by the old per-home key', () => {
    localStorage.setItem('hc_editrights_dismissed_ABCD', '1');
    expect(isNoticeDismissed('editrights', { id: 'ABCD', name: 'Beach House' }, ['hc_editrights_dismissed_ABCD'])).toBe(true);
  });

  it('tolerates a corrupt stored value', () => {
    localStorage.setItem('hc_dismissed_editrights', 'not json');
    expect(readDismissals('editrights')).toEqual([]);
    expect(isNoticeDismissed('editrights', { id: 'A', name: 'B' })).toBe(false);
  });
});
