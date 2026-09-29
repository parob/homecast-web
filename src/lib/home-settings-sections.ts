/**
 * The sections a single home has in Settings.
 *
 * Settings → Homes → a home is one page: the overview, then each of these
 * stacked beneath it in this order. They used to be pages of their own behind a
 * third navigation level, which cost a tap per setting for a handful of
 * switches. Reliability is not one of them: it lives in the overview's
 * Connection card.
 *
 * It is a leaf on purpose — no React, no Apollo, no `window`. The one impure
 * input it needs (`isMQTTAvailable()`, which pokes at `window.webkit`) is
 * passed in as a flag rather than imported, which is what makes the gate
 * testable without a DOM.
 */

export type HomeSettingsSectionId =
  | 'home-screen'
  | 'notifications'
  | 'analytics'
  | 'cameras'
  | 'mqtt';

/** Render order, top to bottom. Display preferences first, plumbing last. */
export const HOME_SETTINGS_SECTION_ORDER: HomeSettingsSectionId[] = [
  'home-screen',
  'notifications',
  'analytics',
  'cameras',
  'mqtt',
];

export interface HomeSettingsSectionFlags {
  /** Community edition — no cloud backend, so no push and no uptime samples. */
  isCommunity: boolean;
  developerMode: boolean;
  /** `isMQTTAvailable()` — whether this build has the native MQTT bridge. */
  mqttBridgeAvailable: boolean;
}

/**
 * The sub-sections this home shows, in order.
 *
 * The gates mirror what each section already did inline, with one deliberate
 * tightening: a Community build with developer mode on but no native bridge
 * used to render a bare "MQTT" heading with nothing beneath it, so it is hidden.
 */
export function visibleHomeSettingsSections(flags: HomeSettingsSectionFlags): HomeSettingsSectionId[] {
  const { isCommunity, developerMode, mqttBridgeAvailable } = flags;

  return HOME_SETTINGS_SECTION_ORDER.filter(id => {
    switch (id) {
      case 'notifications':
        // Push is a cloud feature; the whole Notifications surface is hidden in CE.
        return !isCommunity;
      case 'cameras':
        // Captured by the Cloud Relay's engine window, so CE has nothing to
        // offer. Every cloud home gets the page: one that is not cloud-managed
        // sees the switch off and why, rather than no feature at all.
        return !isCommunity;
      case 'mqtt':
        return developerMode && (!isCommunity || mqttBridgeAvailable);
      default:
        return true;
    }
  });
}
