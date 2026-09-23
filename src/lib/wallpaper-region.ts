import { coverCropRect } from './colorUtils';

export type WallpaperRgb = [number, number, number];
const SIZE = 64;
const pixels = new WeakMap<HTMLImageElement, Uint8ClampedArray | null>();

/** Read an image once; scrolling tiles sample cached pixels, never the canvas. */
function imagePixels(image: HTMLImageElement): Uint8ClampedArray | null {
  if (pixels.has(image)) return pixels.get(image)!;
  try {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = SIZE;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) return null;
    context.drawImage(image, 0, 0, SIZE, SIZE);
    const data = context.getImageData(0, 0, SIZE, SIZE).data;
    pixels.set(image, data);
    return data;
  } catch {
    // A custom image may be displayable without granting canvas/CORS access.
    pixels.set(image, null);
    return null;
  }
}

/** Approximate the blurred wallpaper under a tile, including cover crop/zoom. */
export function wallpaperRegion(
  image: HTMLImageElement,
  tile: DOMRect,
  brightness: number,
): WallpaperRgb | null {
  const box = image.getBoundingClientRect();
  if (!box.width || !box.height || !image.naturalWidth || !image.naturalHeight) return null;
  const data = imagePixels(image);
  if (!data) return null;
  const crop = coverCropRect(image.naturalWidth, image.naturalHeight, box.width, box.height);
  const left = Math.max(tile.left, box.left), right = Math.min(tile.right, box.right);
  const top = Math.max(tile.top, box.top), bottom = Math.min(tile.bottom, box.bottom);
  if (right <= left || bottom <= top) return null;
  const colour = [0, 0, 0];
  // A fixed 8×8 grid bounds the work even for an expanded tile.
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      const sx = crop.x + ((left + (x + 0.5) * (right - left) / 8 - box.left) / box.width) * crop.w;
      const sy = crop.y + ((top + (y + 0.5) * (bottom - top) / 8 - box.top) / box.height) * crop.h;
      const px = Math.max(0, Math.min(SIZE - 1, Math.floor(sx / image.naturalWidth * SIZE)));
      const py = Math.max(0, Math.min(SIZE - 1, Math.floor(sy / image.naturalHeight * SIZE)));
      const offset = (py * SIZE + px) * 4;
      for (let c = 0; c < 3; c++) colour[c] += data[offset + c] / 64;
    }
  }
  const amount = Math.min(1, Math.abs(brightness - 50) / 50);
  const target = brightness < 50 ? 0 : 255;
  return colour.map(c => Math.round(c + (target - c) * amount)) as WallpaperRgb;
}
