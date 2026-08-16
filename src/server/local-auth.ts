/**
 * Community mode: local authentication (HA-style).
 *
 * - First user to onboard becomes the owner
 * - Username + password (no email)
 * - PBKDF2 password hashing via Web Crypto API
 * - JWT tokens via HMAC-SHA256
 * - Admin creates additional users with roles
 */

import * as db from './local-db';

// JWT signing key.
//
// On the Mac app the raw bytes live in the macOS Keychain and are fetched over
// the native bridge — this is the "future Swift bridge to macOS Keychain" the
// original in-memory design was waiting for. It matters more than it looks:
// without it the key was regenerated on every relay launch, so every restart
// of the Mac app silently signed out every client on the network, which is
// exactly the experience LAN and remote clients would hit constantly.
//
// The key is still imported non-extractable, so renderer code cannot read the
// bytes back out of the CryptoKey, and IndexedDB never sees them.
//
// Anywhere without the bridge — a browser, the iOS client, tests — falls back
// to the old per-launch key, which is correct there: those contexts do not
// sign tokens for anyone else.
let jwtSecret: CryptoKey | null = null;
/** In-flight key resolution, so concurrent callers can't mint two keys. */
let jwtSecretPromise: Promise<CryptoKey> | null = null;

type KeychainWindow = Window & {
  webkit?: { messageHandlers?: { localServer?: { postMessage: (msg: unknown) => void } } };
  __homecast_jwt_key?: (requestId: string, base64: string | null) => void;
};

/**
 * Ask the Mac app for the relay's Keychain-held signing key.
 * Resolves null off the Mac app, or if the bridge doesn't answer in time.
 */
