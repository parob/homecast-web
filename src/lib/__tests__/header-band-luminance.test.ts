// @vitest-environment jsdom
/**
 * The header band is measured separately from the wallpaper, and it has to be.
 *
 * A photo of dark trees under a bright sky averages dark, so the whole-image
 * verdict puts white icons on the header — which sits over the sky. While each
 * control carried its own filled disc that mismatch was invisible; taking the
 * discs off (parob/homecast-cloud#118) made it the one case that did not work.
 *
 * jsdom has no image decoder, so this drives `analyzeLoadedImageBand` through a
 * stubbed canvas whose pixels we choose: the point under test is *which region
 * is sampled*, not whether the browser can average bytes.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  analyzeLoadedImageBand,
  analyzeLoadedImage,
  isDarkLuminance,
  HEADER_BAND_FRACTION,
} from '../colorUtils';

/** Height of the fake source image, in px. */
const H = 400;
const W = 200;

/**
 * Stub `document.createElement('canvas')` with a context that records the
 * source rect it was asked to draw, and returns pixels from `pixelAt(y)` — a
 * function of the SOURCE row, so a band read and a whole-image read see
 * genuinely different data.
 */
function stubCanvas(pixelAt: (sourceY: number) => [number, number, number]) {
  const calls: Array<{ sy: number; sh: number }> = [];
  const real = document.createElement.bind(document);

  vi.spyOn(document, 'createElement').mockImplementation(((tag: string) => {
    if (tag !== 'canvas') return real(tag);
    let sy = 0;
    let sh = H;
    return {
      width: 0,
      height: 0,
      getContext: () => ({
        drawImage: (...args: unknown[]) => {
          // drawImage(img, sx, sy, sw, sh, dx, dy, dw, dh) — the 9-arg form.
          // The 5-arg form (img, dx, dy, dw, dh) means "all of it".
          if (args.length === 9) {
            sy = args[2] as number;
            sh = args[4] as number;
          } else {
            sy = 0;
            sh = H;
          }
          calls.push({ sy, sh });
        },
        getImageData: (_x: number, _y: number, w: number, h: number) => {
          const data = new Uint8ClampedArray(w * h * 4);
          for (let row = 0; row < h; row++) {
            // Map the destination row back onto the source rows it came from.
            const sourceY = sy + ((row + 0.5) / h) * sh;
            const [r, g, b] = pixelAt(sourceY);
            for (let col = 0; col < w; col++) {
              const i = (row * w + col) * 4;
              data[i] = r;
              data[i + 1] = g;
              data[i + 2] = b;
              data[i + 3] = 255;
            }
          }
          return { data };
        },
      }),
    } as unknown as HTMLCanvasElement;
  }) as typeof document.createElement);

  return calls;
}

/** The failing wallpaper: a bright sky over the top fifth, dark trees below. */
const skyOverTrees = (y: number): [number, number, number] =>
  y < H * 0.2 ? [236, 240, 245] : [38, 46, 34];

const img = { naturalWidth: W, naturalHeight: H } as HTMLImageElement;

afterEach(() => {
  vi.restoreAllMocks();
});

describe('analyzeLoadedImageBand', () => {
  it('samples only the top band, not the whole image', () => {
    const calls = stubCanvas(skyOverTrees);
    analyzeLoadedImageBand(img);

    expect(calls).toHaveLength(1);
    expect(calls[0].sy).toBe(0);
    expect(calls[0].sh).toBe(Math.round(H * HEADER_BAND_FRACTION));
  });

  it('reads bright where the whole image reads dark', () => {
    stubCanvas(skyOverTrees);
    const band = analyzeLoadedImageBand(img);
    vi.restoreAllMocks();
    stubCanvas(skyOverTrees);
    const whole = analyzeLoadedImage(img);

    // This gap is the entire bug: same picture, opposite answers.
    expect(whole).toBeLessThan(0.2);
    expect(band).toBeGreaterThan(0.7);
    expect(isDarkLuminance(whole, 78)).toBe(true);
    expect(isDarkLuminance(band, 78)).toBe(false);
  });

  it('agrees with the whole image when the picture is uniform', () => {
    stubCanvas(() => [20, 20, 20]);
    const band = analyzeLoadedImageBand(img);
    vi.restoreAllMocks();
    stubCanvas(() => [20, 20, 20]);
    const whole = analyzeLoadedImage(img);

    expect(band).toBeCloseTo(whole, 3);
  });

  it('still reads dark where the top is the dark part', () => {
    // The mirror image, so the band is not simply "assume the top is sky".
    const treesOverSky = (y: number): [number, number, number] =>
      y < H * 0.5 ? [22, 26, 20] : [240, 244, 250];
    stubCanvas(treesOverSky);
    expect(isDarkLuminance(analyzeLoadedImageBand(img), 50)).toBe(true);
  });

  it('never asks for a zero-height band, however short the image', () => {
    const calls = stubCanvas(() => [0, 0, 0]);
    analyzeLoadedImageBand({ naturalWidth: 4, naturalHeight: 2 } as HTMLImageElement);
    expect(calls[0].sh).toBeGreaterThanOrEqual(1);
  });

  it('falls back to the neutral 0.5 rather than throwing on a tainted canvas', () => {
    vi.spyOn(document, 'createElement').mockImplementation((() => ({
      getContext: () => ({
        drawImage: () => {},
        getImageData: () => {
          throw new Error('SecurityError: tainted canvas');
        },
      }),
    })) as unknown as typeof document.createElement);

    expect(analyzeLoadedImageBand(img)).toBe(0.5);
  });
});
