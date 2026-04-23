/**
 * Community mode: handles GraphQL operations locally.
 *
 * Routes operations by name to the appropriate handler, backed by IndexedDB
 * for persistence. Returns the same response shape as the cloud GraphQL API.
 */

import * as db from './local-db';
import * as auth from './local-auth';
import { executeHomeKitAction } from '../relay/local-handler';
import { communityRequest } from './connection';

interface GraphQLRequest {
  operationName?: string;
  query?: string;
  variables?: Record<string, unknown>;
  /**
   * `Authorization` header value from the HTTP request (e.g. "Bearer …"), or
   * the raw JWT. The local server forwards this from the Swift-side HTTP
   * request when available; the Apollo in-process link also attaches the
   * current user's token from localStorage.
   */
  authorization?: string;
}

/**
 * GraphQL operations that never require authentication — they're either used
 * before a user is onboarded, or expose non-sensitive capability data.
 */
const GRAPHQL_PUBLIC_OPS = new Set([
  'IsOnboarded', 'GetVersion', 'Login', 'Signup', 'GetAuthEnabled',
]);

/**
 * Handle a GraphQL request and return the response body.
 *
 * When `auth-enabled` is on, every operation outside `GRAPHQL_PUBLIC_OPS`
 * requires a valid JWT. This closes a gap where external callers (including
 * on the LAN) could invoke any mutation without credentials — e.g. create or
 * delete users, toggle auth, read secrets — because the Swift HTTP front-end
 * does not currently forward the Authorization header on the GraphQL path.
 * The plumbing here accepts the header once Swift is updated, and the
 * in-process Apollo link passes the logged-in user's token inline today.
 */
export async function handleGraphQL(request: GraphQLRequest): Promise<unknown> {
  const { operationName, variables = {}, authorization } = request;

  try {
    if (operationName && !GRAPHQL_PUBLIC_OPS.has(operationName)) {
      const authEnabled = (await db.getSetting('auth-enabled')) === 'true';
      if (authEnabled) {
        const token = extractToken(authorization);
        const payload = token ? await auth.verifyToken(token) : null;
        if (!payload) {
          return { data: null, errors: [{ message: 'Authentication required' }] };
        }
      }
    }

    const data = await resolveOperation(operationName, variables);
    return { data };
  } catch (error: any) {
    return {
      data: null,
      errors: [{ message: error.message || 'Unknown error' }],
    };
  }
}

function extractToken(authorization: string | undefined): string | null {
  if (!authorization) return null;
  const trimmed = authorization.trim();
  if (!trimmed) return null;
  const m = trimmed.match(/^Bearer\s+(.+)$/i);
  const jwt = (m ? m[1] : trimmed).trim();
  return jwt && jwt !== 'community' ? jwt : null;
}

