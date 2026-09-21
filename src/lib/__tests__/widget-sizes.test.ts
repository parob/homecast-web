import { describe, it, expect } from 'vitest';
import {
  availableWidgetSizes,
  cameraSizeCapability,
  gridHasSizedWidget,
  gridRowUnitStyle,
  offersWidgetSizeChoice,
  resolveWidgetSize,
  storedWidgetSize,
  widgetSizeStyle,
  widgetSpan,
  withWidgetSize,
  type WidgetSizeMap,
} from '../widget-sizes';

describe('widgetSpan', () => {
  it('leaves regular as the 1x1 the grid already assumes', () => {
    expect(widgetSpan('regular')).toEqual({ columns: 1, rows: 1 });
  });

  it('gives large four cells and tall two stacked ones', () => {
    expect(widgetSpan('large')).toEqual({ columns: 2, rows: 2 });
    expect(widgetSpan('tall')).toEqual({ columns: 1, rows: 2 });
  });
});

describe('availableWidgetSizes', () => {
  it('offers nothing but regular to a widget that declares no capability', () => {
    expect(availableWidgetSizes(undefined)).toEqual(['regular']);
    expect(availableWidgetSizes({})).toEqual(['regular']);
  });

  it('always includes regular, so there is a way back from every size', () => {
    expect(availableWidgetSizes({ large: true })).toContain('regular');
    expect(availableWidgetSizes({ large: true, tall: true })).toContain('regular');
  });

  it('offers each size its capability allows', () => {
    expect(availableWidgetSizes({ large: true })).toEqual(['regular', 'large']);
    expect(availableWidgetSizes({ tall: true })).toEqual(['regular', 'tall']);
    expect(availableWidgetSizes({ large: true, tall: true })).toEqual(['regular', 'large', 'tall']);
  });
});

describe('offersWidgetSizeChoice', () => {
  it('is false when regular is the only option, so the control is not shown', () => {
    expect(offersWidgetSizeChoice(undefined)).toBe(false);
    expect(offersWidgetSizeChoice({})).toBe(false);
    expect(offersWidgetSizeChoice({ large: false, tall: false })).toBe(false);
  });

  it('is true as soon as there is a second size', () => {
    expect(offersWidgetSizeChoice({ large: true })).toBe(true);
    expect(offersWidgetSizeChoice({ tall: true })).toBe(true);
  });
});

describe('cameraSizeCapability', () => {
  it('offers Large for any camera that has produced a picture', () => {
    expect(cameraSizeCapability({ width: 1920, height: 1080 }).large).toBe(true);
    expect(cameraSizeCapability({ width: 960, height: 1280 }).large).toBe(true);
  });

  it('offers Tall only for a portrait picture', () => {
    expect(cameraSizeCapability({ width: 960, height: 1280 }).tall).toBe(true);
    expect(cameraSizeCapability({ width: 1920, height: 1080 }).tall).toBe(false);
  });

  it('does not call a square picture portrait', () => {
    expect(cameraSizeCapability({ width: 1000, height: 1000 }).tall).toBe(false);
  });

  it('withholds Tall until a snapshot has actually reported its shape', () => {
    // Before the first snapshot we know it is a camera and not what shape it
    // is. Guessing portrait here would offer Tall to a landscape doorbell.
    expect(cameraSizeCapability(undefined)).toEqual({ large: true, tall: false });
    expect(cameraSizeCapability({})).toEqual({ large: true, tall: false });
    expect(cameraSizeCapability({ width: 0, height: 0 }).tall).toBe(false);
    expect(cameraSizeCapability({ width: null, height: null }).tall).toBe(false);
  });
});

describe('storedWidgetSize', () => {
  it('reads regular for an absent map or an absent key', () => {
    expect(storedWidgetSize(undefined, 'cam')).toBe('regular');
    expect(storedWidgetSize({}, 'cam')).toBe('regular');
  });

  it('reads back what was stored', () => {
    expect(storedWidgetSize({ cam: 'large' }, 'cam')).toBe('large');
    expect(storedWidgetSize({ cam: 'tall' }, 'cam')).toBe('tall');
  });

  it('falls back to regular for a value a newer build wrote', () => {
    const fromTheFuture = { cam: 'enormous' } as unknown as WidgetSizeMap;
    expect(storedWidgetSize(fromTheFuture, 'cam')).toBe('regular');
  });
});

describe('resolveWidgetSize', () => {
  const portrait = { large: true, tall: true };
  const landscape = { large: true, tall: false };

  it('renders the stored size when the widget can take it', () => {
    expect(resolveWidgetSize({ cam: 'large' }, 'cam', landscape)).toBe('large');
    expect(resolveWidgetSize({ cam: 'tall' }, 'cam', portrait)).toBe('tall');
  });

  it('falls back to regular when the widget can no longer take it', () => {
    // A camera set to Tall that starts reporting landscape.
    expect(resolveWidgetSize({ cam: 'tall' }, 'cam', landscape)).toBe('regular');
  });

  it('falls back to regular for a widget that lost its capability entirely', () => {
    expect(resolveWidgetSize({ cam: 'large' }, 'cam', undefined)).toBe('regular');
  });

  it('does not need a capability to resolve regular', () => {
    expect(resolveWidgetSize({}, 'cam', undefined)).toBe('regular');
  });
});

