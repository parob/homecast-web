export interface User {
  id: string;
  email: string;
  name: string | null;
  createdAt: string;
  lastLoginAt: string | null;
  isAdmin?: boolean;
  accountType?: string;  // "free" or "standard"
  stagingAccess?: boolean;
}

export interface SessionSubscription {
  id: string;
  scopeType: string;
  scopeId: string;
}

export interface Session {
  id: string;
  deviceId: string | null;
  name: string | null;
  sessionType: string;
  lastSeenAt: string | null;
  homeIds?: string[];
  subscriptions?: SessionSubscription[];
}

export interface AuthResult {
  success: boolean;
  token: string | null;
  error: string | null;
  userId: string | null;
  email: string | null;
  message: string | null;
}

// Query response types
export interface GetMeResponse {
  me: User | null;
}

// Account / Billing types
export interface AccountInfo {
  accountType: string;
  accessoryLimit: number | null;
  adsenseAdsEnabled: boolean;
  smartDealsEnabled: boolean;
  hasSubscription: boolean;
  cloudSignupsAvailable: boolean;
}

export interface GetAccountResponse {
  account: AccountInfo;
}

// Smart Deal types
export type DealTier = 'hot' | 'great' | 'good';

export interface PricePoint {
  date: string;
  price: number;
}

export interface DealInfo {
  id: string;
  deviceId: string;
  deviceName: string;
  deviceManufacturer: string;
  productName: string;
  dealPrice: string;
  regularPrice: string | null;
  discountPercentage: number | null;
  dealTitle: string | null;
  dealTier: DealTier;
  currency: string;
  dealUrl: string;
  imageUrl: string | null;
  expiresAt: string | null;
  quantity: number;
  listingType: string;
  unitPrice: string | null;
  priceHistory?: PricePoint[];
  allTimeLow: string | null;
  isNearAtl: boolean;
}

export interface GetActiveDealsResponse {
  activeDeals: DealInfo[];
}

export interface GetDealPriceHistoryResponse {
  dealPriceHistory: PricePoint[];
}

export interface TrackDealClickResponse {
  trackDealClick: boolean;
}

export interface CheckoutSessionResult {
  url: string | null;
  error: string | null;
  upgraded: boolean | null;
}

export interface CreateCheckoutSessionResponse {
  createCheckoutSession: CheckoutSessionResult;
}

export interface DowngradeToStandardResponse {
  downgradeToStandard: CheckoutSessionResult;
}

export interface PortalSessionResult {
  url: string | null;
  error: string | null;
}

export interface CreatePortalSessionResponse {
  createPortalSession: PortalSessionResult;
}

export interface GetSessionsResponse {
  sessions: Session[];
}

export interface GetSessionResponse {
  session: Session | null;
}

export interface ConnectionDebugInfo {
  serverInstanceId: string;
  pubsubEnabled: boolean;
  pubsubSlot: string | null;
  deviceConnected: boolean;
  deviceId: string | null;
  deviceInstanceId: string | null;
  routingMode: string;  // "local" | "pubsub" | "not_connected" | "unreachable"
}

export interface GetConnectionDebugInfoResponse {
  connectionDebugInfo: ConnectionDebugInfo;
}

// Mutation response types
export interface LoginResponse {
  login: AuthResult;
}

export interface SignupResponse {
  signup: AuthResult;
}

export interface RemoveSessionResponse {
  removeSession: boolean;
}

export interface GetAccessoriesResponse {
  accessories: HomeKitAccessory[];
}

export interface SetCharacteristicResponse {
  setCharacteristic: {
    success: boolean;
    accessoryId: string;
    characteristicType: string;
    value: any;
  };
}

// HomeKit types (from PROTOCOL.md)

export type HomeRole = 'owner' | 'admin' | 'control' | 'view';

export interface HomeKitHome {
  id: string;
  name: string;
  isPrimary: boolean;
  roomCount: number;
  accessoryCount: number;
  sceneCount?: number;
  role?: HomeRole;
  relayConnected?: boolean;
  isCloudManaged?: boolean;
  roomFingerprint?: string;
  ownerEmail?: string;
}

export interface HomeKitRoom {
  id: string;
  name: string;
  accessoryCount: number;
}

export interface HomeKitCharacteristic {
  id: string;
  characteristicType: string;
  value?: any;  // Optional - may not be present when not yet read
  isReadable: boolean;
  isWritable: boolean;
  // Metadata from HomeKit (optional - only included when available)
  validValues?: number[];
  minValue?: number;
  maxValue?: number;
  stepValue?: number;
}

export interface HomeKitService {
  id: string;
  name: string;
  serviceType: string;
  characteristics: HomeKitCharacteristic[];
}

export interface HomeKitAccessory {
  id: string;
  name: string;
  homeId?: string;
  homeName?: string;
  roomId?: string;
  roomName?: string;
  category?: string;
  isReachable: boolean;
  services: HomeKitService[];
}

export interface HomeKitScene {
  id: string;
  name: string;
  actionCount: number;
}

export interface AutomationAction {
  accessoryId: string;
  accessoryName: string;
  characteristicType: string;
  targetValue: string | null;  // JSON-encoded
}

export interface AutomationEvent {
  type: string;
  accessoryId?: string;
  accessoryName?: string;
  characteristicType?: string;
  triggerValue?: string | null;
  thresholdMin?: string | null;
  thresholdMax?: string | null;
  significantEvent?: string;
  offsetMinutes?: number;
  latitude?: number;
  longitude?: number;
  radius?: number;
  notifyOnEntry?: boolean;
  notifyOnExit?: boolean;
  presenceType?: string;
  presenceEvent?: string;
  calendarComponents?: string | null;
  durationSeconds?: number;
}

export interface AutomationTriggerCondition {
  type: string;
  accessoryId?: string;
  accessoryName?: string;
  characteristicType?: string;
  operator?: string;
  value?: string | null;  // JSON-encoded
  beforeTime?: string | null;
  afterTime?: string | null;
  beforeEvent?: string;
  afterEvent?: string;
  predicateFormat?: string;
}

