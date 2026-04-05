import { gql } from '@apollo/client/core';

export const HEALTH_CHECK = gql`
  query Health {
    health
  }
`;

export const GET_VERSION = gql`
  query GetVersion {
    version
    deployedAt
  }
`;

export const GET_IS_WAITLIST_MODE = gql`
  query GetIsWaitlistMode {
    isWaitlistMode
  }
`;

export const GET_BACKGROUND_PRESETS = gql`
  query GetBackgroundPresets {
    backgroundPresets {
      id
      name
      url
      category
    }
  }
`;

export const GET_USER_BACKGROUNDS = gql`
  query GetUserBackgrounds {
    userBackgrounds {
      url
      thumbnailUrl
      filename
    }
  }
`;

export const GET_ME = gql`
  query GetMe {
    me {
      id
      email
      name
      createdAt
      lastLoginAt
      isAdmin
      accountType
      stagingAccess
    }
  }
`;

export const GET_ACCOUNT = gql`
  query GetAccount {
    account {
      accountType
      accessoryLimit
      adsenseAdsEnabled
      smartDealsEnabled
      hasSubscription
      cloudSignupsAvailable
    }
  }
`;

export const GET_ACTIVE_DEALS = gql`
  query GetActiveDeals($marketplace: String, $accessories: [AccessoryInput]) {
    activeDeals(marketplace: $marketplace, accessories: $accessories) {
      id
      deviceId
      deviceName
      deviceManufacturer
      productName
      dealPrice
      regularPrice
      discountPercentage
      dealTitle
      dealTier
      currency
      dealUrl
      imageUrl
      expiresAt
      quantity
      listingType
      unitPrice
      allTimeLow
      isNearAtl
    }
  }
`;

export const GET_DEAL_PRICE_HISTORY = gql`
  query GetDealPriceHistory($dealId: String!) {
    dealPriceHistory(dealId: $dealId) {
      date
      price
    }
  }
`;

export const GET_SESSIONS = gql`
  query GetSessions {
    sessions {
      id
      deviceId
      name
      sessionType
      lastSeenAt
      homeIds
      subscriptions {
        id
        scopeType
        scopeId
      }
    }
  }
`;

export const GET_SESSION = gql`
  query GetSession($deviceId: String!) {
    session(deviceId: $deviceId) {
      id
      deviceId
      name
      sessionType
      lastSeenAt
    }
  }
`;

export const GET_CONNECTION_DEBUG_INFO = gql`
  query GetConnectionDebugInfo {
    connectionDebugInfo {
      serverInstanceId
      pubsubEnabled
      pubsubSlot
      deviceConnected
      deviceId
      deviceInstanceId
      routingMode
    }
  }
`;

// HomeKit queries (require connected Mac app)

export const GET_HOMES = gql`
  query GetHomes {
    homes {
      id
      name
      isPrimary
      roomCount
      accessoryCount
      role
    }
  }
`;

export const GET_CACHED_HOMES = gql`
  query GetCachedHomes {
    cachedHomes {
      id
      name
      updatedAt
      role
      ownerEmail
    }
  }
`;

export const GET_ROOMS = gql`
  query GetRooms($homeId: String!) {
    rooms(homeId: $homeId) {
      id
      name
      accessoryCount
    }
  }
`;

export const GET_ACCESSORIES = gql`
  query GetAccessories($homeId: String, $roomId: String) {
    accessories(homeId: $homeId, roomId: $roomId) {
      id
      name
      homeId
      category
      isReachable
      roomId
      roomName
      services {
        id
        name
        serviceType
        characteristics {
          id
          characteristicType
          value
          isReadable
          isWritable
          validValues
          minValue
          maxValue
          stepValue
        }
      }
    }
  }
`;

export const GET_ACCESSORY = gql`
  query GetAccessory($accessoryId: String!) {
    accessory(accessoryId: $accessoryId) {
      id
      name
      category
      isReachable
      roomId
      roomName
      services {
        id
        name
        serviceType
        characteristics {
          id
          characteristicType
          value
          isReadable
          isWritable
          validValues
          minValue
          maxValue
          stepValue
        }
      }
    }
  }
`;

export const GET_SCENES = gql`
  query GetScenes($homeId: String!) {
    scenes(homeId: $homeId) {
      id
      name
      actionCount
    }
  }
`;