describe('withWidgetSize', () => {
  it('stores a non-default size', () => {
    expect(withWidgetSize(undefined, 'cam', 'large')).toEqual({ cam: 'large' });
  });

  it('leaves other widgets alone', () => {
    expect(withWidgetSize({ a: 'large' }, 'b', 'tall')).toEqual({ a: 'large', b: 'tall' });
  });

  it('expresses regular as absence rather than writing the word', () => {
    // What lets the field be added with no migration.
    expect(withWidgetSize({ cam: 'large', other: 'tall' }, 'cam', 'regular')).toEqual({ other: 'tall' });
  });

  it('drops the field entirely rather than leaving an empty object behind', () => {
    expect(withWidgetSize({ cam: 'large' }, 'cam', 'regular')).toBeUndefined();
    expect(withWidgetSize(undefined, 'cam', 'regular')).toBeUndefined();
  });

  it('does not mutate the map it was given', () => {
    const before: WidgetSizeMap = { cam: 'large' };
    withWidgetSize(before, 'other', 'tall');
    expect(before).toEqual({ cam: 'large' });
  });
});

describe('widgetSizeStyle', () => {
  it('is undefined for regular, so an untouched grid renders exactly as before', () => {
    expect(widgetSizeStyle('regular')).toBeUndefined();
  });

  it('spans the cells the size claims', () => {
    expect(widgetSizeStyle('large')).toEqual({ gridColumn: 'span 2', gridRow: 'span 2', alignSelf: 'stretch', display: 'grid' });
    expect(widgetSizeStyle('tall')).toEqual({ gridColumn: 'span 1', gridRow: 'span 2', alignSelf: 'stretch', display: 'grid' });
  });

  it('makes the cell a container, so the height reaches the card through any wrapper', () => {
    // issue #159. `alignSelf: stretch` sizes this element and nothing below it,
    // and the card's height comes down an `h-full` chain — `height: 100%`, which
    // dies at the first ancestor with `height: auto`. The dashboard has one:
    // the `relative` div holding the deal badge and the expanded overlay. As a
    // grid container the cell stretches its child instead of asking it to
    // measure itself against an auto-height parent, so no wrapper can break it.
    expect(widgetSizeStyle('large')?.display).toBe('grid');
    expect(widgetSizeStyle('tall')?.display).toBe('grid');
    // Never for regular: an untouched tile must stay on its old code path.
    expect(widgetSizeStyle('regular')).toBeUndefined();
  });

  it('stretches, because both grids are items-start', () => {
    // Necessary but not sufficient: without an explicit row track from
    // `gridRowUnitStyle` there is nothing to stretch into. The two go together.
    expect(widgetSizeStyle('large')?.alignSelf).toBe('stretch');
    expect(widgetSizeStyle('tall')?.alignSelf).toBe('stretch');
  });

  it('carries no aspect ratio', () => {
    // It used to. 16/9 of a 358px phone column is 201px and two rows plus the
    // gap is 202px, so it matched at the width it was checked at and was wrong
    // everywhere else — on a 648px desktop span, 364px against 288px. A tile
    // twice the height of the other widgets has to be defined by those widgets.
    expect(widgetSizeStyle('large')).not.toHaveProperty('aspectRatio');
    expect(widgetSizeStyle('tall')).not.toHaveProperty('aspectRatio');
  });
});

describe('gridRowUnitStyle', () => {
  it('sets the track to the measured height of an ordinary tile', () => {
    // 2 × 97 + an 8px gap = 202, which is exactly twice a 97px tile.
    expect(gridRowUnitStyle(true, 97)).toEqual({ gridAutoRows: '97px' });
  });

  it('leaves a grid with nothing resized completely alone', () => {
    // Setting a row track changes how every tile in the grid is laid out.
    expect(gridRowUnitStyle(false, 97)).toBeUndefined();
  });

  it('leaves the grid alone when there is nothing to measure', () => {
    // A grid of only sized tiles has no ordinary tile to be twice the height
    // of, and guessing a track would be worse than not acting.
    expect(gridRowUnitStyle(true, null)).toBeUndefined();
    expect(gridRowUnitStyle(true, 0)).toBeUndefined();
    expect(gridRowUnitStyle(true, -5)).toBeUndefined();
  });
});

describe('gridHasSizedWidget', () => {
  it('is false for a home that has never resized anything', () => {
    expect(gridHasSizedWidget(undefined, ['a', 'b'])).toBe(false);
    expect(gridHasSizedWidget({}, ['a', 'b'])).toBe(false);
  });

  it('is false when the sized widget is not in this grid', () => {
    expect(gridHasSizedWidget({ elsewhere: 'large' }, ['a', 'b'])).toBe(false);
  });

  it('is true when one of this grid\u2019s tiles is sized', () => {
    expect(gridHasSizedWidget({ b: 'large' }, ['a', 'b'])).toBe(true);
    expect(gridHasSizedWidget({ b: 'tall' }, ['a', 'b'])).toBe(true);
  });

  it('ignores a value it does not understand, like storedWidgetSize does', () => {
    const fromTheFuture = { b: 'enormous' } as unknown as WidgetSizeMap;
    expect(gridHasSizedWidget(fromTheFuture, ['a', 'b'])).toBe(false);
  });
});
