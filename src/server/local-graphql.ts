/**
 * Community mode: handles GraphQL operations locally.
 *
 * Routes operations by name to the appropriate handler, backed by IndexedDB
 * for persistence. Returns the same response shape as the cloud GraphQL API.
 */

import * as db from './local-db';
import * as auth from './local-auth';
import { executeHomeKitAction } from '../relay/local-handler';
import { executeHomeKitWrite } from './homekit-write';
import { communityRequest } from './connection';
import { randomUUID } from '../lib/uuid';

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
  // Share links. These carry their own access control — an unguessable hash,
  // the passcode when one is set, and the role recorded against it — and every
  // one of them returns nothing for a hash that matches no row. Sitting behind
  // the blanket auth gate made "public access" mean "public to people who
  // already have an account here", which is not sharing.
  'GetPublicEntity', 'GetPublicEntityAccessories', 'PublicEntitySetCharacteristic',
]);

/**
 * Operations that stay open while auth is on but no owner exists yet.
 *
 * This is a recovery hatch, not a hole: with no users, a token cannot be
 * issued to anybody, so requiring one makes the relay unrecoverable rather
 * than secure. As soon as an owner exists these need credentials like
 * everything else.
 */
const GRAPHQL_BOOTSTRAP_OPS = new Set([
  'CreateCommunityUser', 'SetAuthEnabled',
]);

/**
 * Map a locally-stored HC automation row onto the cloud's StoredEntityInfo
 * shape, which is what the client documents select. Rows written before
 * `updatedAt` existed fall back to `createdAt`.
 */
/**
 * Push automation changes into the locally-running engine. Lazily imported so
 * the engine stays out of the main bundle for browser clients that never run it
 * (same reason local-handler defers it). No-op when the engine isn't running.
 */
async function reloadCommunityAutomations(): Promise<void> {
  try {
    const m = await import('./community-automation');
    await m.reloadCommunityAutomations();
  } catch { /* engine not running in this context */ }
}

/** As above, for helper definitions. */
async function reloadCommunityVirtualAccessories(): Promise<void> {
  try {
    const m = await import('./community-automation');
    await m.reloadCommunityVirtualAccessories();
  } catch { /* engine not running in this context */ }
}

