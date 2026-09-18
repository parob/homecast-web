import { describe, it, expect } from 'vitest';
import {
  availableWidgetSizes,
  cameraSizeCapability,
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
    expect(widgetSizeStyle('large')).toMatchObject({ gridColumn: 'span 2', gridRow: 'span 2' });
    expect(widgetSizeStyle('tall')).toMatchObject({ gridColumn: 'span 1', gridRow: 'span 2' });
  });

  it('carries an aspect ratio, which is what actually gives it height', () => {
    // Measured, not assumed: `align-self: stretch` was tried first and did
    // nothing. Both grids size rows from content, and a tile spanning both
    // columns of a two-column grid is alone in its rows — so the tracks
    // collapse to its own height and there is nothing to stretch into. The
    // tile went 175px → 358px wide and stayed 97px tall.
    expect(widgetSizeStyle('large')?.aspectRatio).toBe('16 / 9');
    expect(widgetSizeStyle('tall')?.aspectRatio).toBe('3 / 4');
  });

  it('gives Large a landscape shape and Tall a portrait one', () => {
    const ratio = (s: string) => {
      const [w, h] = s.split('/').map(n => Number(n.trim()));
      return w / h;
    };
    expect(ratio(widgetSizeStyle('large')!.aspectRatio)).toBeGreaterThan(1);
    expect(ratio(widgetSizeStyle('tall')!.aspectRatio)).toBeLessThan(1);
  });
});
