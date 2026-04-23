/**
 * Tests for GraphQL resolver auth gating.
 *
 * When `auth-enabled` is true in local-db, every non-public operation must
 * require a valid JWT. Public ops (Login, Signup, IsOnboarded, GetVersion,
 * GetAuthEnabled) are always permitted.
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

// Don't need HomeKit/relay for auth gating
vi.mock('@/relay/local-handler', () => ({
  executeHomeKitAction: vi.fn(async () => null),
}));
vi.mock('@/server/connection', () => ({
  communityRequest: vi.fn(async () => null),
}));

import { handleGraphQL } from '@/server/local-graphql';
import * as auth from '@/server/local-auth';

describe('handleGraphQL auth gating', () => {
  beforeEach(() => {
    mockDb.users.clear();
    mockDb.settings.clear();
  });

  /** A non-auth error message (vs. our "Authentication required" gate). */
  function isAuthError(result: any): boolean {
    return /Authentication required/.test(result.errors?.[0]?.message ?? '');
  }

  describe('auth-enabled OFF', () => {
    it('does not block ops with the auth gate (other errors may still fire from resolver bodies, but not the gate)', async () => {
      mockDb.settings.set('auth-enabled', 'false');
      const result: any = await handleGraphQL({ operationName: 'GetCommunityUsers' });
      expect(isAuthError(result)).toBe(false);
    });
  });

  describe('auth-enabled ON', () => {
    beforeEach(() => {
      mockDb.settings.set('auth-enabled', 'true');
    });

    it('allows public ops (Login) without a token', async () => {
      const result: any = await handleGraphQL({
        operationName: 'Login',
        variables: { email: 'ghost', password: 'x' },
      });
      expect(isAuthError(result)).toBe(false);
      expect(result.data?.login?.success).toBe(false);
    });

    it('lets public ops pass the auth gate without a token', async () => {
      for (const op of ['IsOnboarded', 'GetAuthEnabled']) {
        const r: any = await handleGraphQL({ operationName: op });
        expect(isAuthError(r), `${op} must not be blocked by auth gate`).toBe(false);
      }
    });

    it('blocks non-public ops without a token', async () => {
      const result: any = await handleGraphQL({
        operationName: 'GetCommunityUsers',
      });
      expect(result.data).toBeNull();
      expect(result.errors?.[0]?.message).toMatch(/Authentication required/);
    });

    it('blocks non-public ops with a malformed token', async () => {
      const result: any = await handleGraphQL({
        operationName: 'GetCommunityUsers',
        authorization: 'Bearer not-a-real-jwt',
      });
      expect(result.errors?.[0]?.message).toMatch(/Authentication required/);
    });

    it('blocks sensitive mutations without a token', async () => {
      const result: any = await handleGraphQL({
        operationName: 'CreateCommunityUser',
        variables: { name: 'evil', password: 'x', role: 'admin' },
      });
      expect(result.errors?.[0]?.message).toMatch(/Authentication required/);
    });

    it('allows non-public ops with a valid token', async () => {
      // Bootstrap: make a user and get a real JWT
      await auth.createOwner('alice', 'pw');
      const login = await auth.login('alice', 'pw');
      expect(login).not.toBeNull();
      const token = login!.token;

      const result: any = await handleGraphQL({
        operationName: 'GetCommunityUsers',
        authorization: `Bearer ${token}`,
      });
      expect(result.errors).toBeUndefined();
    });

    it('treats bare "community" token as unauthenticated', async () => {
      const result: any = await handleGraphQL({
        operationName: 'GetCommunityUsers',
        authorization: 'Bearer community',
      });
      expect(result.errors?.[0]?.message).toMatch(/Authentication required/);
    });
  });
});
