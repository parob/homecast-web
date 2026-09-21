/**
 * Color utilities for analyzing background brightness
 */

/**
 * Parse a hex color to RGB values
 */
function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  // Remove # if present
  hex = hex.replace(/^#/, '');

  // Handle shorthand (e.g., #fff)
  if (hex.length === 3) {
    hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2];
  }

  if (hex.length !== 6) return null;

  const num = parseInt(hex, 16);
  return {
    r: (num >> 16) & 255,
    g: (num >> 8) & 255,
    b: num & 255,
  };
}

/**
 * Calculate relative luminance of an RGB color (0-1 scale)
 * Using the formula from WCAG 2.0
 *
 * Exported for `lib/widget-tint.ts`, which needs the same maths to decide
 * whether a widget's fill takes white or black ink. One copy, so the two
 * answers can never drift.
 */
export function getLuminance(r: number, g: number, b: number): number {
  const [rs, gs, bs] = [r, g, b].map(c => {
    c = c / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs;
}

/**
 * Extract colors from a CSS gradient string
 */
function extractGradientColors(gradient: string): string[] {
  const colors: string[] = [];

  // Match hex colors
  const hexMatches = gradient.match(/#[0-9a-fA-F]{3,6}/g);
  if (hexMatches) colors.push(...hexMatches);

  // Match rgb/rgba colors
  const rgbMatches = gradient.match(/rgba?\s*\(\s*\d+\s*,\s*\d+\s*,\s*\d+/g);
  if (rgbMatches) {
    rgbMatches.forEach(match => {
      const nums = match.match(/\d+/g);
      if (nums && nums.length >= 3) {
        colors.push(`rgb(${nums[0]},${nums[1]},${nums[2]})`);
      }
    });
  }

  return colors;
}

/**
 * Parse any color string to RGB
 */
export function parseColor(color: string): { r: number; g: number; b: number } | null {
  // Hex color
  if (color.startsWith('#')) {
    return hexToRgb(color);
  }

  // RGB/RGBA color
  const rgbMatch = color.match(/rgba?\s*\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
  if (rgbMatch) {
    return {
      r: parseInt(rgbMatch[1], 10),
      g: parseInt(rgbMatch[2], 10),
      b: parseInt(rgbMatch[3], 10),
    };
  }

  return null;
}

/**
 * Calculate average luminance of a CSS gradient
 * Returns a value between 0 (dark) and 1 (light)
 */
export function getGradientLuminance(gradient: string): number {
  const colors = extractGradientColors(gradient);
  if (colors.length === 0) return 0.5; // Default to middle

  let totalLuminance = 0;
  let validColors = 0;

  for (const color of colors) {
    const rgb = parseColor(color);
    if (rgb) {
      totalLuminance += getLuminance(rgb.r, rgb.g, rgb.b);
      validColors++;
    }
  }

  return validColors > 0 ? totalLuminance / validColors : 0.5;
}

/**
 * Analyze an already-loaded HTMLImageElement and return its average luminance.
 * Returns a value between 0 (dark) and 1 (light).
 * Uses canvas sampling at 50x50 for performance.
 */
export function analyzeLoadedImage(img: HTMLImageElement): number {
  try {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) return 0.5;

    const sampleSize = 50;
    canvas.width = sampleSize;
    canvas.height = sampleSize;

    ctx.drawImage(img, 0, 0, sampleSize, sampleSize);

    const imageData = ctx.getImageData(0, 0, sampleSize, sampleSize);
    const data = imageData.data;

    let totalLuminance = 0;
    const pixelCount = data.length / 4;

    for (let i = 0; i < data.length; i += 4) {
      totalLuminance += getLuminance(data[i], data[i + 1], data[i + 2]);
    }

    return totalLuminance / pixelCount;
  } catch {
    // CORS or other error — image loaded but can't read pixels
    return 0.5;
  }
}

/**
 * The fraction of a background image the app header sits over.
 *
 * The header is 80px tall on a phone (plus the safe-area inset) against a
 * viewport around 850–950px, so a sixth is generous rather than tight — it
 * wants to describe what is *behind and just under* the controls, not only the
 * pixels they cover.
 */
export const HEADER_BAND_FRACTION = 0.16;

/**
 * Average luminance of the TOP BAND of a loaded image, rather than of all of it.
 *
 * The whole-image average answers "is this wallpaper dark", which is the right
 * question for body text and tiles and the wrong one for the header: a photo of
 * trees under a bright sky averages dark while the strip the controls sit on is
 * nearly white. That mismatch was invisible while each control carried its own
 * filled disc, and became the one bad case the moment the discs came off
 * (parob/homecast-cloud#118).
 *
 * Approximate in one known way: the background is painted with `object-fit:
 * cover`, so on a viewport whose aspect ratio differs from the image's, the
 * visible top band is not exactly the image's top band. It is still far closer
 * than the whole-image mean, and the cost is one more 50×50 canvas read beside
 * the one already being taken.
 */
export function analyzeLoadedImageBand(img: HTMLImageElement, fraction = HEADER_BAND_FRACTION): number {
  try {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) return 0.5;

    const sampleSize = 50;
    canvas.width = sampleSize;
    canvas.height = sampleSize;

    const bandHeight = Math.max(1, Math.round(img.naturalHeight * fraction));
    // Source rect is the band; destination is the whole sample canvas, so every
    // sampled pixel comes from the band.
    ctx.drawImage(img, 0, 0, img.naturalWidth, bandHeight, 0, 0, sampleSize, sampleSize);

    const data = ctx.getImageData(0, 0, sampleSize, sampleSize).data;
    let totalLuminance = 0;
    for (let i = 0; i < data.length; i += 4) {
      totalLuminance += getLuminance(data[i], data[i + 1], data[i + 2]);
    }
    return totalLuminance / (data.length / 4);
  } catch {
    // CORS or other error — image loaded but can't read pixels
    return 0.5;
  }
}

/**
 * Analyze an image URL and return its average luminance
 * Returns a Promise that resolves to a value between 0 (dark) and 1 (light)
 */
export function getImageLuminance(imageUrl: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';

    img.onload = () => {
      resolve(analyzeLoadedImage(img));
    };

    img.onerror = () => {
      reject(new Error('Image failed to load'));
    };

    // Set a timeout for slow loading images
    setTimeout(() => reject(new Error('Image load timed out')), 5000);

    img.src = imageUrl;
  });
}

/**
 * Determine if a luminance value represents a "dark" background
 * Takes into account any dimming overlay
 */
export function isDarkLuminance(luminance: number, brightness: number = 50): boolean {
  // Apply brightness adjustment
  // brightness 50 = no change, <50 = darker, >50 = brighter
  let effectiveLuminance: number;

  if (brightness < 50) {
    // Darken: brightness 0 = black (0), brightness 50 = original
    const darkenAmount = (50 - brightness) / 50; // 0 to 1
    effectiveLuminance = luminance * (1 - darkenAmount);
  } else if (brightness > 50) {
    // Brighten: brightness 50 = original, brightness 100 = white (1)
    const brightenAmount = (brightness - 50) / 50; // 0 to 1
    effectiveLuminance = luminance + (1 - luminance) * brightenAmount;
  } else {
    effectiveLuminance = luminance;
  }

  // Threshold for "dark" - 0.8 means only very bright backgrounds won't trigger light text
  return effectiveLuminance < 0.8;
}

// Solid color presets - 'solid-white' is special and means "no background" for widget rendering
export const PRESET_SOLID_COLORS: Record<string, string> = {
  'solid-white': '#ffffff',
  'solid-light-gray': '#f5f5f5',
  'solid-dark-gray': '#374151',
  'solid-black': '#0a0a0a',
  'solid-blue': '#3b82f6',
  'solid-green': '#22c55e',
  'solid-red': '#ef4444',
  'solid-purple': '#a855f7',
};

// Gradient URL map for preset lookup
export const PRESET_GRADIENTS: Record<string, string> = {
  // Simple linear gradients
  'gradient-blue': 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
  'gradient-purple': 'linear-gradient(135deg, #f093fb 0%, #f5576c 100%)',
  'gradient-ocean': 'linear-gradient(135deg, #4facfe 0%, #00f2fe 100%)',
  'gradient-night': 'linear-gradient(135deg, #0c0c0c 0%, #1a1a2e 50%, #16213e 100%)',
  'gradient-warm': 'linear-gradient(135deg, #f5af19 0%, #f12711 100%)',
  'gradient-cool': 'linear-gradient(135deg, #2193b0 0%, #6dd5ed 100%)',
  // Mesh-style — layered radial blobs for an organic Apple-like look
  'gradient-aurora': 'radial-gradient(at 80% 20%, #4ecdc4 0%, transparent 60%), radial-gradient(at 20% 80%, #e07676 0%, transparent 60%), radial-gradient(at 60% 60%, #667eea 0%, transparent 60%), radial-gradient(at 30% 30%, #d4a574 0%, transparent 50%), linear-gradient(135deg, #3a7bd5 0%, #6bb5a0 100%)',
  'gradient-sunset': 'radial-gradient(at 80% 80%, #f9d423 0%, transparent 55%), radial-gradient(at 20% 70%, #e06b8d 0%, transparent 60%), radial-gradient(at 50% 20%, #b8c97e 0%, transparent 55%), linear-gradient(160deg, #d4956a 0%, #c9a87c 100%)',
  'gradient-coral': 'radial-gradient(at 70% 70%, #f97316 0%, transparent 55%), radial-gradient(at 20% 30%, #c084b8 0%, transparent 55%), radial-gradient(at 80% 20%, #e88ea0 0%, transparent 50%), linear-gradient(135deg, #d47a8e 0%, #cf8a6e 100%)',
  'gradient-lagoon': 'radial-gradient(at 30% 80%, #0d9488 0%, transparent 55%), radial-gradient(at 70% 20%, #5b8ac4 0%, transparent 60%), radial-gradient(at 80% 70%, #6ea5b8 0%, transparent 50%), linear-gradient(180deg, #4a7ea5 0%, #3a9a8e 100%)',
  'gradient-dusk': 'radial-gradient(at 80% 30%, #818cf8 0%, transparent 55%), radial-gradient(at 20% 60%, #c084b8 0%, transparent 55%), radial-gradient(at 50% 90%, #5b6daa 0%, transparent 50%), linear-gradient(135deg, #6a5d9e 0%, #8878b5 100%)',
  'gradient-rose': 'radial-gradient(at 70% 80%, #d48a6e 0%, transparent 50%), radial-gradient(at 20% 30%, #c27090 0%, transparent 55%), radial-gradient(at 80% 20%, #e0a0a0 0%, transparent 50%), linear-gradient(135deg, #c87888 0%, #d49888 100%)',
};

// Image URL map for preset lookup (local images in public/backgrounds/)
export const PRESET_IMAGES: Record<string, string> = {
  'nature-forest': '/backgrounds/forest.png',
  'nature-mountains': '/backgrounds/mountain.png',
  'nature-beach': '/backgrounds/beach.png',
  'nature-cliffs': '/backgrounds/cliffs.png',
  'nature-desert': '/backgrounds/desert.png',
  'nature-canyon': '/backgrounds/canyon.png',
  'nature-countryside': '/backgrounds/countryside.png',
  'abstract-blue': '/backgrounds/abstract_blue.png',
  'abstract-orange': '/backgrounds/abstract_orange.png',
  'abstract-forest': '/backgrounds/abstract_forest.png',
  'abstract-mountains': '/backgrounds/abstract_mountains.png',
  'abstract-clouds': '/backgrounds/colourful_clouds.png',
};

/**
 * Get the top-edge color of a background preset as a hex string.
 * Used by iOS 26 Safari Liquid Glass tinting — the html/body background-color
 * must match what's visible at the top of the screen so the translucent
 * status bar blends naturally.
 *
 * For gradients: renders to a canvas and samples the top row of pixels.
 * For solid colors: returns the exact color.
 * Applies brightness adjustment to match the BackgroundLayer rendering.
 */
export function getDominantColor(presetId: string, brightness: number = 50): string {
  // Solid colors — exact match
  if (PRESET_SOLID_COLORS[presetId]) {
    let { r, g, b } = parseColor(PRESET_SOLID_COLORS[presetId]) || { r: 128, g: 128, b: 128 };
    return applyBrightness(r, g, b, brightness);
  }

  // Gradients — weighted average of color stops (earlier stops weighted more
  // since they're more likely to appear at the top of the screen)
  const gradient = PRESET_GRADIENTS[presetId];
  if (gradient) {
    const colors = extractGradientColors(gradient);
    if (colors.length > 0) {
      let totalR = 0, totalG = 0, totalB = 0, totalWeight = 0;
      for (let i = 0; i < colors.length; i++) {
        const rgb = parseColor(colors[i]);
        if (rgb) {
          const weight = colors.length - i;
          totalR += rgb.r * weight;
          totalG += rgb.g * weight;
          totalB += rgb.b * weight;
          totalWeight += weight;
        }
      }
      if (totalWeight > 0) {
        const r = Math.round(totalR / totalWeight);
        const g = Math.round(totalG / totalWeight);
        const b = Math.round(totalB / totalWeight);
        return applyBrightness(r, g, b, brightness);
      }
    }
  }

  return '#888888';
}

/**
 * Apply brightness adjustment to an RGB color, matching BackgroundLayer's overlay.
 * brightness 50 = no change, <50 = darken (black overlay), >50 = brighten (white overlay).
 */
export function applyBrightnessToHex(hex: string, brightness: number): string {
  const rgb = parseColor(hex);
  if (!rgb) return hex;
  return applyBrightness(rgb.r, rgb.g, rgb.b, brightness);
}

/**
 * Re-expose a colour at a given relative luminance, keeping its hue.
 *
 * The scaling is done in LINEAR light — the same space `getLuminance` measures
 * in — so the three channels keep their ratios to each other and only the
 * exposure moves. Doing it on the sRGB bytes instead would pull a colour
 * towards grey as it darkened, which is exactly the character the band is
 * supposed to keep.
 *
 * `target` is a relative luminance in 0–1, as `analyzeLoadedImage` reports it.
 * A target a colour cannot reach without clipping (asking a saturated blue for
 * the luminance of white) lands as close as it can and desaturates on the way,
 * which is what an over-exposure does anyway. Black has no hue to keep, so it
 * answers with the neutral grey of that luminance rather than dividing by zero.
 */
export function setLuminanceHex(hex: string, target: number): string {
  const rgb = parseColor(hex);
  if (!rgb) return hex;
  const t = Math.min(1, Math.max(0, target));
  const toLinear = (c: number) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  const toByte = (v: number) => {
    const c = Math.min(1, Math.max(0, v));
    const s = c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
    return Math.round(s * 255);
  };
  const hexOf = (r: number, g: number, b: number) =>
    `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;

  const r = toLinear(rgb.r), g = toLinear(rgb.g), b = toLinear(rgb.b);
  const current = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  if (current <= 0) {
    const v = toByte(t);
    return hexOf(v, v, v);
  }
  const k = t / current;
  return hexOf(toByte(r * k), toByte(g * k), toByte(b * k));
}

/** Mix a hex colour towards white by `amount` (0–1). Non-hex input is returned unchanged. */
export function lightenHex(hex: string, amount: number): string {
  const rgb = parseColor(hex);
  if (!rgb) return hex;
  const lift = Math.min(1, Math.max(0, amount));
  const r = Math.round(rgb.r + (255 - rgb.r) * lift);
  const g = Math.round(rgb.g + (255 - rgb.g) * lift);
  const b = Math.round(rgb.b + (255 - rgb.b) * lift);
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
}

function applyBrightness(r: number, g: number, b: number, brightness: number): string {
  if (brightness !== 50) {
    const amount = Math.abs(brightness - 50) / 50;
    const target = brightness < 50 ? 0 : 255;
    r = Math.round(r + (target - r) * amount);
    g = Math.round(g + (target - g) * amount);
    b = Math.round(b + (target - b) * amount);
  }
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
}

/**
 * The part of an image that `object-fit: cover; object-position: center`
 * shows in a box — in image pixels. Pure, so the sampler below can be checked
 * without a canvas.
 *
 * `scale` is a uniform enlargement applied on top (the blurred wallpaper is
 * drawn at 1.1× to hide its soft edges), which crops the same amount more.
 */
export function coverCropRect(
  imgW: number, imgH: number, boxW: number, boxH: number, scale = 1,
): { x: number; y: number; w: number; h: number } {
  if (imgW <= 0 || imgH <= 0 || boxW <= 0 || boxH <= 0) return { x: 0, y: 0, w: imgW, h: imgH };
  // Cover: the image is scaled by the larger of the two ratios, then centred.
  const s = Math.max(boxW / imgW, boxH / imgH) * scale;
  const w = Math.min(imgW, boxW / s);
  const h = Math.min(imgH, boxH / s);
  return { x: (imgW - w) / 2, y: (imgH - h) / 2, w, h };
}

/**
 * Get the average color of the top rows of a loaded image AS DISPLAYED.
 * Used for iOS 26 Safari Liquid Glass tinting of image backgrounds: the page
 * canvas takes this colour, and it is what shows in the band behind the
 * status bar, right against the wallpaper's own top edge.
 *
 * "As displayed" matters: the wallpaper is painted with `object-fit: cover`,
 * so on a portrait phone a landscape photo shows a slice from its middle, and
 * the source image's top 5% (sky, a ceiling, dark water) can be nothing like
 * the row that actually meets the band. Pass the box the image fills to sample
 * the visible crop; with no box the whole image is assumed visible.
 * Returns a hex color string.
 */
export function getImageTopColor(
  img: HTMLImageElement,
  brightness: number = 50,
  box?: { width: number; height: number; scale?: number },
): string {
  return getImageEdgeColor(img, 'top', brightness, box);
}

/**
 * `getImageTopColor` for either edge. The bottom edge is what meets iOS
 * Safari's URL bar band, and on a wallpaper that runs sky-to-sand it is
 * nothing like the top.
 */
export function getImageEdgeColor(
  img: HTMLImageElement,
  edge: 'top' | 'bottom',
  brightness: number = 50,
  box?: { width: number; height: number; scale?: number },
): string {
  try {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) return '#888888';

    // Sample the outer 5% of the visible crop, scaled down to a small canvas
    const sampleWidth = 50;
    const sampleHeight = 5;
    const crop = box
      ? coverCropRect(img.naturalWidth, img.naturalHeight, box.width, box.height, box.scale ?? 1)
      : { x: 0, y: 0, w: img.naturalWidth, h: img.naturalHeight };
    // Whole pixels, clamped inside the image. The crop is computed in floats,
    // and a source rectangle that runs a fraction past the bottom edge is
    // clipped by Chrome but refused by Safari — which threw, fell through to
    // the grey below, and painted a grey bar under the URL bar.
    const sourceHeight = Math.max(1, Math.min(Math.floor(crop.h), Math.ceil(crop.h * 0.05)));
    const sourceX = Math.max(0, Math.floor(crop.x));
    const sourceWidth = Math.max(1, Math.min(img.naturalWidth - sourceX, Math.floor(crop.w)));
    const rawY = edge === 'top' ? crop.y : crop.y + crop.h - sourceHeight;
    const sourceY = Math.max(0, Math.min(img.naturalHeight - sourceHeight, Math.floor(rawY)));
    canvas.width = sampleWidth;
    canvas.height = sampleHeight;

    ctx.drawImage(img, sourceX, sourceY, sourceWidth, sourceHeight, 0, 0, sampleWidth, sampleHeight);
    const data = ctx.getImageData(0, 0, sampleWidth, sampleHeight).data;

    let totalR = 0, totalG = 0, totalB = 0;
    const pixelCount = data.length / 4;
    for (let i = 0; i < data.length; i += 4) {
      totalR += data[i];
      totalG += data[i + 1];
      totalB += data[i + 2];
    }

    let r = Math.round(totalR / pixelCount);
    let g = Math.round(totalG / pixelCount);
    let b = Math.round(totalB / pixelCount);

    // Apply brightness adjustment
    if (brightness !== 50) {
      const amount = Math.abs(brightness - 50) / 50;
      const target = brightness < 50 ? 0 : 255;
      r = Math.round(r + (target - r) * amount);
      g = Math.round(g + (target - g) * amount);
      b = Math.round(b + (target - b) * amount);
    }

    return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
  } catch {
    return '#888888';
  }
}

/**
 * Get a hex color from a luminance value (0=black, 1=white).
 * Used for image backgrounds where we only know the luminance.
 */
export function luminanceToHex(luminance: number): string {
  const v = Math.round(Math.max(0, Math.min(1, luminance)) * 255);
  return `#${v.toString(16).padStart(2, '0')}${v.toString(16).padStart(2, '0')}${v.toString(16).padStart(2, '0')}`;
}

/**
 * Get a deterministic preset image ID based on an entity ID hash.
 * Same entity ID always returns the same preset.
 */
export function getAutoPresetId(entityId: string): string {
  let hash = 0;
  for (let i = 0; i < entityId.length; i++) {
    hash = ((hash << 5) - hash) + entityId.charCodeAt(i);
    hash = hash & hash;
  }
  // Nature only. The abstract presets are still offered in the background
  // picker, but a home that assigns its own wallpapers should start from
  // photographs rather than from colour studies.
  const natureIds = Object.keys(PRESET_IMAGES).filter(id => id.startsWith('nature-'));
  const pool = natureIds.length > 0 ? natureIds : Object.keys(PRESET_IMAGES);
  return pool[Math.abs(hash) % pool.length];
}
