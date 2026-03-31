/**
 * Community mode: handles GraphQL operations locally.
 *
 * Routes operations by name to the appropriate handler, backed by IndexedDB
 * for persistence. Returns the same response shape as the cloud GraphQL API.
 */

import * as db from './local-db';
import * as auth from './local-auth';
import { executeHomeKitAction } from '../relay/local-handler';

interface GraphQLRequest {
  operationName?: string;
  query?: string;
  variables?: Record<string, unknown>;
}

/**
 * Handle a GraphQL request and return the response body.
 */
export async function handleGraphQL(request: GraphQLRequest): Promise<unknown> {
  const { operationName, variables = {} } = request;

  try {
    const data = await resolveOperation(operationName, variables);
    return { data };
  } catch (error: any) {
    return {
      data: null,
      errors: [{ message: error.message || 'Unknown error' }],
    };
  }
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
      const result = await auth.login(variables.email as string, variables.password as string);
      if (!result) return { login: { success: false, error: 'Invalid name or password', token: null, __typename: 'LoginResult' } };
      return { login: { success: true, token: result.token, error: null, __typename: 'LoginResult' } };
    }

    case 'Signup': {
      // In Community mode, "signup" creates the owner on first use
      const onboarded = await auth.isOnboarded();
      if (onboarded) return { signup: { success: false, error: 'Registration is disabled. Ask an admin to create your account.', token: null, __typename: 'SignupResult' } };
      const result = await auth.createOwner(variables.email as string, variables.password as string);
      return { signup: { success: true, token: result.token, error: null, message: 'Account created', __typename: 'SignupResult' } };
    }

    case 'IsOnboarded':
      return {
        isOnboarded: await auth.isOnboarded(),
        relayReady: !!localStorage.getItem('homecast-token'),
      };

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

    case 'DeleteCommunityUser':
      return { deleteCommunityUser: { success: await auth.deleteUser(variables.userId as string) } };

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
    case 'GetCachedHomes':
      return { cachedHomes: [] };
    case 'GetPendingInvitations':
      return { pendingInvitations: [] };
    case 'GetMySharedHomes':
      return { mySharedHomes: [] };
    case 'GetMyEnrollments':
      return { myEnrollments: [] };
    case 'GetActiveDeals':
      return { activeDeals: [] };
    case 'GetWebhooks':
      return { webhooks: [] };
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
    case 'GetAuthorizedApps':
      return { authorizedApps: [] };
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
      const access = allAccess.find(a => a.shareHash === variables.shareHash);
      if (!access) return { publicEntity: null };
      // Check passcode if required
      if (access.hasPasscode && access.passcode) {
        const hasPasscodeAccess = allAccess.some(a =>
          a.shareHash === variables.shareHash && a.accessType === 'passcode' && a.passcode === variables.passcode
        );
        if (!hasPasscodeAccess && access.accessType === 'passcode' && access.passcode !== variables.passcode) {
          return { publicEntity: { requiresPasscode: true, entityType: access.entityType, entityId: access.entityId, entityName: access.entityName, role: null, data: null, canUpgradeWithPasscode: false, __typename: 'PublicEntity' } };
        }
      }
      return {
        publicEntity: {
          entityType: access.entityType,
          entityId: access.entityId,
          entityName: access.entityName || access.name,
          role: access.role,
          requiresPasscode: false,
          canUpgradeWithPasscode: allAccess.some(a => a.shareHash === variables.shareHash && a.accessType === 'passcode'),
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
        } else if (access.entityType === 'accessory_group' || access.entityType === 'collection') {
          // For groups/collections, try to get accessories from the stored entity data
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
      // Validate the share hash and role
      const allAccess = await db.getEntityAccess();
      const access = allAccess.find(a => a.shareHash === variables.shareHash);
      if (!access || access.role === 'view') {
        return { publicEntitySetCharacteristic: { success: false, error: 'Access denied' } };
      }
      // Actually execute the HomeKit command
      try {
        await executeHomeKitAction('characteristic.set', {
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
      return { webhookEventTypes: [] };

    default:
      // Return empty data for unknown operations (prevents Apollo errors)
      console.warn(`[LocalGraphQL] Unknown operation: ${operationName}`);
      return {};
  }
}
