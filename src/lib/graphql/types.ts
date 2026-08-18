import type { SummarySectionId, HomeActionId } from '@/lib/summary-sections';

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
  subscriptionSource: 'stripe' | 'apple' | null;
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

export interface MappedAccessory {
  manufacturer: string;
  model: string;
}

export interface AccessoryPriceInfo {
  productName: string;
  imageUrl: string | null;
  currency: string;
  marketplace: string;
  dealUrl: string;
  currentPrice: string | null;
  regularPrice: string | null;
  allTimeLow: string | null;
  allTimeLowDate: string | null;
  avg30dPrice: string | null;
  trackedSince: string | null;
  lastCheckedAt: string | null;
  pricePointCount: number;
  isNearAtl: boolean;
  /** See DealInfo.baselineSource. */
  baselineSource: 'list_price' | 'average';
  priceHistory: PricePoint[];
  deal: DealInfo | null;
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
  /** Whether allTimeLow rests on enough observations to be worth showing. */
  atlIsMeaningful: boolean;
  /** "list_price" when Amazon advertised a was-price, "average" when regularPrice is our rolling 30-day mean. */
  baselineSource: 'list_price' | 'average';
  mappings?: MappedAccessory[];
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
  /** "connected" | "reconnecting" | "offline" — relayConnected is the
   *  grace-applied boolean (reconnecting counts as connected). */
  relayState?: string;
  relayLastSeenAt?: string | null;
  relayId?: string | null;
  relayOwnerEmail?: string | null;
  isCloudManaged?: boolean;
  roomFingerprint?: string;
  ownerEmail?: string;
  /** Whether the relay's Apple ID can edit this home in Apple Home
   *  ("Add & Edit Accessories"). null/undefined = unknown (older relay). */
  isAdmin?: boolean | null;
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
  /** HomeKit action-set type (built-ins can't be deleted). Newer relays only. */
  actionSetType?: string;
  /** Non-null when the scene is an automation's action list — delete the
   *  automation instead of the scene. Newer relays only. */
  automationName?: string | null;
  /** The scene's characteristic writes. Cloud GraphQL serializes as a JSON
   *  string; CE returns the raw array. Newer relays only. */
  actions?: AutomationAction[] | string | null;
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

/**
 * Where a member is in the invite lifecycle.
 * - `awaiting_signup` — invited, but nobody has signed up with that email yet.
 * - `awaiting_acceptance` — they have an account; the invitation is unanswered.
 * - `active` — accepted; the home is in their list.
 */
export type HomeMemberStatus = 'awaiting_signup' | 'awaiting_acceptance' | 'active';

export interface HomeMemberInfo {
  id: string;
  homeId: string;
  email: string;
  name: string | null;
  role: string;
  /** @deprecated Use `status` — this is only ever `awaiting_signup`. */
  isPending: boolean;
  status: HomeMemberStatus;
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

// Pinned tab bar item (mobile bottom navigation).
//
// Declared in `lib/pinned-tabs.ts` — a leaf the tab bar, the settings pane and
// every pinnable tile can import without dragging this module in with it. Kept
// exported here because the settings blob below embeds it and a good many
// callers already reach for it from this file.
export type { PinnedTab, PinnedTabType, PinTarget } from '@/lib/pinned-tabs';
import type { PinnedTab } from '@/lib/pinned-tabs';

// Per-device display/layout settings (stored under devices[deviceId] in settings blob)
export interface DeviceDisplaySettings {
  compactMode?: boolean;
  hideInfoDevices?: boolean;
  hideAccessoryCounts?: boolean;
  layoutMode?: 'grid' | 'masonry';
  groupByRoom?: boolean;
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
  'layoutMode', 'groupByRoom', 'iconStyle',
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
  // For room/accessory/group entities, the parent home ID. NOT always a home:
  // for collection_group this carries a collection id, and for a home share it
  // is normally null (entityId is the home). Resolve via homeKeyForSharedEntity.
  homeId?: string | null;
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

export interface PublicEntitySetServiceGroupResponse {
  publicEntitySetServiceGroup: {
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
  /**
   * Arrangement of the Scenes section's cards, as prefixed keys
   * (`action:lights`, `scene:<uuid>`). See lib/home-cards.ts — the two kinds
   * share no id space, and a key that no longer resolves is skipped rather
   * than pruned, because a shortcut comes and goes with the home's contents.
   */
  sceneCardOrder?: string[];
  visibility?: {
    hiddenRooms?: string[];
    /** Summary-row pills turned off for this home. Absent = all shown. */
    hiddenSummarySections?: SummarySectionId[];
    /** Individual Actions turned off for this home. Absent = all shown. */
    hiddenActions?: HomeActionId[];
    /** Individual Apple Home scenes turned off for this home, by scene id. */
    hiddenScenes?: string[];
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
  // True when the share's target accessory / service group no longer exists
  // on the relay (renamed or removed in HomeKit). Lets the UI distinguish a
  // stale share from a relay that's offline.
  entityMissing?: boolean;
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
  lastHeartbeat: string | null;
}

// Live snapshot of a single pod, as collected by the admin /internal/metrics
// fanout. `reachable=false` means the pod was discovered by the K8s
// Endpoints API but didn't respond inside the fanout timeout.
export interface PodSnapshot {
  podName: string;
  reachable: boolean;
  timestamp: string | null;
  webConnections: number;
  deviceConnections: number;
}

export interface AdminSystemDiagnostics {
  serverInstances: AdminServerInstance[];
  podSnapshots: PodSnapshot[];
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
  crossPodFanouts: number;
  relayRedirectsSent: number;
  webClientRedirectsSent: number;
  localityRate: number;
  hmacRejectedTotal: number;
}

export interface PeerRegistryEntry {
  podName: string;
  ip: string;
  status: 'live' | 'recently_dropped';
  ageSeconds: number | null;
}

export interface AdminInfrastructureStatus {
  deploymentMode: string;
  consistentHashEnabled: boolean;
  currentInstance: string;
  hashRing: AdminHashRingState;
  hpa: AdminHPAStatus | null;
  podMetrics: AdminPodMetric[];
  routingMetrics: AdminRoutingMetrics;
  peerRegistry: PeerRegistryEntry[];
}

export interface AdminInfrastructureStatusResponse {
  infrastructureStatus: AdminInfrastructureStatus;
}

export interface AdminMQTTBridgeStatus {
  enabled: boolean;
  connected: boolean;
  brokerHost: string | null;
  brokerPort: number | null;
  subscribedHomesCount: number;
  customBrokersCount: number;
  initialStateDone: boolean;
}

export interface AdminMQTTBridgeStatusResponse {
  mqttBridgeStatus: AdminMQTTBridgeStatus;
}

export interface AdminDatabasePoolStatus {
  poolSize: number;
  checkedOut: number;
  overflow: number;
  checkedIn: number;
  totalConnections: number;
}

export interface AdminDatabasePoolStatusResponse {
  databasePoolStatus: AdminDatabasePoolStatus;
}

export interface AdminDatabaseTableSize {
  schema: string;
  tableName: string;
  totalBytes: number;
  tableBytes: number;
  indexBytes: number;
  rowEstimate: number;
}

export interface AdminDatabaseSlowQuery {
  pid: number;
  durationSeconds: number;
  state: string;
  query: string;
  applicationName: string | null;
}

export interface AdminDatabaseStats {
  databaseSizeBytes: number;
  activeConnections: number;
  idleConnections: number;
  idleInTransaction: number;
  totalConnections: number;
  maxConnections: number;
  transactionsCommitted: number;
  transactionsRolledBack: number;
  cacheHitRatio: number;
  tuplesReturned: number;
  tuplesFetched: number;
  tuplesInserted: number;
  tuplesUpdated: number;
  tuplesDeleted: number;
  deadlocks: number;
  topTables: AdminDatabaseTableSize[];
  slowQueries: AdminDatabaseSlowQuery[];
}

export interface AdminDatabaseStatsResponse {
  databaseStats: AdminDatabaseStats;
}

export interface AdminTimeSeriesPoint {
  timestamp: string;
  value: number;
}

export interface AdminTimeSeriesResult {
  metric: string;
  unit: string;
  points: AdminTimeSeriesPoint[];
}

export interface AdminTimeSeriesResponse {
  infrastructureTimeSeries: AdminTimeSeriesResult;
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

// --- Relays (AdminRelays / AdminRelayDetail) ---
//
// A relay is a user account running the Mac app in cloud mode — there is no
// relay table. `kind` splits Homecast's own fleet Macs from customers'
// self-hosted ones. Community-mode relays never contact the cloud, so they
// can't appear in any of these.

export type RelayKind = 'cloud' | 'self_hosted' | 'retired';
export type RelayState = 'connected' | 'reconnecting' | 'offline' | 'retired' | 'never';

/** What the relay reports about itself on connect. Null for any build older
 *  than the telemetry protocol. */
export interface RelayTelemetry {
  appVersion: string | null;
  appBuild: string | null;
  osVersion: string | null;
  deviceModel: string | null;
  hostname: string | null;
  platform: string | null;
}

export interface AdminRelayRow {
  userId: string;
  email: string;
  name: string | null;
  kind: RelayKind;
  accountType: string;
  relayState: RelayState;
  region: string | null;
  isActive: boolean;
  sessionCount: number;
  lastSeenAt: string | null;
  lastHeartbeat: string | null;
  homeCount: number;
  accessoryCount: number;
  roomCount: number;
  /** Free home slots — cloud relays only, null for self-hosted. */
  capacity: number | null;
  pendingEnrollmentCount: number;
  uptimePercent7d: number;
  verifiedRatio7d: number;
  currentStatus: string;
  telemetry: RelayTelemetry | null;
}

/** Aggregates over the whole filtered set, not just the current page. */
export interface AdminRelayTotals {
  total: number;
  /** Excludes retired relays — they own nothing and hold no session. */
  active: number;
  retired: number;
  online: number;
  homes: number;
  accessories: number;
  degraded: number;
}

export interface AdminRelayListResult {
  relays: AdminRelayRow[];
  totalCount: number;
  totals: AdminRelayTotals;
}

export interface AdminRelaySessionInfo {
  id: string;
  deviceId: string | null;
  name: string | null;
  clientType: string | null;
  instanceId: string | null;
  connectedAt: string | null;
  lastHeartbeat: string | null;
  homeIds: string[];
  telemetry: RelayTelemetry | null;
}

export interface AdminRelayHomeInfo {
  homeId: string;
  hcId: string | null;
  name: string;
  accessoryCount: number | null;
  roomCount: number | null;
  memberCount: number;
  isPrimary: boolean | null;
  /** Relay's Apple ID can edit this home in Apple Home. Null = older relay. */
  isAdmin: boolean | null;
  mqttEnabled: boolean;
  mqttBrokerCount: number;
  bindCode: string | null;
  unmatched: boolean;
  firstSeenAt: string | null;
  updatedAt: string | null;
  customerEmail: string | null;
  enrollmentStatus: string | null;
  currentStatus: string;
  uptimePercent7d: number;
}

export interface AdminRelayActivityDay {
  date: string;
  commands: number;
  updates: number;
}

export interface AdminRelayActivity {
  days: number;
  commands: number;
  updates: number;
  /** When a command last went through this relay (hour-granular), or null. */
  lastCommandAt: string | null;
  daily: AdminRelayActivityDay[];
}

export interface AdminRelayEnrollmentInfo {
  id: string;
  status: string;
  customerEmail: string | null;
  homeName: string | null;
  matchedHomeId: string | null;
  createdAt: string | null;
  matchedAt: string | null;
}

export interface AdminRelayDetailInfo {
  userId: string;
  email: string;
  name: string | null;
  kind: RelayKind;
  accountType: string;
  relayState: RelayState;
  region: string | null;
  isActive: boolean;
  isAdminUser: boolean;
  createdAt: string | null;
  lastLoginAt: string | null;
  lastSeenAt: string | null;
  subscriptionSource: string | null;
  capacity: number | null;
  maxHomesPerRelay: number | null;
  accessoryLimit: number | null;
  telemetry: RelayTelemetry | null;
  sessions: AdminRelaySessionInfo[];
  homes: AdminRelayHomeInfo[];
  activity: AdminRelayActivity | null;
  enrollments: AdminRelayEnrollmentInfo[];
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
  // Both ids are selected by GET_ALL_ENROLLMENTS and used to build deep links,
  // but were missing here — the pages read them through an untyped hole.
  customerUserId: string | null;
  homeName: string;
  managedUserEmail: string | null;
  managedUserId: string | null;
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
  enrollmentId: string | null;
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
  automationCount?: number;
  mqttEnabled?: boolean;
  /** Whether the relay's Apple ID can edit this home in Apple Home.
   *  null/undefined = unknown (older relay). */
  isAdmin?: boolean | null;
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
  relayLastSeenAt: string | null;
  totalWebClientCount: number;
  totalSubscriptionCount: number;
  totalWebhookCount: number;
}

export interface MyManagedRelayInfoResponse {
  myManagedRelayInfo: ManagedRelayInfo | null;
}

export interface RelayPendingInvite {
  id: string;
  customerAppleId: string | null;
  customerEmail: string | null;
  region: string | null;
  status: string;
  createdAt: string;
  acceptWindowOpen: boolean;
  acceptWindowExpiresAt: string | null;
}

export interface RelayCandidateHome {
  homeId: string;
  homeName: string;
  firstSeenAt: string | null;
  unmatched: boolean;
  removedByCustomer: boolean;
}

export interface RelayInviteBoard {
  pendingInvites: RelayPendingInvite[];
  candidateHomes: RelayCandidateHome[];
  acceptWindowOpen: boolean;
}

export interface MyRelayInviteBoardResponse {
  myRelayInviteBoard: RelayInviteBoard | null;
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
  matchedHomeId: string | null;
  matchedHomeName: string | null;
  needsHomeId: boolean;
  createdAt: string;
  matchedAt: string | null;
  region: string | null;
  codeEntryAvailable: boolean;
  customerAppleId: string | null;
}

export interface AdminUnboundHomeInfo {
  homeId: string;
  homeName: string;
  relayEmail: string;
  bindCode: string | null;
  firstSeenAt: string | null;
  inflightEnrollments: Array<{
    id: string;
    customerEmail: string;
    status: string;
    createdAt: string;
  }>;
}

export interface VerifyCloudManagedHomeResponse {
  verifyCloudManagedHome: {
    success: boolean;
    error: string | null;
  };
}

export interface UpdateEnrollmentAppleIdResponse {
  updateEnrollmentAppleId: {
    success: boolean;
    error: string | null;
  };
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
  relayLatencyMs: number | null;
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
  currency: string;
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

export interface LabeledCount {
  label: string;
  value: number;
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
  downloadsByCountry: LabeledCount[];
  downloadsBySource: LabeledCount[];
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

export interface Ga4TrafficResponse {
  ga4Traffic: GA4TrafficData | null;
}

export interface AppInstallsResponse {
  appInstalls: AppInstallsData | null;
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
  currency: string;
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

// ---- Community Edition telemetry ----

/** One bar in a distribution: a version, platform, category or feature. */
export interface CommunityLabelledCount {
  label: string;
  value: number;
  /** Share of the fleet, 0-100. */
  percent: number;
}

export interface CommunityDailyPoint {
  date: string;
  activeInstalls: number;
  newInstalls: number;
  totalAccessories: number;
  totalClients: number;
  actionsPerDay: number;
  /**
   * False for the current day. Relays report once a day at an install-specific
   * time, so the newest point always has only part of the fleet in it.
   */
  complete: boolean;
}

export interface CommunityKPIs {
  activeInstalls: number;
  activeInstalls7d: number;
  activeInstalls24h: number;
  newInstalls: number;
  totalHomes: number;
  totalAccessories: number;
  totalClients: number;
  medianAccessories: number;
  p90Accessories: number;
  p99Accessories: number;
  maxAccessories: number;
  actionsPerDay: number;
  /** Share of known installs that have reported today, 0-100. */
  reportedTodayPercent: number;
  /**
   * Relays that have reported but not yet on two separate days, so they are
   * excluded from every figure above. Lets an empty page distinguish
   * "nothing arrived" from "arriving, not yet trusted".
   */
  pendingInstalls: number;
}

export interface CommunityDeployment {
  /** Eight characters of a random install id — enough to tell rows apart. */
  installPrefix: string;
  appVersion: string;
  homes: number;
  rooms: number;
  accessories: number;
  automations: number;
  clients: number;
  actionsPerDay: number;
  ageDays: number;
  lastSeen: string;
}

export interface CommunityTelemetryData {
  kpis: CommunityKPIs;
  daily: CommunityDailyPoint[];
  versions: CommunityLabelledCount[];
  platforms: CommunityLabelledCount[];
  categories: CommunityLabelledCount[];
  features: CommunityLabelledCount[];
  clientKinds: CommunityLabelledCount[];
  accessoryBuckets: CommunityLabelledCount[];
  usage: CommunityLabelledCount[];
  largest: CommunityDeployment[];
}

export interface CommunityTelemetryResponse {
  communityTelemetry: CommunityTelemetryData;
}

// ---- Push Notifications ----

export interface NotificationMuteInfo {
  id: string;
  deviceFingerprint: string;
  scope: 'device' | 'home' | 'automation' | string;
  scopeId: string | null;
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

export interface GetNotificationMutesResponse {
  notificationMutes: NotificationMuteInfo[];
}

export interface GetNotificationHistoryResponse {
  notificationHistory: NotificationLogInfo[];
}

export interface RegisterPushTokenResponse {
  registerPushToken: { success: boolean; error: string | null };
}

export interface SetNotificationMuteResponse {
  setNotificationMute: { success: boolean; error: string | null };
}

export interface SendTestNotificationResponse {
  sendTestNotification: boolean;
}


// --- Characteristic History ---

export interface HistorySeriesInfo {
  accessoryId: string;
  characteristicType: string;
  kind: 'numeric' | 'bool' | 'enum' | 'string';
  unit: string | null;
  /** Effective recording state (override merged over profile default). */
  enabled: boolean;
  minIntervalS: number | null;
  deadband: number | null;
  firstTs: number | null;
  lastTs: number | null;
  sampleCount: number;
}

export interface HistoryPointData {
  ts: number;
  min: number;
  avg: number;
  max: number;
  last: number;
  count: number;
}

export interface HistoryStateSpanData {
  ts: number;
  value: number;
  /** string kind: the state's text (value is the 0 sentinel). */
  valueText?: string | null;
}

export interface HistoryStateBucketData {
  ts: number;
  dominant: number;
  /** string kind: the dominant state's text (dominant is the 0 sentinel). */
  dominantText?: string | null;
  /** JSON: Record<stateKey, msInState> — key is the raw string for string kind. */
  stateMsJson: string;
  transitions: number;
}

export interface HistorySeriesData {
  accessoryId: string;
  characteristicType: string;
  kind: 'numeric' | 'bool' | 'enum' | 'string';
  unit: string | null;
  resolution: 'raw' | 'hourly' | 'daily';
  prevValue: number | null;
  /** string kind: the LOCF seed's text. */
  prevValueText?: string | null;
  points: HistoryPointData[];
  states: HistoryStateSpanData[];
  stateBuckets: HistoryStateBucketData[];
}

export interface HistoryStorageStatsData {
  enabled: boolean;
  rawRetentionDays: number;
  seriesCount: number;
  sampleRows: number;
  rollupRows: number;
  estBytes: number;
  oldestTs: number | null;
}

export interface HistorySeriesRefInput {
  accessoryId: string;
  characteristicType: string;
}