export interface AutomationTrigger {
  type: string;
  fireDate?: string;
  recurrence?: string | null;  // JSON-encoded
  timeZone?: string;
  events?: AutomationEvent[];
  endEvents?: AutomationEvent[];
  conditions?: AutomationTriggerCondition[];
  recurrences?: string | null;  // JSON-encoded array of DateComponents
  executeOnce?: boolean;
  activationState?: string;
}

export interface HomeKitAutomation {
  id: string;
  name: string;
  isEnabled: boolean;
  trigger: AutomationTrigger;
  actions: AutomationAction[];
  lastFireDate?: string;
  homeId?: string;
}

export interface GetAutomationsResponse {
  automations: HomeKitAutomation[];
}

export interface CreateAutomationResponse {
  createAutomation: HomeKitAutomation;
}

export interface UpdateAutomationResponse {
  updateAutomation: HomeKitAutomation;
}

export interface DeleteAutomationResponse {
  deleteAutomation: {
    success: boolean;
    automationId: string;
    error?: string;
  };
}

export interface SetAutomationEnabledResponse {
  setAutomationEnabled: HomeKitAutomation;
}

export interface HomeKitServiceGroup {
  id: string;
  name: string;
  serviceIds: string[];
  accessoryIds: string[];
  homeId?: string;
}

// HomeKit query responses
export interface CachedHome {
  id: string;
  name: string;
  updatedAt: string;
  role?: HomeRole;
  ownerEmail?: string;
}

export interface GetHomesResponse {
  homes: HomeKitHome[];
}

export interface GetCachedHomesResponse {
  cachedHomes: CachedHome[];
}

// --- Home Member Types ---

export interface HomeMemberInfo {
  id: string;
  homeId: string;
  email: string;
  name: string | null;
  role: string;
  isPending: boolean;
  createdAt: string;
}

export interface HomeMemberResult {
  success: boolean;
  error: string | null;
  member: HomeMemberInfo | null;
}

export interface GetHomeMembersResponse {
  homeMembers: HomeMemberInfo[];
}

export interface GetMySharedHomesResponse {
  mySharedHomes: CachedHome[];
}

export interface InviteHomeMemberResponse {
  inviteHomeMember: HomeMemberResult;
}

export interface UpdateHomeMemberRoleResponse {
  updateHomeMemberRole: HomeMemberResult;
}

export interface RemoveHomeMemberResponse {
  removeHomeMember: { success: boolean; error: string | null };
}

export interface PendingInvitation {
  id: string;
  homeId: string;
  homeName: string;
  role: string;
  inviterName: string;
  createdAt: string;
}

export interface GetPendingInvitationsResponse {
  pendingInvitations: PendingInvitation[];
}

export interface AcceptHomeInvitationResponse {
  acceptHomeInvitation: { success: boolean; error: string | null };
}

export interface RejectHomeInvitationResponse {
  rejectHomeInvitation: { success: boolean; error: string | null };
}

export interface GetRoomsResponse {
  rooms: HomeKitRoom[];
}

export interface GetRoomsVariables {
  homeId: string;
}

export interface GetAccessoriesResponse {
  accessories: HomeKitAccessory[];
}

export interface GetAccessoryResponse {
  accessory: HomeKitAccessory | null;
}

export interface GetScenesResponse {
  scenes: HomeKitScene[];
}

// HomeKit mutation responses
export interface SetCharacteristicResponse {
  setCharacteristic: {
    success: boolean;
    accessoryId: string;
    characteristicType: string;
    value: any;
  };
}

export interface ExecuteSceneResponse {
  executeScene: {
    success: boolean;
    sceneId: string;
  };
}

export interface GetServiceGroupsResponse {
  serviceGroups: HomeKitServiceGroup[];
}

export interface SetServiceGroupResponse {
  setServiceGroup: {
    success: boolean;
    groupId: string;
    affectedCount: number;
  };
}

// Collection - matches DB model
export interface Collection {
  id: string;
  name: string;
  payload: string;  // JSON: CollectionPayload
  createdAt: string;
}

// Collection payload structure
export interface CollectionPayload {
  groups: CollectionGroup[];
  items: CollectionItem[];
}

// Collection group (like a room within a collection)
export interface CollectionGroup {
  id: string;
  name: string;
}


// Helper type for parsed payload items
// Either accessory_id OR service_group_id should be set (mutually exclusive)
export interface CollectionItem {
  home_id: string;
  home_name?: string;          // Stored for display fallback when home UUID changes
  accessory_id?: string;       // Individual accessory
  service_group_id?: string;   // HomeKit service group (native grouped accessories)
  group_id?: string;           // Collection group (our custom grouping) - null/undefined = ungrouped
}

// Helper to parse collection payload (handles both old array format and new object format)
export function parseCollectionPayload(payload: string): CollectionPayload {
  try {
    const parsed = JSON.parse(payload);
    // Handle old array format (migrate to new format)
    if (Array.isArray(parsed)) {
      return {
        groups: [],
        items: parsed.map(item => ({
          home_id: item.home_id,
          accessory_id: item.accessory_id,
          service_group_id: item.service_group_id,
          group_id: undefined,
        })),
      };
    }
    // New object format - explicitly check for arrays to avoid .map() errors on non-array values
    return {
      groups: Array.isArray(parsed.groups) ? parsed.groups : [],
      items: Array.isArray(parsed.items) ? parsed.items : [],
    };
  } catch {
    return { groups: [], items: [] };
  }
}

/**
 * Strip prefix from accessory name if the accessory name starts with the given prefix.
 * E.g., "Living Room Light" with prefix "Living Room" becomes "Light"
 */
export function getDisplayName(accessoryName: string, prefix?: string): string {
  if (!prefix || !accessoryName) return accessoryName;

  const nameLower = accessoryName.toLowerCase();
  const prefixLower = prefix.toLowerCase();

  if (nameLower.startsWith(prefixLower)) {
    // Strip the prefix and any following space/separator
    const stripped = accessoryName.slice(prefix.length).replace(/^[\s\-_]+/, '');
    // Only use stripped name if there's something left
    if (stripped.length > 0) {
      return stripped;
    }
  }

  return accessoryName;
}

