import { useBackgroundContext } from '@/contexts/BackgroundContext';
import { resolveWidgetTint, STANDARD_TINT, type TintResult } from '@/lib/widget-tint';
import type { IconColor, IconStyle } from './iconColors';

/**
 * A tile's fill and the ink that goes on it, for a component that renders
 * `WidgetCard` rather than living inside one.
 *
 * `WidgetCard` publishes the resolved tone on `WidgetColorContext`, so anything
 * *inside* a card should read `useWidgetColors().onDark` instead. But the
 * widgets themselves — LightbulbWidget, ThermostatWidget, ServiceGroupWidget,
 * VirtualAccessoryWidget — are what render the card, so they sit outside its
 * provider and cannot.
 *
 * They used to answer it by hand, each recomputing `!isOn && isDarkBackground`.
 * That was survivable while the fill was one of two fixed colours. It is not
 * now: the fill depends on the accent, the alpha, the intensity and the
 * wallpaper's luminance, and any call site that assembles those slightly
 * differently paints ink that does not match the tile under it. This is the one
 * assembly, so they cannot disagree.
 */
export interface TileToneInput {
  /** The service type's palette entry, if it has one. */
  colors?: IconColor | null;
  iconStyle?: IconStyle;
  /** How far on, 0-1; null for an accessory with no proportion. */
  intensity?: number | null;
  isOn: boolean;
}

export interface TileTone extends TintResult {
  /** True when the fill is dark enough that content needs white ink. */
  onDark: boolean;
}

export function useTileTone({
  colors,
  iconStyle = 'standard',
  intensity,
  isOn,
}: TileToneInput): TileTone {
  const { isDarkBackground, effectiveLuminance } = useBackgroundContext();
  const colourful = iconStyle === 'colourful';
  const tint = resolveWidgetTint({
    tint: colourful ? colors?.tint : STANDARD_TINT,
    intensity,
    isOn,
    isDarkWallpaper: isDarkBackground,
    wallpaperLuminance: effectiveLuminance,
    alpha: colourful ? colors?.tintAlpha : undefined,
  });
  return { ...tint, onDark: tint.tone === 'light' };
}
