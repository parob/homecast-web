/**
 * The sub-sections a single home has in Settings.
 *
 * Settings → Homes → a home used to be one long scroll of stacked headings.
 * Each of those headings is now a page of its own, reached from a third level
 * in the desktop sidebar or a third push level on mobile. This module is the
 * catalog both navigations read, so the sidebar and the mobile list can never
 * disagree about which rows a home has.
 *
 * It is a leaf on purpose — no React, no Apollo, no `window`. The one impure
 * input it needs (`isMQTTAvailable()`, which pokes at `window.webkit`) is
 * passed in as a flag rather than imported, which is what makes the gate
 * testable without a DOM.
 */

export type HomeSettingsSectionId =
  | 'home-screen'
  | 'notifications'
  | 'reliability'
  | 'analytics'
  | 'mqtt';

/** Render order, top to bottom. Display preferences first, plumbing last. */
export const HOME_SETTINGS_SECTION_ORDER: HomeSettingsSectionId[] = [
  'home-screen',
  'notifications',
  'reliability',
  'analytics',
  'mqtt',
];

export const HOME_SETTINGS_SECTION_META: Record<HomeSettingsSectionId, { label: string; description: string }> = {
  'home-screen': {
    label: 'Home Screen',
    description: 'Which pills the summary row shows for this home',
  },
  notifications: {
    label: 'Notifications',
    description: 'Silence this home, or individual automations, on this device',
  },
  reliability: {
    label: 'Reliability',
    description: 'Relay uptime and end-to-end probe results',
  },
  analytics: {
    label: 'Analytics',
    description: 'Record accessory history for charts and exports',
  },
  mqtt: {
    label: 'MQTT',
    description: 'Publish this home to an MQTT broker',
  },
};

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
 * used to render a bare "MQTT" heading with nothing beneath it. Inline that was
 * merely untidy; as a navigable row it would be a dead end, so it is hidden.
 */
export function visibleHomeSettingsSections(flags: HomeSettingsSectionFlags): HomeSettingsSectionId[] {
  const { isCommunity, developerMode, mqttBridgeAvailable } = flags;

  return HOME_SETTINGS_SECTION_ORDER.filter(id => {
    switch (id) {
      case 'notifications':
        // Push is a cloud feature; the whole Notifications surface is hidden in CE.
        return !isCommunity;
      case 'reliability':
        // Uptime samples are recorded server-side, and CE has no server.
        return !isCommunity;
      case 'mqtt':
        return developerMode && (!isCommunity || mqttBridgeAvailable);
      default:
        return true;
    }
  });
}
