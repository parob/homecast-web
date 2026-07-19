export const REGION_LABELS: Record<string, string> = {
  us: 'United States',
  gb: 'United Kingdom',
  eu: 'Europe',
  au: 'Australia',
};

export const REGION_OPTIONS = Object.entries(REGION_LABELS).map(([value, label]) => ({ value, label }));

export function regionLabel(code: string | null | undefined): string | null {
  if (!code) return null;
  return REGION_LABELS[code] ?? code.toUpperCase();
}

/**
 * Best-guess default region for a new enrollment, from the browser's locale
 * (e.g. "en-GB" → "gb"). Falls back to "gb" — the current relay fleet region.
 * The user confirms/changes it in the enrollment dropdown.
 */
export function guessRegion(): string {
  try {
    const region = new Intl.Locale(navigator.language).region?.toLowerCase();
    if (region && region in REGION_LABELS) return region;
  } catch {
    /* ignore */
  }
  return 'gb';
}
