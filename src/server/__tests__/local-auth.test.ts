/**
 * Tests for local-auth.ts — password hashing (PBKDF2) and JWT generation.
 *
 * Uses an in-memory Map to stub the IndexedDB-backed `local-db` module.
 */

import { vi, describe, it, expect, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// In-memory stub for local-db
// ---------------------------------------------------------------------------

const mockDb = {
  users: new Map<string, any>(),
  settings: new Map<string, string>(),
};

vi.mock('@/server/local-db', () => ({
  getUsers: vi.fn(async () => Array.from(mockDb.users.values())),
  putUser: vi.fn(async (user: any) => { mockDb.users.set(user.id, user); return user; }),
  deleteUser: vi.fn(async (id: string) => { mockDb.users.delete(id); }),
  getSetting: vi.fn(async (key: string) => mockDb.settings.get(key) ?? null),
  setSetting: vi.fn(async (key: string, value: string) => { mockDb.settings.set(key, value); }),
}));

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import * as auth from '@/server/local-auth';
import * as db from '@/server/local-db';

describe('local-auth', () => {
  beforeEach(() => {
    mockDb.users.clear();
    mockDb.settings.clear();
    // Reset the in-memory JWT secret cache by forcing re-import via module cache invalidation
    // (for simplicity, we tolerate a shared secret across tests in this file)
  });

  describe('createOwner', () => {
    it('creates the first user as owner with 600k iteration hash', async () => {
      const { user, token } = await auth.createOwner('alice', 'correct horse battery staple');

      expect(user.name).toBe('alice');
      expect(user.role).toBe('owner');
      expect(user.passwordHash).toBeTruthy();
      expect(user.salt).toBeTruthy();
      expect(user.iterations).toBe(600_000);
      expect(token.split('.')).toHaveLength(3);
    });

    it('refuses a second owner', async () => {
      await auth.createOwner('alice', 'pw1');
      await expect(auth.createOwner('bob', 'pw2')).rejects.toThrow(/Owner already exists/);
    });
  });

  describe('login', () => {
    it('accepts correct password and rejects wrong one', async () => {
      await auth.createOwner('alice', 'hunter2');
      const good = await auth.login('alice', 'hunter2');
      expect(good).not.toBeNull();
      expect(good!.user.name).toBe('alice');

      const bad = await auth.login('alice', 'hunter3');
      expect(bad).toBeNull();
    });

    it('is case-insensitive on username', async () => {
      await auth.createOwner('Alice', 'pw');
      const result = await auth.login('alice', 'pw');
      expect(result).not.toBeNull();
    });

    it('returns null for unknown user', async () => {
      const result = await auth.login('ghost', 'anything');
      expect(result).toBeNull();
    });

    it('accepts legacy 10,000-iteration hashes and upgrades them on success', async () => {
      // Seed a user whose hash was derived with the legacy iteration count. The
      // simplest way: call createOwner, then overwrite the stored user to look
      // like a legacy record. We re-derive a legacy hash for that purpose.
      await auth.createOwner('bob', 'legacy-pw');
      const user = Array.from(mockDb.users.values())[0];

      // Re-derive using PBKDF2 at 10k iterations against the same salt so the
      // stored hash looks like a pre-upgrade record.
      const saltBytes = Uint8Array.from(atob(user.salt), c => c.charCodeAt(0));
      const keyMat = await crypto.subtle.importKey(
        'raw', new TextEncoder().encode('legacy-pw'), 'PBKDF2', false, ['deriveBits'],
      );
      const bits = await crypto.subtle.deriveBits(
        { name: 'PBKDF2', salt: saltBytes, iterations: 10_000, hash: 'SHA-256' },
        keyMat, 256,
      );
      user.passwordHash = btoa(String.fromCharCode(...new Uint8Array(bits)));
      user.iterations = undefined; // emulate pre-upgrade record (missing field = legacy)
      await db.putUser(user);
      const legacyHash = user.passwordHash;

      // Login must succeed against the legacy hash…
      const result = await auth.login('bob', 'legacy-pw');
      expect(result).not.toBeNull();

      // …and the stored hash must now be upgraded to 600k iterations.
      const upgraded = Array.from(mockDb.users.values())[0];
      expect(upgraded.iterations).toBe(600_000);
      expect(upgraded.passwordHash).not.toBe(legacyHash); // re-hashed
    });

    it('rejects login when legacy hash is present but wrong password is supplied', async () => {
      await auth.createOwner('carol', 'right-pw');
      const user = Array.from(mockDb.users.values())[0];
      // Emulate legacy record
      const saltBytes = Uint8Array.from(atob(user.salt), c => c.charCodeAt(0));
      const keyMat = await crypto.subtle.importKey(
        'raw', new TextEncoder().encode('right-pw'), 'PBKDF2', false, ['deriveBits'],
      );
      const bits = await crypto.subtle.deriveBits(
        { name: 'PBKDF2', salt: saltBytes, iterations: 10_000, hash: 'SHA-256' },
        keyMat, 256,
      );
      user.passwordHash = btoa(String.fromCharCode(...new Uint8Array(bits)));
      user.iterations = undefined;
      await db.putUser(user);

      const result = await auth.login('carol', 'wrong-pw');
      expect(result).toBeNull();
    });
  });

  describe('rate limiting', () => {
    it('tracks failed attempts on the user record', async () => {
      await auth.createOwner('eve', 'correct');
      await auth.login('eve', 'wrong1');
      await auth.login('eve', 'wrong2');
      const user = Array.from(mockDb.users.values())[0];
      expect(user.failedLoginCount).toBe(2);
      expect(user.lastFailedLoginAt).toBeGreaterThan(0);
    });

    it('throws LoginRateLimitError after the 3rd consecutive failure', async () => {
      await auth.createOwner('frank', 'correct');
      // First 2 failures are free; the 3rd is subject to cooldown.
      await auth.login('frank', 'wrong1');
      await auth.login('frank', 'wrong2');
      await auth.login('frank', 'wrong3');
      await expect(auth.login('frank', 'wrong4')).rejects.toBeInstanceOf(auth.LoginRateLimitError);
    });

    it('clears failure state on successful login', async () => {
      await auth.createOwner('gina', 'correct');
      await auth.login('gina', 'wrong'); // under the 3-attempt free threshold
      const ok = await auth.login('gina', 'correct');
      expect(ok).not.toBeNull();
      const user = Array.from(mockDb.users.values())[0];
      expect(user.failedLoginCount).toBe(0);
      expect(user.lastFailedLoginAt).toBeUndefined();
    });
  });

  describe('constant-time password compare', () => {
    it('returns false on single-bit hash mismatch', async () => {
      await auth.createOwner('dana', 'abcdefgh');
      // Tamper with the stored hash — flip a single byte
      const user = Array.from(mockDb.users.values())[0];
      const raw = Uint8Array.from(atob(user.passwordHash), c => c.charCodeAt(0));
      raw[0] ^= 0x01;
      user.passwordHash = btoa(String.fromCharCode(...raw));
      await db.putUser(user);

      const result = await auth.login('dana', 'abcdefgh');
      expect(result).toBeNull();
    });
  });

  describe('JWT', () => {
    it('verifies its own tokens', async () => {
      const token = await auth.generateToken('u1', 'alice', 'owner');
      const payload = await auth.verifyToken(token);
      expect(payload).toEqual({ sub: 'u1', name: 'alice', role: 'owner' });
    });

    it('rejects tampered tokens', async () => {
      const token = await auth.generateToken('u1', 'alice', 'owner');
      const parts = token.split('.');
      // Flip a character in the signature
      const badSig = parts[2].replace(/[A-Za-z]/, (c) => (c === 'a' ? 'b' : 'a'));
      const tampered = `${parts[0]}.${parts[1]}.${badSig}`;
      expect(await auth.verifyToken(tampered)).toBeNull();
    });

    it('rejects expired tokens', async () => {
      const past = await auth.generateCustomToken({ sub: 'u1' }, -60);
      expect(await auth.verifyTokenFull(past)).toBeNull();
    });
  });
});
