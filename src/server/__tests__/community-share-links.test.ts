/**
 * A share link has to point at something that exists.
 *
 * GetSharingInfo used to invent a hash for an entity with no access rows at
 * all — `btoa("home:<id>")`, truncated — and hand back a URL built from it. It
 * looked exactly like a real share link, and resolving it could only ever fail,
 * because nothing had been shared and no row carried that hash. The user's link
 * decoded to `home:67DF298`: a truncated id, no timestamp, straight from that
 * fallback.
 *
 * And every link was built from `window.location.origin`, which on the relay is
 * `http://localhost:5656` — an address meaning "this device" on whatever device
 * reads it, so the link was useless to the person it was sent to.
 */

import { vi, describe, it, expect, beforeEach } from 'vitest';

const mockDb = {
  access: new Map<string, any>(),
  settings: new Map<string, string>(),
};

vi.mock('@/server/local-db', () => ({
  getEntityAccess: vi.fn(async () => Array.from(mockDb.access.values())),
  putEntityAccess: vi.fn(async (a: any) => { mockDb.access.set(a.id, a); }),
  deleteEntityAccess: vi.fn(async (id: string) => { mockDb.access.delete(id); }),
  getSetting: vi.fn(async (k: string) => mockDb.settings.get(k) ?? null),
  setSetting: vi.fn(async (k: string, v: string) => { mockDb.settings.set(k, v); }),
  getUsers: vi.fn(async () => []),
  getAutomations: vi.fn(async () => []),
  getCollections: vi.fn(async () => []),
  getRoomGroups: vi.fn(async () => []),
}));

vi.mock('@/relay/local-handler', () => ({ executeHomeKitAction: vi.fn(async () => null) }));
vi.mock('@/server/connection', () => ({ communityRequest: vi.fn(async () => null) }));
vi.mock('@/server/local-server', () => ({
  refreshAuthEnabled: vi.fn(async () => {}),
  refreshRelayName: vi.fn(async () => {}),
  clearAuthenticatedClients: vi.fn(() => {}),
}));

import { handleGraphQL } from '@/server/local-graphql';

const HOME = 'F9015AD6-FCFD-5336-B9E0-1181C011BEFC';
const LAN = 'http://192.168.1.211:5656';

const call = (operationName: string, variables: Record<string, unknown> = {}) =>
  handleGraphQL({ operationName, variables }) as Promise<any>;

beforeEach(() => {
  mockDb.access.clear();
  mockDb.settings.clear();
  // The relay answers /health with the address other devices can reach it on.
  vi.stubGlobal('fetch', vi.fn(async () => ({
    ok: true,
    json: async () => ({ status: 'ok', mode: 'community', addresses: [LAN], lanAddress: '192.168.1.211', port: 5656 }),
  })));
});

describe('share links', () => {
  it('offers no link when nothing has been shared', async () => {
    // The whole bug: this used to return a hash it had just made up, and a URL
    // that answered "Not Found" for the rest of time.
    const res = await call('GetSharingInfo', { entityType: 'home', entityId: HOME });
    expect(res.data.sharingInfo.isShared).toBe(false);
    expect(res.data.sharingInfo.shareHash).toBeNull();
    expect(res.data.sharingInfo.shareUrl).toBeNull();
  });

  it('offers a link once something really is shared, and it resolves', async () => {
    const created = await call('CreateEntityAccess', {
      entityType: 'home', entityId: HOME, accessType: 'public', role: 'view',
    });
    const hash = created.data.createEntityAccess.shareHash;
    expect(hash).toBeTruthy();

    // The same hash comes back, rather than a second invented one.
    const info = await call('GetSharingInfo', { entityType: 'home', entityId: HOME });
    expect(info.data.sharingInfo.shareHash).toBe(hash);

    // And it is stored, which is what makes the link resolve at all.
    expect(Array.from(mockDb.access.values()).some(a => a.shareHash === hash)).toBe(true);
  });

  it('builds links from the address another device can reach, not localhost', async () => {
    const created = await call('CreateEntityAccess', {
      entityType: 'home', entityId: HOME, accessType: 'public', role: 'view',
    });
    const url: string = created.data.createEntityAccess.shareUrl;
    expect(url.startsWith(LAN)).toBe(true);
    // "localhost" means "this device" wherever it is read. A share link is by
    // definition read somewhere else.
    expect(url).not.toContain('localhost');

    const info = await call('GetSharingInfo', { entityType: 'home', entityId: HOME });
    expect(info.data.sharingInfo.shareUrl.startsWith(LAN)).toBe(true);

    const mine = await call('GetMySharedEntities');
    expect(mine.data.mySharedEntities[0].shareUrl.startsWith(LAN)).toBe(true);
  });

  it('falls back to the page origin when the relay cannot be asked', async () => {
    // A failed /health must not produce a link with "undefined" in it.
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));
    const created = await call('CreateEntityAccess', {
      entityType: 'home', entityId: HOME, accessType: 'public', role: 'view',
    });
    const url: string = created.data.createEntityAccess.shareUrl;
    expect(url).toContain('/s/');
    expect(url).not.toContain('undefined');
  });
});