// Response types
export interface GetCollectionsResponse {
  collections: Collection[];
}

export interface CreateCollectionResponse {
  createCollection: Collection | null;
}

export interface UpdateCollectionResponse {
  updateCollection: Collection | null;
}

// Pinned tab bar item (mobile bottom navigation)
export interface PinnedTab {
  type: 'home' | 'room' | 'collection' | 'collectionGroup';
  id: string;
  name: string;       // Cached for display before data loads
  customName?: string; // User-defined label override for tab bar display
  homeId?: string;    // Required for 'room' type (routing needs home context)
  collectionId?: string; // Required for 'collectionGroup' type (navigate to parent collection first)
}

// Per-device display/layout settings (stored under devices[deviceId] in settings blob)
export interface DeviceDisplaySettings {
  compactMode?: boolean;
  hideInfoDevices?: boolean;
  hideAccessoryCounts?: boolean;
  layoutMode?: 'grid' | 'masonry';
  groupByRoom?: boolean;
  groupByType?: boolean;
  iconStyle?: 'standard' | 'colourful';
  fontSize?: 'small' | 'medium' | 'large';
  autoBackgrounds?: boolean;
  fullWidth?: boolean;
  pinnedTabs?: PinnedTab[];
  lastView?:
    | { type: 'home'; homeId: string; roomId?: string }
    | { type: 'collection'; collectionId: string; collectionGroupId?: string };
}

// Keys that are per-device (display/layout) vs global (ordering/data)
export const DEVICE_SETTING_KEYS: readonly (keyof DeviceDisplaySettings)[] = [
  'compactMode', 'hideInfoDevices', 'hideAccessoryCounts',
  'layoutMode', 'groupByRoom', 'groupByType', 'iconStyle',
  'fontSize', 'autoBackgrounds', 'fullWidth', 'pinnedTabs', 'lastView',
] as const;

// Get display settings for a specific device, falling back to legacy flat fields
export function getDeviceSettings(settings: UserSettingsData, deviceId: string): DeviceDisplaySettings {
  const deviceSettings = settings.devices?.[deviceId];
  if (deviceSettings) return deviceSettings;

  // Migration fallback: read from flat fields (old format before per-device support)
  const legacy: DeviceDisplaySettings = {};
  for (const key of DEVICE_SETTING_KEYS) {
    if (key in settings) {
      (legacy as any)[key] = (settings as any)[key];
    }
  }
  return legacy;
}

// User Settings - stored as JSON blob, frontend controls schema
export interface UserSettingsData {
  // Per-device display settings (keyed by device ID)
  devices?: Record<string, DeviceDisplaySettings>;

  // Legacy flat display fields (deprecated, kept for migration fallback)
  compactMode?: boolean;
  hideInfoDevices?: boolean;
  hideAccessoryCounts?: boolean;
  layoutMode?: 'grid' | 'masonry';
  groupByRoom?: boolean;
  groupByType?: boolean;
  iconStyle?: 'standard' | 'colourful';
  fontSize?: 'small' | 'medium' | 'large';
  autoBackgrounds?: boolean;
  fullWidth?: boolean;
  pinnedTabs?: PinnedTab[];
  lastView?:
    | { type: 'home'; homeId: string; roomId?: string }
    | { type: 'collection'; collectionId: string; collectionGroupId?: string };

  // Global settings (shared across all devices)
  homeOrder?: string[];
  roomOrderByHome?: Record<string, string[]>;
  includedAccessoryIds?: string[];  // Selected accessories for free plan (max 10)
  // Unified item order for groups and accessories (keyed by homeId, then contextId)
  // contextId: roomId for room view, 'all' for home view
  // Item IDs: groups prefixed with 'group-', accessories use their ID directly
  itemOrder?: Record<string, Record<string, string[]>>;  // homeId -> contextId -> itemId[]
  // Legacy fields (deprecated, kept for migration)
  deviceOrder?: Record<string, Record<string, string[]>>;
  groupOrder?: Record<string, Record<string, string[]>>;
  // Expanded groups (show devices visible)
  expandedGroups?: string[];  // array of groupId
  // Collection item order (collectionId -> accessoryId[])
  collectionItemOrder?: Record<string, string[]>;
  // Consolidated visibility settings for UI (single config value)
  visibility?: {
    ui: {
      hiddenHomes?: string[];
      hiddenRooms?: Record<string, string[]>;
      hiddenGroups?: Record<string, string[]>;
      hiddenDevices?: Record<string, Record<string, string[]>>;
    };
  };
  // Developer mode: show API access, webhooks, and developer tools in settings
  developerMode?: boolean;
  // Smart Deals preferences
  smartDealsEnabled?: boolean;
  smartDealsMinTier?: 'good' | 'great' | 'hot';
  onboardingCompleted?: boolean;
  onboarding?: {
    completed: boolean;
    setupPath?: 'mac-relay' | 'cloud-relay' | 'shared-home' | 'skipped';
    pendingEnrollmentId?: string;
  };
  tutorialCompleted?: boolean;
}

export interface UserSettings {
  data: string; // JSON string of UserSettingsData
}

export interface GetSettingsResponse {
  settings: UserSettings;
}

export interface UpdateSettingsResponse {
  updateSettings: {
    success: boolean;
    settings: UserSettings | null;
  };
}

// --- Entity Access Types (Unified Sharing) ---

export type EntityType = 'collection' | 'collection_group' | 'room' | 'accessory_group' | 'home' | 'accessory' | 'room_group';
export type AccessType = 'public' | 'passcode' | 'user' | 'member';
export type AccessRole = 'view' | 'control';

// Access schedule types
export interface TimeWindow {
  days: string[];  // ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']
  start: string;   // '09:00' (HH:MM format)
  end: string;     // '17:00' (HH:MM format)
}

export interface AccessSchedule {
  starts_at?: string;      // ISO 8601 datetime for deferred activation
  expires_at?: string;     // ISO 8601 datetime for expiration
  time_windows?: TimeWindow[];  // Recurring time restrictions
  timezone?: string;       // IANA timezone, e.g., 'US/Eastern'
}

