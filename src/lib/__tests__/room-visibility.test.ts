import { describe, it, expect } from 'vitest';
import { isRoomHidden, shouldFilterRoomOut, orderRoomsHiddenLast } from '../room-visibility';

const HIDDEN = ['C7577A45-CD64-408E-9D4B-7BC55F899F4F'];
const AUTOMATIONS = { id: 'C7577A45-CD64-408E-9D4B-7BC55F899F4F', name: 'Automations' };
const KITCHEN = { id: 'AAAA1111-0000-0000-0000-000000000000', name: 'Kitchen' };

describe('a hidden room stays hidden even while it is on show', () => {
  it('is still hidden when hidden things are being shown', () => {
    // The whole bug: Edit Layout reveals hidden rooms, and the one function
    // that answered "is it hidden" started saying no the moment it appeared —
    // so it sorted with the visible rooms and offered to Hide it again.
    expect(isRoomHidden(HIDDEN, AUTOMATIONS.id)).toBe(true);
    expect(shouldFilterRoomOut(HIDDEN, AUTOMATIONS.id, true)).toBe(false);
  });

  it('is dropped from the view when hidden things are not being shown', () => {
    expect(shouldFilterRoomOut(HIDDEN, AUTOMATIONS.id, false)).toBe(true);
  });

  it('leaves a room nobody hid alone, either way', () => {
    expect(isRoomHidden(HIDDEN, KITCHEN.id)).toBe(false);
    expect(shouldFilterRoomOut(HIDDEN, KITCHEN.id, false)).toBe(false);
  });

  it('treats a home that has never hidden anything as all-visible', () => {
    expect(isRoomHidden(undefined, AUTOMATIONS.id)).toBe(false);
    expect(shouldFilterRoomOut(undefined, AUTOMATIONS.id, false)).toBe(false);
  });
});

describe('where a revealed room sits', () => {
  it('drops hidden rooms entirely while they are not on show', () => {
    expect(orderRoomsHiddenLast([AUTOMATIONS, KITCHEN], HIDDEN, false).map(r => r.name))
      .toEqual(['Kitchen']);
  });

  it('puts a revealed room last, not wherever it used to sit', () => {
    // Reported against a real home: "Automations" is hidden but still appears
    // at the top in edit mode. It sorted first because it was first.
    expect(orderRoomsHiddenLast([AUTOMATIONS, KITCHEN], HIDDEN, true).map(r => r.name))
      .toEqual(['Kitchen', 'Automations']);
  });

  it('keeps the visible rooms in their own order', () => {
    const rooms = [KITCHEN, AUTOMATIONS, { id: 'B', name: 'Bedroom' }];
    expect(orderRoomsHiddenLast(rooms, HIDDEN, true).map(r => r.name))
      .toEqual(['Kitchen', 'Bedroom', 'Automations']);
  });
});
