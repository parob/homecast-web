// @vitest-environment jsdom
//
// A thermostat's tile has to agree with the mode it is set to.
//
// Regular thermostats were coloured orange unconditionally, so an air
// conditioner set to Cool drew a blue dial, a blue Cool button and a snowflake
// icon inside a warm orange tile — every part of the tile said cool except the
// tile. Only `heater_cooler` accessories followed their mode; the far more
// common plain Thermostat service did not.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { ThermostatWidget } from '../ThermostatWidget';
import type { WidgetProps } from '../types';

vi.mock('@/lib/config', () => ({
  isCommunity: false,
  getCommunityMode: () => null,
  isRelayMode: () => false,
  isClientMode: () => false,
  isRelaySetupComplete: () => false,
  config: { isCommunity: false, apiBase: 'https://api.test', graphqlUrl: 'https://api.test/', wsUrl: 'wss://api.test/ws' },
}));

// The widget measures its own width to decide the collapsed layout, and jsdom
// has no ResizeObserver. Nothing here depends on the measurement.
if (!window.ResizeObserver) {
  window.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
}

if (!window.matchMedia) {
  window.matchMedia = ((query: string) => ({
    matches: false, media: query, onchange: null,
    addEventListener: () => {}, removeEventListener: () => {},
    addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

function char(type: string, value: unknown, writable = true) {
  return {
    id: `c-${type}`, characteristicType: type, value,
    isReadable: true, isWritable: writable,
    __typename: 'HomeKitCharacteristic',
  };
}

/** `target` follows HomeKit's TargetHeatingCoolingState: 0 off, 1 heat, 2 cool, 3 auto. */
function thermostat(target: number) {
  return {
    id: 'acc-thermo',
    name: 'Air Conditioner',
    category: 'Thermostat',
    isReachable: true,
    services: [{
      id: 'acc-thermo:svc',
      name: 'Air Conditioner',
      serviceType: 'thermostat',
      characteristics: [
        char('heating_cooling_target', target),
        char('heating_cooling_current', target === 2 ? 2 : 1, false),
        char('temperature_current', 26.1, false),
        char('temperature_target', 24),
      ],
      __typename: 'HomeKitService',
    }],
    __typename: 'HomeKitAccessory',
  };
}

/**
 * The colour family of the tile's own tint.
 *
 * Deliberately not a search of the whole tree: the Cool button is blue and the
 * dial is blue whatever the tile does, so matching "sky" anywhere passes even
 * with the tile painted orange — which is exactly the bug. The tint is the fill
 * WidgetWrapper puts on the glass layer, and it is the only thing here that
 * answers "what colour is this tile".
 *
 * That fill used to be a `bg-<family>-200/75` class and this read the family
 * straight off it. It is an inline rgba now — proportional tint cannot be a
 * class, because Tailwind has no safelist and a generated alpha is purged — so
 * the family is recovered by matching the rgb against the palette instead.
 */
const TINT_FAMILIES: Array<[string, string]> = [
  ['orange', '#fed7aa'],
  ['sky', '#bae6fd'],
  ['emerald', '#a7f3d0'],
  ['yellow', '#fef08a'],
  ['blue', '#bfdbfe'],
];

function familyOfFill(fill: string): string | null {
  const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(fill);
  if (!m) return null;
  const [r, g, b] = m.slice(1).map(Number);
  for (const [name, hex] of TINT_FAMILIES) {
    const want = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
    if (want[0] === r && want[1] === g && want[2] === b) return name;
  }
  return null;
}

function tintFamily(target: number): string | null {
  render(<ThermostatWidget {...({
    accessory: thermostat(target),
    getEffectiveValue: (_i: string, _c: string, v: unknown) => v,
    onSetValue: () => {},
    onSlider: () => {},
    onToggle: () => {},
    iconStyle: 'colourful',
  } as unknown as WidgetProps)} />);

  expect(screen.getByText('Air Conditioner')).toBeTruthy();
  for (const el of Array.from(document.querySelectorAll<HTMLElement>('[style]'))) {
    const fill = el.style.backgroundColor;
    if (!fill) continue;
    const family = familyOfFill(fill);
    if (family) return family;
  }
  return null;
}

describe('thermostat tile colour follows its mode', () => {
  afterEach(cleanup);

  it('is warm when set to Heat', () => {
    expect(tintFamily(1)).toBe('orange');
  });

  it('is cool when set to Cool', () => {
    expect(tintFamily(2)).toBe('sky');
  });

  it('is neither warm nor cool when set to Auto', () => {
    expect(tintFamily(3)).toBe('emerald');
  });

  it('does not read as cooling when off', () => {
    // Off asks for no mode at all — WidgetWrapper drops the accent tint
    // entirely for an inactive tile. What matters is that it never inherits
    // the cool blue from whatever it was last set to.
    expect(tintFamily(0)).not.toBe('sky');
  });

  it('paints the accent at full strength — a thermostat has no proportion', () => {
    // Its numbers are absolute temperatures; the gap to target is error, not
    // intensity. So a running unit must land on the accent exactly, not on some
    // partial blend toward it.
    render(<ThermostatWidget {...({
      accessory: thermostat(1),
      getEffectiveValue: (_i: string, _c: string, v: unknown) => v,
      onSetValue: () => {},
      onSlider: () => {},
      onToggle: () => {},
      iconStyle: 'colourful',
    } as unknown as WidgetProps)} />);
    const fills = Array.from(document.querySelectorAll<HTMLElement>('[style]'))
      .map(el => el.style.backgroundColor)
      .filter(Boolean);
    expect(fills).toContain('rgba(254, 215, 170, 0.75)');
  });
});