describe('a share link works for the person it was sent to', () => {
  it('resolves without a login, which is what "public" means', async () => {
    // Every share op sat behind the blanket auth gate, so turning on a password
    // silently turned public sharing off: the owner's own browser worked and
    // the recipient's got "Not Found".
    // The owner creates the share while signed in, then turns a password on —
    // or had one on all along and created it from their own session.
    const created = await call('CreateEntityAccess', {
      entityType: 'home', entityId: HOME, accessType: 'public', role: 'control',
    });
    const shareHash = created.data.createEntityAccess.shareHash;
    mockDb.settings.set('auth-enabled', 'true');

    // No authorization header anywhere in these.
    const entity = await call('GetPublicEntity', { shareHash });
    expect(entity.errors).toBeUndefined();
    expect(entity.data.publicEntity).not.toBeNull();

    const accessories = await call('GetPublicEntityAccessories', { shareHash });
    expect(accessories.errors).toBeUndefined();
  });

  it('still refuses a hash that matches nothing', async () => {
    mockDb.settings.set('auth-enabled', 'true');
    const res = await call('GetPublicEntity', { shareHash: 'nothing-here' });
    expect(res.errors).toBeUndefined();
    expect(res.data.publicEntity).toBeNull();
  });

  it('will not let a view-only link control anything', async () => {
    const created = await call('CreateEntityAccess', {
      entityType: 'home', entityId: HOME, accessType: 'public', role: 'view',
    });
    mockDb.settings.set('auth-enabled', 'true');
    const res = await call('PublicEntitySetCharacteristic', {
      shareHash: created.data.createEntityAccess.shareHash,
      accessoryId: 'a', characteristicType: 'power_state', value: true,
    });
    expect(res.data.publicEntitySetCharacteristic.success).toBe(false);
  });
});

describe('the hash is the credential, so it has to be unguessable', () => {
  it('does not derive from the entity id', async () => {
    // btoa(`type:id:${Date.now()}`).slice(0,16) kept only twelve bytes — "home:"
    // plus seven characters of the id. The timestamp never survived, so the
    // hash was a pure function of the home id and anyone holding that id could
    // compute the link.
    const a = await call('CreateEntityAccess', { entityType: 'home', entityId: HOME, accessType: 'public', role: 'view' });
    const legacyShape = btoa(`home:${HOME}`).replace(/[+/=]/g, c => (c === '+' ? '-' : c === '/' ? '_' : '')).slice(0, 16);
    expect(a.data.createEntityAccess.shareHash).not.toBe(legacyShape);
  });

  it('differs between two shares of the same home', async () => {
    const a = await call('CreateEntityAccess', { entityType: 'home', entityId: HOME, accessType: 'public', role: 'view' });
    const b = await call('CreateEntityAccess', { entityType: 'home', entityId: HOME, accessType: 'passcode', role: 'control', passcode: '1234' });
    expect(a.data.createEntityAccess.shareHash).not.toBe(b.data.createEntityAccess.shareHash);
  });

  it('is long enough to be worth guessing at', async () => {
    const a = await call('CreateEntityAccess', { entityType: 'home', entityId: HOME, accessType: 'public', role: 'view' });
    expect(a.data.createEntityAccess.shareHash.length).toBeGreaterThanOrEqual(22);
  });
});