async function resolveOperation(
  operationName: string | undefined,
  variables: Record<string, unknown>
): Promise<unknown> {
  switch (operationName) {
    // --- Auth ---
    case 'GetMe': {
      // Return the current user based on token (or the owner if no auth yet)
      const users = await auth.getUsers();
      const owner = users[0]; // First user is owner
      return {
        me: {
          id: owner?.id ?? 'community-local',
          email: owner?.name ?? 'local@homecast', // name serves as the identifier
          name: owner?.name ?? null,
          isAdmin: owner?.role === 'owner' || owner?.role === 'admin',
          accountType: 'standard',
          stagingAccess: false,
          createdAt: owner?.createdAt ?? new Date().toISOString(),
          lastLoginAt: new Date().toISOString(),
          __typename: 'User',
        },
      };
    }

    case 'Login': {
      try {
        const result = await auth.login(variables.email as string, variables.password as string);
        if (!result) return { login: { success: false, error: 'Invalid name or password', token: null, __typename: 'LoginResult' } };
        return { login: { success: true, token: result.token, error: null, __typename: 'LoginResult' } };
      } catch (e) {
        if (e instanceof auth.LoginRateLimitError) {
          return { login: { success: false, error: e.message, token: null, __typename: 'LoginResult' } };
        }
        throw e;
      }
    }

    case 'Signup': {
      // In Community mode, "signup" creates the owner on first use
      const onboarded = await auth.isOnboarded();
      if (onboarded) return { signup: { success: false, error: 'Registration is disabled. Ask an admin to create your account.', token: null, __typename: 'SignupResult' } };
      const result = await auth.createOwner(variables.email as string, variables.password as string);
      return { signup: { success: true, token: result.token, error: null, message: 'Account created', __typename: 'SignupResult' } };
    }

    case 'IsOnboarded': {
      const authEnabled = (await db.getSetting('auth-enabled')) === 'true';
      // If the server is running and handling this request, the relay is ready.
      // Don't check localStorage — it may have been wiped during a mode reset.
      return {
        isOnboarded: true,
        relayReady: true,
        authEnabled,
      };
    }

    case 'SetAuthEnabled': {
      await db.setSetting('auth-enabled', variables.enabled ? 'true' : 'false');
      const { refreshAuthEnabled, clearAuthenticatedClients } = await import('./local-server');
      await refreshAuthEnabled();
      if (variables.enabled) {
        await auth.invalidateAllTokens();
        clearAuthenticatedClients();
        const broadcast = (window as any).__localserver_broadcast;
        if (broadcast) broadcast({ type: 'auth_required' });
      }
      return { setAuthEnabled: { success: true, enabled: !!variables.enabled } };
    }

    case 'GetAuthEnabled': {
      const enabled = (await db.getSetting('auth-enabled')) === 'true';
      return { authEnabled: enabled };
    }

    // --- Community User Management ---
    case 'GetCommunityUsers':
      return { communityUsers: await auth.getUsers() };

    case 'CreateCommunityUser': {
      const user = await auth.createUser(
        variables.name as string,
        variables.password as string,
        variables.role as 'admin' | 'control' | 'view'
      );
      return { createCommunityUser: { id: user.id, name: user.name, role: user.role, createdAt: user.createdAt } };
    }

    case 'DeleteCommunityUser': {
      const success = await auth.deleteUser(variables.userId as string);
      if (success) {
        await auth.invalidateAllTokens();
        const { clearAuthenticatedClients } = await import('./local-server');
        clearAuthenticatedClients();
        const broadcast = (window as any).__localserver_broadcast;
        if (broadcast) broadcast({ type: 'auth_required' });
      }
      return { deleteCommunityUser: { success } };
    }

    case 'ChangeCommunityUserPassword': {
      const success = await auth.changePassword(variables.userId as string, variables.password as string);
      if (success) {
        const { clearAuthenticatedClients } = await import('./local-server');
        clearAuthenticatedClients();
        const broadcast = (window as any).__localserver_broadcast;
        if (broadcast) broadcast({ type: 'auth_required' });
      }
      return { changeCommunityUserPassword: { success } };
    }

    case 'UpdateCommunityUserRole':
      return { updateCommunityUserRole: { success: await auth.updateUserRole(variables.userId as string, variables.role as 'admin' | 'control' | 'view') } };

    // --- Settings ---
    case 'GetSettings':
      return {
        settings: {
          data: await db.getSettings(),
          __typename: 'UserSettings',
        },
      };

    case 'UpdateSettings': {
      const data = await db.updateSettings(variables.data as string);
      return {
        updateSettings: {
          success: true,
          settings: { data, __typename: 'UserSettings' },
          __typename: 'UpdateSettingsResult',
        },
      };
    }

    // --- Account ---
    case 'GetAccount':
      return {
        account: {
          accountType: 'standard',
          accessoryLimit: null,
          adsenseAdsEnabled: false,
          smartDealsEnabled: false,
          hasSubscription: true,
          cloudSignupsAvailable: 0,
          __typename: 'Account',
        },
      };

    // --- Collections ---
    case 'GetCollections':
      return { collections: (await db.getCollections()).map(c => ({ ...c, __typename: 'Collection' })) };

    case 'CreateCollection': {
      const collection = await db.createCollection(variables.name as string);
      return { createCollection: { ...collection, __typename: 'Collection' } };
    }

    case 'UpdateCollection': {
      const collection = await db.updateCollection(
        variables.collectionId as string,
        variables.name as string | undefined,
        variables.payload as string | undefined
      );
      return { updateCollection: collection ? { ...collection, __typename: 'Collection' } : null };
    }

    case 'DeleteCollection':
      await db.deleteCollection(variables.collectionId as string);
      return { deleteCollection: { success: true, __typename: 'DeleteResult' } };

    // --- Stored Entities ---
    case 'GetStoredEntities':
      return { storedEntities: (await db.getStoredEntities()).map(e => ({ ...e, __typename: 'StoredEntity' })) };

    case 'SyncEntities': {
      const entities = await db.syncEntities(variables.entities as Array<{ entityType: string; entityId: string; data: string }>);
      return { syncEntities: entities.map(e => ({ ...e, __typename: 'StoredEntity' })) };
    }

    case 'UpdateStoredEntityLayout': {
      const entity = await db.updateStoredEntityLayout(
        variables.entityType as string,
        variables.entityId as string,
        variables.layoutJson as string
      );
      return { updateStoredEntityLayout: entity ? { ...entity, __typename: 'StoredEntity' } : null };
    }

    // --- Room Groups ---
    case 'GetRoomGroups':
      return { roomGroups: (await db.getRoomGroups()).map(g => ({ ...g, __typename: 'RoomGroup' })) };

    case 'CreateRoomGroup': {
      const group = await db.createRoomGroup(
        variables.name as string,
        variables.homeId as string,
        variables.roomIds as string[]
      );
      return { createRoomGroup: { ...group, __typename: 'RoomGroup' } };
    }

    case 'UpdateRoomGroup': {
      const group = await db.updateRoomGroup(
        variables.groupId as string,
        variables.name as string | undefined,
        variables.roomIds as string[] | undefined
      );
      return { updateRoomGroup: group ? { ...group, __typename: 'RoomGroup' } : null };
    }

    case 'DeleteRoomGroup':
      await db.deleteRoomGroup(variables.groupId as string);
      return { deleteRoomGroup: { success: true, __typename: 'DeleteResult' } };

    // --- HC Automations ---
    case 'GetHcAutomations':
      return { hcAutomations: (await db.getHcAutomations()).map(a => ({ ...a, __typename: 'HcAutomation' })) };

    case 'SaveHcAutomation': {
      const automation = await db.saveHcAutomation(
        variables.homeId as string,
        (variables.automationId as string) || null,
        variables.data as string
      );
      return { saveHcAutomation: { ...automation, __typename: 'HcAutomation' } };
    }

    case 'DeleteHcAutomation':
      await db.deleteHcAutomation(variables.automationId as string);
      return { deleteHcAutomation: { success: true, __typename: 'DeleteResult' } };

    // --- Execution History ---
    case 'GetExecutionHistory': {
      const traces = await db.getExecutionTraces(
        variables.automationId as string,
        (variables.limit as number) ?? 50,
      );
      return { executionHistory: traces.map(t => ({ ...t, __typename: 'ExecutionTrace' })) };
    }

    case 'GetExecutionTrace': {
      const trace = await db.getExecutionTrace(variables.traceId as string);
      return { executionTrace: trace ? { ...trace, __typename: 'ExecutionTrace' } : null };
    }

    // --- Automation Versions ---
    case 'GetAutomationVersions': {
      const versions = await db.getAutomationVersions(variables.automationId as string);
      return { automationVersions: versions.map(v => ({ ...v, __typename: 'AutomationVersion' })) };
    }

    case 'RestoreAutomationVersion': {
      const version = await db.getAutomationVersion(variables.versionId as string);
      if (version) {
        await db.saveHcAutomation(variables.homeId as string, version.automationId, version.dataJson);
      }
      return { restoreAutomationVersion: { success: !!version, __typename: 'RestoreResult' } };
    }

    // --- Credentials ---
    case 'GetCredentials':
      return { credentials: (await db.getCredentials()).map(c => ({ ...c, __typename: 'Credential' })) };

    case 'SaveCredential': {
      const cred = {
        id: (variables.id as string) || crypto.randomUUID(),
        name: variables.name as string,
        type: variables.type as 'api_key' | 'bearer' | 'basic_auth' | 'header',
        encryptedValue: variables.encryptedValue as string,
        iv: variables.iv as string,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      await db.saveCredential(cred);
      return { saveCredential: { id: cred.id, name: cred.name, type: cred.type, __typename: 'Credential' } };
    }

    case 'DeleteCredential':
      await db.deleteCredential(variables.id as string);
      return { deleteCredential: { success: true, __typename: 'DeleteResult' } };

    // --- Version ---
    case 'GetVersion': {
      const version = (window as any).homecastAppVersion || 'community';
      return { version, deployedAt: new Date().toISOString() };
    }

    // --- Sessions (just connected clients) ---
    case 'GetSessions':
      return { sessions: [] };

    case 'RemoveSession':
      return { removeSession: { success: true } };

    // --- Empty responses for cloud-only features ---
    case 'GetCachedHomes': {
      try {
        const homesResult = await executeHomeKitAction('homes.list', {}) as any;
        const homes = homesResult?.homes || [];
        return { cachedHomes: homes.map((h: any) => ({ id: h.id, name: h.name, updatedAt: new Date().toISOString(), __typename: 'CachedHome' })) };
      } catch {
        return { cachedHomes: [] };
      }
    }
    case 'GetPendingInvitations':
      return { pendingInvitations: [] };
    case 'GetMySharedHomes':
      return { mySharedHomes: [] };
    case 'GetMyEnrollments':
      return { myEnrollments: [] };
    case 'GetActiveDeals':
      return { activeDeals: [] };
    case 'GetWebhooks': {
      const { webhookToInfo } = await import('./local-webhooks');
      const webhooks = await db.getWebhooks();
      return { webhooks: webhooks.map(webhookToInfo) };
    }

    case 'GetWebhook': {
      const wh = await db.getWebhook(variables.webhookId as string);
      if (!wh) return { webhook: null };
      const { webhookToInfo: toInfo } = await import('./local-webhooks');
      return { webhook: toInfo(wh) };
    }

    case 'CreateWebhook': {
      const { createWebhook } = await import('./local-webhooks');
      const result = await createWebhook({
        name: variables.name as string,
        url: variables.url as string,
        eventTypes: variables.eventTypes as string[] | undefined,
        homeIds: variables.homeIds as string[] | undefined,
        roomIds: variables.roomIds as string[] | undefined,
        accessoryIds: variables.accessoryIds as string[] | undefined,
        collectionIds: variables.collectionIds as string[] | undefined,
        maxRetries: variables.maxRetries as number | undefined,
        rateLimitPerMinute: variables.rateLimitPerMinute as number | undefined,
        timeoutMs: variables.timeoutMs as number | undefined,
      });
      const { webhookToInfo: toInfoC } = await import('./local-webhooks');
      return { createWebhook: { success: true, webhook: toInfoC(result.webhook), rawSecret: result.rawSecret, error: null, __typename: 'CreateWebhookResult' } };
    }

    case 'UpdateWebhook': {
      const { updateWebhook, webhookToInfo: toInfoU } = await import('./local-webhooks');
      const updated = await updateWebhook(variables.webhookId as string, {
        name: variables.name as string | undefined,
        url: variables.url as string | undefined,
        eventTypes: variables.eventTypes as string[] | undefined,
        homeIds: variables.homeIds as string[] | undefined,
        roomIds: variables.roomIds as string[] | undefined,
        accessoryIds: variables.accessoryIds as string[] | undefined,
        collectionIds: variables.collectionIds as string[] | undefined,
        maxRetries: variables.maxRetries as number | undefined,
        rateLimitPerMinute: variables.rateLimitPerMinute as number | undefined,
        timeoutMs: variables.timeoutMs as number | undefined,
      });
      if (!updated) return { updateWebhook: { success: false, webhook: null, error: 'Webhook not found', __typename: 'UpdateWebhookResult' } };
      return { updateWebhook: { success: true, webhook: toInfoU(updated), error: null, __typename: 'UpdateWebhookResult' } };
    }

    case 'DeleteWebhook': {
      const { deleteWebhookById } = await import('./local-webhooks');
      await deleteWebhookById(variables.webhookId as string);
      return { deleteWebhook: { success: true, error: null, __typename: 'DeleteWebhookResult' } };
    }

    case 'PauseWebhook': {
      const { pauseWebhook, webhookToInfo: toInfoP } = await import('./local-webhooks');
      const paused = await pauseWebhook(variables.webhookId as string);
      if (!paused) return { pauseWebhook: { success: false, webhook: null, error: 'Not found', __typename: 'UpdateWebhookResult' } };
      return { pauseWebhook: { success: true, webhook: toInfoP(paused), error: null, __typename: 'UpdateWebhookResult' } };
    }

    case 'ResumeWebhook': {
      const { resumeWebhook, webhookToInfo: toInfoR } = await import('./local-webhooks');
      const resumed = await resumeWebhook(variables.webhookId as string);
      if (!resumed) return { resumeWebhook: { success: false, webhook: null, error: 'Not found', __typename: 'UpdateWebhookResult' } };
      return { resumeWebhook: { success: true, webhook: toInfoR(resumed), error: null, __typename: 'UpdateWebhookResult' } };
    }

    case 'RotateWebhookSecret': {
      const { rotateWebhookSecret, webhookToInfo: toInfoS } = await import('./local-webhooks');
      const rotated = await rotateWebhookSecret(variables.webhookId as string);
      if (!rotated) return { rotateWebhookSecret: { success: false, webhook: null, rawSecret: null, error: 'Not found', __typename: 'RotateSecretResult' } };
      return { rotateWebhookSecret: { success: true, webhook: toInfoS(rotated.webhook), rawSecret: rotated.rawSecret, error: null, __typename: 'RotateSecretResult' } };
    }

    case 'TestWebhook': {
      const { testWebhook } = await import('./local-webhooks');
      const testResult = await testWebhook(variables.webhookId as string);
      return { testWebhook: { ...testResult, __typename: 'TestWebhookResult' } };
    }

    case 'GetWebhookDeliveryHistory': {
      const deliveries = await db.getWebhookDeliveries(variables.webhookId as string, (variables.limit as number) || 50);
      return {
        webhookDeliveryHistory: {
          deliveries: deliveries.map((d: any) => ({ ...d, __typename: 'WebhookDelivery' })),
          total: deliveries.length,
          offset: (variables.offset as number) || 0,
          limit: (variables.limit as number) || 50,
          __typename: 'DeliveryHistoryResult',
        },
      };
    }
    case 'GetAccessTokens': {
      const { getTokens } = await import('./local-tokens');
      const tokens = await getTokens();
      return { accessTokens: tokens.map(t => ({ ...t, token: t.prefix + '...', __typename: 'AccessToken' })) };
    }

    case 'CreateAccessToken': {
      const { createToken } = await import('./local-tokens');
      const { token: tokenObj, fullToken } = await createToken(
        variables.name as string,
        variables.homePermissions as string,
        variables.expiresAt as string | undefined
      );
      return { createAccessToken: { ...tokenObj, token: fullToken, __typename: 'AccessToken' } };
    }

    case 'RevokeAccessToken': {
      const { revokeToken } = await import('./local-tokens');
      await revokeToken(variables.tokenId as string);
      return { revokeAccessToken: { success: true, __typename: 'RevokeResult' } };
    }
    case 'GetAuthorizedApps': {
      const consents = await db.getAllUserConsents();
      const clients = await db.getAllOAuthClients();
      const clientMap = new Map(clients.map((c: any) => [c.client_id, c]));
      return {
        authorizedApps: consents.map((c: any) => {
          const client = clientMap.get(c.client_id);
          return {
            clientId: c.client_id,
            clientName: client?.client_name || c.client_id,
            clientUri: client?.client_uri || null,
            logoUri: client?.logo_uri || null,
            scope: c.scope,
            homePermissions: JSON.stringify(c.home_permissions || {}),
            createdAt: c.created_at,
            lastUsedAt: c.last_used_at || null,
            __typename: 'AuthorizedApp',
          };
        }),
      };
    }

    case 'RevokeAuthorizedApp': {
      const clientId = variables.clientId as string;
      const consents = await db.getAllUserConsents();
      const consent = consents.find((c: any) => c.client_id === clientId);
      if (consent) await db.deleteUserConsent(consent.id);
      return { revokeAuthorizedApp: { success: true, error: null, __typename: 'RevokeAuthorizedAppResult' } };
    }

    case 'UpdateAuthorizedApp': {
      const clientId = variables.clientId as string;
      const consents = await db.getAllUserConsents();
      const consent = consents.find((c: any) => c.client_id === clientId);
      if (consent) {
        if (variables.homePermissions) {
          try { consent.home_permissions = JSON.parse(variables.homePermissions as string); } catch {}
        }
        await db.putUserConsent(consent);
      }
      return { updateAuthorizedApp: { success: true, error: null, __typename: 'UpdateAuthorizedAppResult' } };
    }

    case 'GetBackgroundPresets':
      return { backgroundPresets: [] };
    case 'GetUserBackgrounds':
      return { userBackgrounds: [] };
    case 'GetConnectionDebugInfo':
      return { connectionDebugInfo: { serverInstanceId: 'community-local', pubsubEnabled: false, pubsubSlot: null, __typename: 'ConnectionDebugInfo' } };
    // --- Entity Access (Sharing) ---
    case 'GetEntityAccess': {
      const allAccess = await db.getEntityAccess();
      const filtered = allAccess.filter(a =>
        a.entityType === variables.entityType && a.entityId === variables.entityId
      );
      return { entityAccess: filtered.map(a => ({ ...a, __typename: 'EntityAccess' })) };
    }

    case 'GetSharingInfo': {
      const allAccess = await db.getEntityAccess();
      const matching = allAccess.filter(a =>
        a.entityType === variables.entityType && a.entityId === variables.entityId
      );
      const publicAccess = matching.find(a => a.accessType === 'public');
      const passcodes = matching.filter(a => a.accessType === 'passcode');
      const users = matching.filter(a => a.accessType === 'user');
      const shareHash = publicAccess?.shareHash || matching[0]?.shareHash || btoa(`${variables.entityType}:${variables.entityId}`).replace(/[+/=]/g, c => c === '+' ? '-' : c === '/' ? '_' : '').slice(0, 16);
      return {
        sharingInfo: {
          isShared: matching.length > 0,
          hasPublic: !!publicAccess,
          publicRole: publicAccess?.role || null,
          passcodeCount: passcodes.length,
          userCount: users.length,
          shareHash,
          shareUrl: `${window.location.origin}/s/${shareHash}`,
          roomCount: 0,
          accessoryCount: 0,
          groupCount: 0,
          __typename: 'SharingInfo',
        },
      };
    }

    case 'CreateEntityAccess': {
      const shareHash = btoa(`${variables.entityType}:${variables.entityId}:${Date.now()}`).replace(/[+/=]/g, c => c === '+' ? '-' : c === '/' ? '_' : '').slice(0, 16);
      const access = {
        id: crypto.randomUUID(),
        entityType: variables.entityType as string,
        entityId: variables.entityId as string,
        accessType: variables.accessType as string,
        role: variables.role as string,
        homeId: (variables.homeId as string) || null,
        userEmail: (variables.userEmail as string) || null,
        name: (variables.name as string) || null,
        entityName: (variables.entityName as string) || null,
        passcode: (variables.passcode as string) || null,
        hasPasscode: !!(variables.passcode),
        accessSchedule: (variables.accessSchedule as string) || null,
        shareHash,
        createdAt: new Date().toISOString(),
      };
      await db.putEntityAccess(access);
      return {
        createEntityAccess: {
          success: true,
          error: null,
          access: { ...access, __typename: 'EntityAccess' },
          shareHash,
          shareUrl: `${window.location.origin}/s/${shareHash}`,
          __typename: 'CreateEntityAccessResult',
        },
      };
    }

    case 'UpdateEntityAccess': {
      const allAccess = await db.getEntityAccess();
      const existing = allAccess.find(a => a.id === variables.accessId);
      if (!existing) return { updateEntityAccess: { success: false, error: 'Not found', access: null } };
      if (variables.role !== undefined) existing.role = variables.role;
      if (variables.passcode !== undefined) { existing.passcode = variables.passcode; existing.hasPasscode = !!variables.passcode; }
      if (variables.name !== undefined) existing.name = variables.name;
      if (variables.accessSchedule !== undefined) existing.accessSchedule = variables.accessSchedule;
      await db.putEntityAccess(existing);
      return { updateEntityAccess: { success: true, error: null, access: { ...existing, __typename: 'EntityAccess' }, __typename: 'UpdateEntityAccessResult' } };
    }

    case 'DeleteEntityAccess':
      await db.deleteEntityAccess(variables.accessId as string);
      return { deleteEntityAccess: { success: true, error: null, __typename: 'DeleteResult' } };

    case 'GetMySharedEntities': {
      const allAccess = await db.getEntityAccess();
      return {
        mySharedEntities: allAccess.map(a => ({
          id: a.id,
          entityType: a.entityType,
          entityId: a.entityId,
          entityName: a.entityName || null,
          accessType: a.accessType,
          role: a.role,
          name: a.name || null,
          userEmail: a.userEmail || null,
          hasPasscode: !!a.hasPasscode,
          shareUrl: a.shareHash ? `${window.location.origin}/s/${a.shareHash}` : null,
          accessSchedule: a.accessSchedule || null,
          createdAt: a.createdAt || null,
          __typename: 'EntityAccess',
        })),
      };
    }

    // --- Home Members ---
    case 'GetHomeMembers': {
      const members = await db.getHomeMembers();
      const filtered = variables.homeId ? members.filter(m => m.homeId === variables.homeId) : members;
      return { homeMembers: filtered.map(m => ({ ...m, __typename: 'HomeMember' })) };
    }

    case 'InviteHomeMember': {
      // In Community mode, "invite" creates the member directly (no email)
      const member = {
        id: crypto.randomUUID(),
        homeId: variables.homeId as string,
        email: variables.email as string, // username in Community mode
        name: variables.email as string,
        role: variables.role as string,
        status: 'active',
        createdAt: new Date().toISOString(),
      };
      await db.putHomeMember(member);
      return { inviteHomeMember: { success: true, error: null, member: { ...member, __typename: 'HomeMember' }, __typename: 'InviteHomeMemberResult' } };
    }

    case 'UpdateHomeMemberRole': {
      const members = await db.getHomeMembers();
      const member = members.find(m => m.homeId === variables.homeId && m.email === variables.email);
      if (!member) return { updateHomeMemberRole: { success: false, error: 'Not found' } };
      member.role = variables.role;
      await db.putHomeMember(member);
      return { updateHomeMemberRole: { success: true, error: null, member: { ...member, __typename: 'HomeMember' }, __typename: 'UpdateHomeMemberRoleResult' } };
    }

    case 'RemoveHomeMember': {
      const members = await db.getHomeMembers();
      const member = members.find(m => m.homeId === variables.homeId && m.email === variables.email);
      if (member) await db.deleteHomeMember(member.id);
      return { removeHomeMember: { success: true, error: null, __typename: 'RemoveHomeMemberResult' } };
    }

    case 'AcceptHomeInvitation':
      return { acceptHomeInvitation: { success: true, error: null } };
    case 'RejectHomeInvitation':
      return { rejectHomeInvitation: { success: true, error: null } };
    case 'DismissHome':
      return { dismissHome: { success: true, error: null } };

    // --- Public Entity (shared links) ---
    case 'GetPublicEntity': {
      const allAccess = await db.getEntityAccess();
      const matching = allAccess.filter(a => a.shareHash === variables.shareHash);
      if (matching.length === 0) return { publicEntity: null };

      // Base access record (non-passcode, or first if all are passcode-gated)
      const baseAccess = matching.find(a => a.accessType !== 'passcode') || matching[0];
      // Passcode-gated access record (grants higher role, e.g. control)
      const passcodeAccess = matching.find(a => a.accessType === 'passcode');
      const canUpgradeWithPasscode = !!passcodeAccess;

      // Determine effective role: if passcode provided and matches, use the passcode record's role
      let effectiveRole = baseAccess.role;
      let requiresPasscode = false;

      if (passcodeAccess) {
        if (variables.passcode && passcodeAccess.passcode === variables.passcode) {
          // Correct passcode — grant the passcode record's role
          effectiveRole = passcodeAccess.role;
        } else if (!baseAccess || baseAccess.accessType === 'passcode') {
          // No base (view) access — passcode is required to access at all
          requiresPasscode = true;
          if (variables.passcode) {
            // Wrong passcode provided
            return { publicEntity: { requiresPasscode: true, entityType: baseAccess.entityType, entityId: baseAccess.entityId, entityName: baseAccess.entityName, role: null, data: null, canUpgradeWithPasscode: false, __typename: 'PublicEntity' } };
          }
        }
      }

      return {
        publicEntity: {
          entityType: baseAccess.entityType,
          entityId: baseAccess.entityId,
          entityName: baseAccess.entityName || baseAccess.name,
          role: effectiveRole,
          requiresPasscode,
          canUpgradeWithPasscode,
          data: null,
          __typename: 'PublicEntity',
        },
      };
    }

    case 'GetPublicEntityAccessories': {
      const allAccess = await db.getEntityAccess();
      const access = allAccess.find(a => a.shareHash === variables.shareHash);
      if (!access) return { publicEntityAccessories: '[]' };

      try {
        // Fetch accessory + service group data from HomeKit based on entity type
        let accessories: any[] = [];
        let serviceGroups: any[] = [];
        if (access.entityType === 'accessory') {
          const result = await executeHomeKitAction('accessory.get', { accessoryId: access.entityId }) as any;
          if (result?.accessory) accessories = [result.accessory];
        } else if (access.entityType === 'home') {
          const [accResult, sgResult] = await Promise.all([
            executeHomeKitAction('accessories.list', { homeId: access.entityId, includeValues: true, includeAll: true }) as Promise<any>,
            executeHomeKitAction('serviceGroups.list', { homeId: access.entityId }).catch(() => ({ serviceGroups: [] })) as Promise<any>,
          ]);
          accessories = accResult?.accessories || [];
          serviceGroups = sgResult?.serviceGroups || [];
        } else if (access.entityType === 'room') {
          const result = await executeHomeKitAction('accessories.list', { roomId: access.entityId, includeValues: true, includeAll: true }) as any;
          accessories = result?.accessories || [];
        } else if (access.entityType === 'accessory_group') {
          // Fetch service group from HomeKit to get member accessory IDs
          // Search the specified home, or all homes if homeId is missing
          try {
            const homeIds: string[] = [];
            if (access.homeId) {
              homeIds.push(access.homeId);
            } else {
              const homesResult = await executeHomeKitAction('homes.list') as any;
              homeIds.push(...(homesResult?.homes || []).map((h: any) => h.id));
            }
            for (const hid of homeIds) {
              const sgResult = await executeHomeKitAction('serviceGroups.list', { homeId: hid }) as any;
              const group = (sgResult?.serviceGroups || []).find((g: any) => g.id === access.entityId);
              if (group?.accessoryIds?.length) {
                const results = await Promise.all(
                  group.accessoryIds.map((id: string) =>
                    executeHomeKitAction('accessory.get', { accessoryId: id }).catch(() => null)
                  )
                );
                accessories = results.filter(Boolean).map((r: any) => r?.accessory).filter(Boolean);
                serviceGroups = [group];
                break;
              }
            }
          } catch {}
          // Fallback: try stored entity data
          if (accessories.length === 0) {
            const entities = await db.getStoredEntities();
            const entity = entities.find(e => e.entityId === access.entityId);
            if (entity?.data) {
              try {
                const parsed = JSON.parse(entity.data);
                const accessoryIds = parsed.accessoryIds || parsed.items?.map((i: any) => i.accessoryId) || [];
                const results = await Promise.all(
                  accessoryIds.map((id: string) =>
                    executeHomeKitAction('accessory.get', { accessoryId: id }).catch(() => null)
                  )
                );
                accessories = results.filter(Boolean).map((r: any) => r?.accessory).filter(Boolean);
              } catch {}
            }
          }
        } else if (access.entityType === 'collection') {
          const entities = await db.getStoredEntities();
          const entity = entities.find(e => e.entityId === access.entityId);
          if (entity?.data) {
            try {
              const parsed = JSON.parse(entity.data);
              const accessoryIds = parsed.accessoryIds || parsed.items?.map((i: any) => i.accessoryId) || [];
              const results = await Promise.all(
                accessoryIds.map((id: string) =>
                  executeHomeKitAction('accessory.get', { accessoryId: id }).catch(() => null)
                )
              );
              accessories = results.filter(Boolean).map((r: any) => r?.accessory).filter(Boolean);
            } catch {}
          }
        }
        return { publicEntityAccessories: JSON.stringify({ accessories, serviceGroups, layout: null }) };
      } catch (e) {
        console.error('[LocalGraphQL] Failed to fetch accessories for shared entity:', e);
        return { publicEntityAccessories: '[]' };
      }
    }

    case 'PublicEntitySetCharacteristic': {
      // Validate the share hash and role — check passcode-gated access too
      const allAccess = await db.getEntityAccess();
      const matching = allAccess.filter(a => a.shareHash === variables.shareHash);
      const baseAccess = matching.find(a => a.accessType !== 'passcode') || matching[0];
      const passcodeAccess = matching.find(a => a.accessType === 'passcode');
      // Determine effective role
      let effectiveRole = baseAccess?.role;
      if (passcodeAccess && variables.passcode && passcodeAccess.passcode === variables.passcode) {
        effectiveRole = passcodeAccess.role;
      }
      if (!baseAccess || effectiveRole === 'view') {
        return { publicEntitySetCharacteristic: { success: false, error: 'Access denied' } };
      }
      // Actually execute the HomeKit command
      try {
        await communityRequest('characteristic.set', {
          accessoryId: variables.accessoryId,
          characteristicType: variables.characteristicType,
          value: variables.value,
        });
        return {
          publicEntitySetCharacteristic: {
            success: true,
            accessoryId: variables.accessoryId,
            characteristicType: variables.characteristicType,
            value: variables.value,
            __typename: 'PublicEntitySetCharacteristicResult',
          },
        };
      } catch (e: any) {
        return { publicEntitySetCharacteristic: { success: false, error: e.message } };
      }
    }
    case 'GetWebhookEventTypes':
      return { webhookEventTypes: [
        { eventType: 'state.changed', displayName: 'State Changed', description: 'Fired when a device characteristic changes', category: 'Device', __typename: 'WebhookEventTypeInfo' },
      ] };

    default:
      // Return empty data for unknown operations (prevents Apollo errors)
      console.warn(`[LocalGraphQL] Unknown operation: ${operationName}`);
      return {};
  }
}
