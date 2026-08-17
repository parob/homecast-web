/**
 * Turning authentication on used to be a one-way door.
 *
 * SetAuthEnabled invalidates every outstanding token, and the operations that
 * would create the first account were not public — so on a relay with no
 * accounts, enabling auth left nobody able to create one and nobody able to
 * turn it back off. Both need a token that can no longer be issued.
 */

import { vi, describe, it, expect, beforeEach } from 'vitest';

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