/** Trigger/actions cross GraphQL as JSON strings; the relay actions want objects. */
function parseMaybeJson(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

/**
 * Stamp __typename through a native HomeKit automation so Apollo can normalize
 * the nested trigger/events/conditions the client documents select.
 */
function toHomeKitAutomation(a: any) {
  if (!a) return null;
  const event = (e: any) => ({ ...e, __typename: 'AutomationEvent' });
  return {
    ...a,
    trigger: a.trigger
      ? {
          ...a.trigger,
          events: (a.trigger.events || []).map(event),
          endEvents: (a.trigger.endEvents || []).map(event),
          conditions: (a.trigger.conditions || []).map((c: any) => ({
            ...c,
            __typename: 'AutomationTriggerCondition',
          })),
          __typename: 'AutomationTrigger',
        }
      : null,
    actions: (a.actions || []).map((ac: any) => ({ ...ac, __typename: 'AutomationAction' })),
    __typename: 'HomeKitAutomation',
  };
}

function toStoredAutomation(a: { id: string; homeId: string; data: string; createdAt: string; updatedAt?: string }) {
  return {
    id: a.id,
    entityType: 'automation',
    entityId: a.id,
    parentId: a.homeId,
    dataJson: a.data,
    updatedAt: a.updatedAt ?? a.createdAt,
    __typename: 'StoredEntityInfo',
  };
}

function toStoredVirtualAccessory(h: { id: string; homeId: string; data: string; createdAt: string; updatedAt?: string }) {
  return {
    id: h.id,
    entityType: 'hc_virtual_accessory',
    entityId: h.id,
    parentId: h.homeId,
    dataJson: h.data,
    updatedAt: h.updatedAt ?? h.createdAt,
    __typename: 'StoredEntityInfo',
  };
}

/**
 * Local `stored_entities` rows onto the shape the client documents select.
 * The IndexedDB row names two fields differently (`data`, `createdAt`) from
 * the GraphQL surface (`dataJson`, `updatedAt`), so a read that skipped this
 * mapping handed Apollo `undefined` for both.
 *
 * `typename` defaults to the list type. The single-layout query uses
 * `StoredEntityLayout` to match what `useEntityLayout.updateCache` writes
 * optimistically — otherwise a fresh read and an optimistic write land in two
 * different normalised cache entries.
 */

/**
 * The origin to put in a share link.
 *
 * `window.location.origin` on the relay is `http://localhost:5656`, which
 * means "this device" on whatever device reads it — so a link built from it
 * works only on the Mac that generated it and is useless to the person it was
 * sent to. Only the server knows the answer, and it reports it on /health.
 *
 * Cached because share links are generated in a handful of places and the
 * answer does not change while the process is up. Falls back to the page
 * origin, which is right for every non-relay caller.
 */
let shareOriginCache: string | null = null;
async function shareOrigin(): Promise<string> {
  if (shareOriginCache) return shareOriginCache;
  const fallback = typeof window !== 'undefined' ? window.location.origin : '';
  try {
    const resp = await fetch('/health', { signal: AbortSignal.timeout(3000) });
    const d = await resp.json();
    const first = Array.isArray(d?.addresses) ? d.addresses.find((a: unknown) => typeof a === 'string') : null;
    shareOriginCache = first || (d?.lanAddress ? `http://${d.lanAddress}:${d.port || 5656}` : fallback);
  } catch {
    shareOriginCache = fallback;
  }
  return shareOriginCache;
}

function toStoredEntity(e: db.StoredEntity, typename = 'StoredEntity') {
  return {
    id: e.id,
    entityType: e.entityType,
    entityId: e.entityId,
    parentId: e.parentId ?? null,
    dataJson: e.data ?? null,
    layoutJson: e.layoutJson ?? null,
    updatedAt: e.createdAt,
    __typename: typename,
  };
}

/**
 * A Community member onto the shape the client documents select.
 *
 * Community members are local accounts created on the spot — there is no
 * invite email and nothing to accept — so they are active from the moment they
 * are added. Rows written before `status` existed get it filled in here, and
 * the superseded `isPending` is derived rather than stored twice.
 */
function toHomeMember(m: any) {
  const status = m.status || 'active';
  return { ...m, status, isPending: status === 'awaiting_signup', __typename: 'HomeMember' };
}

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
        // Auth can be on with nobody to authenticate as — switching it on
        // invalidates every token, including the caller's, and the ops that
        // would create the first account are not public. That left the relay
        // permanently unreachable: no user could be made, and auth could not
        // be switched back off, because both need a token that can no longer
        // exist. While there is no owner, the bootstrap ops stay open; there
        // is nothing yet for them to protect.
        const onboarded = await auth.isOnboarded();
        if (!onboarded && GRAPHQL_BOOTSTRAP_OPS.has(operationName)) {
          // fall through — creating the owner or turning auth back off
        } else {
          const token = extractToken(authorization);
          const payload = token ? await auth.verifyToken(token) : null;
          if (!payload) {
            return { data: null, errors: [{ message: 'Authentication required' }] };
          }
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

/** The history query layer over IndexedDB. */
function idbHistoryStore(): import('../history/query').HistoryStore {
  return {
    getSamples: async (sid, from, to) =>
      (await db.getHistorySamples(sid, from, to)).map(r => ({ ts: r.ts, v: r.v, vt: r.vt })),
    getLastSampleBefore: async (sid, ts) => {
      const row = await db.getLastHistorySampleBefore(sid, ts);
      return row ? { ts: row.ts, v: row.v, vt: row.vt } : undefined;
    },
    getFirstSampleTs: async (sid) =>
      (await db.getHistorySamples(sid, 0, Number.MAX_SAFE_INTEGER, 1))[0]?.ts ?? null,
    getRollups: (sid, tier, from, to) => db.getHistoryRollups(sid, tier, from, to),
    getLastRollupBefore: (sid, tier, bucket) => db.getLastHistoryRollupBefore(sid, tier, bucket),
  };
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
      // relayReady stays unconditional: if the server is handling this request
      // the relay is ready, and localStorage may have been wiped by a mode
      // reset. isOnboarded is a different question and must be answered
      // honestly — reporting "yes" on a relay with no accounts told every
      // client to show a sign-in form for credentials that cannot exist.
      return {
        isOnboarded: await auth.isOnboarded(),
        relayReady: true,
        authEnabled,
      };
    }

    case 'SetAuthEnabled': {
      // Turning auth on invalidates every token. With no owner there is nobody
      // to sign back in as, so this would brick the relay rather than secure it.
      if (variables.enabled && !(await auth.isOnboarded())) {
        return {
          setAuthEnabled: {
            success: false,
            enabled: false,
            error: 'Create an account first — turning on authentication with no accounts would lock everyone out.',
          },
        };
      }
      await db.setSetting('auth-enabled', variables.enabled ? 'true' : 'false');
      const { refreshAuthEnabled, clearAuthenticatedClients } = await import('./local-server');
      await refreshAuthEnabled();
      if (variables.enabled) {
        // Deliberately NOT invalidateAllTokens(). Rotating the signing key here
        // destroyed the caller's own token, so switching auth on locked out the
        // person who switched it on — the next request, including creating the
        // first user, came back "Authentication required" from their own relay.
        //
        // It bought nothing either: while auth is off nobody holds a token
        // except real accounts, because unauthenticated clients are Guests with
        // no token at all. So the only credentials it could ever destroy were
        // legitimate ones. Password changes and user deletion still rotate,
        // which is where rotating is actually the point.
        clearAuthenticatedClients();
        const broadcast =
          typeof window !== 'undefined' ? (window as any).__localserver_broadcast : null;
        if (broadcast) broadcast({ type: 'auth_required' });
      }
      return { setAuthEnabled: { success: true, enabled: !!variables.enabled } };
    }

    case 'GetAuthEnabled': {
      const enabled = (await db.getSetting('auth-enabled')) === 'true';
      return { authEnabled: enabled };
    }

    case 'GetRelayName': {
      // Empty means "no custom name" — the native side answers with the
      // computer's hostname instead, so callers get a name either way.
      return { relayName: (await db.getSetting('relay-name')) || '' };
    }

    case 'SetRelayName': {
      // Stored here rather than in Swift because IndexedDB is the relay's
      // settings store; Swift keeps a mirror purely so /health can answer on a
      // cold start, before this web app has loaded to tell it anything.
      const name = String(variables.name ?? '').trim().slice(0, 60);
      await db.setSetting('relay-name', name);
      const { refreshRelayName } = await import('./local-server');
      await refreshRelayName();
      return { setRelayName: { success: true, name, error: null } };
    }

    // --- Community User Management ---
    case 'GetCommunityUsers':
      return { communityUsers: await auth.getUsers() };

    case 'CreateCommunityUser': {
      // Whether this is the very first account has to be answered before we
      // create it.
      const wasFirstAccount = !(await auth.isOnboarded());
      const user = await auth.createUser(
        variables.name as string,
        variables.password as string,
        variables.role as 'admin' | 'control' | 'view'
      );
      // Hand back a session for the first account. Otherwise whoever set up
      // the relay is still holding nothing, and the moment they switch
      // authentication on they are locked out of the screen they did it from —
      // they created the credentials and were never given them.
      const session = wasFirstAccount
        ? await auth.login(variables.name as string, variables.password as string)
        : null;
      return {
        createCommunityUser: {
          id: user.id,
          name: user.name,
          role: user.role,
          createdAt: user.createdAt,
          token: session?.token ?? null,
        },
      };
    }

    case 'DeleteCommunityUser': {
      const success = await auth.deleteUser(variables.userId as string);
      if (success) {
        await auth.invalidateAllTokens();
        const { clearAuthenticatedClients } = await import('./local-server');
        clearAuthenticatedClients();
        const broadcast =
          typeof window !== 'undefined' ? (window as any).__localserver_broadcast : null;
        if (broadcast) broadcast({ type: 'auth_required' });
      }
      return { deleteCommunityUser: { success } };
    }

    case 'ChangeCommunityUserPassword': {
      const success = await auth.changePassword(variables.userId as string, variables.password as string);
      if (success) {
        const { clearAuthenticatedClients } = await import('./local-server');
        clearAuthenticatedClients();
        const broadcast =
          typeof window !== 'undefined' ? (window as any).__localserver_broadcast : null;
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
      return {
        storedEntities: (await db.getStoredEntities(variables.entityType as string | undefined))
          .map(e => toStoredEntity(e)),
      };

    case 'GetStoredEntityLayout': {
      const entity = await db.getStoredEntityLayout(
        variables.entityType as string,
        variables.entityId as string
      );
      // `null`, not `{}` — useEntityLayout reads data?.storedEntityLayout?.layoutJson
      // and updateCache expects the field to be present in the shape.
      return { storedEntityLayout: entity ? toStoredEntity(entity, 'StoredEntityLayout') : null };
    }

    case 'SyncEntities': {
      const entities = await db.syncEntities(
        variables.entities as Array<{ entityType: string; entityId: string; parentId?: string | null; data?: string; dataJson?: string }>
      );
      return { syncEntities: { __typename: 'SyncEntitiesResult', success: true, syncedCount: entities.length } };
    }

    case 'UpdateStoredEntityLayout': {
      const entity = await db.updateStoredEntityLayout(
        variables.entityType as string,
        variables.entityId as string,
        variables.layoutJson as string
      );
      return {
        updateStoredEntityLayout: {
          __typename: 'UpdateEntityLayoutResult',
          success: !!entity,
          entity: entity ? toStoredEntity(entity, 'StoredEntityLayout') : null,
        },
      };
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
    // The client documents (HC_AUTOMATIONS / SAVE_HC_AUTOMATION) select the
    // cloud's StoredEntityInfo shape, so map the local row onto it rather than
    // returning raw IndexedDB columns.
    case 'HcAutomations':
      return {
        hcAutomations: (await db.getHcAutomations(variables.homeId as string))
          .map(toStoredAutomation),
      };

    case 'SaveHcAutomation': {
      const automation = await db.saveHcAutomation(
        variables.homeId as string,
        (variables.automationId as string) || null,
        variables.data as string
      );
      // Cloud mode gets an `automation.sync` push; locally we have to tell the
      // running engine ourselves or the change won't take effect until restart.
      void reloadCommunityAutomations();
      return { saveHcAutomation: toStoredAutomation(automation) };
    }

    case 'DeleteHcAutomation':
      await db.deleteHcAutomation(variables.automationId as string);
      void reloadCommunityAutomations();
      return { deleteHcAutomation: { success: true, __typename: 'DeleteResult' } };

    // --- HC Helpers ---
    // Virtual entities (modes, switches, counters, timers). Same StoredEntityInfo
    // shape as automations — `dataJson` carries the serialized VirtualAccessoryDefinition.
    case 'VirtualAccessories':
      return {
        virtualAccessories: (await db.getVirtualAccessories(variables.homeId as string))
          .map(toStoredVirtualAccessory),
      };

    case 'SaveVirtualAccessory': {
      const helper = await db.saveVirtualAccessory(
        variables.homeId as string,
        (variables.accessoryId as string) || null,
        variables.data as string
      );
      // Same reason as automations: cloud gets a server push, Community has to
      // tell its own engine or the helper won't exist until the next restart.
      //
      // Awaited, not fired off: `accessories.list` reads the running engine, so
      // resolving before the sync lands lets the very next list still answer
      // with the old set — which is the caller's own refetch, every time.
      await reloadCommunityVirtualAccessories();
      return { saveVirtualAccessory: toStoredVirtualAccessory(helper) };
    }

    case 'DeleteVirtualAccessory':
      await db.deleteVirtualAccessory(variables.accessoryId as string);
      // Awaited for the same reason as the save above — here it is what makes
      // the deleted tile actually go away instead of surviving until a reload.
      await reloadCommunityVirtualAccessories();
      // A scalar, because the client document selects this field as a leaf
      // (`mutations.ts` DELETE_VIRTUAL_ACCESSORY) — which is only valid against
      // the cloud's `Boolean`. Answering with an object put a shape into the
      // Apollo cache that CE alone would ever see.
      return { deleteVirtualAccessory: true };

    // --- Execution History ---
    // GET_EXECUTION_HISTORY selects `hcExecutionTraces` with the StoredEntityInfo
    // shape; the stored row keeps the trace in `traceJson`.
    case 'GetExecutionHistory': {
      const traces = await db.getExecutionTraces(
        variables.automationId as string,
        (variables.limit as number) ?? 50,
      );
      return {
        hcExecutionTraces: traces.map(t => ({
          id: t.id,
          entityType: 'execution_trace',
          entityId: t.id,
          parentId: t.automationId,
          dataJson: t.traceJson,
          updatedAt: t.finishedAt ?? t.startedAt,
          __typename: 'StoredEntityInfo',
        })),
      };
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
        void reloadCommunityAutomations();
      }
      return { restoreAutomationVersion: { success: !!version, __typename: 'RestoreResult' } };
    }

    // --- Credentials ---
    case 'GetCredentials':
      return { credentials: (await db.getCredentials()).map(c => ({ ...c, __typename: 'Credential' })) };

    case 'SaveCredential': {
      const cred = {
        id: (variables.id as string) || randomUUID(),
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
    case 'GetScenes': {
      const result = await executeHomeKitAction('scenes.list', { homeId: variables.homeId }) as any;
      return {
        scenes: (result?.scenes || []).map((s: any) => ({
          actionSetType: null,
          automationName: null,
          ...s,
          __typename: 'HomeKitScene',
        })),
      };
    }
    case 'ExecuteScene': {
      const result = await executeHomeKitAction('scene.execute', { sceneId: variables.sceneId }) as any;
      return { executeScene: { success: result?.success ?? true, sceneId: variables.sceneId, __typename: 'SceneExecuteResult' } };
    }
    case 'DeleteScene': {
      const result = await executeHomeKitWrite('scene.delete', { sceneId: variables.sceneId }) as any;
      return { deleteScene: { success: result?.success ?? true, sceneId: variables.sceneId, __typename: 'SceneDeleteResult' } };
    }
    case 'CreateScene': {
      // actions arrives as a JSON string (matches how automations pass actions over GraphQL)
      const actions = typeof variables.actions === 'string' ? JSON.parse(variables.actions as string) : variables.actions;
      const result = await executeHomeKitWrite('scene.create', {
        homeId: variables.homeId,
        name: variables.name,
        actions,
      }) as any;
      return {
        createScene: {
          actionSetType: null,
          automationName: null,
          ...result,
          // Cloud serializes scene actions as a JSON string over GraphQL
          actions: result?.actions != null ? JSON.stringify(result.actions) : null,
          __typename: 'HomeKitScene',
        },
      };
    }
    case 'UpdateScene': {
      const payload: Record<string, unknown> = { sceneId: variables.sceneId };
      if (variables.name !== undefined && variables.name !== null) payload.name = variables.name;
      if (variables.actions !== undefined && variables.actions !== null) {
        payload.actions = typeof variables.actions === 'string' ? JSON.parse(variables.actions as string) : variables.actions;
      }
      const result = await executeHomeKitWrite('scene.update', payload) as any;
      return {
        updateScene: {
          actionSetType: null,
          automationName: null,
          ...result,
          // Cloud serializes scene actions as a JSON string over GraphQL
          actions: result?.actions != null ? JSON.stringify(result.actions) : null,
          __typename: 'HomeKitScene',
        },
      };
    }
    // --- HomeKit-native automations ---
    // These route to the same relay actions the cloud calls. Without them every
    // HomeKit automation operation fell through to the `default` case and
    // returned {}, so the list was silently empty and the create/edit wizard
    // was a no-op in Community mode.
    case 'GetAutomations': {
      const result = await executeHomeKitAction('automations.list', { homeId: variables.homeId }) as any;
      return { automations: (result?.automations || []).map(toHomeKitAutomation) };
    }

    case 'CreateAutomation': {
      const result = await executeHomeKitAction('automation.create', {
        homeId: variables.homeId,
        name: variables.name,
        trigger: parseMaybeJson(variables.trigger),
        actions: parseMaybeJson(variables.actions) ?? [],
      }) as any;
      return { createAutomation: toHomeKitAutomation(result) };
    }

    case 'UpdateAutomation': {
      const payload: Record<string, unknown> = { automationId: variables.automationId };
      if (variables.name != null) payload.name = variables.name;
      if (variables.trigger != null) payload.trigger = parseMaybeJson(variables.trigger);
      if (variables.actions != null) payload.actions = parseMaybeJson(variables.actions);
      if (variables.enabled != null) payload.enabled = variables.enabled;
      const result = await executeHomeKitAction('automation.update', payload) as any;
      return { updateAutomation: toHomeKitAutomation(result) };
    }

    case 'DeleteAutomation': {
      const result = await executeHomeKitAction('automation.delete', {
        automationId: variables.automationId,
      }) as any;
      return {
        deleteAutomation: {
          success: result?.success ?? true,
          automationId: variables.automationId,
          error: null,
          __typename: 'AutomationDeleteResult',
        },
      };
    }

    case 'SetAutomationEnabled': {
      const enabled = variables.enabled as boolean;
      const result = await executeHomeKitAction(
        enabled ? 'automation.enable' : 'automation.disable',
        { automationId: variables.automationId },
      ) as any;
      return {
        setAutomationEnabled: {
          id: (result?.id as string) ?? (variables.automationId as string),
          name: result?.name ?? null,
          isEnabled: result?.isEnabled ?? enabled,
          __typename: 'HomeKitAutomation',
        },
      };
    }

    case 'GetHomes': {
      // Without this the query fell through to the default branch below and
      // returned {}, so `isAdmin` was permanently undefined in Community mode
      // and every view-only warning built on it silently never fired.
      try {
        const homesResult = await executeHomeKitAction('homes.list', {}) as any;
        const homes = homesResult?.homes || [];
        return {
          homes: homes.map((h: any) => ({
            id: h.id,
            name: h.name,
            isPrimary: h.isPrimary ?? false,
            roomCount: h.roomCount ?? 0,
            accessoryCount: h.accessoryCount ?? 0,
            // `role` is Homecast's sharing role, not a HomeKit one — the relay
            // never sends it, and in Community mode you are always the owner.
            role: 'owner',
            // Passed through as-is: undefined on relays older than 1.1.2, which
            // callers must be able to tell apart from an explicit false.
            isAdmin: h.isAdmin ?? null,
            __typename: 'HomeKitHome',
          })),
        };
      } catch {
        return { homes: [] };
      }
    }

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
      // Only a hash that was actually stored can ever resolve. This used to
      // fall back to btoa(entityType:entityId) for an entity with no access
      // rows at all — handing back a link that looked perfectly valid and
      // answered "Not Found" forever, because nothing had been shared and no
      // row with that hash existed to find.
      const shareHash = publicAccess?.shareHash || matching[0]?.shareHash || null;
      return {
        sharingInfo: {
          isShared: matching.length > 0,
          hasPublic: !!publicAccess,
          publicRole: publicAccess?.role || null,
          passcodeCount: passcodes.length,
          userCount: users.length,
          shareHash,
          shareUrl: shareHash ? `${await shareOrigin()}/s/${shareHash}` : null,
          roomCount: 0,
          accessoryCount: 0,
          groupCount: 0,
          __typename: 'SharingInfo',
        },
      };
    }

    case 'CreateEntityAccess': {
      // Random, because the hash *is* the credential — it is the only thing
      // standing between a link and control of someone's home.
      //
      // It used to be btoa(`type:id:${Date.now()}`) truncated to 16 chars. Two
      // things went wrong there: sixteen base64 characters encode twelve bytes,
      // so everything past `home:` plus the first seven characters of the id —
      // the timestamp included — was cut off and contributed nothing. The hash
      // was therefore a pure function of the entity id, identical for every
      // share of the same home, and computable by anyone who knew that id.
      const shareHash = randomUUID().replace(/-/g, '').slice(0, 22);
      const access = {
        id: randomUUID(),
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
          shareUrl: `${await shareOrigin()}/s/${shareHash}`,
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
      // Resolved once, outside the map: the callback is not async, and the
      // answer is the same for every row anyway.
      const origin = await shareOrigin();
      return {
        mySharedEntities: allAccess.map(a => ({
          id: a.id,
          entityType: a.entityType,
          entityId: a.entityId,
          entityName: a.entityName || null,
          // Stored by CreateEntityAccess above; the shared-items list groups by
          // it, so it has to survive the round trip in CE too.
          homeId: a.homeId || null,
          accessType: a.accessType,
          role: a.role,
          name: a.name || null,
          userEmail: a.userEmail || null,
          hasPasscode: !!a.hasPasscode,
          shareUrl: a.shareHash ? `${origin}/s/${a.shareHash}` : null,
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
      // Community members are local accounts — there is no invite to accept,
      // so they are active from the moment they are added. Rows written before
      // `status` existed get it filled in here.
      return { homeMembers: filtered.map(toHomeMember) };
    }

    case 'InviteHomeMember': {
      // In Community mode, "invite" creates the member directly (no email)
      const member = {
        id: randomUUID(),
        homeId: variables.homeId as string,
        email: variables.email as string, // username in Community mode
        name: variables.email as string,
        role: variables.role as string,
        status: 'active',
        createdAt: new Date().toISOString(),
      };
      await db.putHomeMember(member);
      return { inviteHomeMember: { success: true, error: null, member: toHomeMember(member), __typename: 'InviteHomeMemberResult' } };
    }

    case 'UpdateHomeMemberRole': {
      const members = await db.getHomeMembers();
      const member = members.find(m => m.homeId === variables.homeId && m.email === variables.email);
      if (!member) return { updateHomeMemberRole: { success: false, error: 'Not found' } };
      member.role = variables.role;
      await db.putHomeMember(member);
      return { updateHomeMemberRole: { success: true, error: null, member: toHomeMember(member), __typename: 'UpdateHomeMemberRoleResult' } };
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
          if (access.homeId) {
            const sgResult = await executeHomeKitAction('serviceGroups.list', { homeId: access.homeId }).catch(() => ({ serviceGroups: [] })) as any;
            const roomAccIds = new Set(
              accessories.map((a: any) => String(a.id || '').toLowerCase().replace(/-/g, ''))
            );
            serviceGroups = (sgResult?.serviceGroups || []).filter((g: any) =>
              (g.accessoryIds || []).some((id: string) =>
                roomAccIds.has(String(id || '').toLowerCase().replace(/-/g, ''))
              )
            );
          }
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

    // --- Characteristic History (opt-in) ---

    case 'GetHistorySeries': {
      const homeId = variables.homeId as string;
      const [{ getProfile }, rows] = await Promise.all([
        import('../history/policy'),
        db.getHistorySeries(homeId),
      ]);
      const out = [];
      for (const row of rows) {
        const profile = getProfile(row.characteristicType);
        const first = await db.getHistorySamples(row.id, 0, Number.MAX_SAFE_INTEGER, 1);
        const last = await db.getLastHistorySampleBefore(row.id, Number.MAX_SAFE_INTEGER);
        out.push({
          accessoryId: row.accessoryId,
          characteristicType: row.characteristicType,
          kind: row.kind,
          unit: row.unit ?? null,
          enabled: row.enabled ?? profile?.record ?? false,
          minIntervalS: row.minIntervalS ?? profile?.minIntervalS ?? null,
          deadband: row.deadband ?? profile?.deadband ?? null,
          firstTs: first[0]?.ts ?? null,
          lastTs: last?.ts ?? null,
          sampleCount: await db.countHistorySamples(row.id),
          __typename: 'HistorySeriesInfo',
        });
      }
      return { historySeries: out };
    }

    case 'GetHistory': {
      const homeId = variables.homeId as string;
      const refs = (variables.series as Array<{ accessoryId: string; characteristicType: string }> | undefined) ?? [];
      const from = Number(variables.fromTs);
      const to = Number(variables.toTs);
      const maxPoints = Math.min(Math.max(Number(variables.maxPoints) || 500, 10), 2000);
      if (!Number.isFinite(from) || !Number.isFinite(to))

        throw new Error('fromTs/toTs must be epoch milliseconds');
      if (refs.length === 0 || refs.length > 6) {
        throw new Error('history queries take 1-6 series');
      }

      const [{ seriesKey }, { queryHistorySeries }, { getProfile }] = await Promise.all([
        import('../history/keys'),
        import('../history/query'),
        import('../history/policy'),
      ]);
      const store = idbHistoryStore();

      const results = [];
      for (const ref of refs) {
        const sid = seriesKey(homeId, ref.accessoryId, ref.characteristicType);
        const row = await db.getHistorySeriesById(sid);
        const profile = getProfile(ref.characteristicType);
        const kind = row?.kind ?? profile?.kind;
        if (!kind) continue; // unrecordable characteristic — nothing to serve
        const data = await queryHistorySeries(store, sid, kind, from, to, maxPoints);
        results.push({
          accessoryId: ref.accessoryId,
          characteristicType: row?.characteristicType ?? ref.characteristicType,
          kind,
          unit: row?.unit ?? profile?.unit ?? null,
          resolution: data.resolution,
          prevValue: data.prevValue,
          prevValueText: data.prevValueText ?? null,
          points: data.points.map(p => ({ ...p, __typename: 'HistoryPoint' })),
          states: data.states.map(s => ({ ...s, valueText: s.valueText ?? null, __typename: 'HistoryStateSpan' })),
          stateBuckets: data.stateBuckets.map(b => ({
            ts: b.ts,
            dominant: b.dominant,
            dominantText: b.dominantText ?? null,
            stateMsJson: JSON.stringify(b.stateMs),
            transitions: b.transitions,
            __typename: 'HistoryStateBucket',
          })),
          __typename: 'HistorySeriesData',
        });
      }
      return { history: results };
    }

    case 'GetHistoryStorageStats': {
      const homeId = variables.homeId as string;
      const [{ getHistoryHomeConfigs }, stats] = await Promise.all([
        import('./local-history'),
        db.getHistoryStorageStats(variables.homeId as string),
      ]);
      const config = (await getHistoryHomeConfigs())[homeId.toUpperCase()];
      // Empirical CE row cost: a sample object with its two index entries
      // lands around 120 bytes in WebKit's IndexedDB; rollups ~3×.
      const estBytes = stats.sampleRows * 120 + stats.rollupRows * 360;
      return {
        historyStorageStats: {
          enabled: config?.enabled ?? false,
          rawRetentionDays: config?.rawRetentionDays ?? 30,
          seriesCount: stats.seriesCount,
          sampleRows: stats.sampleRows,
          rollupRows: stats.rollupRows,
          estBytes,
          oldestTs: stats.oldestSampleTs,
          __typename: 'HistoryStorageStats',
        },
      };
    }

    case 'SetHomeHistoryEnabled': {
      const history = await import('./local-history');
      const homeId = variables.homeId as string;
      const existing = (await history.getHistoryHomeConfigs())[homeId.toUpperCase()];
      await history.setHistoryHomeConfig(homeId, {
        enabled: variables.enabled as boolean,
        rawRetentionDays: existing?.rawRetentionDays ?? history.DEFAULT_RAW_RETENTION_DAYS,
      });
      return { setHomeHistoryEnabled: true };
    }

    case 'SetHistorySeriesConfig': {
      const history = await import('./local-history');
      const row = await history.setHistorySeriesOverride(
        variables.homeId as string,
        variables.accessoryId as string,
        variables.characteristicType as string,
        {
          enabled: variables.enabled as boolean | undefined,
          minIntervalS: variables.minIntervalS as number | undefined,
          deadband: variables.deadband as number | undefined,
        },
      );
      if (!row) throw new Error('Characteristic is not recordable');
      return { setHistorySeriesConfig: true };
    }

    case 'ExportHistory': {
      // Raw samples as CSV — the take-your-data-with-you half of the privacy
      // story. Bounded: the raw window is retention-limited, and the row cap
      // below turns a pathological export into a truncated file, not a hang.
      const homeId = variables.homeId as string;
      const accessoryId = variables.accessoryId as string | undefined;
      const characteristicType = variables.characteristicType as string | undefined;
      const { canonicalHistoryType } = await import('../history/keys');

      let series = await db.getHistorySeries(homeId);
      if (accessoryId) series = series.filter(s => s.accessoryId === accessoryId.toUpperCase());
      if (characteristicType) {
        const canonical = canonicalHistoryType(characteristicType);
        series = series.filter(s => s.characteristicType === canonical);
      }

      const MAX_EXPORT_ROWS = 200_000;
      // value_text: the string kind's payload (value holds its 0 sentinel).
      const lines = ['timestamp,accessory_id,characteristic,value,value_text,source'];
      let truncated = false;
      const csvText = (vt: string | undefined) =>
        vt === undefined ? '' : `"${vt.replace(/"/g, '""')}"`;
      for (const row of series) {
        if (lines.length > MAX_EXPORT_ROWS) { truncated = true; break; }
        const samples = await db.getHistorySamples(
          row.id, 0, Number.MAX_SAFE_INTEGER, MAX_EXPORT_ROWS - lines.length + 1,
        );
        for (const s of samples) {
          if (lines.length > MAX_EXPORT_ROWS) { truncated = true; break; }
          lines.push(`${new Date(s.ts).toISOString()},${row.accessoryId},${row.characteristicType},${s.v},${csvText(s.vt)},${s.src}`);
        }
      }
      if (truncated) lines.push(`# truncated at ${MAX_EXPORT_ROWS} rows`);
      return { exportHistory: lines.join('\n') };
    }

    case 'PurgeHistory': {
      const homeId = variables.homeId as string;
      const accessoryId = variables.accessoryId as string | undefined;
      const characteristicType = variables.characteristicType as string | undefined;
      const before = variables.beforeTs as number | undefined;

      if (accessoryId && characteristicType) {
        const { seriesKey } = await import('../history/keys');
        const sid = seriesKey(homeId, accessoryId, characteristicType);
        if (before) {
          await db.pruneHistorySamples(before, sid);
          await db.pruneHistoryRollups(sid, before);
        } else {
          await db.deleteHistorySeries(sid);
        }
      } else if (before) {
        const series = await db.getHistorySeries(homeId);
        for (const row of series) {
          await db.pruneHistorySamples(before, row.id);
          await db.pruneHistoryRollups(row.id, before);
        }
      } else {
        await db.deleteHistoryForHome(homeId);
      }
      return { purgeHistory: true };
    }

    default:
      // Return empty data for unknown operations (prevents Apollo errors)
      console.warn(`[LocalGraphQL] Unknown operation: ${operationName}`);
      return {};
  }
}
