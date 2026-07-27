// @vitest-environment jsdom
//
// The automations pickers wrapped AccessoryPicker in `max-h-[65vh]
// overflow-y-auto`. That gave the picker no bounded height, so its own list
// rendered full-length and never scrolled — the wrapper scrolled the whole
// component instead, dragging the search box and filters out of view (and
// defeating the virtualizer, which then rendered every row).
//
// jsdom has no layout, so this guards the structure that produces the layout:
// the dialog is the flex column, and the device list is the only scroller.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';

vi.mock('@/lib/config', () => ({
  isCommunity: false,
  getCommunityMode: () => null,
  isRelayMode: () => false,
  isClientMode: () => false,
  isRelaySetupComplete: () => false,
  getRelayAddress: () => null,
  config: { isCommunity: false, apiBase: 'https://api.test', graphqlUrl: 'https://api.test/', wsUrl: 'wss://api.test/ws' },
}));

import { DevicePicker, DeviceOrGroupPicker } from '../panels/EntityPicker';
import type { HomeKitAccessory } from '@/lib/graphql/types';

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

const ACCESSORIES = [{
  id: 'ACC-1', name: 'Reading Lamp', homeId: 'HOME-1', category: 'Lightbulb',
  isReachable: true, roomId: 'ROOM-1', roomName: 'Kitchen',
  services: [{ id: 'SVC-1', name: 'Lamp', serviceType: 'lightbulb', characteristics: [] }],
}] as unknown as HomeKitAccessory[];

beforeEach(() => {
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = ResizeObserverStub;
});
afterEach(() => cleanup());

function surfaceAfterOpening() {
  fireEvent.click(screen.getByTestId('select-device-button'));
  return document.querySelector('[data-picker-surface]')!;
}

describe.each([
  ['DevicePicker', () => (
    <DevicePicker value={undefined} accessories={ACCESSORIES} homes={[]} onChange={() => {}} />
  )],
  ['DeviceOrGroupPicker', () => (
    <DeviceOrGroupPicker
      accessoryId={undefined} serviceGroupId={undefined}
      accessories={ACCESSORIES} homes={[]} serviceGroups={[]}
      onSelectAccessory={() => {}} onSelectGroup={() => {}}
    />
  )],
])('%s scrolling', (_name, element) => {
  it('leaves the device list as the only scroll container', () => {
    render(element());
    const surface = surfaceAfterOpening();

    expect(surface.querySelectorAll('.overflow-y-auto')).toHaveLength(0);
    expect(surface.querySelectorAll('.overflow-y-scroll')).toHaveLength(1);
  });

  it('makes the dialog the flex column that bounds the picker', () => {
    render(element());
    const surface = surfaceAfterOpening();

    expect(surface.className).toContain('flex');
    expect(surface.className).toContain('flex-col');
    expect(surface.className).toMatch(/max-h-/);
  });

  it('keeps the search and filters outside the scrolling area', () => {
    render(element());
    const surface = surfaceAfterOpening();
    const search = screen.getByPlaceholderText(/search accessories/i);
    const list = surface.querySelector('.overflow-y-scroll')!;

    expect(list.contains(search)).toBe(false);
  });
});
