// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { HomeInfoDialog } from '../HomeInfoDialog';
import { ingestHomeServingPush, resetHomeServing, setDeviceServing } from '@/server/home-serving';

vi.mock('@/lib/browser-logger', () => ({ browserLogger: { logInfo: vi.fn() } }));
const home = { id: 'HOME', name: 'George Street', mqttEnabled: true };
const served = { state: 'served', by: 'mini', kind: 'cloud', since: null, graceEndsAt: null };
const show = () => render(<HomeInfoDialog open onOpenChange={() => {}} home={home} slug="george-street" topicCount={5} roomCount={3} />);
beforeEach(resetHomeServing);
afterEach(cleanup);

it('updates an open home dialog when its cloud relay goes away', () => {
  ingestHomeServingPush({ homeId: home.id, serving: served });
  show();
  expect(screen.getByText('Online')).toBeTruthy();
  act(() => ingestHomeServingPush({ homeId: home.id, serving: { ...served, state: 'offline', by: null, kind: null } }));
  expect(screen.queryByText('Online')).toBeNull();
  expect(screen.getByText('Relay offline')).toBeTruthy();
});

it('explains takeover waiting instead of flattening it to offline', () => {
  ingestHomeServingPush({ homeId: home.id, serving: { ...served, state: 'waiting', by: null, kind: null, graceEndsAt: new Date(Date.now()+60000).toISOString() } });
  show();
  expect(screen.getByText('Waiting for backup')).toBeTruthy();
});

it('does not treat this device’s Local Mode as proof of a cloud MQTT relay', () => {
  ingestHomeServingPush({ homeId: home.id, serving: { ...served, state: 'offline', by: null, kind: null } });
  setDeviceServing(() => ({ active: true }));
  show();
  expect(screen.queryByText('Online')).toBeNull();
  expect(screen.getByText('Relay offline')).toBeTruthy();
});

it('keeps unknown routing neutral', () => {
  const { container } = show();
  expect(screen.getByText('Checking relay…')).toBeTruthy();
  expect(container.querySelector('.bg-green-500')).toBeNull();
});
