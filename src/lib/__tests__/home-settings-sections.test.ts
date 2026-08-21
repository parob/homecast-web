/**
 * The home sub-section catalog drives two navigations (the desktop sidebar and
 * the mobile push list). A gate that disagrees between them strands a user on a
 * page they can't get back to, so the gates are pinned here rather than left to
 * whichever component renders first.
 */

import { describe, it, expect } from 'vitest';
import {
  HOME_SETTINGS_SECTION_ORDER,
  HOME_SETTINGS_SECTION_META,
  visibleHomeSettingsSections,
  type HomeSettingsSectionFlags,
} from '@/lib/home-settings-sections';

const CLOUD: HomeSettingsSectionFlags = {
  isCommunity: false,
  developerMode: false,
  mqttBridgeAvailable: false,
};

const flags = (overrides: Partial<HomeSettingsSectionFlags> = {}): HomeSettingsSectionFlags => ({
  ...CLOUD,
  ...overrides,
});

describe('visibleHomeSettingsSections', () => {
  it('shows the always-on sections for a plain cloud home', () => {
    expect(visibleHomeSettingsSections(flags())).toEqual([
      'home-screen',
      'actions',
      'automations',
      'notifications',
      'reliability',
      'analytics',
    ]);
  });

  it('hides Notifications and Reliability in Community mode — neither has a backend', () => {
    const visible = visibleHomeSettingsSections(flags({ isCommunity: true }));
    expect(visible).not.toContain('notifications');
    expect(visible).not.toContain('reliability');
    expect(visible).toEqual(['home-screen', 'actions', 'automations', 'analytics']);
  });

  it('hides MQTT unless developer mode is on', () => {
    expect(visibleHomeSettingsSections(flags())).not.toContain('mqtt');
    expect(visibleHomeSettingsSections(flags({ developerMode: true }))).toContain('mqtt');
  });

  it('hides MQTT in Community mode when there is no native bridge to talk to', () => {
    // Cloud serves brokers over GraphQL, so the bridge is irrelevant there...
    expect(
      visibleHomeSettingsSections(flags({ developerMode: true, mqttBridgeAvailable: false })),
    ).toContain('mqtt');
    // ...but in CE the bridge is the only source, and a row with nothing behind
    // it is a dead end rather than the empty heading it used to be.
    expect(
      visibleHomeSettingsSections(flags({ isCommunity: true, developerMode: true, mqttBridgeAvailable: false })),
    ).not.toContain('mqtt');
    expect(
      visibleHomeSettingsSections(flags({ isCommunity: true, developerMode: true, mqttBridgeAvailable: true })),
    ).toContain('mqtt');
  });

  it('always returns sections in the canonical order, never the flag order', () => {
    const visible = visibleHomeSettingsSections(flags({ developerMode: true, mqttBridgeAvailable: true }));
    const canonical = HOME_SETTINGS_SECTION_ORDER.filter(id => visible.includes(id));
    expect(visible).toEqual(canonical);
  });
});

describe('catalog integrity', () => {
  it('gives every ordered section a label and description', () => {
    for (const id of HOME_SETTINGS_SECTION_ORDER) {
      expect(HOME_SETTINGS_SECTION_META[id]?.label).toBeTruthy();
      expect(HOME_SETTINGS_SECTION_META[id]?.description).toBeTruthy();
    }
  });

  it('orders every section it has metadata for — no unreachable pages', () => {
    expect(HOME_SETTINGS_SECTION_ORDER.slice().sort()).toEqual(
      (Object.keys(HOME_SETTINGS_SECTION_META) as typeof HOME_SETTINGS_SECTION_ORDER).slice().sort(),
    );
  });
});
