// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

const bridge = vi.hoisted(() => ({ listHomes: vi.fn() }));
const reconcile = vi.hoisted(() => vi.fn());
vi.mock('../../native/homekit-bridge', () => ({ HomeKit: bridge }));
vi.mock('../../relay/local-handler', () => ({ executeHomeKitAction: vi.fn(async () => ({})) }));
vi.mock('../../lib/graphql/local-identity-api', () => ({ reconcileLocalTopology: reconcile }));

function deferred() {
  let resolve!: (value: unknown) => void;
  const promise = new Promise(yes => { resolve = yes; });
  return { promise, resolve };
}
const result = (id: string) => ({ map: { homes: { LIVE: id } }, matched: 1, reported: 1 });

beforeEach(() => {
  vi.resetModules();
  localStorage.clear();
  bridge.listHomes.mockReset().mockResolvedValue([{ id: 'LIVE', name: 'Home' }]);
  reconcile.mockReset();
});

describe('Local Identity account lifecycle', () => {
  it('does not restore a forgotten map when reconciliation finishes late', async () => {
    const old = deferred();
    reconcile.mockReturnValueOnce(old.promise);
    const { localIdentity } = await import('../local-identity');
    localIdentity.load('old-user');
    const pending = localIdentity.sync(true);
    await vi.waitFor(() => expect(reconcile).toHaveBeenCalledTimes(1));
    localIdentity.forget();
    old.resolve(result('HC-OLD'));
    await expect(pending).resolves.toBeNull();
    expect(localIdentity.hasMap()).toBe(false);
    expect(localIdentity.counts()).toBeNull();
    expect(localStorage.getItem('homecast-local-identity:old-user')).toBeNull();
  });

  it('starts a new account sync and keeps it coalesced after the old sync completes', async () => {
    const old = deferred();
    const current = deferred();
    reconcile.mockReturnValueOnce(old.promise).mockReturnValueOnce(current.promise);
    const { localIdentity } = await import('../local-identity');
    localIdentity.load('old-user');
    const previousSync = localIdentity.sync(true);
    await vi.waitFor(() => expect(reconcile).toHaveBeenCalledTimes(1));
    localIdentity.load('new-user');
    const currentSync = localIdentity.sync(true);
    await vi.waitFor(() => expect(reconcile).toHaveBeenCalledTimes(2));

    old.resolve(result('HC-OLD'));
    await expect(previousSync).resolves.toBeNull();
    expect(localIdentity.hasMap()).toBe(false);
    const joined = localIdentity.sync(true);
    current.resolve(result('HC-NEW'));
    await Promise.all([currentSync, joined]);

    expect(reconcile).toHaveBeenCalledTimes(2);
    expect(localIdentity.toStable('LIVE')).toBe('HC-NEW');
    expect(JSON.parse(localStorage.getItem('homecast-local-identity:new-user')!).live.LIVE).toBe('HC-NEW');
    expect(localStorage.getItem('homecast-local-identity:old-user')).toBeNull();
  });

  it.each(['forget', 'switch'])('does not report topology collected before an account %s', async (change) => {
    const homes = deferred();
    bridge.listHomes.mockReturnValueOnce(homes.promise);
    const { localIdentity } = await import('../local-identity');
    localIdentity.load('old-user');
    const pending = localIdentity.sync(true);
    if (change === 'forget') localIdentity.forget();
    else localIdentity.load('new-user');
    homes.resolve([{ id: 'LIVE', name: 'Home' }]);
    await expect(pending).resolves.toBeNull();
    expect(reconcile).not.toHaveBeenCalled();
  });
});
