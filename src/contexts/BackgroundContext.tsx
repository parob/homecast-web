import { createContext, useContext } from 'react';

interface BackgroundContextType {
  /** Whether there's an active background image/gradient */
  hasBackground: boolean;
  /** Whether the background is dark (requires light text) */
  isDarkBackground: boolean;
}

export const BackgroundContext = createContext<BackgroundContextType>({
  hasBackground: false,
  isDarkBackground: false,
});

export const useBackgroundContext = () => useContext(BackgroundContext);
