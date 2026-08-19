/**
 * The icon vocabulary a pinned tab may be given by hand.
 *
 * Keys, not components, are what get stored. A pin lives in the settings blob
 * as JSON and has to survive a lucide upgrade renaming an export, a build that
 * tree-shakes differently, and being read by a client on an older bundle — so
 * the persisted value is a short stable string of ours, and an unknown one
 * falls back to the derived icon rather than rendering nothing.
 *
 * Deliberately free of React: the picker, the tab bar and any test that wants
 * to assert on a stored value all need the key list, and none of them should
 * have to import the bar to get it.
 */

/** A stored icon key. Never widen this to `string` at a persistence boundary. */
export type TabIconKey = string;

/** The groups the picker shows, in order. */
export const TAB_ICON_GROUPS: { label: string; keys: TabIconKey[] }[] = [
  {
    label: 'Rooms',
    keys: [
      'sofa', 'bed', 'cooking-pot', 'utensils', 'bath', 'shower', 'desk',
      'books', 'laundry', 'wardrobe', 'store', 'garage', 'garden', 'balcony',
      'pool', 'plant', 'door', 'stairs', 'nursery', 'gym', 'cinema', 'games',
      'bar', 'studio', 'pets', 'utility',
    ],
  },
  {
    label: 'Accessories',
    keys: [
      'lightbulb', 'lamp', 'blinds', 'lock', 'unlock', 'fan', 'outlet',
      'thermostat', 'shield', 'power', 'camera', 'doorbell', 'speaker', 'tv',
      'sensor', 'water', 'flame', 'battery', 'wifi', 'switch',
    ],
  },
  {
    label: 'General',
    keys: [
      'home', 'star', 'heart', 'bookmark', 'flag', 'bell', 'clock', 'calendar',
      'sun', 'moon', 'sunrise', 'sunset', 'sparkles', 'zap', 'play', 'layers',
      'folder', 'grid', 'compass', 'map-pin', 'user', 'users', 'settings',
      'coffee', 'music', 'car', 'briefcase', 'gift',
    ],
  },
];

/** Flat list of every key the picker offers. */
export const TAB_ICON_KEYS: TabIconKey[] = TAB_ICON_GROUPS.flatMap(g => g.keys);

/** Whether a stored value still names an icon we can draw. */
export function isTabIconKey(value: unknown): value is TabIconKey {
  return typeof value === 'string' && TAB_ICON_KEYS.includes(value);
}

/**
 * A stored key, or undefined if it no longer names anything.
 *
 * The caller falls back to the derived icon, which is why this returns
 * undefined rather than a default: a tab whose custom icon has been retired
 * should look like a tab that never had one, not like a question mark.
 */
export function normalizeTabIcon(value: unknown): TabIconKey | undefined {
  return isTabIconKey(value) ? value : undefined;
}
