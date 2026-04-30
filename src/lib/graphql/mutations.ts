import { gql } from '@apollo/client/core';

export const LOGIN = gql`
  mutation Login($email: String!, $password: String!) {
    login(email: $email, password: $password) {
      success
      token
      error
      userId
      email
    }
  }
`;

export const SIGNUP = gql`
  mutation Signup($email: String!, $password: String!, $name: String) {
    signup(email: $email, password: $password, name: $name) {
      success
      token
      error
      userId
      email
      message
    }
  }
`;

export const VERIFY_EMAIL = gql`
  mutation VerifyEmail($token: String!) {
    verifyEmail(token: $token) {
      success
      token
      error
      message
      email
      userId
    }
  }
`;

export const RESEND_VERIFICATION_EMAIL = gql`
  mutation ResendVerificationEmail($email: String!) {
    resendVerificationEmail(email: $email) {
      success
      error
      message
    }
  }
`;

export const REQUEST_PASSWORD_RESET = gql`
  mutation RequestPasswordReset($email: String!) {
    requestPasswordReset(email: $email) {
      success
      error
      message
    }
  }
`;

export const RESET_PASSWORD = gql`
  mutation ResetPassword($token: String!, $newPassword: String!) {
    resetPassword(token: $token, newPassword: $newPassword) {
      success
      error
      message
    }
  }
`;

export const REMOVE_SESSION = gql`
  mutation RemoveSession($deviceId: String!) {
    removeSession(deviceId: $deviceId)
  }
`;

// --- Smart Deal Mutations ---

export const TRACK_DEAL_CLICK = gql`
  mutation TrackDealClick($dealId: String!) {
    trackDealClick(dealId: $dealId)
  }
`;

// --- Billing Mutations ---

export const CREATE_CHECKOUT_SESSION = gql`
  mutation CreateCheckoutSession($region: String, $plan: String, $homeName: String) {
    createCheckoutSession(region: $region, plan: $plan, homeName: $homeName) {
      url
      error
      upgraded
    }
  }
`;

export const DOWNGRADE_TO_STANDARD = gql`
  mutation DowngradeToStandard {
    downgradeToStandard {
      url
      error
      upgraded
    }
  }
`;

export const CREATE_PORTAL_SESSION = gql`
  mutation CreatePortalSession {
    createPortalSession {
      url
      error
    }
  }
`;

export const VALIDATE_APPLE_PURCHASE = gql`
  mutation ValidateApplePurchase($jwsTransaction: String!, $productId: String!, $homeName: String) {
    validateApplePurchase(jwsTransaction: $jwsTransaction, productId: $productId, homeName: $homeName) {
      accountType
      productId
      error
    }
  }
`;

export const RESTORE_APPLE_PURCHASES = gql`
  mutation RestoreApplePurchases($jwsTransactions: [String!]!) {
    restoreApplePurchases(jwsTransactions: $jwsTransactions) {
      accountType
      productId
      restored
      error
    }
  }
`;

export const REGISTER_CLOUD_INTEREST = gql`
  mutation RegisterCloudInterest {
    registerCloudInterest
  }
`;

export const CREATE_CLOUD_MANAGED_CHECKOUT = gql`
  mutation CreateCloudManagedCheckout($homeName: String!, $region: String) {
    createCloudManagedCheckout(homeName: $homeName, region: $region) {
      success
      checkoutUrl
      enrollmentId
      error
    }
  }
`;

export const CANCEL_CLOUD_MANAGED_ENROLLMENT = gql`
  mutation CancelCloudManagedEnrollment($enrollmentId: String!) {
    cancelCloudManagedEnrollment(enrollmentId: $enrollmentId)
  }
`;

export const DISMISS_HOME = gql`
  mutation DismissHome($homeId: String!) {
    dismissHome(homeId: $homeId)
  }
`;

export const CONFIRM_INVITE_SENT = gql`
  mutation ConfirmInviteSent($enrollmentId: String!) {
    confirmInviteSent(enrollmentId: $enrollmentId)
  }
`;

export const RESET_INVITE_STATUS = gql`
  mutation ResetInviteStatus($enrollmentId: String!) {
    resetInviteStatus(enrollmentId: $enrollmentId)
  }
`;

export const RESOLVE_CLOUD_MANAGED_HOME_ID = gql`
  mutation ResolveCloudManagedHomeId($enrollmentId: String!, $homeId: String!) {
    resolveCloudManagedHomeId(enrollmentId: $enrollmentId, homeId: $homeId) {
      success
      error
    }
  }
`;

