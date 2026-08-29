/** One home, shown on two screens: the desktop and the phone read and write the same state. */
import { useState } from 'react';

export type HomeMode = 'Home' | 'Away' | 'Night' | 'Vacation';

export interface HomeState {
  lights: { on: boolean; brightness: number; temp: number };
  guest: boolean;
  fan: { on: boolean; speed: number };
  /** % open */
  blinds: number;
  doorOpens: number;
  mode: HomeMode;
  locked: boolean;
  motion: boolean;
  gardenLights: boolean;
  irrigation: boolean;
  kitchenLights: boolean;
  coffee: boolean;
}

export interface Home {
  s: HomeState;
  patch: (p: Partial<HomeState>) => void;
}

const INITIAL: HomeState = {
  lights: { on: true, brightness: 59, temp: 73 },
  guest: true,
  fan: { on: true, speed: 50 },
  blinds: 40,
  doorOpens: 4,
  mode: 'Away',
  locked: true,
  motion: false,
  gardenLights: true,
  irrigation: false,
  kitchenLights: true,
  coffee: false,
};

export function useHomeState(): Home {
  const [s, set] = useState<HomeState>(INITIAL);
  return { s, patch: (p) => set((x) => ({ ...x, ...p })) };
}
