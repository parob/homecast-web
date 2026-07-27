// @vitest-environment jsdom
// Temporary: dumps rendered HTML for a visual check.
import { describe, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MockedProvider } from '@apollo/client/testing/react';
import { writeFileSync } from 'node:fs';

vi.mock('@/lib/config', () => ({
  isCommunity: false, getCommunityMode: () => null, isRelayMode: () => false,
  isClientMode: () => false, isRelaySetupComplete: () => false, getRelayAddress: () => null,
  config: { isCommunity: false, apiBase: 'https://api.test', graphqlUrl: 'https://api.test/', wsUrl: 'wss://api.test/ws' },
}));

import { SceneFormDialog } from '../SceneFormDialog';
import { GET_ACCESSORIES, GET_HOMES } from '@/lib/graphql/queries';

const HOME_ID = 'HOME-1111';

class ResizeObserverStub {
  constructor(private cb: any) {}
  observe(el: any) { queueMicrotask(() => this.cb([{ target: el, contentRect: { width: 400, height: 600 }, borderBoxSize: [{ inlineSize: 400, blockSize: 600 }] }], this)); }
  unobserve() {} disconnect() {}
}

function acc(id: string, name: string, room: string, category: string, serviceType: string, chars: any[]) {
  return {
    __typename: 'HomeKitAccessory', id, name, homeId: HOME_ID, category,
    isReachable: true, roomId: `R-${room}`, roomName: room,
    services: [{ __typename: 'HomeKitService', id: `S-${id}`, name, serviceType, characteristics: chars }],
  };
}
function ch(type: string, value: any, extra: any = {}) {
  return { __typename: 'HomeKitCharacteristic', id: `C-${type}-${Math.random()}`, characteristicType: type, value, isReadable: true, isWritable: true, validValues: null, minValue: null, maxValue: null, stepValue: null, ...extra };
}

const ACCESSORIES = [
  acc('ACC-LAMP', 'Reading Lamp', 'Living Room', 'Lightbulb', 'lightbulb', [
    ch('power_state', true), ch('brightness', 40, { minValue: 0, maxValue: 100, stepValue: 1 }),
  ]),
  acc('ACC-LOCK', 'Front Door', 'Hallway', 'Lock', 'lock', [ch('lock_target_state', 0, { validValues: [0, 1], minValue: 0, maxValue: 1, stepValue: 1 })]),
  acc('ACC-THERMO', 'Hallway Thermostat', 'Hallway', 'Thermostat', 'thermostat', [
    ch('heating_cooling_target', 1, { validValues: [0, 1, 2, 3] }),
    ch('target_temperature', 20, { minValue: 10, maxValue: 30, stepValue: 0.5 }),
  ]),
];

const mocks = [
  { request: { query: GET_ACCESSORIES, variables: { homeId: HOME_ID } }, result: { data: { accessories: ACCESSORIES } }, maxUsageCount: 10 },
  { request: { query: GET_HOMES }, result: { data: { homes: [{ __typename: 'HomeKitHome', id: HOME_ID, name: 'Test Home', isPrimary: true, roomCount: 2, accessoryCount: 3, role: 'owner', isAdmin: true }] } }, maxUsageCount: 10 },
];

beforeEach(() => {
  (globalThis as any).ResizeObserver = ResizeObserverStub;
  (window as any).ResizeObserver = ResizeObserverStub;
  Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({ width: 400, height: 600, top: 0, left: 0, right: 400, bottom: 600, x: 0, y: 0, toJSON: () => ({}) }),
  });
});

// Developer scratch tool: dumps rendered markup to a file for eyeballing.
// PREVIEW_OUT is only set when running it deliberately, so skip in CI rather
// than calling writeFileSync(undefined) and failing the build.
const OUT = process.env.PREVIEW_OUT;

describe.skipIf(!OUT)('preview', () => {
  it('dumps the editor', async () => {
    render(
      <MockedProvider mocks={mocks} addTypename={false}>
        <SceneFormDialog
          open
          onOpenChange={() => {}}
          homeId={HOME_ID}
          onDelete={() => {}}
          scene={{
            id: 'SCENE-1', name: 'Movie Night', actionCount: 4,
            actions: JSON.stringify([
              { accessoryId: 'ACC-LAMP', characteristicType: 'power_state', targetValue: true },
              { accessoryId: 'ACC-LAMP', characteristicType: 'brightness', targetValue: 30 },
              { accessoryId: 'ACC-LOCK', characteristicType: 'lock_target_state', targetValue: 1 },
              { accessoryId: 'ACC-THERMO', characteristicType: 'heating_cooling_target', targetValue: 1 },
            ]),
          } as any}
        />
      </MockedProvider>,
    );
    await waitFor(() => screen.getByText('Reading Lamp'));
    writeFileSync(OUT!, document.body.innerHTML);
  });
});
