/**
 * The home section catalog decides what a home's settings page stacks, and in
 * what order. The gates are pinned here rather than left to the page.
 */

import { describe, it, expect } from 'vitest';
import {
  HOME_SETTINGS_SECTION_ORDER,
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
      'notifications',
      'analytics',
      'cameras',
    ]);
  });

  it('shows Cameras to every cloud home and none in Community — the page explains when it is unavailable', () => {
    expect(visibleHomeSettingsSections(flags())).toContain('cameras');
    expect(visibleHomeSettingsSections(flags({ isCommunity: true }))).not.toContain('cameras');
  });

  it('hides Notifications in Community mode — push has no backend there', () => {
    const visible = visibleHomeSettingsSections(flags({ isCommunity: true }));
    expect(visible).not.toContain('notifications');
    expect(visible).toEqual(['home-screen', 'analytics']);
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
