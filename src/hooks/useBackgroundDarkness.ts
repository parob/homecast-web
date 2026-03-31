import { useRef } from 'react';
import type { BackgroundSettings } from '@/lib/graphql/types';
import {
  getGradientLuminance,
  isDarkLuminance,
  PRESET_SOLID_COLORS,
  PRESET_GRADIENTS,
  PRESET_IMAGES,
} from '@/lib/colorUtils';

interface UseBackgroundDarknessResult {
  hasBackground: boolean;
  isDarkBackground: boolean;
  /** Raw luminance value (0-1, where 0 is black and 1 is white) */
  luminance: number | null;
  /** Effective luminance after applying brightness adjustment (0-1) */
  effectiveLuminance: number | null;
}

/**
 * Hook to determine if a background setting results in a dark background.
 * Solids and gradients are computed synchronously.
 * Image luminance is provided externally by BackgroundImage via onLuminanceChange.
 */
export function useBackgroundDarkness(
  settings: BackgroundSettings | null | undefined,
  imageLuminance?: number | null,
): UseBackgroundDarknessResult {
  // Hold previous isDarkBackground to avoid flashing during image transitions
  const prevDarkRef = useRef(false);

  // Determine if there's an active background
  // solid-white is special: it means "no background" for widget rendering purposes
  const isSolidWhite = settings?.type === 'preset' && settings?.presetId === 'solid-white';
  const hasBackground = settings?.type !== undefined && settings?.type !== 'none' && !isSolidWhite;

  // Determine the analysis target type
  const analysisTarget = (() => {
    if (!settings?.type || settings.type === 'none') return null;

    if (settings.type === 'preset' && settings.presetId) {
      if (settings.presetId === 'solid-white') return null;
      if (PRESET_SOLID_COLORS[settings.presetId]) {
        return { type: 'solid' as const, color: PRESET_SOLID_COLORS[settings.presetId] };
      }
      if (PRESET_GRADIENTS[settings.presetId]) {
        return { type: 'gradient' as const, value: PRESET_GRADIENTS[settings.presetId] };
      }
      if (PRESET_IMAGES[settings.presetId]) {
        return { type: 'image' as const };
      }
    }

    if (settings.type === 'custom' && settings.customUrl) {
      return { type: 'image' as const };
    }

    return null;
  })();

  // Calculate luminance values
  const { luminance, effectiveLuminance, isDarkBackground } = (() => {
    if (!hasBackground || !analysisTarget) {
      return { luminance: null, effectiveLuminance: null, isDarkBackground: false };
    }

    const brightness = settings?.brightness ?? 50;
    let rawLuminance: number | null = null;

    if (analysisTarget.type === 'solid') {
      const hex = analysisTarget.color.replace('#', '');
      const r = parseInt(hex.substring(0, 2), 16) / 255;
      const g = parseInt(hex.substring(2, 4), 16) / 255;
      const b = parseInt(hex.substring(4, 6), 16) / 255;
      rawLuminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    } else if (analysisTarget.type === 'gradient') {
      rawLuminance = getGradientLuminance(analysisTarget.value);
    } else if (analysisTarget.type === 'image' && imageLuminance != null) {
      rawLuminance = imageLuminance;
    }

    if (rawLuminance !== null) {
      let effective: number;
      if (brightness < 50) {
        const darkenAmount = (50 - brightness) / 50;
        effective = rawLuminance * (1 - darkenAmount);
      } else if (brightness > 50) {
        const brightenAmount = (brightness - 50) / 50;
        effective = rawLuminance + (1 - rawLuminance) * brightenAmount;
      } else {
        effective = rawLuminance;
      }

      return {
        luminance: rawLuminance,
        effectiveLuminance: effective,
        isDarkBackground: isDarkLuminance(rawLuminance, brightness),
      };
    }

    // Image luminance not yet available — hold previous dark state to avoid flashing
    if (analysisTarget.type === 'image') {
      return { luminance: null, effectiveLuminance: null, isDarkBackground: prevDarkRef.current };
    }

    return { luminance: null, effectiveLuminance: null, isDarkBackground: false };
  })();

  // Update ref when we have a definitive answer
  prevDarkRef.current = isDarkBackground;

  return {
    hasBackground,
    isDarkBackground,
    luminance,
    effectiveLuminance,
  };
}
