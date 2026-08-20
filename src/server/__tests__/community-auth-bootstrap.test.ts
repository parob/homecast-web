/**
 * Turning authentication on used to be a one-way door.
 *
 * SetAuthEnabled invalidates every outstanding token, and the operations that
 * would create the first account were not public — so on a relay with no
 * accounts, enabling auth left nobody able to create one and nobody able to
 * turn it back off. Both need a token that can no longer be issued.
 */

import { vi, describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';

const mockDb = {
  users: new Map<string, any>(),
  settings: new Map<string, string>(),
};

vi.mock('@/server/local-db', () => ({
  getUsers: vi.fn(async () => Array.from(mockDb.users.values())),
  putUser: vi.fn(async (user: any) => { mockDb.users.set(user.id, user); }),
  getSetting: vi.fn(async (key: string) => mockDb.settings.get(key) ?? null),
  setSetting: vi.fn(async (key: string, value: string) => { mockDb.settings.set(key, value); }),
  getAutomations: vi.fn(async () => []),
  getCollections: vi.fn(async () => []),
  getRoomGroups: vi.fn(async () => []),
}));

vi.mock('@/relay/local-handler', () => ({
  executeHomeKitAction: vi.fn(async () => null),
}));
vi.mock('@/server/connection', () => ({
  communityRequest: vi.fn(async () => null),
}));
vi.mock('@/server/local-server', () => ({
  refreshAuthEnabled: vi.fn(async () => {}),
  clearAuthenticatedClients: vi.fn(() => {}),
}));

import { handleGraphQL } from '@/server/local-graphql';

const isAuthError = (r: any) =>
  /Authentication required/.test(r?.errors?.[0]?.message ?? '');

describe('community auth bootstrap', () => {
  beforeEach(() => {
    mockDb.users.clear();
    mockDb.settings.clear();
  });

  it('refuses to enable auth while there are no accounts to sign in with', async () => {
    const result: any = await handleGraphQL({
      operationName: 'SetAuthEnabled',
      variables: { enabled: true },
    });

    expect(result.data?.setAuthEnabled?.success).toBe(false);
    expect(result.data?.setAuthEnabled?.error).toMatch(/create an account first/i);
    // And crucially, it did not write the setting.
    expect(mockDb.settings.get('auth-enabled')).not.toBe('true');
  });

  it('lets a relay already in the locked-out state recover', async () => {
    // The state the bug left behind: auth on, no accounts.
    mockDb.settings.set('auth-enabled', 'true');

    // Without the bootstrap exemption this answers "Authentication required",
    // and no token exists anywhere that would satisfy it.
    const result: any = await handleGraphQL({
      operationName: 'SetAuthEnabled',
      variables: { enabled: false },
    });

    expect(isAuthError(result)).toBe(false);
    expect(mockDb.settings.get('auth-enabled')).toBe('false');
  });

  it('lets the first account be created while locked out', async () => {
    mockDb.settings.set('auth-enabled', 'true');

    const result: any = await handleGraphQL({
      operationName: 'CreateCommunityUser',
      variables: { name: 'owner', password: 'hunter2hunter2', role: 'admin' },
    });

    expect(isAuthError(result)).toBe(false);
  });

  it('still demands credentials once an account exists', async () => {
    mockDb.settings.set('auth-enabled', 'true');
    mockDb.users.set('u1', { id: 'u1', name: 'owner', role: 'owner' });

    const result: any = await handleGraphQL({
      operationName: 'SetAuthEnabled',
      variables: { enabled: false },
    });

    expect(isAuthError(result)).toBe(true);
    expect(mockDb.settings.get('auth-enabled')).toBe('true');
  });

  it('reports onboarding honestly, so clients do not offer a sign-in for accounts that cannot exist', async () => {
    const empty: any = await handleGraphQL({ operationName: 'IsOnboarded' });
    expect(empty.data?.isOnboarded).toBe(false);
    // relayReady is a different question: we answered, so we are ready.
    expect(empty.data?.relayReady).toBe(true);

    mockDb.users.set('u1', { id: 'u1', name: 'owner', role: 'owner' });
    const seeded: any = await handleGraphQL({ operationName: 'IsOnboarded' });
    expect(seeded.data?.isOnboarded).toBe(true);
  });
});

describe('enabling auth does not lock out the person enabling it', () => {
  beforeEach(() => {
    mockDb.users.clear();
    mockDb.settings.clear();
  });

  it('leaves the caller\'s existing token valid', async () => {
    const auth = await import('@/server/local-auth');
    const { token } = await auth.createOwner('owner', 'pw-owner-1234');

    const enabled: any = await handleGraphQL({
      operationName: 'SetAuthEnabled',
      variables: { enabled: true },
      authorization: `Bearer ${token}`,
    });
    expect(enabled.data?.setAuthEnabled?.success).toBe(true);

    // The token they held a moment ago must still work — rotating the signing
    // key here is what locked people out of their own relay.
    expect(await auth.verifyToken(token)).not.toBeNull();

    const after: any = await handleGraphQL({
      operationName: 'CreateCommunityUser',
      variables: { name: 'second', password: 'pw-second-1234', role: 'view' },
      authorization: `Bearer ${token}`,
    });
    expect(isAuthError(after)).toBe(false);
  });
});

describe('setting up authentication from scratch', () => {
  beforeEach(() => {
    mockDb.users.clear();
    mockDb.settings.clear();
  });

  it('hands back a session for the first account, so enabling auth does not lock you out', async () => {
    const auth = await import('@/server/local-auth');

    // Auth is off. Create the first account, exactly as the settings screen does.
    const created: any = await handleGraphQL({
      operationName: 'CreateCommunityUser',
      variables: { name: 'rob', password: 'pw-rob-12345', role: 'admin' },
    });
    const token = created.data?.createCommunityUser?.token;
    expect(token).toBeTruthy();
    expect(await auth.verifyToken(token)).not.toBeNull();

    // Now turn authentication on, holding that session.
    const enabled: any = await handleGraphQL({
      operationName: 'SetAuthEnabled',
      variables: { enabled: true },
      authorization: `Bearer ${token}`,
    });
    expect(enabled.data?.setAuthEnabled?.success).toBe(true);

    // And the screen still works afterwards — this is the whole point.
    const after: any = await handleGraphQL({
      operationName: 'GetCommunityUsers',
      authorization: `Bearer ${token}`,
    });
    expect(isAuthError(after)).toBe(false);

    const off: any = await handleGraphQL({
      operationName: 'SetAuthEnabled',
      variables: { enabled: false },
      authorization: `Bearer ${token}`,
    });
    expect(isAuthError(off)).toBe(false);
    expect(mockDb.settings.get('auth-enabled')).toBe('false');
  });

  it('does not hand out a session for later accounts', async () => {
    await handleGraphQL({
      operationName: 'CreateCommunityUser',
      variables: { name: 'first', password: 'pw-first-1234', role: 'admin' },
    });
    const second: any = await handleGraphQL({
      operationName: 'CreateCommunityUser',
      variables: { name: 'second', password: 'pw-second-123', role: 'view' },
    });
    expect(second.data?.createCommunityUser?.token ?? null).toBeNull();
  });
});

describe('the relay Mac is not a network client', () => {
  it('can still turn auth off when an owner exists but it holds no token', async () => {
    // The lockout this closes: the UI signs the relay Mac in as `relay-owner`
    // without a password and never issues it a JWT. With auth on and an owner
    // in the database the bootstrap hatch is shut — correctly, it is only for
    // a relay with no accounts — so the machine running the relay could not
    // call anything, including the mutation that turns auth back off.
    mockDb.users.set('u1', { id: 'u1', name: 'owner', passwordHash: 'x', salt: 'y', iterations: 1, role: 'owner' });
    mockDb.settings.set('auth-enabled', 'true');

    const overTheWire = await handleGraphQL({ operationName: 'SetAuthEnabled', variables: { enabled: false } }) as any;
    expect(isAuthError(overTheWire)).toBe(true);
    expect(mockDb.settings.get('auth-enabled')).toBe('true');

    const fromTheRelayItself = await handleGraphQL({
      operationName: 'SetAuthEnabled', variables: { enabled: false }, local: true,
    }) as any;
    expect(isAuthError(fromTheRelayItself)).toBe(false);
    expect(mockDb.settings.get('auth-enabled')).toBe('false');
  });

  it('does not let a network caller claim to be local', async () => {
    // local-server.ts builds its request with four named fields and never
    // copies this one, so a body carrying it cannot reach the gate. Pinned
    // here because the whole safety of the flag rests on that.
    const source = readFileSync(
      new URL('../local-server.ts', import.meta.url), 'utf8',
    );
    const call = source.slice(source.indexOf('await handleGraphQL({'));
    const args = call.slice(0, call.indexOf('});'));
    expect(args).not.toContain('local');
  });
});
