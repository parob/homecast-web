import { gql } from '@apollo/client/core';

// --- Admin Queries ---

export const GET_USERS = gql`
  query GetUsers($limit: Int, $offset: Int, $search: String, $accountType: String) {
    users(limit: $limit, offset: $offset, search: $search, accountType: $accountType) {
      users {
        id
        email
        name
        createdAt
        lastLoginAt
        isActive
        isAdmin
        accountType
        sessionCount
        homeCount
        totalAccessoryCount
        recentControlCommands
        recentCharacteristicUpdates
        emailVerified
        automationCount
      }
      totalCount
      hasMore
    }
  }
`;

export const GET_USER_DETAIL = gql`
  query GetUserDetail($userId: String!) {
    userDetail(userId: $userId) {
      id
      email
      name
      createdAt
      lastLoginAt
      isActive
      isAdmin
      accountType
      emailVerified
      stagingAccess
      totalAccessoryCount
      controlCommandCount
      characteristicUpdateCount
      recentControlCommands
      recentCharacteristicUpdates
      region
      sessions {
        id
        deviceId
        browserSessionId
        name
        sessionType
        lastSeenAt
        instanceId
        homeIds
      }
      homes {
        id
        name
      }
      settingsJson
    }
  }
`;

export const GET_LOGS = gql`
  query GetLogs(
    $level: String
    $source: String
    $userId: String
    $traceId: String
    $startTime: String
    $endTime: String
    $success: Boolean
    $limit: Int
    $offset: Int
  ) {
    logs(
      level: $level
      source: $source
      userId: $userId
      traceId: $traceId
      startTime: $startTime
      endTime: $endTime
      success: $success
      limit: $limit
      offset: $offset
    ) {
      logs {
        id
        timestamp
        level
        source
        message
        userId
        userEmail
        deviceId
        traceId
        spanName
        action
        accessoryId
        accessoryName
        success
        error
        latencyMs
        metadata
        instanceId
        slotName
        sourceSlot
        targetSlot
        routingMode
        clientType
        recipientCount
      }
      totalCount
    }
  }
`;

export const GET_ALL_USER_SESSIONS = gql`
  query GetAllUserSessions(
    $userId: String
    $sessionType: String
    $limit: Int
    $offset: Int
  ) {
    allUserSessions(
      userId: $userId
      sessionType: $sessionType
      limit: $limit
      offset: $offset
    ) {
      sessions {
        id
        deviceId
        browserSessionId
        name
        sessionType
        lastSeenAt
        homeIds
        userId
        userEmail
        instanceId
        connectedAt
        subscriptions {
          id
          scopeType
          scopeId
          createdAt
          expiresAt
        }
      }
      totalCount
    }
  }
`;

export const GET_DIAGNOSTICS = gql`
  query GetDiagnostics {
    diagnostics {
      serverInstances {
        instanceId
        slotName
        lastHeartbeat
      }
      topicSlots {
        slotName
        claimed
        instanceId
        claimedAt
        lastHeartbeat
        webConnections
        deviceConnections
        messagesSentLastHour
        messagesReceivedLastHour
      }
      pubsubEnabled
      pubsubActiveSlots
      totalWebsocketConnections
      webConnections
      deviceConnections
      recentErrors {
        id
        timestamp
        level
        source
        message
        userId
        userEmail
      }
    }
  }
`;

export const GET_INFRASTRUCTURE_STATUS = gql`
  query GetInfrastructureStatus {
    infrastructureStatus {
      deploymentMode
      consistentHashEnabled
      currentInstance
      hashRing {
        enabled
        podCount
        pods
        currentPod
        virtualNodes
      }
      hpa {
        minReplicas
        maxReplicas
        currentReplicas
        desiredReplicas
        targetCpuPct
        currentCpuPct
        targetMemoryPct
        currentMemoryPct
      }
      podMetrics {
        podName
        cpuMillicores
        memoryBytes
      }
      routingMetrics {
        broadcastsTotal
        broadcastsLocalOnly
        relayRedirectsSent
        webClientRedirectsSent
        localityRate
      }
    }
  }
`;

export const GET_MQTT_BRIDGE_STATUS = gql`
  query GetMqttBridgeStatus {
    mqttBridgeStatus {
      enabled
      connected
      brokerHost
      brokerPort
      subscribedHomesCount
      customBrokersCount
      initialStateDone
    }
  }
`;

