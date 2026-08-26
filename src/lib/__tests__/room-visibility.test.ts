import { describe, it, expect } from 'vitest';
import {
  isRoomHidden,
  shouldFilterRoomOut,
  orderRoomsHiddenLast,
  orderMenuTreeHiddenLast,
  hiddenRoomsFor,
  isRoomHiddenOn,
  isRoomHiddenAnywhere,
  toggleRoomHidden,
} from '../room-visibility';

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

describe('when a hidden room comes back', () => {
  it('comes back on the reveal, whatever drove it', () => {
    // Rooms reveal at the lift, not at the drop. Hidden *tiles* have to wait —
    // they land inside the grid being dragged — but a revealed room appends a
    // section below everything, so nothing above it moves.
    expect(orderRoomsHiddenLast([AUTOMATIONS, KITCHEN], HIDDEN, true).map(r => r.name))
      .toEqual(['Kitchen', 'Automations']);
  });

  it('is absent until something reveals it', () => {
    expect(orderRoomsHiddenLast([AUTOMATIONS, KITCHEN], HIDDEN, false).map(r => r.name))
      .toEqual(['Kitchen']);
  });
});

describe('the home view and the left menu hide rooms independently', () => {
  // The report: "You should be able to hide a room in the home and it still be
  // in the left menu and the same the other way around." Before the split there
  // was one list and both surfaces read it, so either gesture did both.

  it('hiding from the home view leaves the menu alone', () => {
    const next = toggleRoomHidden(undefined, AUTOMATIONS.id, ['home']);

    expect(isRoomHiddenOn(next, AUTOMATIONS.id, 'home')).toBe(true);
    expect(isRoomHiddenOn(next, AUTOMATIONS.id, 'menu')).toBe(false);
  });

  it('hiding from the menu leaves the home view alone', () => {
    const next = toggleRoomHidden(undefined, AUTOMATIONS.id, ['menu']);

    expect(isRoomHiddenOn(next, AUTOMATIONS.id, 'menu')).toBe(true);
    expect(isRoomHiddenOn(next, AUTOMATIONS.id, 'home')).toBe(false);
  });

  it('lets the two surfaces disagree about different rooms at once', () => {
    let v = toggleRoomHidden(undefined, AUTOMATIONS.id, ['home']);
    v = toggleRoomHidden(v, KITCHEN.id, ['menu']);

    expect(hiddenRoomsFor(v, 'home')).toEqual([AUTOMATIONS.id]);
    expect(hiddenRoomsFor(v, 'menu')).toEqual([KITCHEN.id]);
  });

  it('unhides only the surface it was asked about', () => {
    const both = toggleRoomHidden(undefined, AUTOMATIONS.id, ['home', 'menu']);
    const homeBack = toggleRoomHidden(both, AUTOMATIONS.id, ['home']);

    expect(isRoomHiddenOn(homeBack, AUTOMATIONS.id, 'home')).toBe(false);
    expect(isRoomHiddenOn(homeBack, AUTOMATIONS.id, 'menu')).toBe(true);
  });
});

describe('a layout written before the split', () => {
  // The migration is the fallback: nothing rewrites stored layouts, so this is
  // the case that must not un-hide anyone's rooms on deploy.
  const LEGACY = { hiddenRooms: HIDDEN };

  it('is still hidden on both surfaces', () => {
    expect(isRoomHiddenOn(LEGACY, AUTOMATIONS.id, 'home')).toBe(true);
    expect(isRoomHiddenOn(LEGACY, AUTOMATIONS.id, 'menu')).toBe(true);
  });

  it('splits into two independent lists the first time either is toggled', () => {
    const next = toggleRoomHidden(LEGACY, AUTOMATIONS.id, ['menu']);

    expect(isRoomHiddenOn(next, AUTOMATIONS.id, 'menu')).toBe(false);
    expect(isRoomHiddenOn(next, AUTOMATIONS.id, 'home')).toBe(true);
  });

  it('prefers a per-surface list over the legacy one once it exists', () => {
    const v = { hiddenRooms: HIDDEN, hiddenRoomsMenu: [] };

    expect(hiddenRoomsFor(v, 'menu')).toEqual([]);
    expect(hiddenRoomsFor(v, 'home')).toEqual(HIDDEN);
  });

  it('treats a home that has never hidden anything as all-visible', () => {
    expect(hiddenRoomsFor(undefined, 'home')).toBeUndefined();
    expect(isRoomHiddenOn(undefined, AUTOMATIONS.id, 'menu')).toBe(false);
  });
});