export const RESCAN_RELAY_HOMES = gql`
  mutation RescanRelayHomes {
    rescanRelayHomes
  }
`;

// HomeKit mutations (require connected Mac app)

export const SET_CHARACTERISTIC = gql`
  mutation SetCharacteristic($accessoryId: String!, $characteristicType: String!, $value: String!, $homeId: String) {
    setCharacteristic(accessoryId: $accessoryId, characteristicType: $characteristicType, value: $value, homeId: $homeId) {
      success
      accessoryId
      characteristicType
      value
    }
  }
`;

export const EXECUTE_SCENE = gql`
  mutation ExecuteScene($sceneId: String!, $homeId: String) {
    executeScene(sceneId: $sceneId, homeId: $homeId) {
      success
      sceneId
    }
  }
`;

// Automation mutations
export const CREATE_AUTOMATION = gql`
  mutation CreateAutomation($homeId: String!, $name: String!, $trigger: String!, $actions: String!) {
    createAutomation(homeId: $homeId, name: $name, trigger: $trigger, actions: $actions) {
      id
      name
      isEnabled
      trigger {
        type
        fireDate
        recurrence
        timeZone
        events {
          type
          accessoryId
          accessoryName
          characteristicType
          triggerValue
          significantEvent
          offsetMinutes
        }
        executeOnce
      }
      actions {
        accessoryId
        accessoryName
        characteristicType
        targetValue
      }
      lastFireDate
      homeId
    }
  }
`;

export const UPDATE_AUTOMATION = gql`
  mutation UpdateAutomation($automationId: String!, $homeId: String, $name: String, $trigger: String, $actions: String, $enabled: Boolean) {
    updateAutomation(automationId: $automationId, homeId: $homeId, name: $name, trigger: $trigger, actions: $actions, enabled: $enabled) {
      id
      name
      isEnabled
      trigger {
        type
        fireDate
        recurrence
        timeZone
        events {
          type
          accessoryId
          accessoryName
          characteristicType
          triggerValue
          significantEvent
          offsetMinutes
        }
        executeOnce
      }
      actions {
        accessoryId
        accessoryName
        characteristicType
        targetValue
      }
      lastFireDate
      homeId
    }
  }
`;

export const DELETE_AUTOMATION = gql`
  mutation DeleteAutomation($automationId: String!, $homeId: String) {
    deleteAutomation(automationId: $automationId, homeId: $homeId) {
      success
      automationId
      error
    }
  }
`;

export const SET_AUTOMATION_ENABLED = gql`
  mutation SetAutomationEnabled($automationId: String!, $enabled: Boolean!, $homeId: String) {
    setAutomationEnabled(automationId: $automationId, enabled: $enabled, homeId: $homeId) {
      id
      name
      isEnabled
    }
  }
`;

// Collection mutations
export const CREATE_COLLECTION = gql`
  mutation CreateCollection($name: String!) {
    createCollection(name: $name) {
      id
      name
      payload
      createdAt
    }
  }
`;

export const UPDATE_COLLECTION = gql`
  mutation UpdateCollection($collectionId: String!, $name: String, $payload: String) {
    updateCollection(collectionId: $collectionId, name: $name, payload: $payload) {
      id
      name
      payload
      createdAt
    }
  }
`;

export const DELETE_COLLECTION = gql`
  mutation DeleteCollection($collectionId: String!) {
    deleteCollection(collectionId: $collectionId)
  }
`;


// --- Entity Access Mutations (Unified Sharing) ---

export const CREATE_ENTITY_ACCESS = gql`
  mutation CreateEntityAccess(
    $entityType: String!
    $entityId: String!
    $accessType: String!
    $role: String!
    $homeId: String
    $userEmail: String
    $passcode: String
    $name: String
    $entityName: String
    $accessSchedule: String
  ) {
    createEntityAccess(
      entityType: $entityType
      entityId: $entityId
      accessType: $accessType
      role: $role
      homeId: $homeId
      userEmail: $userEmail
      passcode: $passcode
      name: $name
      entityName: $entityName
      accessSchedule: $accessSchedule
    ) {
      success
      error
      access {
        id
        entityType
        entityId
        accessType
        role
        name
        userId
        userEmail
        hasPasscode
        accessSchedule
        createdAt
      }
    }
  }
`;