export interface EntityAccessInfo {
  id: string;
  entityType: EntityType;
  entityId: string;
  entityName?: string | null;  // Name of the entity (for display)
  accessType: AccessType;
  role: AccessRole;
  name?: string | null;  // Label for passcode
  userId?: string | null;
  userEmail?: string | null;  // Resolved email for user access
  hasPasscode: boolean;
  shareUrl?: string | null;  // URL to access the shared entity
  accessSchedule?: string | null;
  createdAt?: string | null;
}

export interface SharingInfo {
  isShared: boolean;
  hasPublic: boolean;
  publicRole?: AccessRole | null;
  passcodeCount: number;
  userCount: number;
  shareHash: string;
  shareUrl: string;
  roomCount?: number | null;
  accessoryCount?: number | null;
  groupCount?: number | null;
}

export interface SharedEntityData {
  entityType: EntityType;
  entityId: string;
  entityName: string;
  role: AccessRole;
  requiresPasscode: boolean;
  canUpgradeWithPasscode: boolean;  // True if a passcode exists that grants higher access
  isOwner: boolean;  // True if the authenticated user owns this entity
  homeId?: string | null;  // For room/accessory/group entities, the parent home ID
  data?: string | null;  // JSON string with entity-specific data
}

export interface CreateEntityAccessResult {
  success: boolean;
  access?: EntityAccessInfo | null;
  error?: string | null;
}

export interface DeleteEntityAccessResult {
  success: boolean;
  error?: string | null;
}

export interface ClientLogResult {
  success: boolean;
  error?: string | null;
}

// Response types
export interface GetEntityAccessResponse {
  entityAccess: EntityAccessInfo[];
}

export interface GetSharingInfoResponse {
  sharingInfo: SharingInfo | null;
}

export interface GetMySharedEntitiesResponse {
  mySharedEntities: EntityAccessInfo[];
}

export interface GetPublicEntityResponse {
  publicEntity: SharedEntityData | null;
}

export interface CreateEntityAccessResponse {
  createEntityAccess: CreateEntityAccessResult;
}

export interface UpdateEntityAccessResponse {
  updateEntityAccess: CreateEntityAccessResult;
}

export interface DeleteEntityAccessResponse {
  deleteEntityAccess: DeleteEntityAccessResult;
}

export interface PublicEntitySetCharacteristicResponse {
  publicEntitySetCharacteristic: {
    success: boolean;
    accessoryId: string;
    characteristicType: string;
    value: any;
  };
}

// Response for fetching full accessory data from a shared entity
export interface GetPublicEntityAccessoriesResponse {
  publicEntityAccessories: string | null; // JSON string of PublicEntityAccessoriesData
}

// --- Stored Entity Types ---

export interface StoredEntity {
  id: string;
  entityType: 'home' | 'room' | 'collection' | 'collection_group';
  entityId: string;
  parentId?: string | null;
  dataJson: string;
  layoutJson: string;
  updatedAt: string;
}

// Entity data structures (stored in dataJson)
export interface HomeData {
  name: string;
}

export interface RoomData {
  name: string;
  homeId: string;
}

export interface CollectionData {
  name: string;
  items: CollectionItem[];
}

export interface CollectionGroupData {
  name: string;
  order: number;
}

export interface RoomGroupData {
  name: string;
  roomIds: string[];
}

export interface RoomGroupLayout {
  roomOrder?: string[];
  background?: BackgroundSettings;
}

// Background settings for customizable backgrounds
export interface BackgroundSettings {
  type: 'none' | 'preset' | 'custom';
  presetId?: string;      // e.g., 'gradient-blue', 'nature-forest'
  customUrl?: string;     // URL to uploaded image
  blur: number;           // 0-50px blur amount
  brightness: number;     // 0-100 brightness (50 = no change, <50 = darker, >50 = brighter)
}

export interface BackgroundPreset {
  id: string;
  name: string;
  url: string;
  category: string;
}

export interface GetBackgroundPresetsResponse {
  backgroundPresets: BackgroundPreset[];
}

export interface UserBackground {
  url: string;
  thumbnailUrl: string;
  filename: string;
}

export interface GetUserBackgroundsResponse {
  userBackgrounds: UserBackground[];
}

// Layout data structures (stored in layoutJson)
export interface HomeLayoutData {
  roomOrder?: string[];  // Can include room IDs and room group IDs (prefixed with 'room-group-')
  visibility?: {
    hiddenRooms?: string[];
  };
  background?: BackgroundSettings;
}

export interface RoomLayoutData {
  itemOrder?: string[];
  visibility?: {
    hiddenGroups?: string[];
    hiddenAccessories?: string[];
  };
  expandedGroups?: string[];
  background?: BackgroundSettings;  // If not set, inherits from home
}

export interface CollectionLayoutData {
  compactMode?: boolean;
  iconStyle?: string;
  background?: BackgroundSettings;
}

// Public entity accessories response data structure
export interface PublicEntityAccessoriesData {
  accessories: HomeKitAccessory[];
  serviceGroups?: HomeKitServiceGroup[];
  layout?: HomeLayoutData & { rooms?: Record<string, RoomLayoutData>; roomGroups?: Array<{ id: string; name: string; roomIds: string[]; layout?: Record<string, any> }> };
  entityName?: string;
}

// Stored entity query/mutation response types
export interface GetStoredEntitiesResponse {
  storedEntities: StoredEntity[];
}

export interface GetStoredEntityLayoutResponse {
  storedEntityLayout: StoredEntity | null;
}

export interface SyncEntitiesResult {
  success: boolean;
  syncedCount: number;
}

export interface SyncEntitiesResponse {
  syncEntities: SyncEntitiesResult;
}

export interface UpdateEntityLayoutResult {
  success: boolean;
  entity?: StoredEntity | null;
}

export interface UpdateStoredEntityLayoutResponse {
  updateStoredEntityLayout: UpdateEntityLayoutResult;
}

// --- Admin Types ---