function requestKeychainKey(rotate: boolean): Promise<ArrayBuffer | null> {
  if (typeof window === 'undefined') return Promise.resolve(null);
  const win = window as KeychainWindow;
  const handler = win.webkit?.messageHandlers?.localServer;
  if (!handler) return Promise.resolve(null);

  return new Promise(resolve => {
    const requestId = `jwt-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    let settled = false;
    const finish = (value: ArrayBuffer | null) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };

    const previous = win.__homecast_jwt_key;
    win.__homecast_jwt_key = (id, base64) => {
      if (id !== requestId) {
        previous?.(id, base64);
        return;
      }
      win.__homecast_jwt_key = previous;
      if (!base64) return finish(null);
      try {
        const binary = atob(base64);
        const bytes = new Uint8Array(new ArrayBuffer(binary.length));
        for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
        finish(bytes.buffer);
      } catch {
        finish(null);
      }
    };

    setTimeout(() => {
      if (win.__homecast_jwt_key !== previous) win.__homecast_jwt_key = previous;
      finish(null);
    }, 3000);

    try {
      handler.postMessage({ action: 'jwtKey', requestId, rotate });
    } catch {
      finish(null);
    }
  });
}

async function loadJwtSecret(rotate: boolean): Promise<CryptoKey> {
  const raw = await requestKeychainKey(rotate);
  if (raw) {
    return crypto.subtle.importKey(
      'raw',
      raw,
      { name: 'HMAC', hash: 'SHA-256' },
      false, // non-extractable: the bytes stay in the Keychain, not the renderer
      ['sign', 'verify'],
    );
  }
  return crypto.subtle.generateKey({ name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

interface LocalUser {
  id: string;
  name: string;
  passwordHash: string; // base64
  salt: string; // base64
  /** PBKDF2 iteration count used when this hash was derived. Missing = legacy 10,000. */
  iterations?: number;
  role: 'owner' | 'admin' | 'control' | 'view';
  createdAt: string;
  /** Unix ms of last failed login. Used for brute-force rate limiting. */
  lastFailedLoginAt?: number;
  /** Consecutive failed login attempts. Reset on success. */
  failedLoginCount?: number;
}

/**
 * Minimum delay before the *next* login attempt for a given user, based on
 * consecutive failure count. First 2 failures are free; backoff starts on the
 * 3rd. Caps at 60s. We don't hard-lock accounts — legitimate users can still
 * log in after waiting, which avoids the griefing vector where an attacker
 * locks out the account by guessing bad passwords.
 */
function requiredCooldownMs(failureCount: number): number {
  if (failureCount <= 2) return 0;
  const base = 1000;
  return Math.min(60_000, base * Math.pow(2, Math.min(failureCount - 3, 6)));
}

// --- Password Hashing (PBKDF2) ---

/**
 * Current PBKDF2 iteration count for new hashes.
 *
 * Legacy hashes derived at 10,000 iterations remain verifiable (the stored
 * `iterations` count is used during verification) and are lazily re-derived to
 * this value on the next successful login — see `login()`.
 */
const CURRENT_PBKDF2_ITERATIONS = 600_000;
const LEGACY_PBKDF2_ITERATIONS = 10_000;

async function hashPassword(
  password: string,
  salt?: Uint8Array,
  iterations: number = CURRENT_PBKDF2_ITERATIONS,
): Promise<{ hash: string; salt: string; iterations: number }> {
  const saltBytes = salt ?? crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveBits']
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: saltBytes, iterations, hash: 'SHA-256' },
    key,
    256
  );
  return {
    hash: btoa(String.fromCharCode(...new Uint8Array(bits))),
    salt: btoa(String.fromCharCode(...saltBytes)),
    iterations,
  };
}

/** Constant-time equality check over two base64-encoded byte arrays. */
function constantTimeEqualBase64(a: string, b: string): boolean {
  let aBytes: Uint8Array;
  let bBytes: Uint8Array;
  try {
    aBytes = Uint8Array.from(atob(a), c => c.charCodeAt(0));
    bBytes = Uint8Array.from(atob(b), c => c.charCodeAt(0));
  } catch {
    return false;
  }
  if (aBytes.length !== bBytes.length) return false;
  let diff = 0;
  for (let i = 0; i < aBytes.length; i++) diff |= aBytes[i] ^ bBytes[i];
  return diff === 0;
}

async function verifyPassword(
  password: string,
  storedHash: string,
  storedSalt: string,
  iterations: number,
): Promise<boolean> {
  const saltBytes = Uint8Array.from(atob(storedSalt), c => c.charCodeAt(0));
  const { hash } = await hashPassword(password, saltBytes, iterations);
  return constantTimeEqualBase64(hash, storedHash);
}

// --- JWT (HMAC-SHA256) ---

async function getJwtSecret(): Promise<CryptoKey> {
  if (jwtSecret) return jwtSecret;
  if (!jwtSecretPromise) {
    jwtSecretPromise = loadJwtSecret(false).then(key => {
      jwtSecret = key;
      jwtSecretPromise = null;
      return key;
    }).catch(err => {
      jwtSecretPromise = null;
      throw err;
    });
  }
  const key = await jwtSecretPromise;
  // Best-effort cleanup of any leftover jwt-secret from pre-upgrade installs.
  try { await db.setSetting('jwt-secret', ''); } catch { /* ignore */ }
  return key;
}

function base64url(data: Uint8Array): string {
  return btoa(String.fromCharCode(...data))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64urlDecode(str: string): Uint8Array {
  const padded = str.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(padded);
  return Uint8Array.from(binary, c => c.charCodeAt(0));
}

export async function generateToken(userId: string, name: string, role: string): Promise<string> {
  const secret = await getJwtSecret();
  const header = base64url(new TextEncoder().encode(JSON.stringify({ alg: 'HS256', typ: 'JWT' })));
  const payload = base64url(new TextEncoder().encode(JSON.stringify({
    sub: userId,
    name,
    role,
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 30 * 24 * 3600, // 30 days
  })));
  const data = new TextEncoder().encode(`${header}.${payload}`);
  const sig = await crypto.subtle.sign('HMAC', secret, data);
  return `${header}.${payload}.${base64url(new Uint8Array(sig))}`;
}

/** Generate a JWT with custom claims and expiry (used by OAuth). */
export async function generateCustomToken(claims: Record<string, unknown>, expirySeconds: number): Promise<string> {
  const secret = await getJwtSecret();
  const header = base64url(new TextEncoder().encode(JSON.stringify({ alg: 'HS256', typ: 'JWT' })));
  const payload = base64url(new TextEncoder().encode(JSON.stringify({
    ...claims,
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + expirySeconds,
  })));
  const data = new TextEncoder().encode(`${header}.${payload}`);
  const sig = await crypto.subtle.sign('HMAC', secret, data);
  return `${header}.${payload}.${base64url(new Uint8Array(sig))}`;
}

/** Verify a JWT and return its full payload. */
export async function verifyTokenFull(token: string): Promise<Record<string, unknown> | null> {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const secret = await getJwtSecret();
    const data = new TextEncoder().encode(`${parts[0]}.${parts[1]}`);
    const sig = base64urlDecode(parts[2]);
    const valid = await crypto.subtle.verify('HMAC', secret, sig, data);
    if (!valid) return null;
    const payload = JSON.parse(new TextDecoder().decode(base64urlDecode(parts[1])));
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

export async function verifyToken(token: string): Promise<{ sub: string; name: string; role: string } | null> {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;

    const secret = await getJwtSecret();
    const data = new TextEncoder().encode(`${parts[0]}.${parts[1]}`);
    const sig = base64urlDecode(parts[2]);
    const valid = await crypto.subtle.verify('HMAC', secret, sig, data);
    if (!valid) return null;

    const payload = JSON.parse(new TextDecoder().decode(base64urlDecode(parts[1])));
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) return null;

    return { sub: payload.sub, name: payload.name, role: payload.role };
  } catch {
    return null;
  }
}

// --- User Management ---

export async function isOnboarded(): Promise<boolean> {
  const users = await db.getUsers();
  return users.length > 0;
}

export async function createOwner(name: string, password: string): Promise<{ user: LocalUser; token: string }> {
  const existing = await db.getUsers();
  if (existing.length > 0) throw new Error('Owner already exists');

  const { hash, salt, iterations } = await hashPassword(password);
  const user: LocalUser = {
    id: crypto.randomUUID(),
    name,
    passwordHash: hash,
    salt,
    iterations,
    role: 'owner',
    createdAt: new Date().toISOString(),
  };
  await db.putUser(user);
  const token = await generateToken(user.id, user.name, user.role);
  return { user, token };
}

export class LoginRateLimitError extends Error {
  constructor(public readonly retryAfterMs: number) {
    super(`Too many failed login attempts. Try again in ${Math.ceil(retryAfterMs / 1000)}s.`);
    this.name = 'LoginRateLimitError';
  }
}

export async function login(name: string, password: string): Promise<{ user: LocalUser; token: string } | null> {
  const users = await db.getUsers();
  const user = users.find(u => u.name.toLowerCase() === name.toLowerCase()) as LocalUser | undefined;
  if (!user) return null;

  // Rate-limit: require exponential backoff between failed attempts.
  const now = Date.now();
  const cooldown = requiredCooldownMs(user.failedLoginCount ?? 0);
  if (cooldown > 0 && user.lastFailedLoginAt && now - user.lastFailedLoginAt < cooldown) {
    throw new LoginRateLimitError(cooldown - (now - user.lastFailedLoginAt));
  }

  const storedIterations = user.iterations ?? LEGACY_PBKDF2_ITERATIONS;
  const valid = await verifyPassword(password, user.passwordHash, user.salt, storedIterations);
  if (!valid) {
    user.failedLoginCount = (user.failedLoginCount ?? 0) + 1;
    user.lastFailedLoginAt = Date.now();
    try { await db.putUser(user); } catch { /* best-effort */ }
    return null;
  }

  // Success — clear rate-limit state and lazy-upgrade legacy hashes.
  const hadFailures = (user.failedLoginCount ?? 0) > 0;
  user.failedLoginCount = 0;
  user.lastFailedLoginAt = undefined;

  if (storedIterations < CURRENT_PBKDF2_ITERATIONS) {
    try {
      const upgraded = await hashPassword(password);
      user.passwordHash = upgraded.hash;
      user.salt = upgraded.salt;
      user.iterations = upgraded.iterations;
    } catch (e) {
      console.warn('[local-auth] Failed to upgrade password hash iterations:', e);
    }
  }

  if (hadFailures || storedIterations < CURRENT_PBKDF2_ITERATIONS) {
    try { await db.putUser(user); } catch { /* best-effort */ }
  }

  const token = await generateToken(user.id, user.name, user.role);
  return { user, token };
}

export async function createUser(name: string, password: string, role: 'admin' | 'control' | 'view'): Promise<LocalUser> {
  const users = await db.getUsers();
  if (users.some(u => u.name.toLowerCase() === name.toLowerCase())) {
    throw new Error('User already exists');
  }

  const { hash, salt, iterations } = await hashPassword(password);
  const user: LocalUser = {
    id: crypto.randomUUID(),
    name,
    passwordHash: hash,
    salt,
    iterations,
    role,
    createdAt: new Date().toISOString(),
  };
  await db.putUser(user);
  return user;
}

export async function getUsers(): Promise<Array<{ id: string; name: string; role: string; createdAt: string }>> {
  const users = await db.getUsers();
  return users.map(u => ({ id: u.id, name: u.name, role: u.role, createdAt: u.createdAt }));
}

export async function deleteUser(userId: string): Promise<boolean> {
  const users = await db.getUsers();
  const user = users.find(u => u.id === userId);
  if (!user || user.role === 'owner') return false; // Can't delete owner
  await db.deleteUser(userId);
  return true;
}

/** Rotate the JWT secret, invalidating all existing tokens. */
/**
 * Deliberately cut every outstanding token loose — on a password change, a
 * user deletion, or auth being switched on.
 *
 * This rotation is the point; the *incidental* rotation on every relay launch
 * was the bug. `rotate` drops the Keychain copy so a fresh key is minted
 * rather than the old one being handed back.
 */
export async function invalidateAllTokens(): Promise<void> {
  jwtSecretPromise = null;
  jwtSecret = await loadJwtSecret(true);
}

export async function changePassword(userId: string, newPassword: string): Promise<boolean> {
  const users = await db.getUsers();
  const user = users.find(u => u.id === userId) as LocalUser | undefined;
  if (!user) return false;
  const { hash, salt, iterations } = await hashPassword(newPassword);
  user.passwordHash = hash;
  user.salt = salt;
  user.iterations = iterations;
  await db.putUser(user);
  await invalidateAllTokens();
  return true;
}

export async function updateUserRole(userId: string, role: 'admin' | 'control' | 'view'): Promise<boolean> {
  const users = await db.getUsers();
  const user = users.find(u => u.id === userId) as LocalUser | undefined;
  if (!user || user.role === 'owner') return false; // Can't change owner role
  user.role = role;
  await db.putUser(user);
  return true;
}
