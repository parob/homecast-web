// Home coordinates for sun trigger/condition maths.
//
// HomeKit doesn't expose a home's location to apps, so we cache a one-shot
// geolocation reading. Returns undefined rather than guessing — leaving sun
// triggers unscheduled beats firing them against lat 0 / lon 0 (the Gulf of
// Guinea), which is what happened before this existed.

export interface HomeLocation {
  latitude: number;
  longitude: number;
}

const SETTING_KEY = 'automation-location';
const GEOLOCATION_TIMEOUT_MS = 10_000;
const MAX_CACHE_AGE_MS = 24 * 60 * 60_000;

export interface LocationStore {
  getSetting(key: string): Promise<string | null>;
  setSetting(key: string, value: string): Promise<void>;
}

export async function resolveHomeLocation(store?: LocationStore): Promise<HomeLocation | undefined> {
  if (store) {
    try {
      const stored = await store.getSetting(SETTING_KEY);
      if (stored) {
        const parsed = JSON.parse(stored) as Partial<HomeLocation>;
        if (typeof parsed.latitude === 'number' && typeof parsed.longitude === 'number') {
          return { latitude: parsed.latitude, longitude: parsed.longitude };
        }
      }
    } catch { /* fall through to a fresh reading */ }
  }

  if (typeof navigator === 'undefined' || !navigator.geolocation) return undefined;

  const position = await new Promise<GeolocationPosition | null>((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (p) => resolve(p),
      () => resolve(null),
      { timeout: GEOLOCATION_TIMEOUT_MS, maximumAge: MAX_CACHE_AGE_MS },
    );
  });

  if (!position) {
    console.warn('[Automation] No location available — sun triggers will not be scheduled');
    return undefined;
  }

  const location: HomeLocation = {
    latitude: position.coords.latitude,
    longitude: position.coords.longitude,
  };

  if (store) {
    try {
      await store.setSetting(SETTING_KEY, JSON.stringify(location));
    } catch { /* caching is best-effort */ }
  }

  return location;
}
