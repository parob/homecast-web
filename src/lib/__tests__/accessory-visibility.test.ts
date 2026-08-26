import { describe, it, expect } from 'vitest';
import {
  isAccessoryHidden,
  shouldFilterAccessoryOut,
  hiddenAccessoriesFor,
  isAccessoryHiddenOn,
  isAccessoryHiddenAnywhere,
  toggleAccessoryHidden,
  ACCESSORY_SURFACES,
} from '../accessory-visibility';

const LAMP = 'C7577A45-CD64-408E-9D4B-7BC55F899F4F';
const AIRCON = 'AAAA1111-0000-0000-0000-000000000000';
const HIDDEN = [LAMP];

describe('a hidden accessory stays hidden even while it is on show', () => {
  it('is still hidden when hidden things are being shown', () => {
    // Same distinction room-visibility exists for: Edit Layout reveals hidden
    // tiles, and the answer to "drop it right now" flips while the stored
    // state must not — otherwise the revealed tile offers to Hide itself again.
    expect(isAccessoryHidden(HIDDEN, LAMP)).toBe(true);
    expect(shouldFilterAccessoryOut(HIDDEN, LAMP, true)).toBe(false);
  });

  it('is dropped from the view when hidden things are not being shown', () => {
    expect(shouldFilterAccessoryOut(HIDDEN, LAMP, false)).toBe(true);
  });

  it('leaves an accessory nobody hid alone, either way', () => {
    expect(isAccessoryHidden(HIDDEN, AIRCON)).toBe(false);
    expect(shouldFilterAccessoryOut(HIDDEN, AIRCON, false)).toBe(false);
  });

  it('treats a room that has never hidden anything as all-visible', () => {
    expect(isAccessoryHidden(undefined, LAMP)).toBe(false);
    expect(shouldFilterAccessoryOut(undefined, LAMP, false)).toBe(false);
  });
});

describe('the home view and the room view hide accessories independently', () => {
  it('hiding from the home view leaves the room view alone', () => {
    // The report, exactly: hide a tile on the home view and it should still be
    // there when you click into that room from the left menu.
    const next = toggleAccessoryHidden(undefined, LAMP, ['home']);
    expect(isAccessoryHiddenOn(next, LAMP, 'home')).toBe(true);
    expect(isAccessoryHiddenOn(next, LAMP, 'room')).toBe(false);
  });

  it('hiding from the room view leaves the home view alone', () => {
    const next = toggleAccessoryHidden(undefined, LAMP, ['room']);
    expect(isAccessoryHiddenOn(next, LAMP, 'room')).toBe(true);
    expect(isAccessoryHiddenOn(next, LAMP, 'home')).toBe(false);
  });

  it('lets the two hides accumulate — they are separate actions', () => {
    const afterHome = toggleAccessoryHidden(undefined, LAMP, ['home']);
    const afterBoth = toggleAccessoryHidden(afterHome, LAMP, ['room']);
    expect(isAccessoryHiddenOn(afterBoth, LAMP, 'home')).toBe(true);
    expect(isAccessoryHiddenOn(afterBoth, LAMP, 'room')).toBe(true);
  });

  it('unhides one surface without touching the other', () => {
    const both = toggleAccessoryHidden(
      toggleAccessoryHidden(undefined, LAMP, ['home']),
      LAMP,
      ['room'],
    );
    const back = toggleAccessoryHidden(both, LAMP, ['home']);
    expect(isAccessoryHiddenOn(back, LAMP, 'home')).toBe(false);
    expect(isAccessoryHiddenOn(back, LAMP, 'room')).toBe(true);
  });

  it('answers "hidden anywhere" for a control that owns neither surface', () => {
    const homeOnly = toggleAccessoryHidden(undefined, LAMP, ['home']);
    expect(isAccessoryHiddenAnywhere(homeOnly, LAMP)).toBe(true);
    expect(isAccessoryHiddenAnywhere(homeOnly, AIRCON)).toBe(false);
  });

  it('leaves other accessories on the surface untouched', () => {
    const first = toggleAccessoryHidden(undefined, LAMP, ['home']);
    const second = toggleAccessoryHidden(first, AIRCON, ['home']);
    expect(second.hiddenAccessoriesHome).toEqual([LAMP, AIRCON]);
    expect(second.hiddenAccessoriesRoom).toEqual([]);
  });
});