export interface AdminUserSummary {
  id: string;
  email: string;
  name: string | null;
  createdAt: string;
  lastLoginAt: string | null;
  isActive: boolean;
  isAdmin: boolean;
  accountType: string;
  sessionCount: number;
  homeCount: number;
  totalAccessoryCount: number;
  recentControlCommands: number;
  recentCharacteristicUpdates: number;
  emailVerified: boolean;
}

export interface AdminUsersResult {
  users: AdminUserSummary[];
  totalCount: number;
  hasMore: boolean;
}

export interface AdminSessionSummary {
  id: string;
  deviceId: string | null;
  browserSessionId?: string | null;
  name: string | null;
  sessionType: string;
  lastSeenAt: string | null;
  instanceId: string | null;
  homeIds: string[];
}

export interface AdminHomeInfo {
  id: string;
  name: string;
}

export interface AdminUserDetail {
  id: string;
  email: string;
  name: string | null;
  createdAt: string;
  lastLoginAt: string | null;
  isActive: boolean;
  isAdmin: boolean;
  accountType: string;
  sessions: AdminSessionSummary[];
  homes: AdminHomeInfo[];
  settingsJson: string | null;
  forcePubsubRouting: boolean;
  forcePubsubHomes: string[];  // List of home IDs with forced Pub/Sub
  emailVerified: boolean;
  stagingAccess: boolean;
  totalAccessoryCount: number;
  controlCommandCount: number;
  characteristicUpdateCount: number;
  recentControlCommands: number;
  recentCharacteristicUpdates: number;
  region: string | null;
}

export interface AdminLogEntry {
  id: string;
  timestamp: string;
  level: string;
  source: string;
  message: string;
  userId: string | null;
  userEmail: string | null;
  deviceId: string | null;
  traceId: string | null;
  spanName: string | null;
  action: string | null;
  accessoryId: string | null;
  accessoryName: string | null;
  success: boolean | null;
  error: string | null;
  latencyMs: number | null;
  metadata: string | null;
  // Additional fields from Cloud Logging
  instanceId: string | null;
  slotName: string | null;
  sourceSlot: string | null;
  targetSlot: string | null;
  routingMode: string | null;
  clientType: string | null;
  recipientCount: number | null;
}

export interface AdminLogsResult {
  logs: AdminLogEntry[];
  totalCount: number;
}

export interface AdminServerInstance {
  instanceId: string;
  slotName: string | null;
  lastHeartbeat: string | null;
}

export interface PubSubTopicSlot {
  slotName: string;
  claimed: boolean;
  instanceId: string | null;
  claimedAt: string | null;
  lastHeartbeat: string | null;
  webConnections: number;
  deviceConnections: number;
  messagesSentLastHour: number;
  messagesReceivedLastHour: number;
}

export interface AdminSystemDiagnostics {
  serverInstances: AdminServerInstance[];
  topicSlots: PubSubTopicSlot[];
  pubsubEnabled: boolean;
  pubsubActiveSlots: number;
  totalWebsocketConnections: number;
  webConnections: number;
  deviceConnections: number;
  recentErrors: AdminLogEntry[];
}

export interface AdminCommandHistory {
  timestamp: string;
  action: string | null;
  accessoryId: string | null;
  accessoryName: string | null;
  success: boolean | null;
  latencyMs: number | null;
  error: string | null;
}

export interface AdminConnectionEvent {
  timestamp: string;
  event: string;
  details: string | null;
}

export interface AdminUserDiagnostics {
  userId: string;
  userEmail: string;
  websocketConnected: boolean;
  deviceConnected: boolean;
  routingMode: string;
  deviceName: string | null;
  deviceLastSeen: string | null;
  recentCommands: AdminCommandHistory[];
  connectionHistory: AdminConnectionEvent[];
}

// Admin query response types
export interface AdminUsersResponse {
  users: AdminUsersResult;
}

export interface AdminUserDetailResponse {
  userDetail: AdminUserDetail | null;
}

export interface AdminLogsResponse {
  logs: AdminLogsResult;
}

export interface BatchApproveResult {
  approvedCount: number;
  emailsSent: number;
}

export interface ApproveWaitlistBatchResponse {
  approveWaitlistBatch: BatchApproveResult;
}

export interface ApproveWaitlistUsersResponse {
  approveWaitlistUsers: BatchApproveResult;
}

// --- Connection/Subscription Types ---

export interface AdminSubscriptionInfo {
  id: string;
  scopeType: string;
  scopeId: string;
  createdAt: string;
  expiresAt: string | null;
}

export interface AdminSessionInfo {
  id: string;
  deviceId: string | null;
  browserSessionId: string | null;
  name: string | null;
  sessionType: string;
  lastSeenAt: string | null;
  homeIds: string[];
  userId: string | null;
  userEmail: string | null;
  instanceId: string | null;
  connectedAt: string | null;
  subscriptions: AdminSubscriptionInfo[];
}

export interface AdminSessionsResult {
  sessions: AdminSessionInfo[];
  totalCount: number;
}

export interface AdminSessionsResponse {
  allUserSessions: AdminSessionsResult;
}

export interface AdminDiagnosticsResponse {
  diagnostics: AdminSystemDiagnostics;
}

export interface AdminHashRingState {
  enabled: boolean;
  podCount: number;
  pods: string[];
  currentPod: string | null;
  virtualNodes: number;
}

export interface AdminHPAStatus {
  minReplicas: number | null;
  maxReplicas: number | null;
  currentReplicas: number | null;
  desiredReplicas: number | null;
  targetCpuPct: number | null;
  currentCpuPct: number | null;
  targetMemoryPct: number | null;
  currentMemoryPct: number | null;
}

export interface AdminPodMetric {
  podName: string;
  cpuMillicores: number;
  memoryBytes: number;
}

export interface AdminRoutingMetrics {
  broadcastsTotal: number;
  broadcastsLocalOnly: number;
  pubsubMessagesSent: number;
  relayRedirectsSent: number;
  webClientRedirectsSent: number;
  localityRate: number;
}

export interface AdminInfrastructureStatus {
  deploymentMode: string;
  consistentHashEnabled: boolean;
  currentInstance: string;
  hashRing: AdminHashRingState;
  hpa: AdminHPAStatus | null;
  podMetrics: AdminPodMetric[];
  routingMetrics: AdminRoutingMetrics;
}

