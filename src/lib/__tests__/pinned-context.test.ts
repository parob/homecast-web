import { describe, it, expect } from 'vitest';
import { pinnedContextLabel } from '../pinned-context';

describe('pinnedContextLabel', () => {
  it('names the home and the room for an accessory', () => {
    expect(pinnedContextLabel({ homeName: 'Beach House', roomNames: ['Kitchen'] }))
      .toBe('Beach House · Kitchen');
  });

  it('counts rooms rather than listing them when a group spans several', () => {
    expect(pinnedContextLabel({ homeName: 'Beach House', roomNames: ['Kitchen', 'Hall', 'Study'] }))
      .toBe('Beach House · 3 rooms');
  });

  it('names the room once when every member of a group is in it', () => {
    expect(pinnedContextLabel({ homeName: 'Beach House', roomNames: ['Kitchen', 'Kitchen'] }))
      .toBe('Beach House · Kitchen');
  });

  // A roomless group is a real shape, not missing data.
  it('falls back to the home alone when nothing has a room', () => {
    expect(pinnedContextLabel({ homeName: 'Beach House', roomNames: [] })).toBe('Beach House');
    expect(pinnedContextLabel({ homeName: 'Beach House', roomNames: [undefined] })).toBe('Beach House');
  });

  it('shows the room alone when the home has not resolved yet', () => {
    expect(pinnedContextLabel({ roomNames: ['Kitchen'] })).toBe('Kitchen');
  });

  /** A blank line above a control looks like a bug, so say nothing instead. */
  it('says nothing when there is nothing to say', () => {
    expect(pinnedContextLabel({})).toBeUndefined();
    expect(pinnedContextLabel({ homeName: '   ', roomNames: ['  '] })).toBeUndefined();
  });
});
