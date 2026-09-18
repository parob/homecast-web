/**
 * The canvas behind the wallpaper takes the colour of the wallpaper's TOP EDGE
 * AS DISPLAYED — the row that meets iOS 26 Safari's status-bar band — not the
 * source image's top row. `object-fit: cover` on a portrait phone shows a
 * slice from the middle of a landscape photo, and the sky above it is not on
 * screen at all. This pins the geometry the sampler reads.
 */
import { describe, it, expect } from 'vitest';
import { coverCropRect } from '../colorUtils';

describe('coverCropRect', () => {
  it('shows the whole image when the aspect ratios match', () => {
    expect(coverCropRect(1000, 2000, 400, 800)).toEqual({ x: 0, y: 0, w: 1000, h: 2000 });
  });

  it('a landscape photo on a portrait phone shows a centred vertical strip, full height', () => {
    // 4000×3000 into 400×800: height-limited, scale 800/3000, visible width 1500.
    const r = coverCropRect(4000, 3000, 400, 800);
    expect(r.h).toBe(3000);
    expect(r.w).toBeCloseTo(1500, 5);
    expect(r.x).toBeCloseTo(1250, 5);
    expect(r.y).toBe(0);
  });

  it('a tall photo on a wide box shows a centred horizontal band — its top is NOT the image top', () => {
    // 1000×4000 into 800×400: width-limited, scale 0.8, visible height 500 from y=1750.
    const r = coverCropRect(1000, 4000, 800, 400);
    expect(r.w).toBe(1000);
    expect(r.h).toBeCloseTo(500, 5);
    expect(r.y).toBeCloseTo(1750, 5);
  });

  it('the blurred layer\'s 1.1× enlargement crops a further margin all round', () => {
    const plain = coverCropRect(1000, 2000, 400, 800);
    const scaled = coverCropRect(1000, 2000, 400, 800, 1.1);
    expect(scaled.w).toBeCloseTo(plain.w / 1.1, 5);
    expect(scaled.h).toBeCloseTo(plain.h / 1.1, 5);
    expect(scaled.y).toBeGreaterThan(0);
  });

  it('degenerate sizes fall back to the whole image rather than NaN', () => {
    expect(coverCropRect(1000, 2000, 0, 800)).toEqual({ x: 0, y: 0, w: 1000, h: 2000 });
  });
});