export interface AdminInfrastructureStatusResponse {
  infrastructureStatus: AdminInfrastructureStatus;
}

export interface AdminUserDiagnosticsResponse {
  userDiagnostics: AdminUserDiagnostics | null;
}

export interface UserActivityDay {
  date: string;
  controlCommands: number;
  characteristicUpdates: number;
}

export interface UserActivityResponse {
  userActivity: UserActivityDay[];
}

export interface AdminPingResult {
  success: boolean;
  latencyMs: number | null;
  error: string | null;
}

export interface AdminPingSessionResponse {
  pingSession: AdminPingResult;
}

// --- Access Token Types ---

export interface AccessTokenInfo {
  id: string;
  name: string;
  tokenPrefix: string;
  homePermissions: string;  // JSON string: { homeId: 'view'|'control' }
  createdAt: string;
  lastUsedAt: string | null;
  expiresAt: string | null;
}

export interface CreateAccessTokenResult {
  success: boolean;
  token: AccessTokenInfo | null;
  rawToken: string | null;  // Only returned on creation
  error: string | null;
}

export interface RevokeAccessTokenResult {
  success: boolean;
  error: string | null;
}

export interface GetAccessTokensResponse {
  accessTokens: AccessTokenInfo[];
}

export interface CreateAccessTokenResponse {
  createAccessToken: CreateAccessTokenResult;
}

export interface RevokeAccessTokenResponse {
  revokeAccessToken: RevokeAccessTokenResult;
}

// --- Webhook Types ---

export type WebhookEventType = 'state.changed';

export type WebhookStatus = 'active' | 'paused' | 'disabled';
export type DeliveryStatus = 'pending' | 'success' | 'failed' | 'retrying' | 'dead_letter';

export interface WebhookInfo {
  id: string;
  name: string;
  url: string;
  secretPrefix: string;  // Masked secret (e.g., "whsec_abc1...")
  secret: string;  // Full signing secret
  status: WebhookStatus;
  eventTypes: WebhookEventType[];
  homeIds: string[];
  roomIds: string[];
  accessoryIds: string[];
  collectionIds: string[];
  maxRetries: number;
  rateLimitPerMinute: number | null;
  timeoutMs: number;
  consecutiveFailures: number;
  lastTriggeredAt: string | null;
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  createdAt: string | null;
}

export interface WebhookEventTypeInfo {
  eventType: WebhookEventType;
  displayName: string;
  description: string | null;
  category: string;
}

export interface WebhookDeliveryInfo {
  id: string;
  webhookId: string;
  eventType: WebhookEventType;
  eventId: string;
  status: DeliveryStatus;
  attemptNumber: number;
  maxAttempts: number;
  responseStatusCode: number | null;
  responseBody: string | null;
  latencyMs: number | null;
  errorMessage: string | null;
  createdAt: string | null;
  nextRetryAt: string | null;
}

export interface DeliveryHistoryResult {
  deliveries: WebhookDeliveryInfo[];
  total: number;
  offset: number;
  limit: number;
}

export interface CreateWebhookResult {
  success: boolean;
  webhook: WebhookInfo | null;
  rawSecret: string | null;  // Only returned on creation
  error: string | null;
}

export interface UpdateWebhookResult {
  success: boolean;
  webhook: WebhookInfo | null;
  error: string | null;
}

export interface DeleteWebhookResult {
  success: boolean;
  error: string | null;
}

export interface RotateSecretResult {
  success: boolean;
  webhook: WebhookInfo | null;
  rawSecret: string | null;  // Only returned once
  error: string | null;
}

export interface TestWebhookResult {
  success: boolean;
  statusCode: number | null;
  responseTimeMs: number | null;
  error: string | null;
}

// Webhook query response types
export interface GetWebhooksResponse {
  webhooks: WebhookInfo[];
}

export interface GetWebhookResponse {
  webhook: WebhookInfo | null;
}

export interface GetWebhookEventTypesResponse {
  webhookEventTypes: WebhookEventTypeInfo[];
}

export interface GetWebhookDeliveryHistoryResponse {
  webhookDeliveryHistory: DeliveryHistoryResult;
}

// Webhook mutation response types
export interface CreateWebhookResponse {
  createWebhook: CreateWebhookResult;
}

export interface UpdateWebhookResponse {
  updateWebhook: UpdateWebhookResult;
}

export interface DeleteWebhookResponse {
  deleteWebhook: DeleteWebhookResult;
}

export interface PauseWebhookResponse {
  pauseWebhook: UpdateWebhookResult;
}

export interface ResumeWebhookResponse {
  resumeWebhook: UpdateWebhookResult;
}

export interface RotateWebhookSecretResponse {
  rotateWebhookSecret: RotateSecretResult;
}

export interface TestWebhookResponse {
  testWebhook: TestWebhookResult;
}

// --- Authorized App Types ---

export interface AuthorizedAppInfo {
  clientId: string;
  clientName: string | null;
  clientUri: string | null;
  logoUri: string | null;
  redirectDomain: string | null;
  scope: string | null;
  homePermissions: string | null;  // JSON string: { homeId: 'view'|'control' }
  createdAt: string;
  lastUsedAt: string | null;
}

export interface RevokeAuthorizedAppResult {
  success: boolean;
  error: string | null;
}

export interface GetAuthorizedAppsResponse {
  authorizedApps: AuthorizedAppInfo[];
}

export interface RevokeAuthorizedAppResponse {
  revokeAuthorizedApp: RevokeAuthorizedAppResult;
}

export interface UpdateAuthorizedAppResult {
  success: boolean;
  error: string | null;
  app: AuthorizedAppInfo | null;
}

export interface UpdateAuthorizedAppResponse {
  updateAuthorizedApp: UpdateAuthorizedAppResult;
}

// Cloud Managed types
export interface ManagedOverviewStats {
  totalManagedUsers: number;
  activeRelays: number;
  totalEnrollments: number;
  awaitingRelayCount: number;
  pendingEnrollments: number;
  needsHomeIdCount: number;
  activeEnrollments: number;
  totalHomes: number;
  totalCapacity: number;
  availableSlots: number;
  cancelledEnrollments: number;
  maxHomesPerRelay: number;
  cloudCustomerCount: number;
  totalAccessories: number;
}

