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
 */
function getLuminance(r: number, g: number, b: number): number {
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
function parseColor(color: string): { r: number; g: number; b: number } | null {
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
 * Get the average color of the top row of pixels from a loaded image.
 * Used for iOS 26 Safari Liquid Glass tinting of image backgrounds.
 * Returns a hex color string.
 */
export function getImageTopColor(img: HTMLImageElement, brightness: number = 50): string {
  try {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) return '#888888';

    // Sample the top 5% of the source image, scaled down to a small canvas
    const sampleWidth = 50;
    const sampleHeight = 5;
    const sourceHeight = Math.ceil(img.naturalHeight * 0.05);
    canvas.width = sampleWidth;
    canvas.height = sampleHeight;

    ctx.drawImage(img, 0, 0, img.naturalWidth, sourceHeight, 0, 0, sampleWidth, sampleHeight);
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
  const imagePresetIds = Object.keys(PRESET_IMAGES);
  return imagePresetIds[Math.abs(hash) % imagePresetIds.length];
}