export const GET_AUTOMATIONS = gql`
  query GetAutomations($homeId: String!) {
    automations(homeId: $homeId) {
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
          latitude
          longitude
          radius
          notifyOnEntry
          notifyOnExit
          presenceType
          presenceEvent
          calendarComponents
          durationSeconds
        }
        endEvents {
          type
          accessoryId
          accessoryName
          characteristicType
          triggerValue
          significantEvent
          offsetMinutes
        }
        conditions {
          type
          accessoryId
          accessoryName
          characteristicType
          operator
          value
          beforeTime
          afterTime
          beforeEvent
          afterEvent
          predicateFormat
        }
        recurrences
        executeOnce
        activationState
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

export const GET_SERVICE_GROUPS = gql`
  query GetServiceGroups($homeId: String!) {
    serviceGroups(homeId: $homeId) {
      id
      name
      serviceIds
      accessoryIds
    }
  }
`;

export const SET_SERVICE_GROUP = gql`
  mutation SetServiceGroup($homeId: String!, $groupId: String!, $characteristicType: String!, $value: String!) {
    setServiceGroup(homeId: $homeId, groupId: $groupId, characteristicType: $characteristicType, value: $value) {
      success
      groupId
      affectedCount
    }
  }
`;

// User Settings
export const GET_SETTINGS = gql`
  query GetSettings {
    settings {
      data
    }
  }
`;

export const UPDATE_SETTINGS = gql`
  mutation UpdateSettings($data: String!) {
    updateSettings(data: $data) {
      success
      settings {
        data
      }
    }
  }
`;

// Collections
export const GET_COLLECTIONS = gql`
  query GetCollections {
    collections {
      id
      name
      payload
      createdAt
    }
  }