export interface ManagedUserSummary {
  id: string;
  email: string;
  name: string | null;
  isActive: boolean;
  relayConnected: boolean;
  homeCount: number;
  capacity: number;
  pendingEnrollmentCount: number;
  activeEnrollmentCount: number;
  relaySessionId: string | null;
  region: string | null;
}

export interface ManagedUsersResult {
  users: ManagedUserSummary[];
  totalCount: number;
}

export interface ManagedUserHome {
  homeId: string;
  homeName: string;
  accessoryCount: number;
  roomCount: number;
  customerEmail: string | null;
  customerName: string | null;
  enrollmentStatus: string | null;
}

export interface ManagedUserDetail {
  id: string;
  email: string;
  name: string | null;
  isActive: boolean;
  relayConnected: boolean;
  region: string | null;
  homes: ManagedUserHome[];
}

export interface ManagedEnrollmentInfo {
  id: string;
  customerEmail: string;
  customerName: string | null;
  homeName: string;
  managedUserEmail: string | null;
  status: string;
  matchedHomeId: string | null;
  matchedHomeName: string | null;
  createdAt: string;
  matchedAt: string | null;
  region: string | null;
}

export interface ManagedEnrollmentsResult {
  enrollments: ManagedEnrollmentInfo[];
  totalCount: number;
  hasMore: boolean;
}

export interface CreateManagedUserResult {
  success: boolean;
  userId: string | null;
  error: string | null;
}

export interface ManagedAssignResult {
  success: boolean;
  error: string | null;
}

// Managed relay dashboard types
export interface ManagedRelayHomeInfo {
  homeId: string;
  homeName: string;
  accessoryCount: number;
  roomCount: number;
  customerEmail: string | null;
  customerName: string | null;
  customerAccountType: string | null;
  enrollmentStatus: string | null;
  enrollmentCreatedAt: string | null;
  enrollmentMatchedAt: string | null;
  recentControlCommands: number;
  recentCharacteristicUpdates: number;
  customerHasSubscription: boolean;
  webClientCount: number;
  subscriptionCount: number;
  webhookCount: number;
}

export interface ManagedRelayInfo {
  email: string;
  relayConnected: boolean;
  homeCount: number;
  maxHomes: number;
  homes: ManagedRelayHomeInfo[];
  pendingEnrollmentCount: number;
  activeEnrollmentCount: number;
  relayConnectedSince: string | null;
  totalWebClientCount: number;
  totalSubscriptionCount: number;
  totalWebhookCount: number;
}

export interface MyManagedRelayInfoResponse {
  myManagedRelayInfo: ManagedRelayInfo | null;
}

// Managed relay log types
export interface ManagedRelayWebhookDelivery {
  id: string;
  webhookId: string;
  webhookName: string;
  webhookUrl: string;
  customerEmail: string;
  homeName: string | null;
  eventType: string;
  eventId: string;
  status: string;
  attemptNumber: number;
  maxAttempts: number;
  responseStatusCode: number | null;
  latencyMs: number | null;
  errorMessage: string | null;
  createdAt: string | null;
  nextRetryAt: string | null;
}

export interface ManagedRelayDeliveriesResponse {
  managedRelayWebhookDeliveries: {
    deliveries: ManagedRelayWebhookDelivery[];
    totalCount: number;
  } | null;
}

export interface ManagedRelayActivityDay {
  date: string;
  controlCommands: number;
  characteristicUpdates: number;
}

export interface ManagedRelayHomeActivity {
  homeId: string;
  homeName: string;
  customerEmail: string | null;
  days: ManagedRelayActivityDay[];
  totalCommands: number;
  totalUpdates: number;
}

export interface ManagedRelayActivityResponse {
  managedRelayActivity: {
    homes: ManagedRelayHomeActivity[];
    totalCommands: number;
    totalUpdates: number;
  } | null;
}

export interface ManagedRelayServerLogEntry {
  timestamp: string;
  severity: string;
  message: string;
  metadata: string | null;
}

export interface ManagedRelayServerLogsResponse {
  managedRelayServerLogs: {
    entries: ManagedRelayServerLogEntry[];
    totalCount: number;
  } | null;
}

export interface ManagedRelayRecentLogEntry {
  timestamp: string;
  logType: string;
  summary: string;
  status: string;
  latencyMs: number | null;
  homeName: string | null;
}

export interface ManagedRelayRecentLogsResponse {
  managedRelayRecentLogs: {
    entries: ManagedRelayRecentLogEntry[];
  } | null;
}

// Customer-facing cloud managed types
export interface CustomerEnrollmentInfo {
  id: string;
  homeName: string;
  status: string;
  inviteEmail: string | null;
  matchedHomeName: string | null;
  needsHomeId: boolean;
  createdAt: string;
  matchedAt: string | null;
  region: string | null;
}

export interface CloudManagedCheckoutResult {
  success: boolean;
  checkoutUrl: string | null;
  enrollmentId: string | null;
  error: string | null;
}

export interface MyCloudManagedEnrollmentsResponse {
  myCloudManagedEnrollments: CustomerEnrollmentInfo[];
}

export interface CreateCloudManagedCheckoutResponse {
  createCloudManagedCheckout: CloudManagedCheckoutResult;
}

export interface CancelCloudManagedEnrollmentResponse {
  cancelCloudManagedEnrollment: boolean;
}

export interface ResolveCloudManagedHomeIdResponse {
  resolveCloudManagedHomeId: {
    success: boolean;
    error: string | null;
  };
}

// --- Observability Types ---

export interface TraceSummaryEntry {
  traceId: string;
  action: string | null;
  accessoryName: string | null;
  userEmail: string | null;
  userId: string | null;
  startTime: string;
  endTime: string | null;
  totalLatencyMs: number | null;
  success: boolean | null;
  error: string | null;
  hopCount: number;
  usedPubsub: boolean;
  classification: string;
  clientType: string | null;
  originInstance: string | null;
}

