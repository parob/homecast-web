// The decision that produced the HOME_NOT_FOUND flood.
//
// The relay owns its homes, so an id for one of them passed the ownership
// check and was answered locally — but the cloud addresses homes by stable
// hc_id and HomeKit only knows live UUIDs, so HomeKit was handed an id it had
// never seen. Measured on the managed relay: all three homes failed this way,
// on accessories.list and serviceGroups.list, and none of it ever reached the
// server because the relay had already claimed the request.

import { describe, it, expect } from 'vitest';
import { canServeLocally, type RelayRoutingState } from '../relay-routing';

/** County Hall on the managed relay, in both id spaces. */
const LIVE = '3C4399F4-B7E7-5697-9866-D15A8C7CCFE5';
const HC = 'd08cb174-3548-4753-9abe-3d4a13d3326b';

function state(over: Partial<RelayRoutingState> = {}): RelayRoutingState {
  return {
    isActiveRelay: true,
    ownedHomeIds: new Set([LIVE]),
    unservableHomeIds: new Set(),
    ...over,
  };
}

describe('canServeLocally', () => {
  it('serves a home HomeKit knows', () => {
    expect(canServeLocally('accessories.list', LIVE, state())).toBe(true);
  });

  it('sends an unowned home to the server', () => {
    expect(canServeLocally('accessories.list', HC, state())).toBe(false);
  });

  it('stops claiming a home once HomeKit has rejected it', () => {
    // The regression. This id belongs to a home the relay genuinely owns, so
    // ownership alone would answer it locally and fail forever.
    const owned = state({ ownedHomeIds: new Set([LIVE, HC.toUpperCase()]) });
    expect(canServeLocally('accessories.list', HC, owned)).toBe(true);

    const learned = state({
      ownedHomeIds: new Set([LIVE, HC.toUpperCase()]),
      unservableHomeIds: new Set([HC.toUpperCase()]),
    });
    expect(canServeLocally('accessories.list', HC, learned)).toBe(false);
  });

  it('compares ids case-insensitively, because the two id spaces disagree', () => {
    // HomeKit reports uppercase, the cloud stores lowercase, and UUIDs are
    // case-insensitive per RFC 4122 — so case must never decide routing.
    expect(canServeLocally('accessories.list', LIVE.toLowerCase(), state())).toBe(true);
    expect(canServeLocally(
      'accessories.list',
      HC,
      state({ unservableHomeIds: new Set([HC.toUpperCase()]) }),
    )).toBe(false);
  });

  it('always sends homes.list to the server', () => {
    // It deduplicates cloud-managed homes across relays; a local answer omits them.
    expect(canServeLocally('homes.list', LIVE, state())).toBe(false);
    expect(canServeLocally('homes.list', undefined, state())).toBe(false);
  });

  it('serves requests that name no home', () => {
    expect(canServeLocally('ping', undefined, state())).toBe(true);
  });

  it('serves nothing when this device is not the active relay', () => {
    expect(canServeLocally('accessories.list', LIVE, state({ isActiveRelay: false }))).toBe(false);
    expect(canServeLocally('ping', undefined, state({ isActiveRelay: false }))).toBe(false);
  });
});
