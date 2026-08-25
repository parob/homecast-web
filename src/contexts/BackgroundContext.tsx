import { createContext, useContext } from 'react';

interface BackgroundContextType {
  /** Whether there's an active background image/gradient */
  hasBackground: boolean;
  /** Whether the background is dark (requires light text) */
  isDarkBackground: boolean;
  /**
   * The wallpaper's luminance, 0-1, after its brightness adjustment — or null
   * when there is nothing to measure (no wallpaper) or nothing measured yet
   * (an image still decoding).
   *
   * `isDarkBackground` is this number past a threshold, which is all a widget
   * needed while its fill was one of two fixed colours. A proportional fill has
   * to be composited over the wallpaper to know whether it takes white or black
   * ink, and that needs the number itself. Consumers must handle null —
   * `lib/widget-tint.ts` falls back to the dark flag.
   */
  effectiveLuminance: number | null;
}

export const BackgroundContext = createContext<BackgroundContextType>({
  hasBackground: false,
  isDarkBackground: false,
  effectiveLuminance: null,
});

export const useBackgroundContext = () => useContext(BackgroundContext);