`;


// --- Entity Access Queries (Unified Sharing) ---

export const GET_ENTITY_ACCESS = gql`
  query GetEntityAccess($entityType: String!, $entityId: String!) {
    entityAccess(entityType: $entityType, entityId: $entityId) {
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
`;

export const GET_SHARING_INFO = gql`
  query GetSharingInfo($entityType: String!, $entityId: String!) {
    sharingInfo(entityType: $entityType, entityId: $entityId) {
      isShared
      hasPublic
      publicRole
      passcodeCount
      userCount
      shareHash
      shareUrl
      roomCount
      accessoryCount
      groupCount
    }
  }
`;

export const GET_MY_SHARED_ENTITIES = gql`
  query GetMySharedEntities {
    mySharedEntities {
      id
      entityType
      entityId
      entityName
      accessType
      role
      name
      userEmail
      accessSchedule
      createdAt
    }
  }
`;

// Public entity (no auth required) - for /s/:hash routes
export const GET_PUBLIC_ENTITY = gql`
  query GetPublicEntity($shareHash: String!, $passcode: String) {
    publicEntity(shareHash: $shareHash, passcode: $passcode) {
      entityType
      entityId
      entityName
      role
      requiresPasscode
      canUpgradeWithPasscode
      data
    }
  }
`;

// Fetch full accessory data for a shared entity (for realtime widget display)
export const GET_PUBLIC_ENTITY_ACCESSORIES = gql`
  query GetPublicEntityAccessories($shareHash: String!, $passcode: String) {
    publicEntityAccessories(shareHash: $shareHash, passcode: $passcode)
  }
`;

// --- Stored Entity Queries ---

export const GET_STORED_ENTITIES = gql`
  query GetStoredEntities($entityType: String!) {
    storedEntities(entityType: $entityType) {
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

export const GET_STORED_ENTITY_LAYOUT = gql`
  query GetStoredEntityLayout($entityType: String!, $entityId: String!) {
    storedEntityLayout(entityType: $entityType, entityId: $entityId) {
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

// --- Room Group Queries ---

export const GET_ROOM_GROUPS = gql`
  query GetRoomGroups($homeId: String!) {
    roomGroups(homeId: $homeId) {
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

// --- Access Token Queries ---

export const GET_ACCESS_TOKENS = gql`
  query GetAccessTokens {
    accessTokens {
      id
      name
      tokenPrefix
      homePermissions
      createdAt
      lastUsedAt
      expiresAt
    }
  }
`;

// --- Webhook Queries ---

export const GET_WEBHOOKS = gql`
  query GetWebhooks($status: String, $limit: Int, $offset: Int) {
    webhooks(status: $status, limit: $limit, offset: $offset) {
      id
      name
      url
      secretPrefix
      secret
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
`;

export const GET_WEBHOOK = gql`
  query GetWebhook($webhookId: String!) {
    webhook(webhookId: $webhookId) {
      id
      name
      url
      secretPrefix
      secret
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
`;

export const GET_WEBHOOK_EVENT_TYPES = gql`
  query GetWebhookEventTypes {
    webhookEventTypes {
      eventType
      displayName
      description
      category
    }
  }
`;

export const GET_WEBHOOK_DELIVERY_HISTORY = gql`
  query GetWebhookDeliveryHistory($webhookId: String!, $limit: Int, $offset: Int, $status: String) {
    webhookDeliveryHistory(webhookId: $webhookId, limit: $limit, offset: $offset, status: $status) {
      deliveries {
        id
        webhookId
        eventType
        eventId
        status
        attemptNumber
        maxAttempts
        responseStatusCode
        responseBody
        latencyMs
        errorMessage
        createdAt
        nextRetryAt
      }
      total
      offset
      limit
    }
  }
`;

// --- Home Member Queries ---

export const GET_HOME_MEMBERS = gql`
  query GetHomeMembers($homeId: String!) {
    homeMembers(homeId: $homeId) {
      id
      homeId
      email
      name
      role
      isPending
      createdAt
    }
  }
`;

export const GET_MY_SHARED_HOMES = gql`
  query GetMySharedHomes {
    mySharedHomes {
      id
      name
      updatedAt
      role
    }
  }
`;

export const GET_PENDING_INVITATIONS = gql`
  query GetPendingInvitations {
    pendingInvitations {
      id
      homeId
      homeName
      role
      inviterName
      createdAt
    }
  }
`;

// --- Managed Relay Dashboard ---

export const GET_MY_MANAGED_RELAY_INFO = gql`
  query GetMyManagedRelayInfo {
    myManagedRelayInfo {
      email
      relayConnected
      relayConnectedSince
      homeCount
      maxHomes
      totalWebClientCount
      totalSubscriptionCount
      totalWebhookCount
      totalAutomationCount
      homes {
        homeId
        homeName
        accessoryCount
        roomCount
        customerEmail
        customerName
        customerAccountType
        enrollmentStatus
        enrollmentCreatedAt
        enrollmentMatchedAt
        recentControlCommands
        recentCharacteristicUpdates
        customerHasSubscription
        webClientCount
        subscriptionCount
        webhookCount
        automationCount
      }
      pendingEnrollmentCount
      activeEnrollmentCount
    }
  }
`;

export const GET_MANAGED_RELAY_WEBHOOK_DELIVERIES = gql`
  query GetManagedRelayWebhookDeliveries($homeId: String, $status: String, $limit: Int, $offset: Int) {
    managedRelayWebhookDeliveries(homeId: $homeId, status: $status, limit: $limit, offset: $offset) {
      totalCount
      deliveries {
        id
        webhookId
        webhookName
        webhookUrl
        customerEmail
        homeName
        eventType
        eventId
        status
        attemptNumber
        maxAttempts
        responseStatusCode
        latencyMs
        errorMessage
        createdAt
        nextRetryAt
      }
    }
  }
`;

export const GET_MANAGED_RELAY_ACTIVITY = gql`
  query GetManagedRelayActivity($homeId: String, $days: Int) {
    managedRelayActivity(homeId: $homeId, days: $days) {
      totalCommands
      totalUpdates
      homes {
        homeId
        homeName
        customerEmail
        totalCommands
        totalUpdates
        days {
          date
          controlCommands
          characteristicUpdates
        }
      }
    }
  }
`;

export const GET_MANAGED_RELAY_SERVER_LOGS = gql`
  query GetManagedRelayServerLogs($homeId: String, $severity: String, $limit: Int) {
    managedRelayServerLogs(homeId: $homeId, severity: $severity, limit: $limit) {
      totalCount
      entries {
        timestamp
        severity
        message
        metadata
      }
    }
  }
`;

export const GET_MANAGED_RELAY_RECENT_LOGS = gql`
  query GetManagedRelayRecentLogs($homeId: String, $limit: Int) {
    managedRelayRecentLogs(homeId: $homeId, limit: $limit) {
      entries {
        timestamp
        logType
        summary
        status
        latencyMs
        homeName
      }
    }
  }
`;

// --- Cloud Managed Queries ---

export const GET_MY_ENROLLMENTS = gql`
  query GetMyEnrollments {
    myCloudManagedEnrollments {
      id
      homeName
      status
      inviteEmail
      matchedHomeName
      needsHomeId
      createdAt
      matchedAt
      region
    }
  }
`;

// --- Authorized Apps Queries ---

export const GET_AUTHORIZED_APPS = gql`
  query GetAuthorizedApps {
    authorizedApps {
      clientId
      clientName
      clientUri
      logoUri
      redirectDomain
      scope
      homePermissions
      createdAt
      lastUsedAt
    }
  }
`;

// ============================================================
// Homecast Automation Engine
// ============================================================

export const HC_AUTOMATIONS = gql`
  query HcAutomations($homeId: String!) {
    hcAutomations(homeId: $homeId) {
      id
      entityType
      entityId
      parentId
      dataJson
      updatedAt
    }
  }
`;