export const GET_INFRASTRUCTURE_TIME_SERIES = gql`
  query GetInfrastructureTimeSeries(
    $metric: String!
    $deployment: String
    $hours: Int
    $podName: String
  ) {
    infrastructureTimeSeries(
      metric: $metric
      deployment: $deployment
      hours: $hours
      podName: $podName
    ) {
      metric
      unit
      points {
        timestamp
        value
      }
    }
  }
`;

export const GET_DATABASE_POOL_STATUS = gql`
  query GetDatabasePoolStatus {
    databasePoolStatus {
      poolSize
      checkedOut
      overflow
      checkedIn
      totalConnections
    }
  }
`;

export const GET_DATABASE_STATS = gql`
  query GetDatabaseStats {
    databaseStats {
      databaseSizeBytes
      activeConnections
      idleConnections
      idleInTransaction
      totalConnections
      maxConnections
      transactionsCommitted
      transactionsRolledBack
      cacheHitRatio
      tuplesReturned
      tuplesFetched
      tuplesInserted
      tuplesUpdated
      tuplesDeleted
      deadlocks
      topTables {
        schema
        tableName
        totalBytes
        tableBytes
        indexBytes
        rowEstimate
      }
      slowQueries {
        pid
        durationSeconds
        state
        query
        applicationName
      }
    }
  }
`;

export const GET_USER_DIAGNOSTICS = gql`
  query GetUserDiagnostics($userId: String!) {
    userDiagnostics(userId: $userId) {
      userId
      userEmail
      websocketConnected
      deviceConnected
      routingMode
      deviceName
      deviceLastSeen
      recentCommands {
        timestamp
        action
        accessoryId
        accessoryName
        success
        latencyMs
        error
      }
      connectionHistory {
        timestamp
        event
        details
      }
    }
  }
`;

export const GET_USER_ACTIVITY = gql`
  query GetUserActivity($userId: String!, $days: Int) {
    userActivity(userId: $userId, days: $days) {
      date
      controlCommands
      characteristicUpdates
    }
  }
`;

// --- Admin Mutations ---

export const TOGGLE_USER_ACTIVE = gql`
  mutation ToggleUserActive($userId: String!, $isActive: Boolean!) {
    toggleUserActive(userId: $userId, isActive: $isActive)
  }
`;

export const SET_USER_ADMIN = gql`
  mutation SetUserAdmin($userId: String!, $isAdmin: Boolean!) {
    setUserAdmin(userId: $userId, isAdmin: $isAdmin)
  }
`;

export const SET_USER_ACCOUNT_TYPE = gql`
  mutation SetUserAccountType($userId: String!, $accountType: String!, $skipEmail: Boolean) {
    setUserAccountType(userId: $userId, accountType: $accountType, skipEmail: $skipEmail)
  }
`;

export const SET_STAGING_ACCESS = gql`
  mutation SetStagingAccess($userId: String!, $stagingAccess: Boolean!) {
    setStagingAccess(userId: $userId, stagingAccess: $stagingAccess)
  }
`;

export const ADMIN_VERIFY_EMAIL = gql`
  mutation AdminVerifyEmail($userId: String!) {
    adminVerifyEmail(userId: $userId)
  }
`;

export const ADMIN_RESEND_VERIFICATION = gql`
  mutation AdminResendVerification($userId: String!) {
    adminResendVerification(userId: $userId)
  }
`;

export const ADMIN_SET_PASSWORD = gql`
  mutation AdminSetPassword($userId: String!, $newPassword: String!) {
    adminSetPassword(userId: $userId, newPassword: $newPassword)
  }
`;


export const FORCE_DISCONNECT = gql`
  mutation ForceDisconnect($deviceId: String!) {
    forceDisconnect(deviceId: $deviceId)
  }
`;

export const PING_SESSION = gql`
  mutation PingSession($sessionId: String!) {
    pingSession(sessionId: $sessionId) {
      success
      latencyMs
      error
    }
  }
`;

export const GET_WAITLIST_MODE = gql`
  query GetWaitlistMode {
    waitlistMode
  }
`;

export const SET_WAITLIST_MODE = gql`
  mutation SetWaitlistMode($enabled: Boolean!, $approveAll: Boolean) {
    setWaitlistMode(enabled: $enabled, approveAll: $approveAll)
  }
`;

