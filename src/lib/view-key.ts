/**
 * What counts as "a different view" for the purpose of resetting scroll.
 *
 * The dashboard never changes its pathname. Selecting a home, a room, a room
 * group, a collection or an enrollment all happen at `/portal`, expressed as
 * search params (`handleSelectRoom` → `updateUrlParams({ room })`). So keying
 * a navigation effect on `pathname` alone misses every navigation that happens
 * inside the app — which is most of them.
 *
 * See parob/homecast-cloud#175: a room entered from a scrolled home inherited
 * the home's scroll offset and opened with its title clipped off the top.
 */

/**
 * The params that identify WHICH view is being shown.
 *
 * `settings` is deliberately absent. It opens a dialog *over* the current page
 * rather than replacing it, so scrolling the page behind it back to the top
 * would lose the reader's place for nothing — and again when the dialog closes.
 */
export const VIEW_PARAMS = ['home', 'room', 'roomGroup', 'collection', 'enrollment'] as const;

/**
 * A stable string that changes exactly when the user is looking at a different
 * view. Pure, so the decision can be tested without a router or a DOM.
 *
 * Param ORDER in the URL is deliberately not significant: the key is built from
 * `VIEW_PARAMS` in a fixed order, so `?room=a&home=b` and `?home=b&room=a` are
 * the same view and do not trigger a reset.
 */
export function viewKeyOf(pathname: string, search: string): string {
  const params = new URLSearchParams(search);
  const parts = VIEW_PARAMS.map((key) => `${key}=${params.get(key) ?? ''}`);
  return [pathname, ...parts].join('|');
}
