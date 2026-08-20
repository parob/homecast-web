/**
 * How the pinned tab bar draws itself.
 *
 * A leaf, like `pinned-tabs.ts`: the bar, the settings screen and the tests all
 * need the same three names, and none of them should have to import each other
 * to get them.
 *
 * Only `regular` can outgrow the bar. The other two are sized to always fit,
 * which is what lets them do without a scroller — and a bar you scroll is a bar
 * whose far end you have to remember is there.
 */
export type TabBarMode = 'regular' | 'compact' | 'icon';

export const TAB_BAR_MODES: readonly TabBarMode[] = ['regular', 'compact', 'icon'] as const;

export const DEFAULT_TAB_BAR_MODE: TabBarMode = 'regular';

/** How each reads on the settings screen. */
export const TAB_BAR_MODE_LABELS: Record<TabBarMode, string> = {
  regular: 'Regular',
  compact: 'Compact',
  icon: 'Icons',
};

export const TAB_BAR_MODE_HINTS: Record<TabBarMode, string> = {
  regular: 'Name beside each icon',
  compact: 'Name under each icon',
  icon: 'Icons only — swipe along the bar',
};

/**
 * A stored value, or the default if it no longer names a mode.
 *
 * Settings are a JSON blob that outlives any one build, and a client on an
 * older bundle reads the same one — so an unknown mode has to mean "the usual
 * bar" rather than nothing at all.
 */
export function normalizeTabBarMode(value: unknown): TabBarMode {
  return TAB_BAR_MODES.includes(value as TabBarMode) ? value as TabBarMode : DEFAULT_TAB_BAR_MODE;
}

/** Whether this mode's row is allowed to be wider than the bar. */
export function tabBarScrolls(mode: TabBarMode): boolean {
  return mode === 'regular';
}