export const APPROVE_WAITLIST_BATCH = gql`
  mutation ApproveWaitlistBatch($count: Int!) {
    approveWaitlistBatch(count: $count) {
      approvedCount
      emailsSent
    }
  }
`;

export const APPROVE_WAITLIST_USERS = gql`
  mutation ApproveWaitlistUsers($userIds: [String!]!) {
    approveWaitlistUsers(userIds: $userIds) {
      approvedCount
      emailsSent
    }
  }
`;

// --- Cloud Managed Admin Queries/Mutations ---

export const RESET_ONBOARDING = gql`
  mutation ResetOnboarding($userId: String!) {
    resetOnboarding(userId: $userId)
  }
`;

export const GET_USER_ENROLLMENTS = gql`
  query GetUserEnrollments($customerId: String!) {
    managedEnrollments(customerId: $customerId) {
      enrollments {
        id
        customerEmail
        customerName
        homeName
        managedUserEmail
        status
        matchedHomeId
        matchedHomeName
        createdAt
        matchedAt
      }
      totalCount
      hasMore
    }
  }
`;

export const ADMIN_CANCEL_ENROLLMENT = gql`
  mutation AdminCancelEnrollment($enrollmentId: String!) {
    adminCancelEnrollment(enrollmentId: $enrollmentId) {
      success
      error
    }
  }
`;

export const ADMIN_UNASSIGN_ENROLLMENT = gql`
  mutation AdminUnassignEnrollment($enrollmentId: String!) {
    adminUnassignEnrollment(enrollmentId: $enrollmentId) {
      success
      error
    }
  }
`;

export const ADMIN_CREATE_ENROLLMENT = gql`
  mutation AdminCreateEnrollment($customerEmail: String!, $homeName: String!, $region: String) {
    createCloudManagedEnrollment(customerEmail: $customerEmail, homeName: $homeName, region: $region) {
      success
      error
    }
  }
`;

export const CREATE_MANAGED_USER = gql`
  mutation CreateManagedUser($email: String!, $name: String, $region: String) {
    createManagedUser(email: $email, name: $name, region: $region) {
      success
      userId
      error
    }
  }
`;

export const UPDATE_MANAGED_USER = gql`
  mutation UpdateManagedUser($userId: String!, $region: String, $name: String) {
    updateManagedUser(userId: $userId, region: $region, name: $name) {
      success
      error
    }
  }
`;

export const GET_PENDING_ENROLLMENTS = gql`
  query GetPendingEnrollments($limit: Int) {
    pendingEnrollments(limit: $limit) {
      enrollments {
        id
        customerEmail
        customerName
        homeName
        managedUserEmail
        status
        matchedHomeId
        matchedHomeName
        createdAt
        matchedAt
        region
      }
      totalCount
      hasMore
    }
  }
`;

export const RESEND_RELAY_INVITE_EMAIL = gql`
  mutation ResendRelayInviteEmail($enrollmentId: String!) {
    resendRelayInviteEmail(enrollmentId: $enrollmentId) {
      success
      error
    }
  }
`;

export const GET_ALL_ENROLLMENTS = gql`
  query GetAllEnrollments($status: String, $limit: Int, $offset: Int) {
    managedEnrollments(status: $status, limit: $limit, offset: $offset) {
      enrollments {
        id
        customerEmail
        customerName
        homeName
        managedUserEmail
        status
        matchedHomeId
        matchedHomeName
        createdAt
        matchedAt
        region
      }
      totalCount
      hasMore
    }
  }
`;

export const GET_MANAGED_OVERVIEW = gql`
  query GetManagedOverview {
    managedOverview {
      totalManagedUsers
      activeRelays
      totalEnrollments
      awaitingRelayCount
      pendingEnrollments
      needsHomeIdCount
      activeEnrollments
      totalHomes
      totalCapacity
      availableSlots
      cancelledEnrollments
      maxHomesPerRelay
      cloudCustomerCount
      totalAccessories
    }
  }
`;

export const GET_MANAGED_USERS = gql`
  query GetManagedUsers($limit: Int, $offset: Int) {
    managedUsers(limit: $limit, offset: $offset) {
      users {
        id
        email
        name
        isActive
        relayConnected
        homeCount
        capacity
        pendingEnrollmentCount
        activeEnrollmentCount
        relaySessionId
        region
      }
      totalCount
    }
  }
`;

