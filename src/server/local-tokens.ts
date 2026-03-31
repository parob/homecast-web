/**
 * Community mode: API token management.
 * Tokens use the hc_ prefix, stored in IndexedDB.
 */

import * as db from './local-db';

interface ApiToken {
  id: string;
  name: string;
  tokenHash: string; // We store the hash, return the full token only on creation
  prefix: string; // First 8 chars for display
  homePermissions: string;
  expiresAt: string | null;
  createdAt: string;
  lastUsedAt: string | null;
}

function generateTokenString(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return 'hc_' + Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}

async function hashToken(token: string): Promise<string> {
  const data = new TextEncoder().encode(token);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hash), b => b.toString(16).padStart(2, '0')).join('');
}

export async function createToken(name: string, homePermissions: string, expiresAt?: string): Promise<{ token: ApiToken; fullToken: string }> {
  const fullToken = generateTokenString();
  const tokenObj: ApiToken = {
    id: crypto.randomUUID(),
    name,
    tokenHash: await hashToken(fullToken),
    prefix: fullToken.slice(0, 11), // "hc_" + first 8 hex chars
    homePermissions,
    expiresAt: expiresAt || null,
    createdAt: new Date().toISOString(),
    lastUsedAt: null,
  };
  await db.putAccessToken(tokenObj);
  return { token: tokenObj, fullToken };
}

export async function validateToken(token: string): Promise<ApiToken | null> {
  if (!token.startsWith('hc_')) return null;
  const hash = await hashToken(token);
  const tokens = await db.getAccessTokens();
  const found = tokens.find((t: any) => t.tokenHash === hash);
  if (!found) return null;
  if (found.expiresAt && new Date(found.expiresAt) < new Date()) return null;
  // Update last used
  found.lastUsedAt = new Date().toISOString();
  await db.putAccessToken(found);
  return found;
}

export async function getTokens(): Promise<ApiToken[]> {
  return db.getAccessTokens();
}

export async function revokeToken(tokenId: string): Promise<boolean> {
  await db.deleteAccessToken(tokenId);
  return true;
}