export const UPDATE_ENTITY_ACCESS = gql`
  mutation UpdateEntityAccess(
    $accessId: String!
    $role: String
    $passcode: String
    $name: String
    $accessSchedule: String
  ) {
    updateEntityAccess(
      accessId: $accessId
      role: $role
      passcode: $passcode
      name: $name
      accessSchedule: $accessSchedule
    ) {
      success
      error
      access {
        id
        entityType
        entityId
        accessType
        role
        name
        userId
        userEmail
        hasPasscode
        accessSchedule
        createdAt
      }
    }
  }
`;

export const DELETE_ENTITY_ACCESS = gql`
  mutation DeleteEntityAccess($accessId: String!) {
    deleteEntityAccess(accessId: $accessId) {
      success
      error
    }
  }
`;

// Public entity control (no auth required, validates via share hash)
export const PUBLIC_ENTITY_SET_CHARACTERISTIC = gql`
  mutation PublicEntitySetCharacteristic(
    $shareHash: String!
    $accessoryId: String!
    $characteristicType: String!
    $value: String!
    $passcode: String
  ) {
    publicEntitySetCharacteristic(
      shareHash: $shareHash
      accessoryId: $accessoryId
      characteristicType: $characteristicType
      value: $value
      passcode: $passcode
    ) {
      success
      accessoryId
      characteristicType
      value
    }
  }
`;

// Atomic group control — one relay call toggles every member simultaneously.
// Only valid for accessory_group shares where groupId matches the share entity.
export const PUBLIC_ENTITY_SET_SERVICE_GROUP = gql`
  mutation PublicEntitySetServiceGroup(
    $shareHash: String!
    $groupId: String!
    $characteristicType: String!
    $value: String!
    $passcode: String
  ) {
    publicEntitySetServiceGroup(
      shareHash: $shareHash
      groupId: $groupId
      characteristicType: $characteristicType
      value: $value
      passcode: $passcode
    ) {
      success
      accessoryId
      characteristicType
      value
    }
  }
`;

// --- Stored Entity Mutations ---

export const SYNC_ENTITIES = gql`
  mutation SyncEntities($entities: [JSON!]!) {
    syncEntities(entities: $entities) {
      success
      syncedCount
    }
  }
`;

export const UPDATE_STORED_ENTITY_LAYOUT = gql`
  mutation UpdateStoredEntityLayout($entityType: String!, $entityId: String!, $layoutJson: String!) {
    updateStoredEntityLayout(entityType: $entityType, entityId: $entityId, layoutJson: $layoutJson) {
      success
      entity {
        id
        entityType
        entityId
        layoutJson
        updatedAt
      }
    }
  }
`;

// --- Room Group Mutations ---

export const CREATE_ROOM_GROUP = gql`
  mutation CreateRoomGroup($name: String!, $homeId: String!, $roomIds: [String!]!) {
    createRoomGroup(name: $name, homeId: $homeId, roomIds: $roomIds) {
      id
      entityType
      entityId
      parentId
      dataJson
      layoutJson
      updatedAt
    }
  }
`;

export const UPDATE_ROOM_GROUP = gql`
  mutation UpdateRoomGroup($groupId: String!, $name: String, $roomIds: [String!]) {
    updateRoomGroup(groupId: $groupId, name: $name, roomIds: $roomIds) {
      id
      entityType
      entityId
      parentId
      dataJson
      layoutJson
      updatedAt
    }
  }
`;

export const DELETE_ROOM_GROUP = gql`
  mutation DeleteRoomGroup($groupId: String!) {
    deleteRoomGroup(groupId: $groupId)
  }
`;

// --- Access Token Mutations ---

export const CREATE_ACCESS_TOKEN = gql`
  mutation CreateAccessToken($name: String!, $homePermissions: String!, $expiresAt: String) {
    createAccessToken(name: $name, homePermissions: $homePermissions, expiresAt: $expiresAt) {
      success
      error
      rawToken
      token {
        id
        name
        tokenPrefix
        homePermissions
        createdAt
        lastUsedAt
        expiresAt
      }
    }
  }
`;

export const REVOKE_ACCESS_TOKEN = gql`
  mutation RevokeAccessToken($tokenId: String!) {
    revokeAccessToken(tokenId: $tokenId) {
      success
      error
    }
  }
`;

// --- Webhook Mutations ---

