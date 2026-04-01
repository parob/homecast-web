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

// JWT secret — generated once per installation, stored in IndexedDB
let jwtSecret: CryptoKey | null = null;

interface LocalUser {
  id: string;
  name: string;
  passwordHash: string; // base64
  salt: string; // base64
  role: 'owner' | 'admin' | 'control' | 'view';
  createdAt: string;
}

// --- Password Hashing (PBKDF2) ---

async function hashPassword(password: string, salt?: Uint8Array): Promise<{ hash: string; salt: string }> {
  const saltBytes = salt ?? crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveBits']
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: saltBytes, iterations: 10000, hash: 'SHA-256' },
    key,
    256
  );
  return {
    hash: btoa(String.fromCharCode(...new Uint8Array(bits))),
    salt: btoa(String.fromCharCode(...saltBytes)),
  };
}

async function verifyPassword(password: string, storedHash: string, storedSalt: string): Promise<boolean> {
  const saltBytes = Uint8Array.from(atob(storedSalt), c => c.charCodeAt(0));
  const { hash } = await hashPassword(password, saltBytes);
  return hash === storedHash;
}

// --- JWT (HMAC-SHA256) ---

async function getJwtSecret(): Promise<CryptoKey> {
  if (jwtSecret) return jwtSecret;

  // Check if we have a stored secret
  const stored = await db.getSetting('jwt-secret');
  if (stored) {
    const keyData = Uint8Array.from(atob(stored), c => c.charCodeAt(0));
    jwtSecret = await crypto.subtle.importKey('raw', keyData, { name: 'HMAC', hash: 'SHA-256' }, true, ['sign', 'verify']);
    return jwtSecret;
  }

  // Generate new secret
  jwtSecret = await crypto.subtle.generateKey({ name: 'HMAC', hash: 'SHA-256' }, true, ['sign', 'verify']);
  const exported = await crypto.subtle.exportKey('raw', jwtSecret);
  await db.setSetting('jwt-secret', btoa(String.fromCharCode(...new Uint8Array(exported))));
  return jwtSecret;
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

  const { hash, salt } = await hashPassword(password);
  const user: LocalUser = {
    id: crypto.randomUUID(),
    name,
    passwordHash: hash,
    salt,
    role: 'owner',
    createdAt: new Date().toISOString(),
  };
  await db.putUser(user);
  const token = await generateToken(user.id, user.name, user.role);
  return { user, token };
}

export async function login(name: string, password: string): Promise<{ user: LocalUser; token: string } | null> {
  const users = await db.getUsers();
  const user = users.find(u => u.name.toLowerCase() === name.toLowerCase()) as LocalUser | undefined;
  if (!user) return null;

  const valid = await verifyPassword(password, user.passwordHash, user.salt);
  if (!valid) return null;

  const token = await generateToken(user.id, user.name, user.role);
  return { user, token };
}

export async function createUser(name: string, password: string, role: 'admin' | 'control' | 'view'): Promise<LocalUser> {
  const users = await db.getUsers();
  if (users.some(u => u.name.toLowerCase() === name.toLowerCase())) {
    throw new Error('User already exists');
  }

  const { hash, salt } = await hashPassword(password);
  const user: LocalUser = {
    id: crypto.randomUUID(),
    name,
    passwordHash: hash,
    salt,
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
export async function invalidateAllTokens(): Promise<void> {
  jwtSecret = await crypto.subtle.generateKey({ name: 'HMAC', hash: 'SHA-256' }, true, ['sign', 'verify']);
  const exported = await crypto.subtle.exportKey('raw', jwtSecret);
  await db.setSetting('jwt-secret', btoa(String.fromCharCode(...new Uint8Array(exported))));
}

export async function changePassword(userId: string, newPassword: string): Promise<boolean> {
  const users = await db.getUsers();
  const user = users.find(u => u.id === userId) as LocalUser | undefined;
  if (!user) return false;
  const { hash, salt } = await hashPassword(newPassword);
  user.passwordHash = hash;
  user.salt = salt;
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
