/**
 * Where a dialog belongs when an expanded panel is already on screen.
 *
 * `ExpandedOverlay` portals to document.body, so a dialog opened from its
 * action bar (Analytics, Price & Deals, Edit, Share) is a SIBLING rather than a
 * descendant — z-index alone separates them. On the dashboard the panel sits
 * below dialog level (10017/10018) and the static 10050 was enough.
 *
 * Inside the accessory-search dialog it is not. The panel there has to clear
 * the search dialog itself, so it is raised to 10051/10052 — and the History
 * dialog then opened *underneath the panel that opened it*, greyed out by that
 * panel's own blurred scrim. The right number cannot be picked ahead of time;
 * it has to be read at the moment the dialog opens.
 *
 * Read ONCE, at open. A dialog that a panel is later elevated *inside* must
 * keep the level it opened with, or the two chase each other upwards forever:
 * the search dialog stays at 10050 and the panel clears it, while the dialog
 * the panel opens clears the panel.
 */

/** The resting level for a dialog — `z-[10050]` in `ui/dialog.tsx`. */
export const DIALOG_Z = 10050;

const openPanels = new Map<number, number>();
let nextId = 1;

/** Publish an open panel's elevation. Returns the unregister. */
export function registerPanelElevation(z: number): () => void {
  const id = nextId++;
  openPanels.set(id, z);
  return () => { openPanels.delete(id); };
}

/** The highest panel currently open, or 0 when none is. */
export function topPanelElevation(): number {
  let top = 0;
  for (const z of openPanels.values()) if (z > top) top = z;
  return top;
}

/**
 * Where a dialog opening now belongs, given the panels already up.
 *
 * A panel below dialog level changes nothing — that is the dashboard, and the
 * overwhelmingly common case.
 */
export function dialogElevation(topPanel: number): number {
  return topPanel >= DIALOG_Z ? topPanel + 1 : DIALOG_Z;
}

/** Test seam: forget every registered panel. */
export function __resetPanelElevations(): void {
  openPanels.clear();
}
