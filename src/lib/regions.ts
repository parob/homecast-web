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