describe('what an old bundle still reading `hiddenRooms` sees', () => {
  // A Community-mode Mac app runs a bundled web build. It gets the
  // intersection, so it errs toward showing a room rather than hiding one the
  // user has no way to bring back.

  it('keeps a room hidden everywhere in the legacy list', () => {
    const v = toggleRoomHidden(undefined, AUTOMATIONS.id, ['home', 'menu']);
    expect(v.hiddenRooms).toEqual([AUTOMATIONS.id]);
  });

  it('drops a room hidden from only one surface out of the legacy list', () => {
    const v = toggleRoomHidden(undefined, AUTOMATIONS.id, ['home']);
    expect(v.hiddenRooms).toEqual([]);
  });

  it('stops hiding it once either surface brings it back', () => {
    const both = toggleRoomHidden(undefined, AUTOMATIONS.id, ['home', 'menu']);
    expect(toggleRoomHidden(both, AUTOMATIONS.id, ['menu']).hiddenRooms).toEqual([]);
  });
});

describe('the control that owns neither surface', () => {
  // The dropdown reached from inside a room. It hides everywhere, and treats
  // "hidden on either" as hidden — which is exactly what it did when there was
  // one list.

  it('reports hidden when only one surface hides it', () => {
    const v = toggleRoomHidden(undefined, AUTOMATIONS.id, ['home']);
    expect(isRoomHiddenAnywhere(v, AUTOMATIONS.id)).toBe(true);
  });

  it('hides on both surfaces from a clean slate', () => {
    const v = toggleRoomHidden(undefined, AUTOMATIONS.id, ['home', 'menu']);
    expect(isRoomHiddenOn(v, AUTOMATIONS.id, 'home')).toBe(true);
    expect(isRoomHiddenOn(v, AUTOMATIONS.id, 'menu')).toBe(true);
  });

  it('brings it back on both when only one surface was hiding it', () => {
    const half = toggleRoomHidden(undefined, AUTOMATIONS.id, ['home']);
    const back = toggleRoomHidden(half, AUTOMATIONS.id, ['home', 'menu']);

    expect(isRoomHiddenAnywhere(back, AUTOMATIONS.id)).toBe(false);
  });
});

describe('where a room hidden from the menu sits in the menu', () => {
  // "A room hidden from the menu will be at the bottom of the menu when in
  // editing mode" — the same rule the home view already uses, but the menu is a
  // tree of rooms and room groups rather than a flat list.
  const GROUP = { id: 'room-group-1', type: 'roomGroup' };
  const tree = [
    { id: AUTOMATIONS.id, type: 'room' },
    GROUP,
    { id: KITCHEN.id, type: 'room' },
  ];

  it('drops it from the menu until edit mode reveals it', () => {
    expect(orderMenuTreeHiddenLast(tree, HIDDEN, false).map(i => i.id))
      .toEqual([GROUP.id, KITCHEN.id]);
  });

  it('puts it last, below the room groups, once revealed', () => {
    expect(orderMenuTreeHiddenLast(tree, HIDDEN, true).map(i => i.id))
      .toEqual([GROUP.id, KITCHEN.id, AUTOMATIONS.id]);
  });

  it('never moves a room group, whatever its id collides with', () => {
    const hiddenGroupId = [GROUP.id];
    expect(orderMenuTreeHiddenLast(tree, hiddenGroupId, false).map(i => i.id))
      .toEqual([AUTOMATIONS.id, GROUP.id, KITCHEN.id]);
  });

  it('leaves a menu with nothing hidden exactly as it was', () => {
    expect(orderMenuTreeHiddenLast(tree, undefined, true)).toEqual(tree);
  });
});
