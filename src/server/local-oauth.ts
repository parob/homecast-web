/**
 * Community mode: OAuth 2.1 with PKCE.
 *
 * Implements authorization code flow with PKCE for MCP clients
 * (Claude, ChatGPT, Gemini, Cursor, Windsurf, etc.)
 *
 * Endpoints:
 *   GET  /.well-known/oauth-authorization-server
 *   GET  /.well-known/oauth-protected-resource
 *   POST /oauth/register
 *   GET  /oauth/authorize
 *   POST /oauth/authorize/callback
 *   POST /oauth/token
 *
 * Runs inside the Mac app's WKWebView — uses Web Crypto API.
 */

import * as db from './local-db';
import { verifyToken, generateCustomToken } from './local-auth';

// --- Helpers ---

const SCOPES_SUPPORTED = ['read', 'write', 'admin'];
const AUTH_CODE_EXPIRY_MS = 10 * 60 * 1000; // 10 minutes
const ACCESS_TOKEN_EXPIRY_S = 3600; // 1 hour
const REFRESH_TOKEN_EXPIRY_MS = 90 * 24 * 3600 * 1000; // 90 days

function baseUrl(): string {
  return window.location.origin;
}

function randomHex(bytes: number): string {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  return Array.from(arr, b => b.toString(16).padStart(2, '0')).join('');
}

async function sha256Hex(data: string): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(data));
  return Array.from(new Uint8Array(hash), b => b.toString(16).padStart(2, '0')).join('');
}