export interface TracesResult {
  traces: TraceSummaryEntry[];
  totalCount: number;
}

export interface TracesResponse {
  traces: TracesResult;
}

export interface TraceDetailResult {
  traceId: string;
  logs: AdminLogEntry[];
}

export interface TraceDetailResponse {
  traceDetail: TraceDetailResult;
}

// --- Analytics Dashboard Types ---

export interface TimeseriesPoint {
  date: string;
  value: number;
}

export interface AnalyticsKPIs {
  totalUsers: number;
  signupsThisPeriod: number;
  activeUsers: number;
  paidSubscribers: number;
  mrrEstimate: number;
  totalHomes: number;
  totalAccessories: number;
}

export interface AccountTypeBreakdown {
  free: number;
  standard: number;
  cloud: number;
  managed: number;
  waitlist: number;
}

export interface EngagementData {
  dailyActiveUsers: TimeseriesPoint[];
  controlCommands: TimeseriesPoint[];
  characteristicUpdates: TimeseriesPoint[];
}

export interface ConversionData {
  totalUsers: number;
  paidUsers: number;
  conversionRate: number;
  accountTypeBreakdown: AccountTypeBreakdown;
}

export interface GA4TrafficSource {
  source: string;
  sessions: number;
}

export interface GA4TrafficData {
  sessions: TimeseriesPoint[];
  pageViews: TimeseriesPoint[];
  users: TimeseriesPoint[];
  newUsers: TimeseriesPoint[];
  topSources: GA4TrafficSource[];
  deviceDesktop: number;
  deviceMobile: number;
  deviceTablet: number;
  propertyName: string;
  available: boolean;
  error: string | null;
}

export interface AppInstallsData {
  iosDownloads: TimeseriesPoint[];
  macDownloads: TimeseriesPoint[];
  iosImpressions: TimeseriesPoint[];
  iosProductPageViews: TimeseriesPoint[];
  androidInstalls: TimeseriesPoint[];
  iosAvailable: boolean;
  androidAvailable: boolean;
  iosError: string | null;
  androidError: string | null;
}

export interface AnalyticsDashboard {
  environment: string;
  kpis: AnalyticsKPIs;
  signups: TimeseriesPoint[];
  accountTypes: AccountTypeBreakdown;
  engagement: EngagementData;
  conversion: ConversionData;
  ga4Traffic: GA4TrafficData | null;
  appInstalls: AppInstallsData | null;
}

export interface AnalyticsInternalData {
  environment: string;
  kpis: AnalyticsKPIs;
  signups: TimeseriesPoint[];
  accountTypes: AccountTypeBreakdown;
  engagement: EngagementData;
  conversion: ConversionData;
}

export interface AnalyticsExternalData {
  ga4Traffic: GA4TrafficData | null;
  appInstalls: AppInstallsData | null;
}

export interface AnalyticsDashboardResponse {
  analyticsDashboard: AnalyticsDashboard;
}

export interface AnalyticsInternalResponse {
  analyticsInternal: AnalyticsInternalData;
}

export interface AnalyticsExternalResponse {
  analyticsExternal: AnalyticsExternalData;
}

// --- Cost & Revenue Types ---

export interface GCPServiceCost {
  service: string;
  cost: number;
  percentage: number;
}

export interface GCPSKUCost {
  sku: string;
  service: string;
  cost: number;
}

export interface GCPEnvironmentCost {
  environment: string;
  cost: number;
}

export interface GCPBillingData {
  totalCost: number;
  totalCredits: number;
  netCost: number;
  costByService: GCPServiceCost[];
  costBySku: GCPSKUCost[];
  costByEnvironment: GCPEnvironmentCost[];
  dailyCosts: TimeseriesPoint[];
  costPerUser: number;
  available: boolean;
  error: string | null;
}

export interface StripeSubscriptionBreakdown {
  standard: number;
  cloud: number;
}

export interface StripeRevenueData {
  mrr: number;
  totalRevenue: number;
  netRevenue: number;
  totalRefunds: number;
  activeSubscriptions: number;
  subscriptionBreakdown: StripeSubscriptionBreakdown | null;
  newSubscriptions: number;
  churnedSubscriptions: number;
  churnRate: number;
  revenueTimeseries: TimeseriesPoint[];
  available: boolean;
  error: string | null;
}

export interface ProfitLossData {
  totalRevenue: number;
  totalCost: number;
  netProfit: number;
  marginPercentage: number;
  revenueTimeseries: TimeseriesPoint[];
  costTimeseries: TimeseriesPoint[];
}

export interface CostRevenueData {
  gcpBilling: GCPBillingData | null;
  stripeRevenue: StripeRevenueData | null;
  profitLoss: ProfitLossData | null;
}

export interface CostRevenueResponse {
  costsAndRevenue: CostRevenueData;
}

// ---- Push Notifications ----

export interface PushTokenInfo {
  id: string;
  platform: string;
  deviceName: string | null;
  deviceFingerprint: string;
  createdAt: string;
  lastUsedAt: string | null;
}

export interface NotificationPreferenceInfo {
  id: string;
  scope: string;
  scopeId: string | null;
  pushEnabled: boolean;
  emailEnabled: boolean;
  localEnabled: boolean;
}

export interface NotificationLogInfo {
  id: string;
  automationId: string | null;
  homeId: string | null;
  title: string | null;
  message: string;
  channelsSent: string;
  channelsFailed: string | null;
  rateLimited: boolean;
  createdAt: string;
}

export interface GetPushTokensResponse {
  pushTokens: PushTokenInfo[];
}

export interface GetNotificationPreferencesResponse {
  notificationPreferences: NotificationPreferenceInfo[];
}

export interface GetNotificationHistoryResponse {
  notificationHistory: NotificationLogInfo[];
}

export interface RegisterPushTokenResponse {
  registerPushToken: { success: boolean; error: string | null };
}

export interface SetNotificationPreferenceResponse {
  setNotificationPreference: { success: boolean; error: string | null };
}

export interface SendTestNotificationResponse {
  sendTestNotification: boolean;
}

