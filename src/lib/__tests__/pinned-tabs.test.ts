import { describe, it, expect } from 'vitest';
import {
  pinKey,
  samePin,
  pinBehaviour,
  PIN_TYPE_LABELS,
  MAX_PINNED_TABS,
  type PinnedTab,
  type PinnedTabType,
} from '../pinned-tabs';

describe('pinKey', () => {
  it('separates the same action pinned in two homes', () => {
    // The bug the scope segment exists for: action ids are a closed union, not
    // UUIDs, so both of these were `action-everything-off` and unpinning one
    // unpinned the other.
    const a = { type: 'action', id: 'everything-off', homeId: 'HOME-A' } as const;
    const b = { type: 'action', id: 'everything-off', homeId: 'HOME-B' } as const;

    expect(pinKey(a)).not.toBe(pinKey(b));
    expect(samePin(a, b)).toBe(false);
  });

  it('treats the same target as the same pin regardless of the fields pinKey ignores', () => {
    const stored: PinnedTab = {
      type: 'scene', id: 'SCENE-1', homeId: 'HOME-A', name: 'Movie night', customName: 'Movie',
    };
    const target = { type: 'scene', id: 'SCENE-1', homeId: 'HOME-A' } as const;

    expect(samePin(stored, target)).toBe(true);
  });

  it('survives ids containing hyphens', () => {
    // HomeKit UUIDs are hyphenated, which is why the separator is not `-`.
    const uuid = '6E4F1A2B-0C3D-4E5F-8A9B-0C1D2E3F4A5B';
    const key = pinKey({ type: 'accessory', id: uuid, homeId: 'HOME-A' });

    expect(key).toBe(`accessory:HOME-A:${uuid}`);
    expect(key.split(':')).toHaveLength(3);
  });

  it('scopes a collectionGroup by its collection', () => {
    const a = { type: 'collectionGroup', id: 'G1', collectionId: 'C1' } as const;
    const b = { type: 'collectionGroup', id: 'G1', collectionId: 'C2' } as const;

    expect(samePin(a, b)).toBe(false);
  });

  it('keys an unscoped pin without inventing a scope', () => {
    expect(pinKey({ type: 'home', id: 'HOME-A' })).toBe('home::HOME-A');
  });

  it('never collides across types that share an id', () => {
    const id = 'SHARED-ID';
    const keys = (Object.keys(PIN_TYPE_LABELS) as PinnedTabType[])
      .map(type => pinKey({ type, id, homeId: 'HOME-A' }));

    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe('pinBehaviour', () => {
  it('routes each type to exactly one behaviour', () => {
    expect(pinBehaviour('home')).toBe('navigate');
    expect(pinBehaviour('room')).toBe('navigate');
    expect(pinBehaviour('collection')).toBe('navigate');
    expect(pinBehaviour('collectionGroup')).toBe('navigate');
    expect(pinBehaviour('action')).toBe('run');
    expect(pinBehaviour('scene')).toBe('run');
    expect(pinBehaviour('accessory')).toBe('popover');
    expect(pinBehaviour('serviceGroup')).toBe('popover');
  });

  it('classifies every pinnable type', () => {
    for (const type of Object.keys(PIN_TYPE_LABELS) as PinnedTabType[]) {
      expect(['navigate', 'run', 'popover']).toContain(pinBehaviour(type));
    }
  });
});

describe('PIN_TYPE_LABELS', () => {
  it('never shows a raw camelCase union value', () => {
    for (const label of Object.values(PIN_TYPE_LABELS)) {
      expect(label).not.toMatch(/[a-z][A-Z]/);
    }
  });

  it('says accessory, never device', () => {
    for (const label of Object.values(PIN_TYPE_LABELS)) {
      expect(label.toLowerCase()).not.toContain('device');
    }
  });
});

describe('MAX_PINNED_TABS', () => {
  it('is the agreed limit', () => {
    expect(MAX_PINNED_TABS).toBe(5);
  });
});
