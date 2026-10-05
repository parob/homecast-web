import { describe, it, expect } from 'vitest';
import { imageSize } from '../image-size';

const bytes = (...parts: (number[] | string)[]) =>
  new Uint8Array(parts.flatMap((p) => (typeof p === 'string' ? [...p].map((c) => c.charCodeAt(0)) : p)));

describe('imageSize', () => {
  it('reads PNG from IHDR', () => {
    const png = bytes([0x89], 'PNG', [0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13], 'IHDR', [0, 0, 6, 64, 0, 0, 3, 132]);
    expect(imageSize(png)).toEqual({ width: 1600, height: 900 });
  });

  it('reads extended WebP (VP8X)', () => {
    // canvas width-1 and height-1 as 24-bit little endian at offsets 24 and 27
    const webp = bytes('RIFF', [0, 0, 0, 0], 'WEBP', 'VP8X', [10, 0, 0, 0, 0, 0, 0, 0], [0x3f, 0x06, 0], [0x83, 0x03, 0]);
    expect(imageSize(webp)).toEqual({ width: 1600, height: 900 });
  });

  it('reads JPEG from the first start-of-frame', () => {
    const jpeg = bytes([0xff, 0xd8, 0xff, 0xe0, 0, 4, 0, 0, 0xff, 0xc0, 0, 17, 8, 3, 132, 6, 64, 3]);
    expect(imageSize(jpeg)).toEqual({ width: 1600, height: 900 });
  });

  it('reads SVG from width/height, else the viewBox', () => {
    const enc = (s: string) => new TextEncoder().encode(s);
    expect(imageSize(enc('<svg xmlns="x" width="800" height="400">'))).toEqual({ width: 800, height: 400 });
    expect(imageSize(enc('<svg viewBox="0 0 1200 630" xmlns="x">'))).toEqual({ width: 1200, height: 630 });
  });

  it('declines anything else rather than guessing', () => {
    expect(imageSize(new TextEncoder().encode('GIF89a......'))).toBeUndefined();
  });
});