async function verifyCodeChallenge(verifier: string, challenge: string): Promise<boolean> {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  const computed = btoa(String.fromCharCode(...new Uint8Array(hash)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
  return computed === challenge;
}

function parseBody(body?: string): Record<string, string> {
  if (!body) return {};
  try {
    return JSON.parse(body);
  } catch {
    // Try URL-encoded form data
    const params = new URLSearchParams(body);
    const result: Record<string, string> = {};
    for (const [k, v] of params) result[k] = v;
    return result;
  }
}

function parseQuery(path: string): Record<string, string> {
  const q = path.indexOf('?');
  if (q === -1) return {};
  const params = new URLSearchParams(path.slice(q + 1));
  const result: Record<string, string> = {};
  for (const [k, v] of params) result[k] = v;
  return result;
}

function redirect(url: string): Record<string, unknown> {
  return { _status: 302, _headers: { Location: url }, _body: '' };
}

function jsonResponse(data: Record<string, unknown>, status = 200): Record<string, unknown> {
  if (status === 200) return data;
  return { _status: status, _headers: {}, _body: JSON.stringify(data) };
}

// --- Main Handler ---

export async function handleOAuth(request: {
  method: string;
  path: string;
  body?: string;
  authorization?: string;
}): Promise<Record<string, unknown>> {
  const fullPath = request.path;
  const path = fullPath.split('?')[0];
  const query = parseQuery(fullPath);
  const method = request.method.toUpperCase();

  try {
    // Well-known endpoints
    if (path === '/.well-known/oauth-authorization-server') {
      return serverMetadata();
    }
    if (path === '/.well-known/oauth-protected-resource') {
      return resourceMetadata();
    }
    if (path === '/.well-known/openid-configuration') {
      return serverMetadata(); // Alias for OIDC clients
    }

    // Dynamic client registration
    if (path === '/oauth/register' && method === 'POST') {
      return handleRegister(parseBody(request.body));
    }

    // Authorization
    if (path === '/oauth/authorize' && method === 'GET') {
      return handleAuthorize(query);
    }
    if (path === '/oauth/authorize/callback' && method === 'POST') {
      return handleAuthorizeCallback(parseBody(request.body));
    }

    // Token
    if (path === '/oauth/token' && method === 'POST') {
      return handleToken(parseBody(request.body));
    }

    return { error: 'not_found', error_description: 'Unknown OAuth endpoint' };
  } catch (err: any) {
    console.error('[OAuth] Error:', err);
    return { error: 'server_error', error_description: err.message || 'Internal error' };
  }
}

// --- Server Metadata (RFC 8414) ---

function serverMetadata(): Record<string, unknown> {
  const base = baseUrl();
  return {
    issuer: base,
    authorization_endpoint: `${base}/oauth/authorize`,
    token_endpoint: `${base}/oauth/token`,
    registration_endpoint: `${base}/oauth/register`,
    scopes_supported: SCOPES_SUPPORTED,
    response_types_supported: ['code'],
    response_modes_supported: ['query'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    token_endpoint_auth_methods_supported: ['none'],
    code_challenge_methods_supported: ['S256'],
    service_documentation: 'https://docs.homecast.cloud',
  };
}

function resourceMetadata(): Record<string, unknown> {
  const base = baseUrl();
  return {
    resource: base,
    authorization_servers: [base],
    scopes_supported: SCOPES_SUPPORTED,
  };
}

// --- Dynamic Client Registration (RFC 7591) ---

async function handleRegister(body: Record<string, any>): Promise<Record<string, unknown>> {
  const redirectUris = body.redirect_uris;
  if (!redirectUris || !Array.isArray(redirectUris) || redirectUris.length === 0) {
    return jsonResponse({ error: 'invalid_client_metadata', error_description: 'redirect_uris is required' }, 400);
  }

  // Validate redirect URIs
  for (const uri of redirectUris) {
    try {
      const u = new URL(uri);
      const isLocal = u.hostname === 'localhost' || u.hostname === '127.0.0.1';
      const isHttps = u.protocol === 'https:';
      const isCustomScheme = !u.protocol.startsWith('http');
      if (!isLocal && !isHttps && !isCustomScheme) {
        return jsonResponse({ error: 'invalid_redirect_uri', error_description: 'redirect_uri must be localhost, HTTPS, or custom scheme' }, 400);
      }
    } catch {
      return jsonResponse({ error: 'invalid_redirect_uri', error_description: 'Invalid redirect_uri format' }, 400);
    }
  }

  const clientId = crypto.randomUUID();
  const client = {
    client_id: clientId,
    client_name: body.client_name || null,
    redirect_uris: redirectUris,
    grant_types: body.grant_types || ['authorization_code', 'refresh_token'],
    response_types: ['code'],
    token_endpoint_auth_method: 'none',
    scope: body.scope || SCOPES_SUPPORTED.join(' '),
    logo_uri: body.logo_uri || null,
    client_uri: body.client_uri || null,
    client_id_issued_at: Math.floor(Date.now() / 1000),
    client_secret_expires_at: 0,
    created_at: new Date().toISOString(),
  };

  await db.putOAuthClient(client);

  return jsonResponse({
    client_id: clientId,
    client_name: client.client_name,
    redirect_uris: client.redirect_uris,
    grant_types: client.grant_types,
    response_types: client.response_types,
    token_endpoint_auth_method: client.token_endpoint_auth_method,
    scope: client.scope,
    client_id_issued_at: client.client_id_issued_at,
    client_secret_expires_at: client.client_secret_expires_at,
  }, 201);
}

// --- Authorization Endpoint ---

async function handleAuthorize(query: Record<string, string>): Promise<Record<string, unknown>> {
  const {
    response_type, client_id, redirect_uri, code_challenge,
    code_challenge_method, scope, state, _token, resource,
    client_name, logo_uri, client_uri,
  } = query;

  // Validate required params
  if (response_type !== 'code') {
    return errorRedirect(redirect_uri, 'unsupported_response_type', 'Only response_type=code is supported', state);
  }
  if (!client_id) {
    return { error: 'invalid_request', error_description: 'client_id is required' };
  }
  if (!redirect_uri) {
    return { error: 'invalid_request', error_description: 'redirect_uri is required' };
  }
  if (!code_challenge || code_challenge_method !== 'S256') {
    return errorRedirect(redirect_uri, 'invalid_request', 'PKCE with S256 is required', state);
  }

  // Look up or auto-register client
  let client = await db.getOAuthClient(client_id);
  if (!client) {
    // Auto-register for convenience (public clients)
    client = {
      client_id,
      client_name: client_name || null,
      redirect_uris: [redirect_uri],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
      scope: scope || SCOPES_SUPPORTED.join(' '),
      logo_uri: logo_uri || null,
      client_uri: client_uri || null,
      client_id_issued_at: Math.floor(Date.now() / 1000),
      client_secret_expires_at: 0,
      created_at: new Date().toISOString(),
    };
    await db.putOAuthClient(client);
  }

  // Validate redirect_uri matches registered URIs
  if (!client.redirect_uris.includes(redirect_uri)) {
    // Add it (auto-expand for convenience in Community mode)
    client.redirect_uris.push(redirect_uri);
    await db.putOAuthClient(client);
  }

  // Check authentication
  const authEnabled = await db.getSetting('auth-enabled');

  if (!_token && authEnabled === 'true') {
    // Auth is enabled and no token — redirect to login with OAuth params
    const oauthParams = new URLSearchParams({
      client_id, redirect_uri, code_challenge, code_challenge_method: 'S256',
      scope: scope || '', state: state || '', resource: resource || '',
    });
    if (client_name) oauthParams.set('client_name', client_name);
    if (logo_uri) oauthParams.set('logo_uri', logo_uri);
    if (client_uri) oauthParams.set('client_uri', client_uri);

    return redirect(`${baseUrl()}/login?oauth_flow=true&oauth_params=${encodeURIComponent(oauthParams.toString())}`);
  }

  // Verify the token if provided, otherwise use guest for no-auth servers
  let user: { sub: string; name: string; role: string } | null = null;
  if (_token) {
    user = await verifyToken(_token);
    if (!user) {
      return errorRedirect(redirect_uri, 'access_denied', 'Invalid or expired token', state);
    }
  } else {
    // No auth — auto-approve as guest
    user = { sub: 'guest', name: 'Guest', role: 'admin' };
  }

  // Check for existing consent — always show consent screen for new connections
  const consentId = `${user.sub}:${client_id}`;
  const consent = await db.getUserConsent(consentId);

  if (consent) {
    // Has existing consent — create auth code directly
    const code = randomHex(32);
    await db.putAuthorizationCode({
      code,
      client_id,
      redirect_uri,
      code_challenge,
      user_id: user.sub,
      user_name: user.name,
      user_role: user.role,
      scope: scope || consent?.scope || SCOPES_SUPPORTED.join(' '),
      home_permissions: consent?.home_permissions || {},
      resource: resource || null,
      expires_at: new Date(Date.now() + AUTH_CODE_EXPIRY_MS).toISOString(),
      created_at: new Date().toISOString(),
    });

    const redirectUrl = new URL(redirect_uri);
    redirectUrl.searchParams.set('code', code);
    if (state) redirectUrl.searchParams.set('state', state);
    return redirect(redirectUrl.toString());
  }

  // No consent — redirect to consent page
  const oauthParams = new URLSearchParams({
    client_id, redirect_uri, code_challenge, code_challenge_method: 'S256',
    scope: scope || '', state: state || '', resource: resource || '',
  });
  if (client_name) oauthParams.set('client_name', client_name);
  if (logo_uri) oauthParams.set('logo_uri', logo_uri);
  if (client_uri) oauthParams.set('client_uri', client_uri);

  return redirect(`${baseUrl()}/oauth/consent?oauth_params=${encodeURIComponent(oauthParams.toString())}`);
}

function errorRedirect(redirectUri: string | undefined, error: string, description: string, state?: string): Record<string, unknown> {
  if (!redirectUri) return { error, error_description: description };
  try {
    const url = new URL(redirectUri);
    url.searchParams.set('error', error);
    url.searchParams.set('error_description', description);
    if (state) url.searchParams.set('state', state);
    return redirect(url.toString());
  } catch {
    return { error, error_description: description };
  }
}

// --- Authorization Callback (from OAuthConsent.tsx) ---

async function handleAuthorizeCallback(body: Record<string, any>): Promise<Record<string, unknown>> {
  const { token, approved, homePermissions, client_id, redirect_uri, code_challenge, scope, state } = body;

  // Verify user token
  const user = await verifyToken(token);
  if (!user) {
    return { error: 'access_denied', error_description: 'Invalid or expired token' };
  }

  if (!approved) {
    // Denied
    if (redirect_uri) {
      const url = new URL(redirect_uri);
      url.searchParams.set('error', 'access_denied');
      url.searchParams.set('error_description', 'User denied the request');
      if (state) url.searchParams.set('state', state);
      return { redirect_uri: url.toString() };
    }
    return { error: 'access_denied' };
  }

  // Save consent
  const consentId = `${user.sub}:${client_id}`;
  await db.putUserConsent({
    id: consentId,
    user_id: user.sub,
    client_id,
    scope: scope || SCOPES_SUPPORTED.join(' '),
    home_permissions: homePermissions || {},
    created_at: new Date().toISOString(),
  });

  // Create authorization code
  const code = randomHex(32);
  await db.putAuthorizationCode({
    code,
    client_id,
    redirect_uri,
    code_challenge,
    user_id: user.sub,
    user_name: user.name,
    user_role: user.role,
    scope: scope || SCOPES_SUPPORTED.join(' '),
    home_permissions: homePermissions || {},
    resource: body.resource || null,
    expires_at: new Date(Date.now() + AUTH_CODE_EXPIRY_MS).toISOString(),
    created_at: new Date().toISOString(),
  });

  const url = new URL(redirect_uri);
  url.searchParams.set('code', code);
  if (state) url.searchParams.set('state', state);
  return { redirect_uri: url.toString() };
}

// --- Token Endpoint ---

async function handleToken(body: Record<string, any>): Promise<Record<string, unknown>> {
  const grantType = body.grant_type;

  if (grantType === 'authorization_code') {
    return handleAuthCodeGrant(body);
  }
  if (grantType === 'refresh_token') {
    return handleRefreshTokenGrant(body);
  }

  return jsonResponse({ error: 'unsupported_grant_type', error_description: 'Supported: authorization_code, refresh_token' }, 400);
}

async function handleAuthCodeGrant(body: Record<string, any>): Promise<Record<string, unknown>> {
  const { code, redirect_uri, client_id, code_verifier } = body;

  if (!code || !redirect_uri || !client_id || !code_verifier) {
    return jsonResponse({ error: 'invalid_request', error_description: 'Missing required parameters' }, 400);
  }

  // Look up authorization code
  const authCode = await db.getAuthorizationCode(code);
  if (!authCode) {
    return jsonResponse({ error: 'invalid_grant', error_description: 'Invalid authorization code' }, 400);
  }

  // Delete code (one-time use)
  await db.deleteAuthorizationCode(code);

  // Verify not expired
  if (new Date(authCode.expires_at) < new Date()) {
    return jsonResponse({ error: 'invalid_grant', error_description: 'Authorization code expired' }, 400);
  }

  // Verify client_id matches
  if (authCode.client_id !== client_id) {
    return jsonResponse({ error: 'invalid_grant', error_description: 'client_id mismatch' }, 400);
  }

  // Verify redirect_uri matches
  if (authCode.redirect_uri !== redirect_uri) {
    return jsonResponse({ error: 'invalid_grant', error_description: 'redirect_uri mismatch' }, 400);
  }

  // PKCE verification
  const pkceValid = await verifyCodeChallenge(code_verifier, authCode.code_challenge);
  if (!pkceValid) {
    return jsonResponse({ error: 'invalid_grant', error_description: 'PKCE verification failed' }, 400);
  }

  // Generate access token
  const accessToken = await generateCustomToken({
    sub: authCode.user_id,
    name: authCode.user_name,
    role: authCode.user_role,
    client_id,
    scope: authCode.scope,
    home_permissions: authCode.home_permissions,
    token_type: 'access_token',
    aud: authCode.resource || baseUrl(),
  }, ACCESS_TOKEN_EXPIRY_S);

  // Generate refresh token
  const refreshTokenRaw = randomHex(48);
  const refreshTokenHash = await sha256Hex(refreshTokenRaw);
  const family = crypto.randomUUID();

  await db.putRefreshToken({
    token_hash: refreshTokenHash,
    client_id,
    user_id: authCode.user_id,
    user_name: authCode.user_name,
    user_role: authCode.user_role,
    scope: authCode.scope,
    home_permissions: authCode.home_permissions,
    resource: authCode.resource || null,
    family,
    used: false,
    expires_at: new Date(Date.now() + REFRESH_TOKEN_EXPIRY_MS).toISOString(),
    created_at: new Date().toISOString(),
  });

  return {
    access_token: accessToken,
    token_type: 'Bearer',
    expires_in: ACCESS_TOKEN_EXPIRY_S,
    refresh_token: refreshTokenRaw,
    scope: authCode.scope,
  };
}

async function handleRefreshTokenGrant(body: Record<string, any>): Promise<Record<string, unknown>> {
  const { refresh_token, client_id } = body;

  if (!refresh_token || !client_id) {
    return jsonResponse({ error: 'invalid_request', error_description: 'Missing required parameters' }, 400);
  }

  const tokenHash = await sha256Hex(refresh_token);
  const storedToken = await db.getRefreshToken(tokenHash);

  if (!storedToken) {
    return jsonResponse({ error: 'invalid_grant', error_description: 'Invalid refresh token' }, 400);
  }

  // Check if already used (replay detection — revoke family)
  if (storedToken.used) {
    await db.deleteRefreshTokensByFamily(storedToken.family);
    return jsonResponse({ error: 'invalid_grant', error_description: 'Refresh token reuse detected — all tokens revoked' }, 400);
  }

  // Verify client_id
  if (storedToken.client_id !== client_id) {
    return jsonResponse({ error: 'invalid_grant', error_description: 'client_id mismatch' }, 400);
  }

  // Check expiry
  if (new Date(storedToken.expires_at) < new Date()) {
    await db.deleteRefreshToken(tokenHash);
    return jsonResponse({ error: 'invalid_grant', error_description: 'Refresh token expired' }, 400);
  }

  // Mark old token as used (for rotation/replay detection)
  storedToken.used = true;
  await db.putRefreshToken(storedToken);

  // Generate new access token
  const accessToken = await generateCustomToken({
    sub: storedToken.user_id,
    name: storedToken.user_name,
    role: storedToken.user_role,
    client_id,
    scope: storedToken.scope,
    home_permissions: storedToken.home_permissions,
    token_type: 'access_token',
    aud: storedToken.resource || baseUrl(),
  }, ACCESS_TOKEN_EXPIRY_S);

  // Generate new refresh token (same family)
  const newRefreshRaw = randomHex(48);
  const newRefreshHash = await sha256Hex(newRefreshRaw);

  await db.putRefreshToken({
    token_hash: newRefreshHash,
    client_id,
    user_id: storedToken.user_id,
    user_name: storedToken.user_name,
    user_role: storedToken.user_role,
    scope: storedToken.scope,
    home_permissions: storedToken.home_permissions,
    resource: storedToken.resource,
    family: storedToken.family,
    used: false,
    expires_at: new Date(Date.now() + REFRESH_TOKEN_EXPIRY_MS).toISOString(),
    created_at: new Date().toISOString(),
  });

  return {
    access_token: accessToken,
    token_type: 'Bearer',
    expires_in: ACCESS_TOKEN_EXPIRY_S,
    refresh_token: newRefreshRaw,
    scope: storedToken.scope,
  };
}