export const CREATE_WEBHOOK = gql`
  mutation CreateWebhook(
    $name: String!
    $url: String!
    $eventTypes: [String!]
    $homeIds: [String!]
    $roomIds: [String!]
    $accessoryIds: [String!]
    $collectionIds: [String!]
    $maxRetries: Int
    $rateLimitPerMinute: Int
    $timeoutMs: Int
  ) {
    createWebhook(
      name: $name
      url: $url
      eventTypes: $eventTypes
      homeIds: $homeIds
      roomIds: $roomIds
      accessoryIds: $accessoryIds
      collectionIds: $collectionIds
      maxRetries: $maxRetries
      rateLimitPerMinute: $rateLimitPerMinute
      timeoutMs: $timeoutMs
    ) {
      success
      error
      rawSecret
      webhook {
        id
        name
        url
        secretPrefix
        status
        eventTypes
        homeIds
        roomIds
        accessoryIds
        collectionIds
        maxRetries
        rateLimitPerMinute
        timeoutMs
        consecutiveFailures
        lastTriggeredAt
        lastSuccessAt
        lastFailureAt
        createdAt
      }
    }
  }
`;

export const UPDATE_WEBHOOK = gql`
  mutation UpdateWebhook(
    $webhookId: String!
    $name: String
    $url: String
    $eventTypes: [String!]
    $homeIds: [String!]
    $roomIds: [String!]
    $accessoryIds: [String!]
    $collectionIds: [String!]
    $maxRetries: Int
    $rateLimitPerMinute: Int
    $timeoutMs: Int
  ) {
    updateWebhook(
      webhookId: $webhookId
      name: $name
      url: $url
      eventTypes: $eventTypes
      homeIds: $homeIds
      roomIds: $roomIds
      accessoryIds: $accessoryIds
      collectionIds: $collectionIds
      maxRetries: $maxRetries
      rateLimitPerMinute: $rateLimitPerMinute
      timeoutMs: $timeoutMs
    ) {
      success
      error
      webhook {
        id
        name
        url
        secretPrefix
        status
        eventTypes
        homeIds
        roomIds
        accessoryIds
        collectionIds
        maxRetries
        rateLimitPerMinute
        timeoutMs
        consecutiveFailures
        lastTriggeredAt
        lastSuccessAt
        lastFailureAt
        createdAt
      }
    }
  }
`;

export const DELETE_WEBHOOK = gql`
  mutation DeleteWebhook($webhookId: String!) {
    deleteWebhook(webhookId: $webhookId) {
      success
      error
    }
  }
`;

export const PAUSE_WEBHOOK = gql`
  mutation PauseWebhook($webhookId: String!) {
    pauseWebhook(webhookId: $webhookId) {
      success
      error
      webhook {
        id
        status
      }
    }
  }
`;

export const RESUME_WEBHOOK = gql`
  mutation ResumeWebhook($webhookId: String!) {
    resumeWebhook(webhookId: $webhookId) {
      success
      error
      webhook {
        id
        status
        consecutiveFailures
      }
    }
  }
`;

export const ROTATE_WEBHOOK_SECRET = gql`
  mutation RotateWebhookSecret($webhookId: String!) {
    rotateWebhookSecret(webhookId: $webhookId) {
      success
      error
      rawSecret
      webhook {
        id
        secretPrefix
      }
    }
  }
`;

export const TEST_WEBHOOK = gql`
  mutation TestWebhook($webhookId: String!) {
    testWebhook(webhookId: $webhookId) {
      success
      statusCode
      responseTimeMs
      error
    }
  }
`;

// --- Home Member Mutations ---

export const INVITE_HOME_MEMBER = gql`
  mutation InviteHomeMember($homeId: String!, $email: String!, $role: String!) {
    inviteHomeMember(homeId: $homeId, email: $email, role: $role) {
      success
      error
      member {
        id
        homeId
        email
        name
        role
        isPending
        createdAt
      }
    }
  }
`;

export const UPDATE_HOME_MEMBER_ROLE = gql`
  mutation UpdateHomeMemberRole($homeId: String!, $email: String!, $role: String!) {
    updateHomeMemberRole(homeId: $homeId, email: $email, role: $role) {
      success
      error
      member {
        id
        homeId
        email
        name
        role
        isPending
        createdAt
      }
    }
  }
`;

export const REMOVE_HOME_MEMBER = gql`
  mutation RemoveHomeMember($homeId: String!, $email: String!) {
    removeHomeMember(homeId: $homeId, email: $email) {
      success
      error
    }
  }
`;

export const ACCEPT_HOME_INVITATION = gql`
  mutation AcceptHomeInvitation($homeId: String!) {
    acceptHomeInvitation(homeId: $homeId) {
      success
      error
    }
  }
`;

export const REJECT_HOME_INVITATION = gql`
  mutation RejectHomeInvitation($homeId: String!) {
    rejectHomeInvitation(homeId: $homeId) {
      success
      error
    }
  }
`;

// --- Authorized Apps Mutations ---