describe('a layout written before the split', () => {
  const legacy = { hiddenAccessories: [LAMP] };

  it('hides the accessory on both surfaces, exactly as it used to', () => {
    // The fallback IS the migration. Nothing is rewritten until something is
    // toggled, so no deploy can silently un-hide a tile.
    for (const surface of ACCESSORY_SURFACES) {
      expect(hiddenAccessoriesFor(legacy, surface)).toEqual([LAMP]);
      expect(isAccessoryHiddenOn(legacy, LAMP, surface)).toBe(true);
    }
  });

  it('splits on the first toggle, keeping the other surface as it was', () => {
    const next = toggleAccessoryHidden(legacy, LAMP, ['home']);
    expect(isAccessoryHiddenOn(next, LAMP, 'home')).toBe(false);
    expect(isAccessoryHiddenOn(next, LAMP, 'room')).toBe(true);
  });

  it('does not resurrect the legacy list once a per-surface key exists', () => {
    // An empty per-surface list is a real answer, not a missing one: `?? `
    // must not fall through to `hiddenAccessories` and re-hide the tile.
    const split = { hiddenAccessories: [LAMP], hiddenAccessoriesHome: [] as string[] };
    expect(hiddenAccessoriesFor(split, 'home')).toEqual([]);
    expect(isAccessoryHiddenOn(split, LAMP, 'home')).toBe(false);
    expect(isAccessoryHiddenOn(split, LAMP, 'room')).toBe(true);
  });
});

describe('what an old bundle still reading `hiddenAccessories` sees', () => {
  // A Community-mode Mac app runs the web build bundled into it, which may
  // predate the split. It gets the intersection, so it errs toward showing an
  // accessory rather than hiding one the user can no longer find.
  it('shows an accessory hidden from only one surface', () => {
    expect(toggleAccessoryHidden(undefined, LAMP, ['home']).hiddenAccessories).toEqual([]);
    expect(toggleAccessoryHidden(undefined, LAMP, ['room']).hiddenAccessories).toEqual([]);
  });

  it('hides one the user hid from both', () => {
    const both = toggleAccessoryHidden(
      toggleAccessoryHidden(undefined, LAMP, ['home']),
      LAMP,
      ['room'],
    );
    expect(both.hiddenAccessories).toEqual([LAMP]);
  });

  it('drops it again as soon as either surface brings it back', () => {
    const both = toggleAccessoryHidden(
      toggleAccessoryHidden(undefined, LAMP, ['home']),
      LAMP,
      ['room'],
    );
    expect(toggleAccessoryHidden(both, LAMP, ['room']).hiddenAccessories).toEqual([]);
  });
});

describe('the control that owns neither surface', () => {
  it('hides on both when it is hidden on neither', () => {
    const next = toggleAccessoryHidden(undefined, LAMP, ACCESSORY_SURFACES);
    expect(isAccessoryHiddenOn(next, LAMP, 'home')).toBe(true);
    expect(isAccessoryHiddenOn(next, LAMP, 'room')).toBe(true);
  });

  it('reveals on both when it is hidden on either — one decision, not two', () => {
    const homeOnly = toggleAccessoryHidden(undefined, LAMP, ['home']);
    const next = toggleAccessoryHidden(homeOnly, LAMP, ACCESSORY_SURFACES);
    expect(isAccessoryHiddenAnywhere(next, LAMP)).toBe(false);
  });
});
