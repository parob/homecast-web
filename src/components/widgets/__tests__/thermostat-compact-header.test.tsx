// @vitest-environment jsdom
//
// A compact tile's header must fit inside the tile.
//
// An air conditioner that is off puts its Auto/Heat/Cool chips in the header
// slot, and that slot used to also repeat the current temperature — which the
// subtitle underneath already says in full ("Off · 26.0°"). Icon + reading +
// three chips is wider than a compact tile, and neither the icon nor the header
// slot could shrink, so the row was laid out straight past the card's right
// padding: the Cool chip sat on the card's edge at 440pt and was drawn outside
// the card below about 400pt. Reported as homecast-cloud#9.
//
// jsdom does no layout, so the width itself can't be asserted here. What is
// asserted is the two things that caused it: the duplicated reading, and a
// header slot that could not be stopped at the card's padding.
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

function char(type: string, value: unknown, writable = true, extra: Record<string, unknown> = {}) {
  return {
    id: `c-${type}`, characteristicType: type, value,
    isReadable: true, isWritable: writable, ...extra,
    __typename: 'HomeKitCharacteristic',
  };
}

/** A heater_cooler that is off, reading 26°, offering all three modes. */
const airConditioner = {
  id: 'acc-ac',
  name: 'Room Air Conditioner',
  category: 'AirConditioner',
  isReachable: true,
  services: [{
    id: 'acc-ac:svc',
    name: 'Room Air Conditioner',
    serviceType: 'heater_cooler',
    characteristics: [
      char('active', 0),
      char('target_heater_cooler_state', 2, true, { characteristic: { validValues: [0, 1, 2] } }),
      char('current_heater_cooler_state', 0, false),
      char('current_temperature', 26.0, false),
      char('cooling_threshold', 26, true, { characteristic: { minValue: 10, maxValue: 35 } }),
      char('heating_threshold', 22, true, { characteristic: { minValue: 10, maxValue: 35 } }),
    ],
    __typename: 'HomeKitService',
  }],
  __typename: 'HomeKitAccessory',
};

function renderCompactTile() {
  render(<ThermostatWidget {...({
    accessory: airConditioner,
    getEffectiveValue: (_i: string, _c: string, v: unknown) => v,
    onSetValue: () => {},
    onSlider: () => {},
    onToggle: () => {},
    iconStyle: 'colourful',
    compact: true,
  } as unknown as WidgetProps)} />);
}

/** The box WidgetCard gives the widget's header action, found from a chip in it. */
function headerSlotOf(chip: HTMLElement): HTMLElement {
  let el: HTMLElement | null = chip;
  while (el && !el.className.includes('origin-top-right')) el = el.parentElement;
  if (!el) throw new Error('chip is not inside a header action slot');
  return el;
}

describe('a compact heater_cooler tile fits its own header', () => {
  afterEach(cleanup);

  it('does not repeat the temperature the subtitle already carries', () => {
    renderCompactTile();

    // The subtitle says it, in full.
    expect(screen.getByText('Off · 26.0°')).toBeTruthy();

    // The header slot says nothing — it is three chips and no reading. It is
    // the repeat that made the row wider than the tile.
    const slot = headerSlotOf(screen.getByTitle('Cool'));
    expect(slot.textContent).toBe('');
  });

  it('offers all three modes', () => {
    renderCompactTile();
    for (const mode of ['Auto', 'Heat', 'Cool']) {
      expect(screen.getByTitle(mode)).toBeTruthy();
    }
  });

  it('wraps the chips rather than drawing one outside the card', () => {
    renderCompactTile();
    const chip = screen.getByTitle('Cool');
    const row = chip.parentElement!;

    // Both halves are needed and neither works alone: the row has to be willing
    // to wrap, and the slot around it has to be stoppable at the card's padding
    // for there to be anything to wrap within. `shrink-0` on the slot is what
    // put the chip outside the tile.
    expect(row.className).toContain('flex-wrap');
    expect(headerSlotOf(chip).className).not.toContain('shrink-0');
  });
});