export const REVOKE_AUTHORIZED_APP = gql`
  mutation RevokeAuthorizedApp($clientId: String!) {
    revokeAuthorizedApp(clientId: $clientId) {
      success
      error
    }
  }
`;

export const UPDATE_AUTHORIZED_APP = gql`
  mutation UpdateAuthorizedApp($clientId: String!, $homePermissions: String!) {
    updateAuthorizedApp(clientId: $clientId, homePermissions: $homePermissions) {
      success
      error
      app {
        clientId
        clientName
        clientUri
        logoUri
        redirectDomain
        scope
        homePermissions
        createdAt
      }
    }
  }
`;

// ============================================================
// Homecast Automation Engine
// ============================================================

export const SAVE_HC_AUTOMATION = gql`
  mutation SaveHcAutomation($homeId: String!, $automationId: String, $data: String!) {
    saveHcAutomation(homeId: $homeId, automationId: $automationId, data: $data) {
      id
      entityType
      entityId
      parentId
      dataJson
      updatedAt
    }
  }
`;

export const DELETE_HC_AUTOMATION = gql`
  mutation DeleteHcAutomation($automationId: String!) {
    deleteHcAutomation(automationId: $automationId)
  }
`;

export const RESTORE_AUTOMATION_VERSION = gql`
  mutation RestoreAutomationVersion($homeId: String!, $versionId: String!) {
    restoreAutomationVersion(homeId: $homeId, versionId: $versionId) {
      success
    }
  }
`;

export const SAVE_CREDENTIAL = gql`
  mutation SaveCredential($id: String, $name: String!, $type: String!, $encryptedValue: String!, $iv: String!) {
    saveCredential(id: $id, name: $name, type: $type, encryptedValue: $encryptedValue, iv: $iv) {
      id
      name
      type
    }
  }
`;

export const DELETE_CREDENTIAL = gql`
  mutation DeleteCredential($id: String!) {
    deleteCredential(id: $id)
  }
`;

// ---- Push Notifications ----

export const REGISTER_PUSH_TOKEN = gql`
  mutation RegisterPushToken($token: String!, $platform: String!, $deviceFingerprint: String!, $deviceName: String) {
    registerPushToken(token: $token, platform: $platform, deviceFingerprint: $deviceFingerprint, deviceName: $deviceName) {
      success
      error
    }
  }
`;

export const UNREGISTER_PUSH_TOKEN = gql`
  mutation UnregisterPushToken($deviceFingerprint: String!) {
    unregisterPushToken(deviceFingerprint: $deviceFingerprint)
  }
`;

export const SET_NOTIFICATION_PREFERENCE = gql`
  mutation SetNotificationPreference($scope: String!, $pushEnabled: Boolean!, $emailEnabled: Boolean!, $localEnabled: Boolean!, $scopeId: String) {
    setNotificationPreference(scope: $scope, pushEnabled: $pushEnabled, emailEnabled: $emailEnabled, localEnabled: $localEnabled, scopeId: $scopeId) {
      success
      error
    }
  }
`;

export const DELETE_NOTIFICATION_PREFERENCE = gql`
  mutation DeleteNotificationPreference($scope: String!, $scopeId: String) {
    deleteNotificationPreference(scope: $scope, scopeId: $scopeId)
  }
`;

export const SEND_TEST_NOTIFICATION = gql`
  mutation SendTestNotification {
    sendTestNotification
  }
`;

export const CLEAR_NOTIFICATION_HISTORY = gql`
  mutation ClearNotificationHistory {
    clearNotificationHistory
  }
`;

export const SET_HOME_MQTT_ENABLED = gql`
  mutation SetHomeMqttEnabled($homeId: String!, $enabled: Boolean!) {
    setHomeMqttEnabled(homeId: $homeId, enabled: $enabled)
  }
`;

export const ADD_HOME_MQTT_BROKER = gql`
  mutation AddHomeMqttBroker($homeId: String!, $name: String!, $host: String!, $port: Int, $username: String, $password: String, $useTls: Boolean, $topicPrefix: String, $haDiscovery: Boolean) {
    addHomeMqttBroker(homeId: $homeId, name: $name, host: $host, port: $port, username: $username, password: $password, useTls: $useTls, topicPrefix: $topicPrefix, haDiscovery: $haDiscovery)
  }
`;

export const REMOVE_HOME_MQTT_BROKER = gql`
  mutation RemoveHomeMqttBroker($homeId: String!, $brokerId: String!) {
    removeHomeMqttBroker(homeId: $homeId, brokerId: $brokerId)
  }
`;