export const GET_MANAGED_USER_DETAIL = gql`
  query GetManagedUserDetail($userId: String!) {
    managedUserDetail(userId: $userId) {
      id
      email
      name
      isActive
      relayConnected
      region
      homes {
        homeId
        homeName
        accessoryCount
        roomCount
        customerEmail
        customerName
        enrollmentStatus
      }
    }
  }
`;

// --- Observability Queries ---

export const GET_TRACES = gql`
  query GetTraces(
    $action: String
    $userId: String
    $success: Boolean
    $startTime: String
    $endTime: String
    $limit: Int
    $offset: Int
  ) {
    traces(
      action: $action
      userId: $userId
      success: $success
      startTime: $startTime
      endTime: $endTime
      limit: $limit
      offset: $offset
    ) {
      traces {
        traceId
        action
        accessoryName
        userEmail
        userId
        startTime
        endTime
        totalLatencyMs
        success
        error
        hopCount
        usedPubsub
        classification
        clientType
        originInstance
      }
      totalCount
    }
  }
`;

export const GET_TRACE_DETAIL = gql`
  query GetTraceDetail($traceId: String!) {
    traceDetail(traceId: $traceId) {
      traceId
      logs {
        id
        timestamp
        level
        source
        message
        userId
        userEmail
        deviceId
        traceId
        spanName
        action
        accessoryId
        accessoryName
        success
        error
        latencyMs
        metadata
        instanceId
        slotName
        sourceSlot
        targetSlot
        routingMode
        clientType
        recipientCount
      }
    }
  }
`;

// --- Analytics Dashboard ---

export const GET_ANALYTICS_INTERNAL = gql`
  query GetAnalyticsInternal($days: Int) {
    analyticsInternal(days: $days) {
      environment
      kpis {
        totalUsers
        signupsThisPeriod
        activeUsers
        paidSubscribers
        mrrEstimate
        totalHomes
        totalAccessories
      }
      signups { date value }
      accountTypes { free standard cloud managed waitlist }
      engagement {
        dailyActiveUsers { date value }
        controlCommands { date value }
        characteristicUpdates { date value }
      }
      conversion {
        totalUsers
        paidUsers
        conversionRate
        accountTypeBreakdown { free standard cloud managed waitlist }
      }
      mqtt {
        enabledHomes
        customBrokers
        connectedClients
        retainedMessages
        browserSessions
      }
    }
  }
`;

export const GET_ANALYTICS_EXTERNAL = gql`
  query GetAnalyticsExternal($days: Int) {
    analyticsExternal(days: $days) {
      ga4Traffic {
        sessions { date value }
        pageViews { date value }
        users { date value }
        newUsers { date value }
        topSources { source sessions }
        deviceDesktop
        deviceMobile
        deviceTablet
        propertyName
        available
        error
      }
      appInstalls {
        iosDownloads { date value }
        macDownloads { date value }
        iosImpressions { date value }
        iosProductPageViews { date value }
        androidInstalls { date value }
        iosAvailable
        androidAvailable
        iosError
        androidError
      }
    }
  }
`;

export const GET_COSTS_AND_REVENUE = gql`
  query GetCostsAndRevenue($days: Int) {
    costsAndRevenue(days: $days) {
      gcpBilling {
        totalCost
        totalCredits
        netCost
        costByService { service cost percentage }
        costBySku { sku service cost }
        costByEnvironment { environment cost }
        dailyCosts { date value }
        costPerUser
        available
        error
      }
      stripeRevenue {
        mrr
        totalRevenue
        netRevenue
        totalRefunds
        activeSubscriptions
        subscriptionBreakdown { standard cloud }
        newSubscriptions
        churnedSubscriptions
        churnRate
        revenueTimeseries { date value }
        available
        error
      }
      profitLoss {
        totalRevenue
        totalCost
        netProfit
        marginPercentage
        revenueTimeseries { date value }
        costTimeseries { date value }
      }
    }
  }
`;

export const ADMIN_SEND_NOTIFICATION = gql`
  mutation AdminSendNotification($userId: String!, $title: String!, $message: String!) {
    adminSendNotification(userId: $userId, title: $title, message: $message) {
      success
      sentPush
      sentEmail
      failed
      error
    }
  }
`;
